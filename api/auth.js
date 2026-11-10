// Login with lockout, and "Forgot password" with a 6-digit code sent by email (no reset links).
// POST /api/auth?action=login  { email, password }
// POST /api/auth?action=forgot { email }
// POST /api/auth?action=reset  { email, code, password }
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const config = require("./_lib/config");
const { db } = require("./_lib/db");
const { applySecrets } = require("./_lib/secrets");
const { ipOf, uaOf, body, noStore } = require("./_lib/http");

const LOCK_FAILS = 5;            // failed logins per email…
const LOCK_MIN = 15;             // …within this many minutes locks the email for the same time
const IP_FAILS = 25;             // failed logins per IP within LOCK_MIN
const OTP_MIN = 10;              // code lifetime
const OTP_TRIES = 5;             // wrong codes before the code dies
const OTP_GAP_S = 60;            // wait between codes
const OTP_PER_HOUR = 5;

const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254;
const since = (min) => new Date(Date.now() - min * 60000).toISOString();
const hashCode = (email, code) => crypto.createHmac("sha256", "otp:" + config.supabaseServiceKey).update(email + ":" + code).digest("hex");

async function log(req, email, kind, ok) {
  await db().from("le_auth_attempts").insert({ email, ip: ipOf(req), ua: uaOf(req), kind, ok }).then(() => {}, () => {});
}
async function count(filter) {
  let q = db().from("le_auth_attempts").select("id", { count: "exact", head: true });
  for (const [k, v] of Object.entries(filter)) q = k === "after" ? q.gte("created_at", v) : q.eq(k, v);
  const { count: n } = await q;
  return n || 0;
}
async function findUser(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db().auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const u = data.users.find((x) => normEmail(x.email) === email);
    if (u) return u;
    if (data.users.length < 200) return null;
  }
  return null;
}
function shell(title, inner) {
  return `<div style="font-family:Inter,Segoe UI,Arial,sans-serif;background:#f3f4f8;padding:28px">
  <div style="max-width:460px;margin:auto;background:#fff;border-radius:14px;border:1px solid #e3e6ef;overflow:hidden">
  <div style="background:#0d1424;color:#fff;padding:18px 24px;font-weight:700;font-size:17px">LeadEngine</div>
  <div style="padding:24px;color:#1b2333;font-size:14px;line-height:1.6"><h2 style="margin:0 0 10px;font-size:19px">${title}</h2>${inner}</div></div></div>`;
}
async function mailReady() {
  await applySecrets().catch(() => {});
  return !!(config.zohoEmail && config.zohoPassword);
}
async function alertNewDevice(req, user) {
  try {
    const ip = ipOf(req), ua = uaOf(req);
    const { count: seen } = await db().from("le_auth_attempts").select("id", { count: "exact", head: true })
      .eq("email", normEmail(user.email)).eq("kind", "login").eq("ok", true).eq("ip", ip).eq("ua", ua).gte("created_at", since(60 * 24 * 30));
    if (seen > 1 || !(await mailReady())) return; // >1 because this login is already logged
    const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const { sendSystemMail } = require("./_lib/mail");
    await sendSystemMail({
      to: user.email,
      subject: "New sign-in to LeadEngine",
      text: `New sign-in to your LeadEngine account.\nTime: ${when} IST\nIP: ${ip}\nDevice: ${ua}\n\nIf this was not you, use "Forgot password" now to change your password.`,
      html: shell("New sign-in", `<p>Your account was just used on a new device.</p><p><b>Time:</b> ${when} IST<br><b>IP:</b> ${ip}<br><b>Device:</b> ${ua.replace(/</g, "&lt;")}</p><p>If this was not you, open LeadEngine, choose <b>Forgot password</b> and set a new one.</p>`),
    });
  } catch { /* alerts are best effort */ }
}

async function login(req, res, b) {
  const email = normEmail(b.email), password = String(b.password || "");
  if (!validEmail(email) || !password) return res.status(400).json({ error: "Enter your email and password." });
  const fails = await count({ email, kind: "login", ok: false, after: since(LOCK_MIN) });
  const ipFails = await count({ ip: ipOf(req), kind: "login", ok: false, after: since(LOCK_MIN) });
  if (fails >= LOCK_FAILS || ipFails >= IP_FAILS)
    return res.status(429).json({ error: `Too many wrong attempts. Try again in ${LOCK_MIN} minutes or reset your password.`, lockedMinutes: LOCK_MIN });
  const anon = createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) {
    await log(req, email, "login", false);
    const left = Math.max(0, LOCK_FAILS - fails - 1);
    const msg = /confirm/i.test(error?.message || "") ? "Confirm your email first (check your inbox)." : "Email or password is wrong.";
    return res.status(401).json({ error: msg, attemptsLeft: left });
  }
  await log(req, email, "login", true);
  await alertNewDevice(req, data.user);
  const s = data.session;
  return res.json({ ok: true, session: { access_token: s.access_token, refresh_token: s.refresh_token } });
}

