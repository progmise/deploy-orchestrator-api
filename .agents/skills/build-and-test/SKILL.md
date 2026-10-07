---
name: build-and-test
description: Install, lint, check and dockerize this Node/Express microservice (ESM, Express 5, oxlint, Dockerfile)
allowed-tools:
  - read
  - exec
  - grep
  - glob
permissions:
  allow:
    - Read(package.json)
    - Read(src/**)
  ask:
    - Exec(npm *)
    - Exec(docker *)
---

# Skill: Build and Test — Node/Express microservice

## Description
Step-by-step guide to install, lint and containerize this Express service.
It is a **plain Node** project (ESM, no build step, no transpiler) — `build`
is `node --check` syntax validation only.

## When to Use
- Installing/testing the service for the first time or on a new machine.
- Diagnosing dependency-resolution or lint failures.
- Building the Docker image locally.

---

## Step 1: Environment
- **Node 20+** (CI uses 24). Confirm the version under test in
  `package.json` (`version` field).

## Step 2: Install
```bash
npm ci          # reproducible, from package-lock.json — never npm install in CI
```

## Step 3: Lint + syntax check
```bash
npm run lint    # oxlint
npm run build   # node --check src/index.js
```

## Step 4: Tests
```bash
npm test --if-present
```
Hermetic by convention — no external services required.

## Step 5: Boot smoke test
```bash
PORT=8123 node src/index.js &
curl -sf localhost:8123/api/health   # → {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}' localhost:8123/api/me   # → 401
```

## Step 6: Docker image (optional)
```bash
docker build -t api:dev .
```

## Troubleshooting

| Symptom | Root cause | Fix |
|---|---|---|
| `npm ci` fails on lock mismatch | `package.json` edited without lock | `npm install` once, commit the lockfile |
| `node --check` syntax error | trailing comma/typo | read the reported line |
| 401s expected but 503 | env vars unset | `cp .env.example .env` and fill |
| Port in use | stale process | kill the old `node` process |

## Notes
- Do **not** bump `version` as part of a build — see the `api-release` skill.
