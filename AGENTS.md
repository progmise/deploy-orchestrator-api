# AGENTS.md

Guide for working on **deploy-orchestrator-api** — the backend service of the
progmise deploy orchestrator (generated from `node-express-api-template`).

## Architecture

```
src/index.js      Express app — OAuth + allowlist + /api/gh proxy + /api/manifest
                  + component catalog routes (/api/templates, /api/components*)
src/db.js         Supabase PostgREST client (service_role key, server-side only)
src/provision.js  provisioning state machine — GitHub generate/secrets/vars,
                  deploy-manifest registration PR. Each step is idempotent;
                  status transitions logged to provision_log. The Vercel
                  project is NOT created here — VERCEL_PROJECT_ID ships empty
                  and the deploy workflow provisions it lazily.
db/schema.sql     components + platform_vars + app_config tables, Vault view
                  — apply in the Supabase SQL editor.
```

- The DB is also the API's own config store: `loadAppEnv()` (db.js) runs at
  boot before any `process.env` read and hydrates `app_config` plaintext keys
  (`GITHUB_CLIENT_ID`, `ALLOWED_USERS`, `FRONTEND_URL`, `GITHUB_OWNER`,
  `MANIFEST_REPO`) + Vault secrets (`GITHUB_CLIENT_SECRET`,
  `PROVISIONING_TOKEN`). Only `SUPABASE_*` (and `PORT`) are real env vars.
  **Module-level env reads don't see DB values** — provision.js reads env
  through lazy getters (`GH_TOKEN()`, `OWNER()`, …) for this reason.
- Provisioning spec lives in `SPECS` (provision.js): which repo secrets/vars
  each template kind (`app` vs `*-lib-template`) gets. Master values live in
  the Supabase credential store (`platform_vars` + `vault.secrets`, read via
  `platformConfig()`; process.env is only a fallback) — never exposed to the
  frontend.

- The SPA (`deploy-orchestrator`) proxies `/api/*` here — requests arrive
  same-origin, so there is **no CORS** and the session cookie stays
  `SameSite=Lax` + HttpOnly.
- `FRONTEND_URL` = the SPA origin: builds the OAuth `redirect_uri`
  (registered in the OAuth App as `<FRONTEND_URL>/api/auth/callback`) and
  the post-login/logout redirect.
- `ALLOWED_USERS` gates the callback AND every protected endpoint
  (`authedUser` re-fetches `/user` per request — revoking is immediate).
- `/api/manifest` and `/api/gh/*` require a session; `/api/health` is open.

## Conventions

- ESM, Express 5, no build step (`build` = `node --check src/index.js`).
- Single root `Dockerfile` — CSA scans it, Vercel builds it (preset
  `Container`); runtime strips npm.
- Secrets only via Vault/env (`GITHUB_CLIENT_*`); never log tokens.

## CI/CD

Thin callers → `progmise/reusable-workflows` `app-*` `@v1`.
`Setup → Build artifact → Build image → SAST ‖ SCA ‖ CSA → Tracing → Summary`;
release adds `Validate → CI → Publish Image → Release` — **never deploys**.

## Verify before done

```bash
npm ci && npm run build
PORT=8123 node src/index.js &   # /api/health → 200, /api/me → 401, /api/manifest → 401
```

## Branches

`main` (releases) + `development` (integration). Work lands on
`<type>/<snake_description>` → PR to `development` → PR to `main`.
