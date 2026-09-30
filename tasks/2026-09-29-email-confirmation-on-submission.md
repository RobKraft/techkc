# Email confirmation to event submitters

- **Date:** 2026-09-29
- **Status:** Completed — code shipped, Resend domain verified and Netlify env vars set (2026-09-30)

## Request

Send an email to the submitter confirming their event was received and will be posted after approval.

## What changed

- [netlify/functions/submit-event.ts](../netlify/functions/submit-event.ts) — after the GitHub PR is successfully created, calls a new `sendConfirmationEmail()` helper that sends a plain-text email via [Resend](https://resend.com)'s API to the verified submitter email (from Auth0's `/userinfo`).
- [.env.example](../.env.example) — documents the two new variables, `RESEND_API_KEY` and `RESEND_FROM_EMAIL`.

## How it works

- Uses `fetch` directly against Resend's REST API — no new npm dependency, consistent with how the GitHub API calls in the same function are done.
- Email sending is **best-effort and non-blocking**: if `RESEND_API_KEY` isn't set, or the Resend call fails for any reason, the function logs it and moves on — it never fails the submission itself. The PR (the part that actually matters) is already created by the time this runs.
- Email content: a short plain-text note confirming receipt, naming the event, and noting it's pending review.

## Setup required

Completed by Rob on 2026-09-30:

1. Created a Resend account, generated an API key, set `RESEND_API_KEY` in Netlify's environment variables.
2. Verified the `techkc.org` domain in Resend (DNS records added, confirmed verified).
3. Set `RESEND_FROM_EMAIL` to `TechKC <noreply@techkc.org>` in Netlify's environment variables.

## Verification

`npm run build` passes. The code path itself (Resend API call on successful PR creation) has not yet been exercised against the now-live credentials in this session — recommend a real test submission via `/submit-event` to confirm the confirmation email actually lands in an inbox, not just that the config is in place.
