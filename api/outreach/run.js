// "Run now" button in the CRM. Only the owner account may trigger it.
const { db, getOwnerId } = require("../_lib/db");
const { runOnce } = require("../_lib/run");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Sign in first" });
    const { data, error } = await db().auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: "Session expired. Sign in again." });
    const owner = await getOwnerId();
    if (data.user.id !== owner) return res.status(403).json({ error: "Only the owner account can run outreach" });
    const result = await runOnce("manual");
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
