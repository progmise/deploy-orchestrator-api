# AGENTS.md

Guide for working on **deploy-orchestrator-api** — the backend service of the
progmise deploy orchestrator (generated from `node-express-api-template`).

## Architecture

Hexagonal (ports & adapters), mirroring `java-maven-api-template` with
idiomatic JS (functions + duck-typed ports, no class ceremony):

```
src/
  index.js                    composition root — env → adapters → usecases → app
  app.js                      express wiring — middleware + routers
  config/env.js               every process.env read + config guards
  domain/                     pure rules (allowlist, component naming)
  application/
    ports/output/             contracts as JSDoc typedefs (IdentityProvider,
                              ComponentCatalog, CredentialStore, RepoHost)
    usecases/                 resolveSession, exchangeOAuthCode,
                              listTemplates (+createTemplate — validates the
                              repo, flips is_template, can /generate from a
                              base template repo),
                              provisionComponent (state machine) +
                              createComponent,
                              members, releases (RLSE registry: list/create/
                              detail/publish/deploy — publish flips the manifest
                              draft via repoHost; deploy dispatches deploy.yml
                              with the RLSE number, which is what unlocks `pro`),
                              secrets (list declared names per env, write-only
                              upsert into the credential store — role-gated:
                              developers write cert/pre, technical-lead +
                              product-owner also pro; every write is audited to
                              secret_events, values never leave the server)
  infrastructure/
    adapters/input/rest/      routers (auth, components, members, releases,
                              secrets, proxy, system) + session middleware —
                              HTTP <-> use cases
    adapters/output/          githubIdentity (OAuth), githubAdmin (provisioning
                              token), supabase/ (client, componentCatalog,
                              templateCatalog, memberCatalog, releaseCatalog,
                              platformConfigStore — incl. putPlatformSecret via
                              the put_platform_secret RPC writing vault.secrets)
db/schema.sql                 templates + components + platform_vars + members +
                              releases + release_deployments + secret_events
                              tables, Vault view + put_platform_secret function
                              — apply in the Supabase SQL editor.
```

- Dependencies point inward: routers never touch `fetch`/env directly; use
  cases never import express; domain imports nothing.
- The Vercel project is NOT created at provisioning time —
  `VERCEL_PROJECT_ID` ships empty and the deploy workflow provisions it
  lazily.
- Provisioning spec lives on the template row: `templates.spec` jsonb
  (`{manifest, secrets, vars}`) is authoritative — `SPECS` in
  provisionComponent.js is only the legacy fallback for rows without a spec.
  Spec credential names are validated against the credential store at
  registration (`GET /api/platform/keys` exposes the names only).
  The kind comes from the `templates` catalog row — not from naming
  conventions — and `components.template` is a FK to it. Master
  values live in the Supabase credential store (`platform_vars` +
  `vault.secrets`, read via the platformConfigStore adapter; process.env is
  only a fallback) — never exposed to the frontend.
- `templates.fields` (jsonb) declares the wizard's "Personalización" step —
  `select`/`fixed`/`component` fields; answers land in `components.config`
  (resolved server-side via domain `resolveConfig`). `component` fields take
  an existing component name (options resolved dynamically by the wizard —
  e.g. `configures` on ConfigMap templates). `components.branch_strategy`
  (`gitflow`/`trunk`) picks which branches the provisioner creates and
  protects: gitflow → main + development (dev default); trunk → main only.
- Template kinds: `app` (deployable — infra block + component entry in the
  manifest), `lib` (publishable — no manifest), `cm` (ConfigMap — registers
  as `type: configmap`, binds to the `config.configures` app's infra ids,
  and adds itself to that app's `needs:`), `secrets` (registers as
  `type: secrets` — same infra-binding/needs mechanics as cm; its repos
  only declare secret names, values are upserted into `vault.secrets` as
  `NAME__ENV` via `POST /api/secrets` and deployed by `sec-deploy`).
- Session resolution attaches the member row (`members` by GitHub login) —
  `/api/me` returns `secret_envs`, the environments that login may write
  secrets for; logins without a member row keep broad access (bootstrap).

- The SPA (`deploy-orchestrator`) proxies `/api/*` here — requests arrive
  same-origin, so there is **no CORS** and the session cookie stays
  `SameSite=Lax` + HttpOnly.
- `FRONTEND_URL` = the SPA origin: builds the OAuth `redirect_uri`
  (registered in the OAuth App as `<FRONTEND_URL>/api/auth/callback`) and
  the post-login/logout redirect.
- `ALLOWED_USERS` gates the callback AND every protected endpoint
  (`authedUser` re-fetches `/user` per request — revoking is immediate).
- Everything under `/api/*` requires a session except `/api/health` and
  `/api/auth/*`; `/api/gh/*` is the generic GitHub read proxy, `/api/manifest`
  serves the rendered manifest.

## Conventions

- ESM, Express 5, no build step (`build` = `node --check src/index.js`).
- Single root `Dockerfile` — CSA scans it, Vercel builds it (preset
  `Container`); runtime strips npm.
- Secrets only via env (`GITHUB_CLIENT_*`); never log tokens.

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
