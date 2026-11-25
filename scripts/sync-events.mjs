// Pulls upcoming events from group calendar feeds (iCal) and adds the ones
// TechKC doesn't have yet to src/data/events.json.
//
//   node scripts/sync-events.mjs            # update events.json, write a summary
//   node scripts/sync-events.mjs --dry-run  # only report what would change
//   add --verbose to list every upcoming event each source returned
//
// Run daily by .github/workflows/sync-events.yml, which opens a pull request for
// review; nothing goes live until that PR is merged. Sources (configured in
// scripts/event-sources.json):
//   - Meetup: each group's own calendar export (meetupUrl + "events/ical/").
//   - config.sources: other sites, each with a `type` naming a loader below
//     (iCal feeds, Bevy chapter API, Squarespace, Global AI, WordPress Event
//     List RSS, Wix Events). Sources without per-event links use eventUrl.
// Sources rarely give a usable location, so new events get the group's
// configured city (or "Virtual" when the source says so).
//
// Dedupe: an event is skipped if its link is already listed, or if the same
// group already has an event that day. A same-day entry that only links to the
// group's page (a hand-entered placeholder) is upgraded to the real event.
import { readFileSync, writeFileSync } from 'node:fs';

const EVENTS_PATH = 'src/data/events.json';
const GROUPS_PATH = 'src/data/groups.json';
const CONFIG_PATH = 'scripts/event-sources.json';
const SUMMARY_PATH = process.env.SYNC_SUMMARY_PATH; // markdown PR body, if set
const USER_AGENT = 'TechKC-calendar-bot/1.0 (+https://techkc.org)';
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose'); // list what each source returned (to stderr)

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

// Date-only arithmetic on YYYY-MM-DD keys (UTC noon avoids DST edge cases)
const keyToDate = k => new Date(`${k}T12:00:00Z`);
const dateToKey = d => d.toISOString().slice(0, 10);
const addDays = (k, n) => { const d = keyToDate(k); d.setUTCDate(d.getUTCDate() + n); return dateToKey(d); };

// ── Minimal iCal parsing: unfold lines, split VEVENTs, keep property params ───
function parseIcal(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const out = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { EXDATE: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [rawName, ...params] = line.slice(0, colon).split(';');
    const name = rawName.toUpperCase();
    const value = line.slice(colon + 1);
    if (name === 'EXDATE') cur.EXDATE.push(...value.split(','));
    else cur[name] = { value, params: params.join(';').toUpperCase() };
  }
  return out;
}
const unescapeText = s => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