async function forgot(req, res, b) {
  const email = normEmail(b.email);
  if (!validEmail(email)) return res.status(400).json({ error: "Enter a valid email." });
  const generic = { ok: true, message: "If this email has a LeadEngine account, a 6-digit code is on its way.", resendIn: OTP_GAP_S };
  const { data: recent } = await db().from("le_auth_otps").select("created_at").eq("email", email).gte("created_at", since(60)).order("created_at", { ascending: false });
  if (recent?.length && Date.now() - Date.parse(recent[0].created_at) < OTP_GAP_S * 1000)
    return res.status(429).json({ error: "Please wait a minute before asking for another code." });
  if ((recent?.length || 0) >= OTP_PER_HOUR || (await count({ ip: ipOf(req), kind: "forgot", after: since(60) })) >= 15)
    return res.status(429).json({ error: "Too many code requests. Try again in an hour." });
  if (!(await mailReady())) return res.status(503).json({ error: "Email sending is not set up yet. Add the Zoho email and app password on the Settings page." });

  await log(req, email, "forgot", true);
  const user = await findUser(email);
  if (!user) return res.json(generic); // same answer, so nobody can test which emails have accounts

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await db().from("le_auth_otps").update({ used_at: new Date().toISOString() }).eq("email", email).is("used_at", null);
  const { error } = await db().from("le_auth_otps").insert({ email, code_hash: hashCode(email, code), expires_at: new Date(Date.now() + OTP_MIN * 60000).toISOString(), ip: ipOf(req) });
  if (error) throw error;
  const { sendSystemMail } = require("./_lib/mail");
  const spaced = code.split("").join(" ");
  await sendSystemMail({
    to: email,
    subject: `${code} is your LeadEngine reset code`,
    text: `Your LeadEngine password reset code is ${code}\nIt works for ${OTP_MIN} minutes. Never share it with anyone.\nIf you did not ask for this, ignore this email; your password stays the same.`,
    html: shell("Password reset code", `<p>Enter this code in LeadEngine to set a new password:</p>
      <p style="font:700 32px/1.2 'Courier New',monospace;letter-spacing:6px;background:#f3f4f8;border-radius:10px;padding:14px;text-align:center;margin:16px 0">${spaced}</p>
      <p>It works for <b>${OTP_MIN} minutes</b>. Never share it, LeadEngine will never ask for it.</p>
      <p style="color:#667085">Did not ask for this? Ignore this email. Your password stays the same.</p>`),
  });
  return res.json(generic);
}

async function reset(req, res, b) {
  const email = normEmail(b.email), code = String(b.code || "").replace(/\D/g, ""), password = String(b.password || "");
  if (!validEmail(email) || code.length !== 6) return res.status(400).json({ error: "Enter the 6-digit code from your email." });
  const { data: otp } = await db().from("le_auth_otps").select("*").eq("email", email).is("used_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!otp || Date.parse(otp.expires_at) < Date.now() || otp.attempts >= OTP_TRIES) {
    await log(req, email, "reset", false);
    return res.status(400).json({ error: "This code has expired. Ask for a new one.", expired: true });
  }
  const want = Buffer.from(String(otp.code_hash)), got = Buffer.from(hashCode(email, code));
  const good = want.length === got.length && crypto.timingSafeEqual(want, got);
  if (!good) {
    await db().from("le_auth_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
    await log(req, email, "reset", false);
    const left = OTP_TRIES - otp.attempts - 1;
    return res.status(400).json({ error: left > 0 ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.` : "Wrong code. Ask for a new one.", expired: left <= 0 });
  }
  if (b.checkOnly) return res.json({ ok: true }); // code is right; the browser now asks for the new password
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))
    return res.status(400).json({ error: "Use at least 8 characters with letters and numbers." });
  const user = await findUser(email);
  if (!user) return res.status(400).json({ error: "This code has expired. Ask for a new one.", expired: true });
  const { error } = await db().auth.admin.updateUserById(user.id, { password });
  if (error) return res.status(400).json({ error: error.message });
  await db().from("le_auth_otps").update({ used_at: new Date().toISOString() }).eq("id", otp.id);
  await log(req, email, "reset", true);
  try {
    const { sendSystemMail } = require("./_lib/mail");
    await sendSystemMail({ to: email, subject: "Your LeadEngine password was changed", text: "Your LeadEngine password was just changed. If this was not you, reset it again now.", html: shell("Password changed", "<p>Your LeadEngine password was just changed.</p><p>If this was not you, use <b>Forgot password</b> right away.</p>") });
  } catch { /* best effort */ }
  return res.json({ ok: true });
}

module.exports = async (req, res) => {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!config.supabaseServiceKey) return res.status(503).json({ error: "Server login is not set up yet.", fallback: true });
  const b = body(req);
  try {
    const a = String(req.query?.action || "");
    if (a === "login") return await login(req, res, b);
    if (a === "forgot") return await forgot(req, res, b);
    if (a === "reset") return await reset(req, res, b);
    return res.status(404).json({ error: "Unknown action" });
  } catch (e) {
    const missing = /does not exist|relation/i.test(e.message);
    return res.status(missing ? 503 : 500).json({ error: missing ? "Run supabase/004_secure_login_settings.sql in Supabase first." : "Something went wrong. Try again.", fallback: missing });
  }
};
