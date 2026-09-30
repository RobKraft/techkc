# Add ProductTank Kansas City group

- **Date:** 2026-09-30
- **Status:** Completed

## Request

Add the group at https://www.meetup.com/producttank-kansas-city/ to the site.

## What changed

- [src/data/groups.json](../src/data/groups.json) — new entry `producttank-kc`, inserted alphabetically between OWASP Kansas City and Python KC:
  - Description and topics drawn from the group's Meetup page (product management, design, UX, strategy, metrics — part of the global ProductTank network).
  - Frequency: Monthly, per Rob directly (not stated explicitly on the Meetup page itself).

## Verification

JSON validated, `npm run build` passes (61 groups total now). Not yet viewed live in the browser — it'll appear on `/groups` and the homepage's group count the same as any other entry in that file.
