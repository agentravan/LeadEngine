const config = require("./config");

const wordCount = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

// Adds the fixed opt-out line and signature so the AI can never alter them.
function composeEmail(body) {
  let clean = String(body || "").replace(/^.*reply ['"‘’]?no['"‘’]?.*$/gim, "");
  // Cut any sign-off block the AI added (Regards / Thanks / name) so the fixed signature is the only one.
  const cut = clean.search(/\n\s*(best regards|warm regards|kind regards|regards|thanks|thank you|best|cheers)[,!.]?\s*(\n|$)|\n\s*-?\s*harshit\b/i);
  if (cut > 0) clean = clean.slice(0, cut);
  clean = clean.trim();
  return `${clean}\n\n${config.optOut}\n\n${config.signature()}`;
}

function signOff(body) {
  const clean = String(body || "").trim();
  return /harshit/i.test(clean.split("\n").slice(-2).join(" ")) ? clean : `${clean}\n\n- Harshit`;
}

const reSubject = (s) => (/^re:/i.test(s || "") ? s : `Re: ${s || ""}`);

module.exports = { wordCount, composeEmail, signOff, reSubject };
