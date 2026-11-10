const dns = require("dns").promises;
const config = require("./config");

const UA = "Mozilla/5.0 (compatible; LeadEngineCRM/1.0; business research)";

// ---------- Web search (Serper, Tavily or Brave) ----------
async function search(query, num = 10) {
  if (!config.searchKey) throw new Error("SEARCH_API_KEY is not set");
  const p = config.searchProvider;
  const timeout = AbortSignal.timeout(20000);
  let items = [];
  if (p === "serper") {
    const r = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: { "X-API-KEY": config.searchKey, "Content-Type": "application/json" },
      body: JSON.stringify({ q: query, gl: "in", num }),
      signal: timeout,
    });
    if (!r.ok) throw new Error("Serper HTTP " + r.status);
    items = ((await r.json()).organic || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet }));
  } else if (p === "tavily") {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.searchKey },
      body: JSON.stringify({ api_key: config.searchKey, query, max_results: num, country: "india" }),
      signal: timeout,
    });
    if (!r.ok) throw new Error("Tavily HTTP " + r.status);
    items = ((await r.json()).results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
  } else if (p === "brave") {
    const r = await fetch("https://api.search.brave.com/res/v1/web/search?count=" + num + "&country=IN&q=" + encodeURIComponent(query), {
      headers: { "X-Subscription-Token": config.searchKey, Accept: "application/json" },
      signal: timeout,
    });
    if (!r.ok) throw new Error("Brave HTTP " + r.status);
    items = ((await r.json()).web?.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.description }));
  } else if (p === "brightdata") {
    // Bright Data SERP API (github.com/luminati-io/google-search-api). Needs an API token and a SERP zone name.
    const url = "https://www.google.com/search?hl=en&gl=in&num=" + num + "&q=" + encodeURIComponent(query) + "&brd_json=1";
    const r = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + config.searchKey },
      body: JSON.stringify({ zone: config.searchZone || "serp_api1", url, format: "raw" }),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) throw new Error("Bright Data HTTP " + r.status);
    const j = await r.json().catch(() => ({}));
    items = (j.organic || []).map((x) => ({ title: x.title, url: x.link || x.url, snippet: x.description || x.snippet }));
  } else throw new Error("Unknown search provider " + p + " (use serper, tavily, brave or brightdata)");
  return items.filter((x) => x.url);
}

// ---------- Page fetching ----------
async function fetchHtml(url, ms = 15000) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    const type = r.headers.get("content-type") || "";
    if (!type.includes("html") && !type.includes("text")) return null;
    return { html: (await r.text()).slice(0, 600000), finalUrl: r.url };
  } catch {
    return null;
  }
}

function htmlToText(html, max = 7000) {
  return String(html || "")
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#64;|&commat;/g, "@").replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, max);
}

function domainOf(url) {
  try {
    return new URL(/^https?:/i.test(url) ? url : "https://" + url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

// Root domain comparison: mail.acme.co.in and acme.co.in match.
function sameOrg(a, b) {
  const root = (d) => {
    const parts = d.split(".");
    const twoLevel = /^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(parts.slice(-2).join("."));
    return parts.slice(twoLevel ? -3 : -2).join(".");
  };
  return !!a && !!b && root(a) === root(b);
}

// Only generic business inboxes. Never personal names, never guessed addresses.
const ROLE_PREFIXES = ["info", "hr", "hrd", "careers", "career", "jobs", "job", "recruitment", "hiring", "contact", "contactus", "care", "customercare", "hello", "hi", "support", "admin", "office", "enquiry", "enquiries", "inquiry", "sales", "connect", "team", "business", "mail", "help", "talent", "people"];
const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|rediffmail|live|icloud|proton|protonmail|ymail|aol)\./i;

function extractEmails(html, siteDomain) {
  const raw = String(html || "")
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  const found = new Set();
  for (const m of raw.matchAll(/(?:mailto:)?([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)) found.add(m[1].toLowerCase().replace(/\.$/, ""));
  return [...found].filter((e) => {
    const [local, dom] = e.split("@");
    if (FREE_MAIL.test(e) || /\.(png|jpe?g|gif|webp|svg)$/.test(dom)) return false;
    if (/example|sentry|wixpress|domain\.com|email\.com|yourcompany/.test(dom)) return false;
    if (siteDomain && !sameOrg(dom, siteDomain)) return false;
    return ROLE_PREFIXES.includes(local.replace(/[._-]?\d+$/, ""));
  });
}

function pickEmail(emails) {
  const order = ["hr", "careers", "career", "jobs", "recruitment", "hiring", "talent", "people", "info", "contact", "hello", "office", "admin", "business", "enquiry", "care"];
  return [...emails].sort((a, b) => {
    const ia = order.indexOf(a.split("@")[0]), ib = order.indexOf(b.split("@")[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  })[0] || "";
}

function extractPhones(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(?:\+91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}\b|\b0124[\s-]?\d{7}\b/g)) out.add(m[0].trim());
  return [...out].slice(0, 2);
}

// Visits the homepage and a few likely contact pages of a company site.
async function crawlSite(website) {
  const domain = domainOf(website);
  if (!domain) return null;
  const base = "https://" + domain;
  const pages = [base, base + "/contact", base + "/contact-us", base + "/careers", base + "/about"];
  let text = "", emails = new Set(), phones = new Set(), ok = false;
  for (const url of pages) {
    const page = await fetchHtml(url, 12000);
    if (!page) continue;
    ok = true;
    const t = htmlToText(page.html, 3500);
    if (url === base) text = t;
    else if (text.length < 6000) text += "\n---\n" + t.slice(0, 1500);
    extractEmails(page.html, domain).forEach((e) => emails.add(e));
    extractPhones(t).forEach((p) => phones.add(p));
    if (emails.size && url !== base && text.length > 3000) break;
  }
  if (!ok) return null;
  return { domain, text: text.slice(0, 7000), emails: [...emails], phones: [...phones] };
}

async function hasMx(email) {
  const dom = email.split("@")[1];
  try {
    const mx = await dns.resolveMx(dom);
    return mx.length > 0;
  } catch {
    return false;
  }
}

module.exports = { search, fetchHtml, htmlToText, domainOf, sameOrg, extractEmails, pickEmail, extractPhones, crawlSite, hasMx };
