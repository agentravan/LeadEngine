# LeadEngine CRM

Dark-mode local-business lead research CRM with a FastAPI + PostgreSQL backend, drag/drop pipeline, lead notes/status management, short outreach hook drafts, WhatsApp click-to-chat links, CSV export and locally generated SVG demo banners.

## Run locally (Docker Desktop required)

1. Install Docker Desktop on your personal machine (or use an approved workstation).
2. Clone this repository:
   `git clone https://github.com/agentravan/LeadEngine.git`
3. Enter the folder:
   `cd LeadEngine`
4. Start the app:
   `docker compose up --build`
5. Open **http://localhost:8000**.

The dashboard and API are served from the same local origin. PostgreSQL data persists in the `leadengine_pg` Docker volume. The API port is bound to 127.0.0.1 only, so it is not exposed to the public internet.

## Features in this starter

- Any niche/location search form (e.g. gyms in Sector 56, Gurugram).
- OSM Nominatim geocoding + Overpass POI lookup; no Google Places API key.
- PostgreSQL persistence and campaign history.
- Lead table, filters, score, priority and six-stage drag/drop pipeline.
- Short personalized hook template generator (deterministic template; no LLM call yet).
- WhatsApp click-to-chat deep link with prefilled copy; operator reviews and presses Send.
- Locally generated SVG demo banner template (not AI image generation).
- CSV export.

## Important data-source boundary

The requested `gosom/google-maps-scraper` is an unofficial Google Maps extraction tool, not an official Google API. Its upstream README describes a Go CLI, local UI and REST API; that does not make automated extraction authorized, unlimited, or guaranteed free. This project does **not** bundle or execute Google Maps scraping, proxies, CAPTCHA solving, or anti-bot bypasses. Instead it uses OpenStreetMap data, which is incomplete and subject to Nominatim/Overpass usage policies and ODbL attribution. Rating/review counts are not generally available from OSM and will remain blank.

See [data source notes](integrations/DATA_SOURCES.md).

## Outreach and calling

- WhatsApp currently opens a user-clicked `wa.me` draft; it does not send automatically.
- Bulk/automated cold messaging is not implemented.
- Telnyx outbound AI calling is not enabled. Production calling needs a Telnyx account, API credentials, number/voice application setup, webhooks, paid usage, and explicit contact consent plus applicable telecom compliance. See [outreach notes](integrations/OUTREACH.md).
- No OpenAI/Gemini key is required for the local template generator. An actual hosted LLM and AI image generation would require a configured provider and may incur charges.

## Cross-device / production deployment

This starter is intentionally **local-first**. It does not yet include user authentication, tenant isolation, HTTPS deployment, cloud backup, or multi-device sync. Do not expose this API publicly or store sensitive personal data. For remote access, add authentication (e.g. Supabase Auth), per-user row-level security, managed PostgreSQL, HTTPS, secrets management, rate limits and audit logs before deployment.

GitHub Pages is not the app server for this database-backed version. Run the Docker app on a trusted machine or deploy the full container stack to a secured host after adding authentication.

## Attribution

Business discovery data is from [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Public geocoding/search endpoints are community services, not an SLA-backed production feed.
