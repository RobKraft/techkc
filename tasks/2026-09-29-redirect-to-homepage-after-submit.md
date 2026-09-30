# Redirect to homepage after event submission

- **Date:** 2026-09-29
- **Status:** Completed

## Request

After a successful submission on `/submit-event`, take the user to the homepage instead of leaving them on the form page.

## What changed

- [src/pages/submit-event.astro](../src/pages/submit-event.astro) — on a successful submission, the existing success message (with the PR link) still displays briefly, then the page redirects to `/` after 2.2 seconds via `window.location.href`.

## How it works

The delay is intentional: it gives the submitter a moment to see confirmation and the PR link before being moved along, rather than yanking them away instantly.

## Setup required

None — no new config or environment variables.

## Verification

`npm run build` passes. Not re-tested live end-to-end (no code path here interacts with Auth0/GitHub); behavior follows directly from the existing, already-verified success branch.
