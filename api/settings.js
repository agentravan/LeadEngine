// Settings page API. GET shows which keys are saved (never the values), POST saves them, POST ?test=1 checks them.
const config = require("./_lib/config");
const { getOwnerId, claimOwner } = require("./_lib/db");
const { readSecrets, saveSecrets, describe, applySecrets } = require("./_lib/secrets");
const { body, userOf, noStore } = require("./_lib/http");

async function ownerFor(user, claim) {
  try { return await getOwnerId(); } catch (e) {
    if (!/No owner yet/.test(e.message)) throw e;
    return claim ? claimOwner(user.id) : null;
  }
}

async function test() {
  const out = {};
  try {
    const nodemailer = require("nodemailer");
    if (!config.zohoEmail || !config.zohoPassword) throw new Error("Zoho email or app password missing");
    const t = nodemailer.createTransport({ host: config.smtpHost, port: 465, secure: true, auth: { user: config.zohoEmail, pass: config.zohoPassword }, connectionTimeout: 15000 });
    await t.verify();
    out.zoho = { ok: true, msg: "Zoho login works" };
  } catch (e) { out.zoho = { ok: false, msg: e.response || e.message }; }
  try {
    const { search } = require("./_lib/web");
    const r = await search("HR consultancy Gurugram", 3);
    out.search = { ok: r.length > 0, msg: r.length ? `${config.searchProvider}: ${r.length} results` : "No results returned" };
  } catch (e) { out.search = { ok: false, msg: e.message }; }
  try {
    if (!config.aiKey) throw new Error("NVIDIA AI key missing");
    const r = await fetch(config.aiBaseUrl + "/models", { headers: { Authorization: "Bearer " + config.aiKey }, signal: AbortSignal.timeout(15000) });
    out.ai = { ok: r.ok, msg: r.ok ? "AI key accepted" : "AI key rejected (HTTP " + r.status + ")" };
  } catch (e) { out.ai = { ok: false, msg: e.message }; }
  return out;
}

module.exports = async (req, res) => {
  noStore(res);
  try {
    if (!config.supabaseServiceKey) return res.status(503).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set in Vercel yet." });
    const user = await userOf(req);
    if (!user) return res.status(401).json({ error: "Session expired. Sign in again." });

    if (req.method === "GET") {
      const owner = await ownerFor(user, false);
      if (owner && owner !== user.id) return res.status(403).json({ error: "Only the owner account can see Settings." });
      const values = owner ? await readSecrets(owner) : {};
      return res.json({ owner: !!owner, fields: describe(values), envDefaults: { searchProvider: config.searchProvider, aiModel: config.aiModel } });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const owner = await ownerFor(user, true);
    if (owner !== user.id) return res.status(403).json({ error: "Only the owner account can change Settings." });
    if (req.query?.test) {
      await applySecrets(owner);
      return res.json({ test: await test() });
    }
    const b = body(req);
    const values = await saveSecrets(owner, b.values || {}, b.clear || []);
    return res.json({ ok: true, fields: describe(values) });
  } catch (e) {
    const msg = /does not exist|relation/i.test(e.message) ? "Run supabase/004_secure_login_settings.sql in Supabase first." : e.message;
    return res.status(400).json({ error: msg });
  }
};
