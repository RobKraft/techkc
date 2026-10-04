# Let submitters edit and delete their own events (overview)

- **Date:** 2026-10-04
- **Status:** Code complete and tested locally; **not yet committed, pushed, or deployed**. Needs the one-time setup below before it works in production.

## Request

1. Let people submit edits and deletions for events, but only for the events *they* submitted.
2. Don't require location or description on submit, and remove cost.
3. Remember details about the submitter to pre-fill Organizing Group, event website, event type, and location.

## Steps (one file each)

1. [Relax the submit form and remove cost](2026-10-04-relax-event-form-remove-cost.md)
2. [Event ownership + shared server library](2026-10-04-event-ownership-and-shared-library.md)
3. [Normalize events.json formatting](2026-10-04-normalize-events-json-formatting.md)
4. [My-events, edit-event, delete-event functions](2026-10-04-edit-and-delete-event-functions.md)
5. [Submit page: Your events list, edit mode, pre-fill](2026-10-04-my-events-ui-and-prefill.md)

## Decisions made (you can reverse any of these)

- **Review gate stays.** Edits and deletes open a PR for you to merge, exactly like new submissions. Nothing a submitter does changes the live site on its own.
- **Ownership = HMAC of the submitter's email**, stored as `owner` on the event in `events.json`. The file is public, so the raw email is never stored.
- **Pre-fill sources:** the submitter's most recent live events (server-side, works on any device) overlaid with what they last submitted on this device (`localStorage`, covers the gap while a PR is still unmerged).
- **Events with no location** are treated as Kansas City for the region filter on /events, since this is a KC calendar.

## Setup required before this works in production

1. **Generate a secret and set it in Netlify:** `OWNER_HASH_SECRET` (for example `openssl rand -hex 32`). **Never change it afterwards**, or every existing owner is orphaned. Documented in [.env.example](../.env.example).
   - Until it is set, submissions still work but record no owner (the PR body says so), and `my-events` / `edit-event` / `delete-event` return 503.
2. **Merge the normalization of events.json together with the code** (see step 3), otherwise the first edit/delete PR will rewrite the whole file.
3. **Existing events have no owner** and are not editable by anyone but you. To give someone control of an older event, run `OWNER_HASH_SECRET=<secret> node scripts/owner-hash.mjs their@email.com` and paste the printed `"owner": "..."` line into that event in `events.json`. Everything I added by hand in this session (WiSKC, Agile KC, etc.) is in this category.

## Known limitations

- The "Your events" list reads published events from `main`. A change you have submitted but not yet merged still shows the old values (the UI marks the row "pending review" for the current page view only).
- Ownership follows the submitter's email. If a group leader hands off, you re-point the `owner` with the script.
- Two pending PRs touching the same event can conflict when merging the second; resolve like any other merge conflict.
- Not exercised against real Auth0 or GitHub. See each step's Verification section for what was and wasn't tested.
