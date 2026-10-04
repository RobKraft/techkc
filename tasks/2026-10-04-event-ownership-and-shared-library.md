# Event ownership + shared server library

- **Date:** 2026-10-04
- **Status:** Completed (uncommitted). Requires `OWNER_HASH_SECRET` in Netlify before ownership is recorded.

## Request

Foundation for "people can edit/delete only the events they submitted."

## What changed

- **New** [netlify/lib/common.ts](../netlify/lib/common.ts) — the pieces `submit-event.ts` used to keep privately, now shared by all four functions: Auth0 token verification, GitHub API helper, field validation, slugify, the "open a PR that changes events.json" routine, and the Resend email helper. Plus the new ownership pieces:
  - `ownerHash(email)` — HMAC-SHA256 of the lower-cased email with `OWNER_HASH_SECRET`, first 32 hex chars. Stored as `owner` on the event.
  - `applyEdit()` / `describeChanges()` — used by the edit function to build the change and a before/after table for the PR.
- [netlify/functions/submit-event.ts](../netlify/functions/submit-event.ts) — rewritten on top of the library. New submissions now record `owner`. Behavior otherwise preserved (PR for review, confirmation email, 409 on duplicate id).
- [.env.example](../.env.example) — documents `OWNER_HASH_SECRET`.
- **New** [scripts/owner-hash.mjs](../scripts/owner-hash.mjs) — prints the `"owner": "..."` line for an email, to backfill events that predate this feature.

## How it works

- **Why a hash and not the email:** `events.json` is public in the repo and shipped to every visitor. An HMAC with a server-only secret can't be reversed or checked by outsiders, but the server can recompute it from the verified Auth0 email to check ownership.
- **Graceful degradation:** if `OWNER_HASH_SECRET` is missing, submissions still go through (so a missed env var can't break the form on deploy) but with no owner, and the PR description carries a warning. The edit/delete endpoints return 503 until it's set.
- **Behavior fix, not just a refactor:** the old code created the GitHub branch *before* checking for a duplicate id, leaving an orphan branch on every 409. The new `openEventsPr()` reads the file first and only creates a branch after the change is known to be valid.

## Verification

Ran a scratch harness (not committed) that bundles the real functions and runs them against a fake GitHub and Auth0 (real signed JWTs verified against a JWKS the harness serves):
- submission records `owner` and never contains the raw email;
- duplicate submission returns 409 and creates **no** branch;
- with `OWNER_HASH_SECRET` unset: submission still succeeds without an owner and the PR body carries the warning;
- `scripts/owner-hash.mjs` output equals `ownerHash()` for the same secret, including email case normalization.

Not done: a real submission against live Auth0, GitHub, and Resend. Recommend one real submission after deploying, then check the resulting PR for the `owner` line.
