// Sending: Day3/Day7 follow-ups, then new Day0 emails until 10 have gone out successfully today.
// Recipient rejections and bounces do not count toward the daily 10.
const config = require("./config");
const { db, logEvent, istDay } = require("./db");
const { sendMail } = require("./mail");
const { hasMx } = require("./web");
const { reSubject, signOff } = require("./text");

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = () => pause(4000 + Math.floor(Math.random() * 6000));

// Day0 emails that went out today (IST) and have not bounced.
async function deliveredToday(owner) {
  const { startUtc } = istDay();
  const { count, error } = await db().from("le_leads").select("id", { count: "exact", head: true })
    .eq("owner_id", owner).gte("day0_sent_at", startUtc.toISOString()).neq("outreach_status", "bounced");
  if (error) throw error;
  return count || 0;
}

async function sendFollowups(owner, deadline) {
  const stats = { day3: 0, day7: 0, errors: [] };
  const now = Date.now();
  const { data, error } = await db().from("le_leads").select("*").eq("owner_id", owner).eq("outreach_status", "sent")
    .not("day0_sent_at", "is", null).order("day0_sent_at", { ascending: true }).limit(200);
  if (error) throw error;
  let sent = 0;
  for (const lead of data || []) {
    if (sent >= config.followupLimit || Date.now() > deadline - 40000) break;
    const age = (now - Date.parse(lead.day0_sent_at)) / 86400000;
    let step = null;
    if (!lead.day3_sent_at && age >= 3 && lead.day3_body) step = "day3";
    else if (lead.day3_sent_at && !lead.day7_sent_at && age >= 7 && lead.day7_body) step = "day7";
    else if (!lead.day3_body && !lead.day7_body) continue;
    if (!step) {
      if (lead.day3_sent_at && (lead.day7_sent_at || !lead.day7_body) && age >= 7)
        await db().from("le_leads").update({ outreach_status: "completed" }).eq("id", lead.id);
      continue;
    }
    const r = await sendMail({
      to: lead.email,
      subject: reSubject(lead.day0_subject),
      text: signOff(lead[step + "_body"]),
      inReplyTo: lead.message_id || undefined,
      references: lead.message_id || undefined,
    });
    await logEvent(owner, lead.id, step + "_" + r.status, { message_id: r.messageId || null, subject: reSubject(lead.day0_subject), to_email: lead.email, body: lead[step + "_body"], category: r.reason || null });
    if (r.status === "sent") {
      const upd = { [step + "_sent_at"]: new Date().toISOString() };
      if (step === "day7") { upd.outreach_status = "completed"; upd.status = lead.status === "New Leads" || lead.status === "Contacted" ? "Lost" : lead.status; }
      await db().from("le_leads").update(upd).eq("id", lead.id);
      stats[step]++;
      sent++;
    } else if (r.status === "rejected") {
      await db().from("le_leads").update({ outreach_status: "bounced", bounce_reason: r.reason }).eq("id", lead.id);
    } else if (r.status === "blocked") {
      stats.errors.push("Zoho blocked sending: " + r.reason);
      stats.blocked = true;
      break;
    } else stats.errors.push(`${lead.name}: ${r.reason}`);
    await jitter();
  }
  return stats;
}

async function sendNew(owner, limit, deadline) {
  const stats = { sent: 0, rejected: 0, invalid: 0, errors: [], deliveredBefore: 0 };
  stats.deliveredBefore = await deliveredToday(owner);
  let need = limit - stats.deliveredBefore;
  if (need <= 0) return stats;
  const { data, error } = await db().from("le_leads").select("*").eq("owner_id", owner).eq("outreach_status", "queued")
    .order("score", { ascending: false }).order("created_at", { ascending: true }).limit(need * 3 + 5);
  if (error) throw error;

  for (const lead of data || []) {
    if (need <= 0 || Date.now() > deadline - 40000) break;
    if (!lead.email || !(await hasMx(lead.email))) {
      await db().from("le_leads").update({ outreach_status: "invalid_email" }).eq("id", lead.id);
      stats.invalid++;
      continue;
    }
    const r = await sendMail({ to: lead.email, subject: lead.day0_subject, text: lead.day0_body });
    await logEvent(owner, lead.id, "day0_" + r.status, { message_id: r.messageId || null, subject: lead.day0_subject, to_email: lead.email, body: lead.day0_body, category: r.reason || null });
    if (r.status === "sent") {
      await db().from("le_leads").update({
        outreach_status: "sent", day0_sent_at: new Date().toISOString(), message_id: r.messageId || null,
        status: lead.status === "New Leads" ? "Contacted" : lead.status,
      }).eq("id", lead.id);
      stats.sent++;
      need--;
    } else if (r.status === "rejected") {
      await db().from("le_leads").update({ outreach_status: "rejected", bounce_reason: r.reason }).eq("id", lead.id);
      stats.rejected++; // does not count, the loop moves to the next lead
    } else if (r.status === "blocked") {
      stats.errors.push("Zoho blocked sending: " + r.reason);
      stats.blocked = true;
      break;
    } else {
      stats.errors.push(`${lead.name}: ${r.reason}`);
      if (stats.errors.length >= 3) break; // SMTP/login problem: stop instead of hammering
    }
    await jitter();
  }
  stats.queueLeft = Math.max(0, (data || []).length - stats.sent - stats.rejected - stats.invalid);
  return stats;
}

async function queuedCount(owner) {
  const { count, error } = await db().from("le_leads").select("id", { count: "exact", head: true }).eq("owner_id", owner).eq("outreach_status", "queued");
  if (error) throw error;
  return count || 0;
}

module.exports = { sendFollowups, sendNew, deliveredToday, queuedCount };
