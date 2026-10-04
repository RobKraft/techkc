# Normalize events.json formatting

- **Date:** 2026-10-04
- **Status:** Completed (uncommitted). Data unchanged; formatting only.

## Why

`src/data/events.json` mixed two styles: older entries had one tag per line, and hand-added entries (including most of mine) had tags on one line. The submission function re-serialized the whole file with `JSON.stringify(..., null, 2)`, so **every PR it opened rewrote hundreds of lines** and buried the actual change. That defeats the point of "review the diff", and it matters more now that edits and deletes also go through PRs.

## What changed

- Added `serializeEvents()` to [netlify/lib/common.ts](../netlify/lib/common.ts), which writes the format the file is hand-edited in (2-space entries, 4-space fields, tags inline).
- Rewrote [src/data/events.json](../src/data/events.json) once with it: 742 lines down to 548, **43 events, identical data**. The script that did it asserted `JSON.parse(before)` deep-equals `JSON.parse(after)` and that serializing is idempotent.

## Things to know

- This will look like a big diff in the commit. It is formatting only; verify with any JSON-aware diff if you like.
- **Merge this with the function changes.** After this, an edit or delete PR touches only the affected entry, and a new-submission PR only appends one.
- Hand-editing is unaffected, as long as new entries follow the same style (tags on one line).

## Verification

Harness check: `serializeEvents(parse(events.json))` reproduces the file **byte-for-byte**, so unchanged entries produce no diff lines.
