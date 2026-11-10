// Lead discovery: search job boards -> read the posting -> read the company site -> score -> write outreach.
const config = require("./config");
const { db, logEvent, istDay } = require("./db");
const { chatJson } = require("./ai");
const web = require("./web");
const { composeEmail, wordCount } = require("./text");

const SECTORS = [
  "D2C brand", "digital marketing agency", "clinic", "hospital", "dental clinic", "manufacturing company IMT Manesar",
  "real estate", "logistics", "edtech", "restaurant group", "BPO call centre", "interior design studio",
  "fintech startup", "physiotherapy centre", "skincare brand", "IT services company", "travel company", "school",
];
const PATTERNS = [
  (s) => `site:jobs.weekday.works Gurugram ${s} hiring`,
  (s) => `site:cutshort.io ${s} Gurgaon jobs`,
  (s) => `site:wellfound.com ${s} Gurugram`,
  (s) => `${s} Gurugram hiring careers "hr@" OR "careers@"`,
  (s) => `site:jobhai.com ${s} Gurgaon`,
];
const SKIP_HOSTS = /(linkedin|naukri|indeed|glassdoor|ambitionbox|foundit|shine|timesjobs|apna\.co|facebook|instagram|youtube|twitter|x\.com|justdial|quora|reddit|wikipedia)\./i;

function queriesForToday(n = 3) {
  const { day } = istDay();
  const seed = Number(day.replace(/-/g, "")) % 997;
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = SECTORS[(seed * 7 + i * 5) % SECTORS.length];
    const p = PATTERNS[(seed + i * 3) % PATTERNS.length];
    out.push(p(s));
  }
  return out;
}

const EXTRACT_SYSTEM = `You read a web page (usually a job posting or company page) and extract facts. Use ONLY what is written on the page. Never guess. Reply with one JSON object:
{"is_relevant": true/false, "company": "", "company_website": "", "location": "", "in_delhi_ncr": true/false, "employees": number or null, "roles": [""], "role_count": number, "industry": "", "is_recruiter_or_hr_firm": true/false, "is_large_brand_or_mnc": true/false, "emails_on_page": [""], "facts": ["short verifiable facts from the page"]}
is_relevant = the page shows a specific company hiring. Recruitment agencies, staffing firms, HR consultancies and job portals posting for clients => is_recruiter_or_hr_firm true. Famous brands, listed companies, MNCs or 500+ employees => is_large_brand_or_mnc true.`;

const WRITE_SYSTEM = `You are the sales assistant of ${config.sender.company} (${config.sender.city}, founded ${config.sender.founded}). Services: ${config.sender.services}. Owner: ${config.sender.name}.
Write cold outreach to a small/mid company that may need HR help. Rules:
- Use ONLY the facts provided. No invented numbers, stats, client names, prices, guarantees or urgency.
- First sentence of day0 = one specific, verifiable observation about them (e.g. the exact role they are hiring for).
- One offer, one soft CTA such as "Shall I send 2-3 pre-screened profiles?".
- day0 body max 85 words (no greeting name guesses: start "Hi <Company> team,"). Do NOT add signature or opt-out line, they are added later.
- day3 max 65 words: one useful practical hiring/HR idea for them. day7 max 35 words: polite breakup. Sign day3/day7 with "- Harshit".
- whatsapp: max 55 words, Hinglish ok, ends with "- Harshit, ${config.zohoEmail || "Teamwork.hrsolution@zohomail.in"}".
- subject: short, lowercase-ish, max 7 words.
Score: need 0-4 (hiring volume, no HR person visible, growth), pay 0-3 (size, funding, premium business), reach 0-3 (business email 3, phone only 1-2).
Reply with one JSON object: {"category":"","area":"","observations":"","pitch":"","need":0,"pay":0,"reach":0,"subject":"","day0":"","day3":"","day7":"","whatsapp":""}`;

