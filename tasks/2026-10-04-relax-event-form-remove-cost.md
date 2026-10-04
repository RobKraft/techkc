# Relax the submit form and remove cost

- **Date:** 2026-10-04
- **Status:** Completed (uncommitted)

## Request

Don't require location or description when people submit events, and remove cost.

## What changed

- [src/pages/submit-event.astro](../src/pages/submit-event.astro) — removed the Cost field; Location and Description are no longer `required` and are labelled "(optional)". Empty optional fields are sent as absent rather than as empty strings.
- [netlify/lib/common.ts](../netlify/lib/common.ts) `parseEventFields()` — server-side validation now requires only name, event website, event type, and start date. Location and description are optional; cost is no longer read at all. (The old `validateSubmission` in `submit-event.ts` required all three.)
- Display code tolerates events that have no location, description, or cost, since new events will often lack them:
  - [src/components/EventCard.astro](../src/components/EventCard.astro) — description paragraph, location row, and cost text render only when present (types made optional).
  - [src/components/Calendar.astro](../src/components/Calendar.astro) — the "· location" suffix only renders when a location exists (types made optional).
  - [src/pages/events.astro](../src/pages/events.astro) — region filter and search no longer assume `location`/`description` exist. A missing location counts as "Kansas City / Virtual" for the region filter (judgment call: this is a KC calendar, and treating them as "Other" would hide local events from the default filter).

## Things to know

- **Cost still exists on older events** and still displays for them. Only the *submission* of cost was removed. Edits preserve an existing `cost` value untouched (see step 4).
- Server-side validation also got a few safety checks while I was in there: the event website must be `http(s)` (a `javascript:` link would otherwise be rendered as a clickable href on the site), dates must be real calendar dates, end date cannot precede start date, and field lengths are capped.

## Verification

- `npm run build` passes.
- In the browser (stubbed page): no cost field exists, Location/Description are not required, and a submission with those left empty sent a payload with no `location`, `description`, or `cost` keys.
- Server harness: a submission containing only name, url, type, and date succeeds; `javascript:` URLs, invalid dates, end-before-start, and blank names are rejected with 400 and create no branch.
- Not done: viewing an event card with missing fields on the real /events page (no such event exists in the data yet). The template changes are conditionals only, and the build renders all existing events.