// DTSTART;TZID=America/Chicago:20261210T190000 → { date: '2026-12-10', time: '19:00', allDay: false }
function icalDateTime(prop) {
  const v = typeof prop === 'string' ? prop : prop?.value;
  const m = v?.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(?:\d{2})?)?(Z?)/);
  if (!m) return null;
  const [, y, mo, d, h, mi, z] = m;
  if (!h) return { date: `${y}-${mo}-${d}`, time: null, allDay: true };
  if (z) {
    // UTC: convert to Kansas City local date/time
    const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
    const time = dt.toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' });
    return { date: kcDateKey(dt), time, allDay: false };
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, allDay: false };
}
function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ── Recurring events (RRULE): expand the common WEEKLY/MONTHLY patterns ───────
const WEEKDAYS = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Dates (YYYY-MM-DD) on which a recurring event occurs, up to `until`. */
function expandRrule(rruleText, startKey, until) {
  const r = Object.fromEntries(rruleText.split(';').map(p => p.split('=')));
  const interval = Number(r.INTERVAL ?? 1);
  const count = r.COUNT ? Number(r.COUNT) : Infinity;
  const ruleUntil = r.UNTIL ? icalDateTime(r.UNTIL).date : null;
  const last = ruleUntil && ruleUntil < until ? ruleUntil : until;
  const byDay = r.BYDAY ? r.BYDAY.split(',') : null;
  const dates = [];
  const push = k => { if (k >= startKey && k <= last && dates.length < count) dates.push(k); };

  if (r.FREQ === 'WEEKLY') {
    const days = (byDay ?? [Object.keys(WEEKDAYS)[keyToDate(startKey).getUTCDay()]]).map(d => WEEKDAYS[d.slice(-2)]).sort();
    // Walk week by week from the Sunday of the start week
    let weekStart = addDays(startKey, -keyToDate(startKey).getUTCDay());
    while (weekStart <= last && dates.length < count) {
      for (const wd of days) push(addDays(weekStart, wd));
      weekStart = addDays(weekStart, 7 * interval);
    }
    return dates;
  }
  if (r.FREQ === 'MONTHLY') {
    const s = keyToDate(startKey);
    let y = s.getUTCFullYear(), m = s.getUTCMonth();
    while (dateToKey(new Date(Date.UTC(y, m, 1, 12))) <= last && dates.length < count) {
      const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const monthDates = [];
      if (byDay) {
        for (const spec of byDay) {
          const [, ord, wd] = spec.match(/^([+-]?\d*)([A-Z]{2})$/) ?? [];
          if (!wd) continue;
          const matches = [];
          for (let d = 1; d <= daysInMonth; d++) {
            if (new Date(Date.UTC(y, m, d, 12)).getUTCDay() === WEEKDAYS[wd]) matches.push(d);
          }
          const n = Number(ord || 0);
          const picks = n > 0 ? [matches[n - 1]] : n < 0 ? [matches[matches.length + n]] : matches;
          monthDates.push(...picks.filter(Boolean));
        }
      } else {
        const day = Number(r.BYMONTHDAY ?? s.getUTCDate());
        if (day <= daysInMonth) monthDates.push(day);
      }
      for (const d of monthDates.sort((a, b) => a - b)) push(dateToKey(new Date(Date.UTC(y, m, d, 12))));
      m += interval;
      if (m > 11) { y += Math.floor(m / 12); m %= 12; }
    }
    return dates;
  }
  return null; // unsupported FREQ
}

