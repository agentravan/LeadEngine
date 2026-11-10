// Reads the Zoho inbox: marks bounces (they don't count toward the daily 10),
// stops follow-ups on replies, and answers interested replies automatically.
const config = require("./config");
const { db, logEvent } = require("./db");
const { fetchInbox, sendMail } = require("./mail");
const { chatJson } = require("./ai");
const { reSubject } = require("./text");

const BOUNCE_FROM = /mailer-daemon|postmaster|mail delivery|delivery subsystem/i;
const BOUNCE_SUBJECT = /undeliver|delivery status notification|delivery failure|failure notice|returned mail|could not be delivered|delivery has failed|mail delivery failed|not delivered/i;
const AUTO_SUBJECT = /out of office|automatic reply|auto[- ]?reply|autoreply|on leave|away from|vacation/i;

const REPLY_SYSTEM = `You handle replies to cold emails sent by ${config.sender.name} of ${config.sender.company} (${config.sender.city}, since ${config.sender.founded}). Services: ${config.sender.services}.
Classify the prospect's reply and, when appropriate, draft a short answer. Rules for the answer:
- Max 90 words, warm, plain text, no signature (added later).
- Never quote prices, fees, timelines, guarantees, client names or numbers. For pricing say Harshit will share a quote once he understands the requirement.
- Never claim things not in this prompt. Do not promise specific candidates exist.
- Move toward a next step: ask for the job description / number of roles / location, or offer a 10-minute call and ask for a convenient time or phone number.
- Match the prospect's language (English or Hinglish).
Categories: "interested" (wants profiles/details/call), "question" (asks something), "not_interested" (no, not now, remove, unsubscribe, stop), "already_have" (has HR/vendor, not needed), "out_of_office", "wrong_person" (forwarded/pointed to someone else), "other".
Reply with JSON: {"category":"", "summary":"one line", "should_reply": true/false, "reply":"", "needs_harshit": true/false}
should_reply = true only for interested, question, wrong_person. needs_harshit = true if they ask for pricing, a meeting time, contract terms, anything you cannot answer, or seem upset.`;

function sinceDays(n) {
  return new Date(Date.now() - n * 86400000);
}

async function loadContactedLeads(owner) {
  const { data, error } = await db()
    .from("leads")
    .select("*")
    .eq("owner_id", owner)
    .not("day0_sent_at", "is", null)
    .gte("day0_sent_at", sinceDays(60).toISOString());
  if (error) throw error;
  return data || [];
}

function findLead(leads, msg) {
  const exact = leads.find((l) => (l.email || "").toLowerCase() === msg.from);
  if (exact) return exact;
  const refs = [msg.inReplyTo, ...msg.references].filter(Boolean);
  const byThread = leads.find((l) => l.message_id && refs.includes(l.message_id));
  if (byThread) return byThread;
  const dom = msg.from.split("@")[1];
  return leads.find((l) => dom && (l.email || "").toLowerCase().endsWith("@" + dom)) || null;
}

