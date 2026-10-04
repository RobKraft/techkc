# Submit page: "Your events" list, edit mode, and pre-fill

- **Date:** 2026-10-04
- **Status:** Completed (uncommitted)

## Request

A way to submit edits and deletes for your own events, and remember submitter details to pre-populate Organizing Group, event website, event type, and location.

## What changed

All in [src/pages/submit-event.astro](../src/pages/submit-event.astro):

- **"Your events" list** above the form, shown only if the person has live events. Each row has **Edit** and **Delete**.
- **Edit mode:** Edit loads the event into the same form, changes the heading to "Edit: <name>" and the button to "Submit changes", and shows "Cancel edit". Submitting calls `edit-event`.
- **Delete:** confirms, then calls `delete-event`. Server errors (e.g. "You can only delete events you submitted.") are shown inline and leave the buttons usable.
- **Pending state:** after a successful edit or removal request, that row shows "Change pending review" / "Removal pending review" and its buttons are disabled, so the same thing isn't submitted twice. (It is per page view; the list reloads from `main`.)
- **Pre-fill** of group, website, type, and location on the new-event form, from two sources merged together:
  1. the server's `defaults` (their most recent live events), which works on any device;
  2. `localStorage` (`techkc-submitter-defaults:<auth0 user id>`), saved on every successful submit or edit, which covers the period while a PR is unmerged and the server has nothing yet.
  Local values win. Pre-fill never overwrites something already typed, and is not applied while editing.
- All event text is inserted with `textContent`, never `innerHTML`, since names come from user input.
- The list and pre-fill are conveniences: if `my-events` fails or isn't configured, the form still works as before.
- New submissions still redirect to the homepage after ~2 seconds (existing behavior); edits and removals stay on the page so you can see the confirmation and the pending row.

## Verification

Auth0 can't run locally, so I made a throwaway copy of the page (deleted afterwards) with the Auth0 client and the `/.netlify/functions/*` calls stubbed in-page, and drove the real script in the dev server:
- list renders two rows with formatted dates; pre-fill populated all four fields;
- new submission with only required fields sent a payload with no `cost`/`location`/`description`; success message shown; `localStorage` defaults saved;
- Edit populated every field correctly (including tags as "A, B"); clearing the description omitted it from the payload; after success the form returned to "new event" mode, the success message stayed visible, and the row showed "Change pending review" with buttons disabled;
- Delete: a stubbed 403 showed the server's message and left buttons enabled; a stubbed success marked the row "Removal pending review";
- the payloads the UI produced were fed through the real server-side `parseEventFields()` and validated;
- `npm run build` passes; screenshot checked for layout.

Not done: the real Auth0 login redirect and a real round trip through the deployed functions. After deploying, try it once end to end: submit, merge the PR, reload, confirm the event appears under "Your events", then edit it and delete it.
