# Deploy LeadEngine using GitHub Pages

1. Open https://github.com/agentravan/LeadEngine/settings/pages
2. Under Build and deployment, choose **Deploy from a branch**.
3. Select branch **main** and folder **/(root)**, then Save.
4. Wait for GitHub Pages to publish. The site address will be shown on that Settings page, typically `https://agentravan.github.io/LeadEngine/`.

This is a static browser app. Search is performed from the browser against public OSM endpoints. **Lead data is saved only in the current browser's local storage**, so it does not sync to another device. For real cross-device access, add an authenticated private backend (e.g. Supabase Auth + database with row-level security) before storing real prospect data.
