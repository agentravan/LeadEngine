const config = require("./config");
const { getOwnerId, getSettings, logEvent, istDay } = require("./db");
const { processInbox } = require("./inbox");
const { sendFollowups, sendNew, queuedCount } = require("./send");
const { hunt } = require("./hunt");

// One automation pass. slot: hunt | morning | noon | afternoon | evening | manual
async function runOnce(slot = "manual", budgetMs = 280000) {
  const started = Date.now();
  const deadline = started + budgetMs;
  const missing = config.missing(["supabaseServiceKey", "ownerEmail", "aiKey", "searchKey", "zohoEmail", "zohoPassword"]);
  if (missing.length) return { ok: false, error: "Missing environment variables: " + missing.join(", ") };

  const owner = await getOwnerId();
  const settings = await getSettings(owner);
  const report = { slot, day: istDay().day, paused: !settings.automation_enabled };
  if (!settings.automation_enabled) return { ok: true, ...report };
  const limit = Number(settings.daily_limit) || config.dailyLimit;
  const sunday = istDay().weekday === 0;

  // 1) Inbox first, so replies stop follow-ups and bounces free up today's quota.
  try { report.inbox = await processInbox(owner, deadline); } catch (e) { report.inbox = { error: e.message }; }

  if (slot === "hunt") {
    // Hunt-only pass: build tomorrow's / today's queue with the full time budget.
    try {
      const queued = await queuedCount(owner);
      const want = Math.min(15, Math.max(0, limit * 2 - queued));
      if (want > 0) report.hunt = await hunt(owner, want, deadline);
    } catch (e) { report.hunt = { error: e.message }; }
  } else if (slot !== "evening" && !sunday) {
    // 2) Top up the queue if needed.
    try {
      const queued = await queuedCount(owner);
      const want = Math.min(12, Math.max(0, limit + 3 - queued));
      if (want > 0) report.hunt = await hunt(owner, want, deadline - 120000);
    } catch (e) { report.hunt = { error: e.message }; }

    // 3) Follow-ups (morning only), then new emails up to the daily limit.
    try { if (slot === "morning" || slot === "manual") report.followups = await sendFollowups(owner, deadline); } catch (e) { report.followups = { error: e.message }; }
    try { report.send = await sendNew(owner, limit, deadline); } catch (e) { report.send = { error: e.message }; }
  }

  report.seconds = Math.round((Date.now() - started) / 1000);
  await logEvent(owner, null, "run", { body: JSON.stringify(report).slice(0, 4000), category: slot }).catch(() => {});
  return { ok: true, ...report };
}

module.exports = { runOnce };
