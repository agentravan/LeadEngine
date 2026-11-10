const { createClient } = require("@supabase/supabase-js");
const config = require("./config");

let client = null;
function db() {
  if (!client) {
    if (!config.supabaseServiceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

let ownerId = null;
async function getOwnerId() {
  if (ownerId) return ownerId;
  if (!config.ownerEmail) throw new Error("OWNER_EMAIL is not set");
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => (x.email || "").toLowerCase() === config.ownerEmail);
    if (u) return (ownerId = u.id);
    if (data.users.length < 200) break;
  }
  throw new Error(`No LeadEngine account found for OWNER_EMAIL ${config.ownerEmail}`);
}

async function getSettings(owner) {
  const { data, error } = await db().from("outreach_settings").select("*").eq("owner_id", owner).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const row = { owner_id: owner, automation_enabled: true, daily_limit: config.dailyLimit };
  const ins = await db().from("outreach_settings").insert(row).select().single();
  if (ins.error) throw ins.error;
  return ins.data;
}

async function logEvent(owner, leadId, kind, fields = {}) {
  const row = { owner_id: owner, lead_id: leadId || null, kind, ...fields };
  const { error } = await db().from("email_events").insert(row);
  // duplicate message ids are expected when an inbox message was already processed
  if (error && error.code !== "23505") throw error;
  return !error;
}

// Calendar day in India (IST, UTC+5:30) as YYYY-MM-DD plus its UTC start instant.
function istDay(d = new Date()) {
  const ist = new Date(d.getTime() + 330 * 60000);
  const day = ist.toISOString().slice(0, 10);
  const startUtc = new Date(Date.parse(day + "T00:00:00Z") - 330 * 60000);
  return { day, startUtc, weekday: ist.getUTCDay() };
}

module.exports = { db, getOwnerId, getSettings, logEvent, istDay };
