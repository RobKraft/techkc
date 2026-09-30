# Fix event search silently scoped to the calendar's current month

- **Date:** 2026-09-30
- **Status:** Completed

## Request

Rob reported search on the events/calendar page "does not work."

## Root cause

[src/pages/events.astro](../src/pages/events.astro)'s card-grid filter required `matchMonth && matchText && matchRegion` to show a card. `matchMonth` ties the grid to whatever month the compact calendar view currently happens to be showing. So searching for something outside that month (e.g. "FutureCon," which has events in Feb/June/Aug, while the calendar defaults to the current month) returned zero results even though the text genuinely matched — the search itself worked, but the month restriction silently overrode it. From a user's perspective that just looks like "search is broken."

## What changed

- [src/pages/events.astro](../src/pages/events.astro) — `applyFilters()` now only applies the month restriction when the search box is empty. While there's an active search query, matching is done across the whole year; clearing the search reverts to the normal month-scoped browsing tied to the calendar.

## Verification

`npm run build` passes. Tested live in the browser: searching "futurecon" while the calendar showed September correctly surfaced all 3 FutureCon conferences (Feb/June/Aug), and clearing the search correctly reverted to showing only September's 15 events.
