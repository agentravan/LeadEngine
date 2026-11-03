# Run and deploy LeadEngine

## Local run (recommended first test)

1. Install Docker Desktop.
2. Clone: `git clone https://github.com/agentravan/LeadEngine.git`
3. Enter: `cd LeadEngine`
4. Start: `docker compose up --build`
5. Open: http://localhost:8000

The API and UI run together; PostgreSQL persists in a Docker volume. Stop with `Ctrl+C`; stop containers with `docker compose down`. To keep database contents, do not use `docker compose down -v`.

## Remote hosting

Do not expose the current API publicly: authentication and per-user data isolation have not yet been implemented. Before deploying to a public cloud host, add login, per-user authorization/RLS, HTTPS, secret management, request limits and audit logging. The GitHub Pages workflow was removed because static Pages cannot host the PostgreSQL API.
