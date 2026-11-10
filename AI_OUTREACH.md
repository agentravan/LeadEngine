# AI Outreach (lead hunt + Zoho auto-mail)

## What it does
Vercel Cron runs these jobs (times in IST):

| Time | Job |
|---|---|
| 08:00 daily | **Hunt**: search job boards, read the posting and the company site, keep only small/mid NCR companies (no recruiters, no big brands), find a public business email (info@, hr@, careers@...), score 1-10 and write Day0/Day3/Day7 + WhatsApp text with NVIDIA Nemotron. Builds the queue. |
| 10:00 Mon-Sat | Inbox check, Day3/Day7 follow-ups, new Day0 emails up to the daily limit |
| 12:00 daily | Hunt again (top up the queue) |
| 13:00, 16:00 Mon-Sat | Inbox check + top-up so **10 emails are successfully delivered** |
| 19:00 daily | Inbox check + auto-replies only |

**Daily limit counts only successful emails.** Before sending, the domain's MX record is checked. If Zoho or the recipient's server refuses the address (5xx), or a bounce arrives later, that lead is marked `rejected`/`bounced`, does not count, and the next lead is sent in the following run.

**Replies** (read from Zoho over IMAP, read/unread state is not changed):
- "no / not interested / already have" -> lead marked *Do not contact*, no more emails, no reply sent.
- Interested or a question -> Nemotron writes a short reply (no prices, no invented claims) and sends it in the same thread, max 2 automatic replies per company. You get an alert email for every reply.
- Pricing, meeting time, anything unclear, or after 2 auto-replies -> *Needs you*: you get an "ACTION NEEDED" email and continue from Zoho yourself.
- Out-of-office replies are logged and the follow-up sequence continues.
- If Zoho reports a sending block or rate limit, sending stops for that run.

Leads without a public email are saved as *WhatsApp/LinkedIn* with a ready message (Open WhatsApp button in the lead).

## Setup (one time)
1. **Supabase > SQL Editor**: run `supabase/001_ai_outreach.sql`.
2. **Zoho Mail**: Settings > Mail Accounts > enable **IMAP access**. Create an **App Password** (My Account > Security > App Passwords).
3. **Vercel > Settings > Environment Variables**: add the variables in `.env.example` (top section). Redeploy.
4. Open LeadEngine > **AI Outreach** > **Run now** once to test. Pause/resume and the daily limit are on the same page.

Cron jobs only run on the production deployment.
