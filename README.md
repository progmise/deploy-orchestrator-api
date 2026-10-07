# deploy-orchestrator-api

Backend of the **progmise deploy orchestrator** — the API service behind
[`deploy-orchestrator`](https://github.com/progmise/deploy-orchestrator) (the SPA).
Generated from `node-express-api-template`.

## What it does

| Endpoint | Notes |
|---|---|
| `/api/auth/login` → `/api/auth/callback` | GitHub OAuth — `client_secret` never leaves the server; token goes into an HttpOnly `gh_token` cookie. `redirect_uri` = `FRONTEND_URL/api/auth/callback` (the SPA proxies it here) |
| `/api/me` | Session user (`401` anon, `403` not in `ALLOWED_USERS`) |
| `/api/gh/*` | GitHub API proxy using the caller's own token |
| `/api/manifest` | `deploy-manifest` `manifest.yml` (session required) |
| `/api/health` | Liveness |

Access is gated by `ALLOWED_USERS` (comma-separated GitHub logins),
re-checked on every request — removing a login cuts access immediately.
The SPA reaches this service through a same-origin `/api/*` proxy on the
frontend, so **no CORS is needed** and the cookie stays `SameSite=Lax`.

## Deploy

Vercel container (preset `Container` + root `Dockerfile`), env vars
(Production): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ALLOWED_USERS`,
`FRONTEND_URL`. Releases and deploys run through the `app-*` pipelines —
`Release` (tag + image) then `Deploy` (or the `deploy-manifest` orchestrator).