async function processInbox(owner, deadline) {
  const stats = { checked: 0, bounces: 0, replies: 0, autoReplies: 0, stopped: 0, needsHarshit: 0, errors: [] };
  const leads = await loadContactedLeads(owner);
  if (!leads.length) return stats;
  const messages = await fetchInbox(sinceDays(4));

  for (const msg of messages) {
    if (Date.now() > deadline - 30000) break;
    if (!msg.from || msg.from === (config.zohoEmail || "").toLowerCase()) continue;
    // Skip anything already handled.
    const seen = await db().from("email_events").select("id").eq("owner_id", owner).eq("message_id", msg.messageId).maybeSingle();
    if (seen.data) continue;
    stats.checked++;
    try {
      // ---- Bounces ----
      if (BOUNCE_FROM.test(msg.from) || BOUNCE_SUBJECT.test(msg.subject) || /report-type=delivery-status/i.test(msg.contentType)) {
        const body = (msg.text || "").toLowerCase();
        const lead = leads.find((l) => l.email && body.includes(l.email.toLowerCase()) && ["sent", "followup"].includes(l.outreach_status));
        await logEvent(owner, lead?.id, "bounce", { message_id: msg.messageId, subject: msg.subject, from_email: msg.from, body: msg.text.slice(0, 2000) });
        if (lead) {
          await db().from("leads").update({ outreach_status: "bounced", bounce_reason: msg.subject.slice(0, 200), notes: appendNote(lead.notes, "Email bounced: " + msg.subject) }).eq("id", lead.id);
          lead.outreach_status = "bounced";
          stats.bounces++;
        }
        continue;
      }

      const lead = findLead(leads, msg);
      if (!lead) continue; // not related to outreach: leave it alone, don't log

      // ---- Out of office / auto replies: log only, keep follow-ups going ----
      if (AUTO_SUBJECT.test(msg.subject) || /auto-replied|auto-generated/.test(msg.autoSubmitted)) {
        await logEvent(owner, lead.id, "auto_reply_received", { message_id: msg.messageId, subject: msg.subject, from_email: msg.from, body: msg.text.slice(0, 2000) });
        continue;
      }

      // ---- Real reply ----
      stats.replies++;
      const thread = await recentThread(owner, lead.id);
      const decision = await chatJson(
        REPLY_SYSTEM,
        `Company: ${lead.name}\nWhat we pitched: ${lead.pitch || "HR / recruitment support"}\nOur first email:\n${lead.day0_body || ""}\n\nEarlier conversation:\n${thread}\n\nTheir new reply (from ${msg.fromName} <${msg.from}>):\n${stripQuoted(msg.text)}`,
        { maxTokens: 900, temperature: 0.3 }
      );
      await logEvent(owner, lead.id, "reply_received", {
        message_id: msg.messageId, subject: msg.subject, from_email: msg.from,
        body: stripQuoted(msg.text).slice(0, 4000), category: decision.category || "other",
      });

      const update = { last_reply_at: new Date().toISOString(), reply_count: (lead.reply_count || 0) + 1 };
      const stop = ["not_interested", "already_have"].includes(decision.category);
      if (stop) {
        update.outreach_status = "do_not_contact";
        update.status = "Lost";
        stats.stopped++;
      } else {
        update.outreach_status = "replied";
        if (["interested", "question"].includes(decision.category)) update.status = "Qualified";
      }

      const canAuto = decision.should_reply && decision.reply && !stop && (lead.auto_replies || 0) < config.maxAutoReplies;
      if (canAuto) {
        const r = await sendMail({
          to: msg.from,
          subject: reSubject(msg.subject || lead.day0_subject),
          text: `${String(decision.reply).replace(/\n*-?\s*Harshit[\s\S]*$/i, "").trim()}\n\n${config.signature()}`,
          inReplyTo: msg.messageId,
          references: [...msg.references, msg.messageId].join(" "),
        });
        await logEvent(owner, lead.id, "auto_reply_sent", { message_id: r.messageId || null, subject: reSubject(msg.subject), to_email: msg.from, body: decision.reply, category: r.status });
        if (r.status === "sent") { update.auto_replies = (lead.auto_replies || 0) + 1; stats.autoReplies++; }
      }
      const handOver = decision.needs_harshit || (!stop && !canAuto) || (lead.auto_replies || 0) + 1 >= config.maxAutoReplies;
      if (handOver && !stop) { update.outreach_status = "needs_harshit"; stats.needsHarshit++; }
      update.notes = appendNote(lead.notes, `Reply (${decision.category}): ${decision.summary || ""}`);
      await db().from("leads").update(update).eq("id", lead.id);
      Object.assign(lead, update);

      await notifyOwner(lead, msg, decision, canAuto, handOver && !stop);
    } catch (e) {
      stats.errors.push(`${msg.subject}: ${e.message}`.slice(0, 200));
    }
  }
  return stats;
}

async function recentThread(owner, leadId) {
  const { data } = await db().from("email_events").select("kind,body,created_at").eq("owner_id", owner).eq("lead_id", leadId)
    .in("kind", ["reply_received", "auto_reply_sent", "day3_sent", "day7_sent"]).order("created_at", { ascending: true }).limit(8);
  return (data || []).map((e) => `[${e.kind}] ${String(e.body || "").slice(0, 600)}`).join("\n") || "(none)";
}

function stripQuoted(text) {
  const lines = String(text || "").split("\n");
  const cut = lines.findIndex((l) => /^\s*>|^On .+wrote:$|^-{2,}\s*Original Message|^From:\s/i.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join("\n").trim().slice(0, 3000);
}

function appendNote(notes, line) {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${notes ? notes + "\n" : ""}[${stamp}] ${line}`.slice(-4000);
}

async function notifyOwner(lead, msg, decision, autoReplied, needsYou) {
  if (!config.notifyEmail) return;
  const head = needsYou ? "ACTION NEEDED" : autoReplied ? "Auto-replied" : "Reply logged";
  await sendMail({
    to: config.notifyEmail,
    subject: `[LeadEngine] ${head}: ${lead.name} (${decision.category})`,
    text: `${lead.name} replied (${decision.category}).\nSummary: ${decision.summary || "-"}\n\nTheir message:\n${stripQuoted(msg.text).slice(0, 1500)}\n\n${autoReplied ? "LeadEngine sent this reply:\n" + decision.reply : "No automatic reply was sent."}\n\n${needsYou ? "Please take over this conversation from your Zoho inbox." : ""}`,
  }).catch(() => {});
}

module.exports = { processInbox, stripQuoted, findLead };
