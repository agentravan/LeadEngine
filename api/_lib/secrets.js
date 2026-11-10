// Settings typed in the app (Zoho password, API keys). Stored encrypted in public.app_secrets,
// readable only with the service role key. Values are never sent back to the browser.
const crypto = require("crypto");
const config = require("./config");
const { db, getOwnerId } = require("./db");

// Fields the Settings page may set, with the config property each one fills.
const FIELDS = {
  zohoEmail: { label: "Zoho email", secret: false },
  zohoPassword: { label: "Zoho app password", secret: true },
  notifyEmail: { label: "Alert email", secret: false },
  aiKey: { label: "NVIDIA AI key", secret: true },
  aiModel: { label: "AI model", secret: false },
  searchProvider: { label: "Search provider", secret: false },
  searchKey: { label: "Search API key", secret: true },
  searchZone: { label: "Bright Data zone", secret: false },
  smtpHost: { label: "SMTP host", secret: false },
  imapHost: { label: "IMAP host", secret: false },
};
const PROVIDERS = ["serper", "tavily", "brave", "brightdata"];

function key() {
  if (!config.supabaseServiceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return crypto.createHash("sha256").update("leadengine-secrets:" + config.supabaseServiceKey).digest();
}
function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function decrypt(str) {
  const [iv, tag, enc] = String(str).split(".").map((s) => Buffer.from(s, "base64"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString("utf8"));
}

async function readSecrets(owner) {
  const { data, error } = await db().from("le_app_secrets").select("data").eq("owner_id", owner).maybeSingle();
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return {};
    throw error;
  }
  if (!data) return {};
  try { return decrypt(data.data); } catch { return {}; } // service key was rotated: values must be re-entered
}

function clean(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!FIELDS[k] || typeof v !== "string") continue;
    const t = v.trim();
    if (!t) continue;
    if (t.length > 500) throw new Error(FIELDS[k].label + " is too long");
    if (k === "searchProvider" && !PROVIDERS.includes(t.toLowerCase())) throw new Error("Search provider must be one of " + PROVIDERS.join(", "));
    if ((k === "zohoEmail" || k === "notifyEmail") && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) throw new Error(FIELDS[k].label + " is not a valid email");
    out[k] = k === "searchProvider" ? t.toLowerCase() : t;
  }
  return out;
}

async function saveSecrets(owner, patch, clear = []) {
  const current = await readSecrets(owner);
  const next = { ...current, ...clean(patch) };
  for (const k of clear || []) if (FIELDS[k]) delete next[k];
  const { error } = await db().from("le_app_secrets").upsert({ owner_id: owner, data: encrypt(next), updated_at: new Date().toISOString() });
  if (error) throw error;
  return next;
}

// What the browser may see: which fields are set, plus the last 4 characters of secrets.
function describe(values) {
  const out = {};
  for (const [k, f] of Object.entries(FIELDS)) {
    const v = values[k];
    out[k] = !v ? { set: false } : f.secret ? { set: true, hint: "••••" + String(v).slice(-4) } : { set: true, value: v };
  }
  return out;
}

const ENV_DEFAULTS = {};
let loadedFor = null;
// Merge saved settings over the environment-variable defaults. Call at the start of every request that uses them.
async function applySecrets(owner) {
  if (!Object.keys(ENV_DEFAULTS).length) for (const k of Object.keys(FIELDS)) ENV_DEFAULTS[k] = config[k];
  owner = owner || (await getOwnerId().catch(() => null));
  const values = owner ? await readSecrets(owner) : {};
  const before = config.zohoEmail + "|" + config.zohoPassword + "|" + config.smtpHost;
  for (const k of Object.keys(FIELDS)) config[k] = values[k] || ENV_DEFAULTS[k] || config[k];
  if (!config.notifyEmail) config.notifyEmail = config.zohoEmail;
  if (before !== config.zohoEmail + "|" + config.zohoPassword + "|" + config.smtpHost) require("./mail").resetTransport();
  loadedFor = owner;
  return values;
}

module.exports = { FIELDS, PROVIDERS, readSecrets, saveSecrets, describe, applySecrets };
