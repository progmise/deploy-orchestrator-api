---
name: maintain-agents-doc
description: Reconcile this service's AGENTS.md with the actual codebase (module map, conventions, env vars, version, consumers)
argument-hint: "[section to focus on, or 'all']"
allowed-tools:
  - read
  - edit
  - grep
  - glob
  - exec
permissions:
  allow:
    - Read(src/**)
    - Read(package.json)
    - Read(AGENTS.md)
  ask:
    - Write(AGENTS.md)
---

# Skill: Maintain AGENTS.md

## Description
Keeps the service's canonical documentation (`AGENTS.md`) **in sync with the
real code**. This is an on-demand **audit/reconcile** tool — not a README
generator. Use it after large changes, onboarding, or when docs may have
drifted.

## When to Use
- After adding/removing routes, modules or env vars.
- After a version bump or dependency change.
- Periodically, to catch accumulated drift.

## Scope
Reconcile the section in `$ARGUMENTS`, or `all`. Things to verify against the
code:

1. **Module map** — must match the actual files under `src/` and describe
   what each holds (routes, middleware, helpers).
2. **Conventions** — still match how code is actually written (ESM, Express
   5 splat syntax, env-only config, JSON-only responses).
3. **Env vars** — every `process.env.X` read must be documented in
   `.env.example` (no values) and mentioned in the docs where relevant.
4. **Version** — the version mentioned matches `package.json`.
5. **Consumers** — cross-check the workspace for repos calling this service;
   add/remove repos (names/URLs, not local paths).

## Process
1. Enumerate the real state: list `src/` files, read `package.json`
   `version` + `scripts`, grep `process.env` and `app.(get|post|put|...)`.
2. Diff against each targeted `AGENTS.md` section.
3. Apply **minimal, targeted edits** — do not restructure the document or
   invent content; only reconcile with reality.
4. Report what was out of date and what you changed; list anything ambiguous
   as a suggestion rather than guessing.

## Rules
- Documentation only — never change source code from this skill.
- Preserve the existing document structure, tone and headings.
- *Consumers* lists repo names/URLs, not machine-specific checkout paths.
- Do not bump the service version here (that belongs to `api-release`).
