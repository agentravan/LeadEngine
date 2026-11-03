# LeadEngine

A responsive local-business lead research CRM inspired by the provided Nexora-style dashboard.

## Features
- Editable country/city/area, radius, business categories and maximum results per category.
- OpenStreetMap Nominatim + Overpass discovery (no Google Maps API key).
- Lead enrichment from publicly accessible business websites (best-effort robots.txt check).
- Dashboard, lead pipeline, filtering, notes, follow-up dates and CSV export.
- Browser-local persistence in this starter version; data remains in that browser/device and is not synchronized between devices.

## Run locally
Open `index.html` in a modern browser. No build tools or API keys required.

## Notes
OpenStreetMap data is community-maintained, incomplete, and subject to the ODbL. Public Nominatim/Overpass endpoints have usage limits; use modest, user-triggered searches. The number set is a maximum cap, not a guarantee. Google Maps links are for manual verification only; this app does not scrape Google Maps.

For cross-device syncing, add a private authenticated database/backend (e.g. Supabase) before storing real lead data. Do not put service-role keys in browser code.
