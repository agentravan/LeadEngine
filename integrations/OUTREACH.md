# Outreach integration policy and setup

## WhatsApp

The current API creates a user-clicked `wa.me` deep link with prefilled text. It does not send messages automatically. This keeps the final send action with the operator and avoids bulk unsolicited messaging. For WhatsApp Business Platform/API sending, create a Meta Business app, complete business/number verification, use approved message templates where required, record opt-in, honor opt-outs, and keep credentials server-side. Provider and conversation charges may apply; this is not a guaranteed zero-cost integration.

## AI hook generation

`POST /api/leads/{id}/hook` currently generates a short local template without a paid LLM. Add an LLM provider only after setting a server-side key and adding spend limits. Do not send generated copy without human review.

## Telnyx voice

The repository `team-telnyx/ai` is an official Telnyx AI agent developer resource, not a drop-in outbound dialer. Production voice requires a Telnyx account, API key, purchased/verified number, configured Voice API connection or AI assistant, webhook endpoint, and paid call/AI usage. Do not initiate sales calls to a person unless the contact has explicitly consented to automated calls and applicable Indian telecom/DLT/consent requirements have been reviewed. Keep call initiation disabled until that is in place. No automated cold-call endpoint is provided in this starter.

Reference: https://github.com/team-telnyx/ai
