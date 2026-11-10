// Central configuration. Every secret comes from Vercel Environment Variables, never from the repo.
const env = (k, d = "") => (process.env[k] ?? d).toString().trim();

const config = {
  supabaseUrl: env("SUPABASE_URL", "https://rmgtzuqpfjphtmtomrkm.supabase.co"),
  supabaseServiceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
  // Public key, same one the browser uses (supabase-config.js). Used for password sign-in on the server.
  supabasePublishableKey: env("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_XhUw9RQ4oJXnMEMGJOG7kA_JZuTBvrK"),
  ownerEmail: env("OWNER_EMAIL").toLowerCase(), // the email you log in to LeadEngine with
  cronSecret: env("CRON_SECRET"),

  // AI (NVIDIA Nemotron via the OpenAI-compatible NVIDIA API)
  aiKey: env("AI_API_KEY") || env("NVIDIA_API_KEY"),
  aiBaseUrl: env("AI_BASE_URL", "https://integrate.api.nvidia.com/v1"),
  aiModel: env("AI_MODEL", "nvidia/llama-3.3-nemotron-super-49b-v1.5"),

  // Web search: serper | tavily | brave | brightdata
  // These, Zoho and the AI key can also be set on the app's Settings page (stored encrypted, see secrets.js).
  searchProvider: env("SEARCH_PROVIDER", "serper").toLowerCase(),
  searchKey: env("SEARCH_API_KEY"),
  searchZone: env("BRIGHTDATA_ZONE", "serp_api1"),

  // Zoho Mail
  zohoEmail: env("ZOHO_EMAIL"),
  zohoPassword: env("ZOHO_APP_PASSWORD"),
  smtpHost: env("ZOHO_SMTP_HOST", "smtp.zoho.in"),
  imapHost: env("ZOHO_IMAP_HOST", "imap.zoho.in"),
  notifyEmail: env("NOTIFY_EMAIL") || env("ZOHO_EMAIL"),

  // Limits
  dailyLimit: Number(env("DAILY_LIMIT", "10")) || 10, // successful new (Day0) emails per day
  followupLimit: Number(env("FOLLOWUP_LIMIT", "20")) || 20,
  maxAutoReplies: Number(env("MAX_AUTO_REPLIES", "2")) || 2,
  minScore: Number(env("MIN_SCORE", "5")) || 5,

  sender: {
    name: "Harshit Bhardwaj",
    company: "Team Work HR Consultancy",
    city: "Gurugram",
    founded: 2017,
    services: "recruitment/hiring support, payroll, PF/ESI compliance, HR policies, onboarding",
  },
};

config.signature = () =>
  `${config.sender.name}\n${config.sender.company}, ${config.sender.city}\n${config.zohoEmail || "Teamwork.hrsolution@zohomail.in"}`;
config.optOut = "Reply 'no' and I won't follow up.";

config.missing = (keys) => keys.filter((k) => !config[k]);

module.exports = config;
