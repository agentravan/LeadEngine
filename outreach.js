// AI Outreach page. Uses the globals from app.js: db, user, esc, toast, $.
(function () {
  let oLeads = [], oSettings = null, oEvents = [];
  const STATUS_LABEL = {
    queued: "Queued", sent: "Sent", replied: "Replied", needs_harshit: "Needs you", manual: "WhatsApp/LinkedIn",
    bounced: "Bounced", rejected: "Rejected", invalid_email: "Invalid email", do_not_contact: "Do not contact",
    completed: "Sequence done", imported: "Imported",
  };
  const fmt = (t) => (t ? new Date(t).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
  const istStart = () => {
    const now = new Date(Date.now() + 330 * 60000);
    return new Date(Date.parse(now.toISOString().slice(0, 10) + "T00:00:00Z") - 330 * 60000);
  };

  async function load() {
    const [l, s, e] = await Promise.all([
      db.from("le_leads").select("id,name,email,phone,score,status,outreach_status,day0_subject,day0_body,day3_body,day7_body,whatsapp_msg,observations,pitch,day0_sent_at,day3_sent_at,day7_sent_at,last_reply_at,reply_count,auto_replies,notes,website,profile_url,created_at").not("outreach_status", "is", null).order("created_at", { ascending: false }).limit(500),
      db.from("le_outreach_settings").select("*").maybeSingle(),
      db.from("le_email_events").select("created_at,kind,category,subject,to_email,from_email,body,lead_id").order("created_at", { ascending: false }).limit(40),
    ]);
    const err = l.error || s.error || e.error;
    if (err) { toast(err.message.includes("does not exist") ? "Run the Supabase SQL setup first (supabase/001_ai_outreach.sql)." : err.message); return; }
    oLeads = l.data || []; oSettings = s.data; oEvents = e.data || [];
  }

  async function drawOutreach() {
    if (!user) return;
    await load();
    const start = istStart().getTime();
    const by = (st) => oLeads.filter((x) => x.outreach_status === st);
    $("oSentToday").textContent = oLeads.filter((x) => x.day0_sent_at && Date.parse(x.day0_sent_at) >= start && x.outreach_status !== "bounced").length + " / " + (oSettings?.daily_limit || 10);
    $("oQueue").textContent = by("queued").length;
    $("oNeeds").textContent = by("needs_harshit").length;
    $("oReplies").textContent = oLeads.filter((x) => (x.reply_count || 0) > 0).length;
    $("oBounced").textContent = by("bounced").length + by("rejected").length;
    $("oManual").textContent = by("manual").length;
    const on = oSettings ? oSettings.automation_enabled : true;
    $("autoToggle").textContent = on ? "⏸ Pause automation" : "▶ Resume automation";
    $("autoToggle").className = "btn" + (on ? "" : " primary");
    $("dailyLimit").value = oSettings?.daily_limit || 10;

    $("oNeedsRows").innerHTML = oLeads.filter((x) => ["needs_harshit", "replied"].includes(x.outreach_status)).map((x) =>
      `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.email)}</td><td>${fmt(x.last_reply_at)}</td><td style="white-space:pre-wrap;max-width:420px">${esc((x.notes || "").split("\n").slice(-2).join("\n"))}</td><td><button class="btn" onclick="openOutreach('${x.id}')">Open</button></td></tr>`
    ).join("") || `<tr><td colspan="5" class="muted">No replies waiting.</td></tr>`;

    const f = $("oFilter").value;
    $("oRows").innerHTML = oLeads.filter((x) => !f || x.outreach_status === f).slice(0, 200).map((x) =>
      `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.email || x.phone || "—")}</td><td>${x.score ?? ""}</td><td>${esc(STATUS_LABEL[x.outreach_status] || x.outreach_status)}</td><td>${fmt(x.day0_sent_at)}</td><td>${fmt(x.day3_sent_at)}</td><td>${fmt(x.day7_sent_at)}</td><td><button class="btn" onclick="openOutreach('${x.id}')">View</button></td></tr>`
    ).join("") || `<tr><td colspan="8" class="muted">Nothing here yet. The first automatic run will fill this list.</td></tr>`;

    const names = Object.fromEntries(oLeads.map((x) => [x.id, x.name]));
    $("oEvents").innerHTML = oEvents.map((ev) => {
      let detail = ev.subject || ev.category || "";
      if (["run", "hunt"].includes(ev.kind)) { try { detail = summarizeRun(JSON.parse(ev.body)); } catch { detail = ""; } }
      return `<tr><td>${fmt(ev.created_at)}</td><td>${esc(ev.kind.replace(/_/g, " "))}</td><td>${esc(names[ev.lead_id] || "")}</td><td>${esc(detail)}</td></tr>`;
    }).join("");
  }

  function summarizeRun(r) {
    if (r.added !== undefined) return `found ${r.added} new leads (${r.withEmail} with email)${r.errors?.length ? ", " + r.errors.length + " errors" : ""}`;
    const parts = [r.slot];
    if (r.paused) parts.push("paused");
    if (r.send) parts.push(r.send.error ? "send error: " + r.send.error : `sent ${r.send.sent || 0}, rejected ${r.send.rejected || 0}`);
    if (r.followups && !r.followups.error) parts.push(`follow-ups ${(r.followups.day3 || 0) + (r.followups.day7 || 0)}`);
    if (r.inbox) parts.push(r.inbox.error ? "inbox error: " + r.inbox.error : `replies ${r.inbox.replies || 0}, auto-replied ${r.inbox.autoReplies || 0}, bounces ${r.inbox.bounces || 0}`);
    if (r.hunt) parts.push(r.hunt.error ? "hunt error: " + r.hunt.error : `new leads ${r.hunt.added || 0}`);
    if (r.error) parts.push(r.error);
    return parts.join(" · ");
  }

  function openOutreach(id) {
    const x = oLeads.find((v) => v.id === id);
    if (!x) return;
    const block = (title, body) => body ? `<h3>${title}</h3><pre style="white-space:pre-wrap;font:inherit" class="card panel">${esc(body)}</pre>` : "";
    const wa = (x.phone || "").replace(/\D/g, "");
    $("modal").innerHTML = `<div class="modalbg"><div class="modal"><button class="btn" onclick="document.getElementById('modal').innerHTML=''">Close</button>
      <h2>${esc(x.name)}</h2><p>${esc(x.email || "No email")} · ${esc(x.phone || "")} · Score ${x.score ?? ""} · ${esc(STATUS_LABEL[x.outreach_status] || x.outreach_status)}</p>
      <p>${x.website ? `<a target="_blank" rel="noopener" href="${esc(x.website)}">Website</a> · ` : ""}${x.profile_url && /^https?:/.test(x.profile_url) ? `<a target="_blank" rel="noopener" href="${esc(x.profile_url)}">Source</a>` : ""}</p>
      ${block("Observations", x.observations)}${block("Subject: " + (x.day0_subject || ""), x.day0_body)}${block("Day 3", x.day3_body)}${block("Day 7", x.day7_body)}${block("WhatsApp / LinkedIn", x.whatsapp_msg)}${block("Notes", x.notes)}
      <div class="row">${x.whatsapp_msg && wa ? `<button class="btn" onclick="outreachWa('${x.id}')">Open WhatsApp</button>` : ""}
      ${x.outreach_status !== "do_not_contact" ? `<button class="btn" onclick="setOutreach('${x.id}','do_not_contact')">Do not contact</button>` : ""}
      ${["needs_harshit", "replied"].includes(x.outreach_status) ? `<button class="btn" onclick="setOutreach('${x.id}','completed')">Mark handled</button>` : ""}
      ${x.outreach_status === "queued" ? `<button class="btn" onclick="setOutreach('${x.id}','manual')">Don't email (manual)</button>` : ""}
      ${x.outreach_status === "manual" && x.email ? `<button class="btn" onclick="setOutreach('${x.id}','queued')">Queue email</button>` : ""}</div></div></div>`;
  }

  function outreachWa(id) {
    const x = oLeads.find((v) => v.id === id);
    let wa = (x?.phone || "").split("/")[0].replace(/\D/g, "");
    if (wa.length === 10) wa = "91" + wa;
    if (wa && x.whatsapp_msg) window.open("https://wa.me/" + wa + "?text=" + encodeURIComponent(x.whatsapp_msg), "_blank", "noopener");
  }

  async function setOutreach(id, st) {
    const { error } = await db.from("le_leads").update({ outreach_status: st }).eq("id", id);
    if (error) return toast(error.message);
    $("modal").innerHTML = "";
    toast("Updated.");
    drawOutreach();
  }

  async function saveSettings(patch) {
    const row = { owner_id: user.id, automation_enabled: oSettings ? oSettings.automation_enabled : true, daily_limit: oSettings?.daily_limit || 10, ...patch, updated_at: new Date().toISOString() };
    const { error } = await db.from("le_outreach_settings").upsert(row, { onConflict: "owner_id" });
    if (error) return toast(error.message);
    toast("Saved.");
    drawOutreach();
  }

  $("autoToggle").onclick = () => saveSettings({ automation_enabled: !(oSettings ? oSettings.automation_enabled : true) });
  $("saveLimit").onclick = () => saveSettings({ daily_limit: Math.min(30, Math.max(1, Number($("dailyLimit").value) || 10)) });
  $("oFilter").onchange = drawOutreach;
  $("runNow").onclick = async () => {
    const b = $("runNow");
    b.disabled = true;
    $("runMsg").textContent = "Running… this can take up to 5 minutes (finding leads, checking inbox, sending).";
    try {
      const { data } = await db.auth.getSession();
      const r = await fetch("/api/outreach/run", { method: "POST", headers: { Authorization: "Bearer " + (data.session?.access_token || "") } });
      const j = await r.json().catch(() => ({ error: "Invalid response (HTTP " + r.status + ")" }));
      $("runMsg").textContent = j.ok ? "Done: " + summarizeRun(j) : "Run failed: " + (j.error || "HTTP " + r.status);
    } catch (e) {
      $("runMsg").textContent = "Run failed: " + e.message;
    } finally {
      b.disabled = false;
      drawOutreach();
    }
  };

  window.drawOutreach = drawOutreach;
  window.openOutreach = openOutreach;
  window.setOutreach = setOutreach;
  window.outreachWa = outreachWa;
})();
