// Pulls upcoming events from each group's Meetup calendar feed (iCal) and adds
// the ones TechKC doesn't have yet to src/data/events.json.
//
//   node scripts/sync-events.mjs            # update events.json, write a summary
//   node scripts/sync-events.mjs --dry-run  # only report what would change
//
// Run daily by .github/workflows/sync-events.yml, which opens a pull request for
// review; nothing goes live until that PR is merged. Feeds are Meetup's own
// calendar export, not scraped pages. They carry title, start/end, link, and
// status but no location, so new events get the group's configured city.
//
// Dedupe: an event is skipped if its Meetup link is already listed, or if the
// same group already has an event that day. A same-day entry that only links to
// the group's page (a hand-entered placeholder) is upgraded to the real event.
import { readFileSync, writeFileSync } from 'node:fs';

const EVENTS_PATH = 'src/data/events.json';
const GROUPS_PATH = 'src/data/groups.json';
const CONFIG_PATH = 'scripts/event-sources.json';
const SUMMARY_PATH = process.env.SYNC_SUMMARY_PATH; // markdown PR body, if set
const USER_AGENT = 'TechKC-calendar-bot/1.0 (+https://techkc.org)';
const DRY_RUN = process.argv.includes('--dry-run');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const groups = JSON.parse(readFileSync(GROUPS_PATH, 'utf8'));
const eventsSrc = readFileSync(EVENTS_PATH, 'utf8');
const events = JSON.parse(eventsSrc);

// ── Dates (all in Kansas City time, which is what the feeds use) ──────────────
function kcDateKey(d) {
  // en-CA formats as YYYY-MM-DD
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}
const todayKey = kcDateKey(new Date());
const horizonKey = kcDateKey(new Date(Date.now() + config.horizonDays * 86400000));

// ── Minimal iCal parsing: unfold lines, split VEVENTs, read the few props we use
function parseIcal(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    cur[name] = line.slice(colon + 1);
  }
  return out;
}
const unescapeText = s => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();
// DTSTART;TZID=America/Chicago:20261210T190000 → { date: '2026-12-10', time: '19:00' }
function icalDateTime(v) {
  const m = v?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?(Z?)/);
  if (!m) return null;
  const [, y, mo, d, h, mi, z] = m;
  if (z) {
    // UTC: convert to Kansas City local date/time
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +(h ?? 0), +(mi ?? 0)));
    const time = dt.toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' });
    return { date: kcDateKey(dt), time: h ? time : null };
  }
  return { date: `${y}-${mo}-${d}`, time: h ? `${h}:${mi}` : null };
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ── Helpers for matching against what's already listed ───────────────────────
function normUrl(u) {
  try {
    const url = new URL(u.trim());
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return u.trim().toLowerCase();
  }
}
function slugify(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50).replace(/-$/, '');
}

const listedUrls = new Set(events.map(e => normUrl(e.url)));
// Events deliberately removed from the calendar; never re-add them.
const ignoredUrls = new Set((config.ignoreEventUrls ?? []).map(normUrl));
const ids = new Set(events.map(e => e.id));

// ── Sources: groups.json Meetup groups + extras from the config ──────────────
const sources = [
  ...groups
    .filter(g => g.active && g.meetupUrl)
    .map(g => ({ group: g.name, groupId: g.id, meetupUrl: g.meetupUrl, groupUrl: g.url, tags: g.topics.slice(0, 3) })),
  ...config.extraMeetupGroups.map(x => ({ ...x, groupId: slugify(x.group), groupUrl: x.meetupUrl })),
].filter(s => !config.skipGroups.includes(s.group));

const added = [];
const upgraded = [];
const cancelled = [];
const failures = [];

