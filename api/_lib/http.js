// Small helpers shared by the API routes.
const { db } = require("./db");

function ipOf(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim().slice(0, 64);
}
function uaOf(req) {
  return String(req.headers["user-agent"] || "").slice(0, 200);
}
function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}"); } catch { return {}; }
}
// The signed-in Supabase user for this request, or null.
async function userOf(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await db().auth.getUser(token);
  return error ? null : data?.user || null;
}
function noStore(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

module.exports = { ipOf, uaOf, body, userOf, noStore };