async function existingKeys(owner) {
  const names = new Set(), domains = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await db().from("le_leads").select("name,website,email").eq("owner_id", owner).range(from, from + 999);
    if (error) throw error;
    for (const r of data) {
      names.add(normName(r.name));
      const d = web.domainOf(r.website || "") || (r.email || "").split("@")[1];
      if (d) domains.add(d.replace(/^www\./, ""));
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  return { names, domains };
}

function normName(n) {
  return String(n || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/\b(pvt|private|ltd|limited|llp|inc|india|the|group)\b/g, "").replace(/[^a-z0-9]/g, "");
}

// Finds up to `want` new leads. Stops early when `deadline` (ms timestamp) is near.
async function hunt(owner, want, deadline) {
  const seen = await existingKeys(owner);
  const stats = { searched: 0, pages: 0, added: 0, withEmail: 0, skipped: 0, errors: [] };
  const urls = [];
  for (const q of queriesForToday(want > 6 ? 4 : 3)) {
    try {
      const res = await web.search(q, 10);
      stats.searched++;
      for (const r of res) if (!SKIP_HOSTS.test(r.url) && !urls.find((u) => u.url === r.url)) urls.push(r);
    } catch (e) {
      stats.errors.push(e.message);
    }
  }

  // Process several pages in parallel; each worker takes the next URL.
  let next = 0;
  const worker = async () => {
    while (next < urls.length && stats.added < want && Date.now() < deadline - 60000) {
      const item = urls[next++];
      await processItem(item);
    }
  };
  const processItem = async (item) => {
    try {
      const page = await web.fetchHtml(item.url);
      if (!page) return;
      stats.pages++;
      const pageText = web.htmlToText(page.html, 6000);
      const info = await chatJson(EXTRACT_SYSTEM, `URL: ${item.url}\nTITLE: ${item.title}\n\nPAGE:\n${pageText}`, { maxTokens: 900, temperature: 0.1 });
      if (!info.is_relevant || !info.company || !info.in_delhi_ncr || info.is_recruiter_or_hr_firm || info.is_large_brand_or_mnc) { stats.skipped++; return; }
      if (info.employees && info.employees > 500) { stats.skipped++; return; }

      const key = normName(info.company);
      const site = info.company_website && !SKIP_HOSTS.test(info.company_website) ? info.company_website : "";
      const domain = web.domainOf(site);
      if (!key || seen.names.has(key) || (domain && seen.domains.has(domain))) { stats.skipped++; return; }
      seen.names.add(key);
      if (domain) seen.domains.add(domain);

      const crawl = site ? await web.crawlSite(site) : null;
      // Emails on the job page only count when they belong to the company's own domain.
      const pageEmails = domain
        ? web.extractEmails(page.html, domain).concat((info.emails_on_page || []).flatMap((e) => web.extractEmails(e, domain)))
        : [];
      const emails = [...new Set([...(crawl?.emails || []), ...pageEmails])];
      let email = web.pickEmail(emails);
      if (email && !(await web.hasMx(email))) email = "";

      const facts = [
        `Company: ${info.company}`, `Source: ${item.url}`, `Industry: ${info.industry || "unknown"}`,
        `Location: ${info.location}`, `Employees: ${info.employees ?? "not stated"}`,
        `Hiring for: ${(info.roles || []).join(", ")} (${info.role_count || (info.roles || []).length} role(s))`,
        `Facts from job post: ${(info.facts || []).join("; ")}`,
        crawl ? `Company website text (${crawl.domain}):\n${crawl.text.slice(0, 3500)}` : "Company website: not available",
        `Public business email: ${email || "none found"}`,
      ].join("\n");
      const w = await chatJson(WRITE_SYSTEM, facts, { maxTokens: 1500, temperature: 0.5 });
      const score = clamp(w.need, 0, 4) + clamp(w.pay, 0, 3) + (email ? 3 : crawl?.phones?.length ? 1 : 0);
      if (score < config.minScore) { stats.skipped++; return; }
      if (wordCount(w.day0) > 95 || !w.subject) { stats.skipped++; return; }

      const row = {
        owner_id: owner,
        source_id: "hunt:" + (domain || key),
        name: info.company,
        category: w.category || info.industry || "",
        city: "Gurugram",
        area: w.area || info.location || "",
        address: "",
        phone: (crawl?.phones || []).join(" / "),
        website: domain ? "https://" + domain : "",
        email,
        profile_url: item.url,
        source: "AI Hunt",
        score,
        priority: score >= 8 ? "High" : score >= 6 ? "Medium" : "Low",
        status: "New Leads",
        observations: w.observations || "",
        pitch: w.pitch || "",
        day0_subject: w.subject,
        day0_body: composeEmail(w.day0),
        day3_body: w.day3 || "",
        day7_body: w.day7 || "",
        whatsapp_msg: w.whatsapp || "",
        outreach_status: email ? "queued" : "manual",
      };
      if (stats.added >= want) return;
      const { error } = await db().from("le_leads").upsert(row, { onConflict: "owner_id,source_id", ignoreDuplicates: true });
      if (error) throw error;
      stats.added++;
      if (email) stats.withEmail++;
    } catch (e) {
      stats.errors.push(`${item.url}: ${e.message}`.slice(0, 200));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await db().from("le_campaigns").insert({ owner_id: owner, niche: "AI Hunt (HR)", location: "Gurugram / Delhi NCR", count: stats.added, status: "Completed" });
  await logEvent(owner, null, "hunt", { body: JSON.stringify(stats).slice(0, 4000) });
  return stats;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));

module.exports = { hunt, queriesForToday, normName };
