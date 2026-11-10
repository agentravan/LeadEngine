const nodemailer = require("nodemailer");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const config = require("./config");

let transport = null;
function smtp() {
  if (!transport) {
    if (!config.zohoEmail || !config.zohoPassword) throw new Error("ZOHO_EMAIL / ZOHO_APP_PASSWORD are not set");
    transport = nodemailer.createTransport({
      host: config.smtpHost,
      port: 465,
      secure: true,
      auth: { user: config.zohoEmail, pass: config.zohoPassword },
      connectionTimeout: 20000,
      socketTimeout: 30000,
    });
  }
  return transport;
}

function resetTransport() { transport = null; }

// System emails (OTP codes, security alerts). Throws on failure so the caller can report it.
async function sendSystemMail({ to, subject, text, html }) {
  const info = await smtp().sendMail({ from: { name: "LeadEngine Security", address: config.zohoEmail }, to, subject, text, html });
  if (info.rejected && info.rejected.length) throw new Error("Recipient refused");
  return info.messageId;
}

// Sends one plain-text email. Never throws for recipient problems: returns a status instead.
// status: "sent" | "rejected" (recipient refused = does not count) | "error" (temporary/our side)
async function sendMail({ to, subject, text, inReplyTo, references }) {
  const headers = {};
  try {
    const info = await smtp().sendMail({
      from: { name: config.sender.name, address: config.zohoEmail },
      to,
      subject,
      text,
      inReplyTo: inReplyTo || undefined,
      references: references || undefined,
      headers,
    });
    if (info.rejected && info.rejected.length) return { status: "rejected", reason: "Recipient refused by server", messageId: info.messageId };
    return { status: "sent", messageId: info.messageId };
  } catch (e) {
    const code = Number(e.responseCode) || 0;
    const reason = (e.response || e.message || "SMTP error").slice(0, 300);
    if (code >= 550 && code < 560 && /recipient|mailbox|user|address|not exist|unknown|invalid/i.test(reason))
      return { status: "rejected", reason };
    if (/daily.*limit|rate|too many|blocked|unusual activity|policy/i.test(reason)) return { status: "blocked", reason };
    return { status: "error", reason };
  }
}

// Reads messages that arrived in INBOX since `since`. Does not change read/unread state.
async function fetchInbox(since, max = 60) {
  const client = new ImapFlow({
    host: config.imapHost,
    port: 993,
    secure: true,
    auth: { user: config.zohoEmail, pass: config.zohoPassword },
    logger: false,
  });
  const out = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = (await client.search({ since }, { uid: true })) || [];
      for (const uid of uids.slice(-max)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const p = await simpleParser(msg.source);
        out.push({
          messageId: p.messageId || `uid-${uid}@inbox`,
          from: (p.from?.value?.[0]?.address || "").toLowerCase(),
          fromName: p.from?.value?.[0]?.name || "",
          subject: p.subject || "",
          text: (p.text || "").slice(0, 8000),
          date: p.date || new Date(),
          inReplyTo: p.inReplyTo || "",
          references: Array.isArray(p.references) ? p.references : p.references ? [p.references] : [],
          autoSubmitted: String(p.headers.get("auto-submitted") || "").toLowerCase(),
          contentType: String(p.headers.get("content-type")?.value || ""),
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

module.exports = { resetTransport, sendSystemMail, sendMail, fetchInbox };
