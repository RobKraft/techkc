# Groups list cleanup: two removals, one deletion pair, one move

- **Date:** 2026-09-30
- **Status:** Completed

## Request

- Remove "Coding and Cupcakes KC" group
- Move "Kansas City Women in Technology" from Groups to Organizations
- Remove "1 Million Cups" group
- Remove "Next Five Meetup" group

## What changed

- [src/data/groups.json](../src/data/groups.json) — removed four entries: `coding-and-cupcakes`, `1-million-cups`, `kc-women-in-tech`, `next-five`. 61 → 57 groups.
- [src/data/orgs.json](../src/data/orgs.json) — added "Kansas City Women in Technology" (shortName `KCWiT`), converted from its old group entry into the org schema (no `topics`/`frequency`/`active`, uses `category`/`tags` instead). 16 → 17 orgs.

## Note

"1 Million Cups Kansas City" already existed as its own separate entry in `orgs.json` before this change — so removing the group version leaves that org entry as the only listing for it, no duplication and nothing else needed there.

## Verification

Both JSON files validated, `npm run build` passes. Not yet viewed live in the browser.