for (const src of sources) {
  const base = src.meetupUrl.replace(/^http:/, 'https:').replace(/\/?$/, '/');
  const feedUrl = `${base}events/ical/`;
  let text;
  try {
    const res = await fetch(feedUrl, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    if (!text.startsWith('BEGIN:VCALENDAR')) throw new Error('not an iCal feed');
  } catch (err) {
    failures.push({ group: src.group, feedUrl, error: String(err.message ?? err) });
    continue;
  }

  const groupPageUrls = new Set([normUrl(base), normUrl(src.groupUrl)]);

  for (const ve of parseIcal(text)) {
    const start = icalDateTime(ve.DTSTART);
    const end = icalDateTime(ve.DTEND);
    const url = ve.URL;
    const title = ve.SUMMARY ? unescapeText(ve.SUMMARY) : null;
    if (!start || !url || !title) continue;
    if (start.date < todayKey || start.date > horizonKey) continue;
    if ((config.skipTitlesMatching ?? []).some(s => title.toLowerCase().includes(s.toLowerCase()))) continue;
    if (ignoredUrls.has(normUrl(url))) continue;

    const status = (ve.STATUS ?? '').toUpperCase();
    const known = listedUrls.has(normUrl(url));

    if (status === 'CANCELLED') {
      // Never delete automatically; flag it for review if we list it.
      if (known) cancelled.push({ group: src.group, name: title, date: start.date, url });
      continue;
    }
    if (known) continue;

    const sameDay = events.filter(e => e.group === src.group && e.date === start.date);
    if (sameDay.length) {
      const placeholder = sameDay.find(e => groupPageUrls.has(normUrl(e.url)));
      if (placeholder) {
        upgraded.push({ from: { name: placeholder.name, url: placeholder.url }, to: { name: title, url }, date: start.date, group: src.group });
        placeholder.name = title;
        placeholder.url = url;
        listedUrls.add(normUrl(url));
      }
      // Otherwise it's already listed under a different link; leave it alone.
      continue;
    }

    let id = `${src.groupId}-${start.date}-${slugify(title)}`.slice(0, 90).replace(/-$/, '');
    for (let n = 2; ids.has(id); n++) id = `${id}-${n}`;
    ids.add(id);
    listedUrls.add(normUrl(url));

    const timeText = start.time
      ? (end?.time && end.date === start.date ? `${fmtTime(start.time)} - ${fmtTime(end.time)}.` : `${fmtTime(start.time)}.`)
      : undefined;

    const ev = {
      id,
      name: title,
      group: src.group,
      ...(timeText ? { description: timeText } : {}),
      url,
      date: start.date,
      endDate: end && end.date >= start.date ? end.date : start.date,
      location: config.locations[src.group] ?? config.defaultLocation,
      type: 'Meetup',
      tags: [...new Set([...(src.tags ?? []), 'Meetup'])],
    };
    events.push(ev);
    added.push(ev);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const lines = [];
lines.push(`Checked ${sources.length} Meetup group calendars for events from ${todayKey} through ${horizonKey}.`, '');
if (added.length) {
  lines.push(`### New events (${added.length})`, '', '| Date | Group | Event |', '|---|---|---|');
  for (const e of [...added].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(`| ${e.date} | ${e.group} | [${e.name.replace(/\|/g, '/')}](${e.url}) |`);
  }
  lines.push('');
}
if (upgraded.length) {
  lines.push(`### Placeholders replaced with the real event (${upgraded.length})`, '');
  for (const u of upgraded) lines.push(`- ${u.date} ${u.group}: "${u.from.name}" → [${u.to.name}](${u.to.url})`);
  lines.push('');
}
if (cancelled.length) {
  lines.push(`### Cancelled on Meetup but still listed (${cancelled.length}): not removed, please check`, '');
  for (const c of cancelled) lines.push(`- ${c.date} ${c.group}: [${c.name}](${c.url})`);
  lines.push('');
}
if (failures.length) {
  lines.push(`### Feeds that couldn't be read (${failures.length})`, '');
  for (const f of failures) lines.push(`- ${f.group}: ${f.feedUrl} (${f.error})`);
  lines.push('');
}
if (!added.length && !upgraded.length) lines.push('No new events.');
const summary = lines.join('\n');
console.log(summary);
if (SUMMARY_PATH) writeFileSync(SUMMARY_PATH, summary + '\n');

// ── Write events.json in the file's existing style (2-space JSON, one-line tags)
const changed = added.length > 0 || upgraded.length > 0;
if (changed && !DRY_RUN) {
  const nl = eventsSrc.includes('\r\n') ? '\r\n' : '\n';
  let out = JSON.stringify(events, null, 2).replace(/"tags": \[\s*([^\]]*?)\s*\]/g, (_, inner) =>
    `"tags": [${inner.split(/,\s*/).filter(Boolean).join(', ')}]`);
  out = out.replace(/\n/g, nl) + (eventsSrc.endsWith('\n') ? nl : '');
  writeFileSync(EVENTS_PATH, out);
}
if (DRY_RUN) console.log('\n(dry run: events.json not changed)');
