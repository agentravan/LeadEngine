// Called by Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
const config = require("../_lib/config");
const { runOnce } = require("../_lib/run");

module.exports = async (req, res) => {
  if (!config.cronSecret || req.headers.authorization !== `Bearer ${config.cronSecret}`)
    return res.status(401).json({ error: "Unauthorized" });
  try {
    const slot = String(req.query?.slot || "manual").replace(/[^a-z]/g, "");
    const result = await runOnce(slot);
    return res.status(result.ok ? 200 : 500).json(result);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
