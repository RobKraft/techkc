# My-events, edit-event, and delete-event functions

- **Date:** 2026-10-04
- **Status:** Completed (uncommitted)

## Request

Let people submit edits and deletes, only for events they submitted.

## What changed

Three new Netlify functions, all requiring a valid Auth0 login (same check as submitting):

- [netlify/functions/my-events.ts](../netlify/functions/my-events.ts) — `GET`. Returns the caller's events (owner hash matches) read fresh from `main` on GitHub, without the `owner` or `cost` fields. Also returns `defaults` (most recent non-empty group, website, type, location across their events) used for pre-fill.
- [netlify/functions/edit-event.ts](../netlify/functions/edit-event.ts) — `POST {id, ...fields}`. Opens a PR that updates the event. The PR description has a Before/After table of only the fields that changed. The form sends the full set of editable fields, so an omitted optional field means "clear it."
- [netlify/functions/delete-event.ts](../netlify/functions/delete-event.ts) — `POST {id}`. Opens a PR that removes the event.

## Access rules (enforced server-side, the UI is just a convenience)

| Situation | Result |
|---|---|
| Not logged in / bad token | 401 |
| Event id doesn't exist on `main` (including submitted-but-unmerged) | 404 |
| Event exists but `owner` isn't the caller | 403 |
| Event has **no** owner (everything added before this feature) | 403 for everyone; only you can change it |
| Edit with no actual changes | 400, nothing written |
| `OWNER_HASH_SECRET` not configured | 503 |

Rejected requests create no branch and write nothing.

## Details

- Edits keep the event's `id` stable even if the name changes (so links and the PR stay coherent) and preserve fields the form doesn't expose, such as `cost`, `dateTBD`, and `owner`. `owner` can never be changed through the API.
- Submitters get a best-effort confirmation email for edits and removal requests, like new submissions.
- No auto-merge: every change waits for your review.

## Verification

Scratch harness against fake GitHub/Auth0 with real signed tokens, 10 groups of checks, all passing. Covering this step:
- `my-events` returns only the caller's events; another user gets an empty list; derived defaults are correct.
- Owner edit succeeds, keeps `cost`/`owner`, removes cleared optional fields, leaves other events untouched.
- Non-owner edit and delete get 403; unknown id gets 404; ownerless seed events get 403; no-op edit gets 400; missing id gets 400; **zero writes and zero branches** on every rejection.
- Owner delete removes exactly that event.
- `tsc --strict --noEmit` on all functions passes.

Not done: calls against real GitHub/Auth0.