/** Turn parsed VEVENTs into one instance per occurrence (recurrences expanded). */
function feedInstances(vevents, warnings, label) {
  const overridden = new Set(); // "uid|date" replaced by a RECURRENCE-ID entry
  for (const ve of vevents) {
    if (ve['RECURRENCE-ID'] && ve.UID) overridden.add(`${ve.UID.value}|${icalDateTime(ve['RECURRENCE-ID']).date}`);
  }
  const out = [];
  for (const ve of vevents) {
    const start = icalDateTime(ve.DTSTART);
    if (!start) continue;
    const endRaw = icalDateTime(ve.DTEND);
    // All-day DTEND is exclusive (an event on the 13th ends on the 14th)
    const end = endRaw && endRaw.allDay ? { ...endRaw, date: addDays(endRaw.date, -1) } : endRaw;
    const spanDays = end ? Math.round((keyToDate(end.date) - keyToDate(start.date)) / 86400000) : 0;
    const base = {
      title: ve.SUMMARY ? unescapeText(ve.SUMMARY.value) : null,
      url: ve.URL?.value ?? null,
      status: (ve.STATUS?.value ?? '').toUpperCase(),
      time: start.time,
      endTime: end?.time ?? null,
    };
    if (ve.RRULE && !ve['RECURRENCE-ID']) {
      const dates = expandRrule(ve.RRULE.value, start.date, horizonKey);
      if (!dates) {
        warnings.push(`${label}: skipped recurring "${base.title}" (unsupported rule ${ve.RRULE.value})`);
        continue;
      }
      const exdates = new Set(ve.EXDATE.map(x => icalDateTime(x)?.date));
      for (const date of dates) {
        if (exdates.has(date) || overridden.has(`${ve.UID?.value}|${date}`)) continue;
        out.push({ ...base, date, endDate: addDays(date, Math.max(spanDays, 0)) });
      }
    } else {
      out.push({ ...base, date: start.date, endDate: end && end.date >= start.date ? end.date : start.date });
    }
  }
  return out;
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
const titleMatches = (title, list) => (list ?? []).some(s => title.toLowerCase().includes(s.toLowerCase()));

const listedUrls = new Set(events.map(e => normUrl(e.url)));
const ids = new Set(events.map(e => e.id));
// Events deliberately removed from the calendar; never re-add them.
const ignoredUrls = new Set((config.ignoreEventUrls ?? []).map(normUrl));
const ignoredGroupDates = new Set((config.ignoreGroupDates ?? []).map(x => `${x.group}|${x.date}`));

// ── Sources ──────────────────────────────────────────────────────────────────
const groupByName = new Map(groups.map(g => [g.name, g]));
const meetupFeed = url => `${url.replace(/^http:/, 'https:').replace(/\/?$/, '/')}events/ical/`;

// Each non-Meetup source in config.sources has a `type` naming its loader below.
const sources = [
  ...groups
    .filter(g => g.active && g.meetupUrl)
    .map(g => ({ type: 'ical', group: g.name, groupId: g.id, feedUrl: meetupFeed(g.meetupUrl), groupUrls: [g.meetupUrl, g.url], tags: g.topics.slice(0, 3), meetup: true })),
  ...(config.extraMeetupGroups ?? []).map(x => ({ type: 'ical', group: x.group, groupId: slugify(x.group), feedUrl: meetupFeed(x.meetupUrl), groupUrls: [x.meetupUrl], tags: x.tags, meetup: true })),
  ...(config.sources ?? []).map(x => {
    const g = groupByName.get(x.group);
    return {
      ...x,
      groupId: g?.id ?? slugify(x.group),
      feedUrl: x.feedUrl ?? x.ical ?? x.api ?? x.url,
      groupUrls: [g?.url, g?.meetupUrl, x.eventUrl].filter(Boolean),
      tags: x.tags ?? g?.topics.slice(0, 3) ?? [],
      fixedUrl: x.eventUrl,
    };
  }),
].filter(s => !config.skipGroups.includes(s.group));

// ── Loaders: each returns instances { title, date, endDate, time, endTime, url, status, virtual }
async function get(url, accept) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, ...(accept ? { accept } : {}) }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
/** ISO timestamp (any offset) → Kansas City local { date, time }. */
function isoToKc(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  return { date: kcDateKey(d), time: d.toLocaleTimeString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit' }) };
}
function instanceFromIso(title, startIso, endIso, url, extra = {}) {
  const s = isoToKc(startIso);
  if (!s) return null;
  const e = endIso ? isoToKc(endIso) : null;
  return { title, date: s.date, endDate: e && e.date >= s.date ? e.date : s.date, time: s.time, endTime: e?.time ?? null, url, status: '', ...extra };
}
const decodeEntities = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const loaders = {
  // Any iCal feed: Meetup, Google Calendar public .ics, MemberNova, etc.
  async ical(src) {
    const text = await get(src.feedUrl);
    if (!text.startsWith('BEGIN:VCALENDAR')) throw new Error('not an iCal feed');
    return feedInstances(parseIcal(text), warnings, src.group);
  },

  // Bevy community platform (ace.atlassian.com, gdg.community.dev): chapter events API.
  async bevy(src) {
    const api = new URL(src.api);
    Object.entries({
      page_size: '50', status: 'Live', include_cohosted_events: 'true', visible_on_parent_chapter_only: 'true', order: 'start_date',
      fields: 'title,start_date,end_date,url,audience_type',
    })
      .forEach(([k, v]) => api.searchParams.set(k, v));
    const data = JSON.parse(await get(api.href, 'application/json'));
    return (data.results ?? []).map(e =>
      instanceFromIso(e.title, e.start_date, e.end_date, e.url, { virtual: e.audience_type === 'VIRTUAL' }));
  },

  // Squarespace events collection (e.g. seckc.org/upcoming-events): ?format=json.
  async squarespace(src) {
    const base = new URL(src.url);
    const data = JSON.parse(await get(`${base.href}?format=json`, 'application/json'));
    return [...(data.upcoming ?? []), ...(data.items ?? [])].map(e =>
      instanceFromIso(e.title, new Date(e.startDate).toISOString(), e.endDate ? new Date(e.endDate).toISOString() : null, new URL(e.fullUrl, base.origin).href));
  },

  // Global AI Community chapter page: chapter events are <a class="gai-event" href="/e/ID">,
  // and each event page embeds an "add to calendar" iCal file.
  async globalai(src) {
    const page = await get(src.url);
    const ids = [...new Set([...page.matchAll(/href="(\/e\/[a-z0-9]+)"[^>]*class="gai-event"/g)].map(m => m[1]))];
    if (!ids.length) warnings.push(`${src.group}: no events found on ${src.url} (page layout may have changed)`);
    const out = [];
    for (const id of ids) {
      const eventUrl = new URL(id, src.url).href;
      const html = await get(eventUrl);
      const m = html.match(/data:text\/calendar;charset=utf-8,([^"']+)/);
      if (!m) { warnings.push(`${src.group}: no calendar data on ${eventUrl}`); continue; }
      for (const inst of feedInstances(parseIcal(decodeURIComponent(decodeEntities(m[1]))), warnings, src.group)) {
        out.push({ ...inst, url: inst.url ?? eventUrl });
      }
    }
    return out;
  },

  // WordPress "Event List" plugin RSS (e.g. kcdama.org/feed/event-list). Titles look like
  // "Nov 6, 2026 - Title"; pubDate is the event date. Items have no per-event link.
  async eventListRss(src) {
    const xml = await get(src.rss);
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
      const rawTitle = decodeEntities(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim();
      const pub = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
      const date = pub ? new Date(pub).toISOString().slice(0, 10) : null; // stored as midnight UTC on the event date
      if (!date) return null;
      const desc = decodeEntities(item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '');
      const t = desc.match(/\b(\d{1,2}):(\d{2})\s*([AP]M)\s*-\s*(\d{1,2}):(\d{2})\s*([AP]M)/i);
      const to24 = (h, mi, ap) => `${String((+h % 12) + (/p/i.test(ap) ? 12 : 0)).padStart(2, '0')}:${mi}`;
      return {
        title: rawTitle.replace(/^[A-Z][a-z]{2} \d{1,2}, \d{4}\s*-\s*/, ''),
        date, endDate: date,
        time: t ? to24(t[1], t[2], t[3]) : null,
        endTime: t ? to24(t[4], t[5], t[6]) : null,
        url: null, status: '',
      };
    });
  },

  // Wix Events: the calendar page embeds each event's JSON (scheduling, title, slug, status).
  async wixEvents(src) {
    const html = await get(src.url);
    const re = /"scheduling":\{"config":\{"scheduleTbd":(true|false),"startDate":"([^"]+)","endDate":"([^"]+)"[\s\S]*?"title":"((?:[^"\\]|\\.)*)"[\s\S]*?"slug":"([a-z0-9-]+)"(?:,"language":"[^"]*")?(?:,"created":"[^"]*")?(?:,"modified":"[^"]*")?(?:,"status":(\d))?/g;
    const bySlug = new Map();
    for (const m of html.matchAll(re)) {
      if (m[1] === 'true') continue; // date TBD
      const title = JSON.parse(`"${m[4]}"`).trim();
      // Wix event status 3 = canceled
      bySlug.set(m[5], instanceFromIso(title, m[2], m[3], new URL(m[5], src.eventBaseUrl).href, { status: m[6] === '3' ? 'CANCELLED' : '' }));
    }
    if (!bySlug.size) warnings.push(`${src.group}: no events found on ${src.url} (page layout may have changed)`);
    return [...bySlug.values()];
  },
};

const added = [];
const upgraded = [];
const cancelled = [];
const failures = [];
const warnings = [];

for (const src of sources) {
  let instances;
  try {
    const load = loaders[src.type];
    if (!load) throw new Error(`unknown source type "${src.type}"`);
    instances = (await load(src)).filter(Boolean);
  } catch (err) {
    failures.push({ group: src.group, feedUrl: src.feedUrl, error: String(err.message ?? err) });
    continue;
  }

  const groupPageUrls = new Set(src.groupUrls.map(normUrl));

  if (VERBOSE) {
    const upcoming = instances.filter(i => i.title && i.date >= todayKey && i.date <= horizonKey);
    console.error(`[${src.type}] ${src.group}: ${instances.length} found, ${upcoming.length} upcoming`);
    for (const i of upcoming) console.error(`    ${i.date} ${i.title}${i.virtual ? ' (virtual)' : ''}  ${i.url ?? src.fixedUrl ?? ''}`);
  }

  for (const inst of instances) {
    const { title, date } = inst;
    if (!title || date < todayKey || date > horizonKey) continue;
    if (titleMatches(title, config.skipTitlesMatching)) continue;
    if (src.includeTitlesMatching && !titleMatches(title, src.includeTitlesMatching)) continue;
    if (ignoredGroupDates.has(`${src.group}|${date}`)) continue;

    // Feeds without per-event links all share fixedUrl, so match those by group + day only.
    const url = inst.url ?? src.fixedUrl;
    if (!url) continue;
    const perEventUrl = Boolean(inst.url);
    if (perEventUrl && ignoredUrls.has(normUrl(url))) continue;

    const sameDay = events.filter(e => e.group === src.group && e.date === date);
    const known = perEventUrl ? listedUrls.has(normUrl(url)) : sameDay.length > 0;

    if (inst.status === 'CANCELLED') {
      // Never delete automatically; flag it for review if we list it.
      if (known) cancelled.push({ group: src.group, name: title, date, url });
      continue;
    }
    if (known) continue;

    if (sameDay.length) {
      const placeholder = perEventUrl && sameDay.find(e => groupPageUrls.has(normUrl(e.url)));
      if (placeholder) {
        upgraded.push({ from: { name: placeholder.name, url: placeholder.url }, to: { name: title, url }, date, group: src.group });
        placeholder.name = title;
        placeholder.url = url;
        listedUrls.add(normUrl(url));
      }
      // Otherwise it's already listed under a different link; leave it alone.
      continue;
    }

    let id = `${src.groupId}-${date}-${slugify(title)}`.slice(0, 90).replace(/-$/, '');
    for (let n = 2; ids.has(id); n++) id = `${id}-${n}`;
    ids.add(id);
    listedUrls.add(normUrl(url));

    const timeText = inst.time
      ? (inst.endTime && inst.endDate === date ? `${fmtTime(inst.time)} - ${fmtTime(inst.endTime)}.` : `${fmtTime(inst.time)}.`)
      : undefined;

    const ev = {
      id,
      name: title,
      group: src.group,
      ...(timeText ? { description: timeText } : {}),
      url,
      date,
      endDate: inst.endDate,
      location: inst.virtual ? 'Virtual' : (config.locations[src.group] ?? config.defaultLocation),
      type: 'Meetup',
      tags: [...new Set([...(src.tags ?? []), 'Meetup'])],
    };
    events.push(ev);
    added.push(ev);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const meetupCount = sources.filter(s => s.meetup).length;
const otherCount = sources.length - meetupCount;
const lines = [];
lines.push(`Checked ${meetupCount} Meetup group calendars${otherCount ? ` and ${otherCount} other calendar${otherCount > 1 ? 's' : ''}` : ''} for events from ${todayKey} through ${horizonKey}.`, '');
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
  lines.push(`### Cancelled at the source but still listed (${cancelled.length}): not removed, please check`, '');
  for (const c of cancelled) lines.push(`- ${c.date} ${c.group}: [${c.name}](${c.url})`);
  lines.push('');
}
if (failures.length) {
  lines.push(`### Feeds that couldn't be read (${failures.length})`, '');
  for (const f of failures) lines.push(`- ${f.group}: ${f.feedUrl} (${f.error})`);
  lines.push('');
}
if (warnings.length) {
  lines.push('### Warnings', '');
  for (const w of warnings) lines.push(`- ${w}`);
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
