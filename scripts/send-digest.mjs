// Builds the weekly "This week in KC tech" email from src/data/events.json and
// sends it to the digest segment as a Resend broadcast.
//
//   node scripts/send-digest.mjs --preview [file.html]   # write the email to a file, send nothing
//   node scripts/send-digest.mjs --test you@example.com  # send one copy to that address only
//   node scripts/send-digest.mjs --send                  # send to every subscriber
//
// Env: RESEND_API_KEY, RESEND_DIGEST_SEGMENT_ID (for --send), RESEND_FROM_EMAIL,
// optional DIGEST_POSTAL_ADDRESS (mailing address shown in the footer).
// Run Sunday evenings by .github/workflows/weekly-digest.yml. The week covered
// is the seven days after the run date (Monday–Sunday when run on a Sunday).
import { readFileSync, writeFileSync } from 'node:fs';

const SITE = 'https://techkc.org';
const UNSUBSCRIBE = '{{{RESEND_UNSUBSCRIBE_URL}}}'; // Resend fills in a per-recipient link for broadcasts
const COMING_UP_DAYS = 45;
const COMING_UP_MAX = 6;

const args = process.argv.slice(2);
const mode = args.includes('--send') ? 'send' : args.includes('--test') ? 'test' : 'preview';
const testTo = mode === 'test' ? args[args.indexOf('--test') + 1] : null;
const previewFile = mode === 'preview' ? (args[args.indexOf('--preview') + 1] ?? 'digest-preview.html') : null;

// ── Dates in Kansas City time ───────────────────────────────────────────────
const kcDateKey = d => d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
const keyToDate = k => new Date(`${k}T12:00:00Z`);
const addDays = (k, n) => { const d = keyToDate(k); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fmt = (k, opts) => keyToDate(k).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

const today = kcDateKey(new Date());
const weekStart = addDays(today, 1);
const weekEnd = addDays(weekStart, 6);
const comingUpEnd = addDays(weekEnd, COMING_UP_DAYS);

// ── Pick events ─────────────────────────────────────────────────────────────
const events = JSON.parse(readFileSync('src/data/events.json', 'utf8')).filter(e => !e.dateTBD);
const endOf = e => e.endDate ?? e.date;

// Same rule as the site (src/lib/events.ts): "Group: Title" unless the title already names the group.
const displayTitle = e => (!e.group || e.name.toLowerCase().includes(e.group.toLowerCase()) ? e.name : `${e.group}: ${e.name}`);

const thisWeek = events
  .filter(e => e.date <= weekEnd && endOf(e) >= weekStart)
  .sort((a, b) => a.date.localeCompare(b.date) || displayTitle(a).localeCompare(displayTitle(b)));

// Bigger events further out: conferences, workshops, and the like (not regular meetups).
const comingUp = events
  .filter(e => e.date > weekEnd && e.date <= comingUpEnd && e.type !== 'Meetup')
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(0, COMING_UP_MAX);

if (!thisWeek.length && !comingUp.length) {
  console.log(`No events for ${weekStart} to ${weekEnd} or coming up; nothing to send.`);
  process.exit(0);
}

// Group this week's events by day; events already underway are listed on the first day.
const byDay = new Map();
for (const e of thisWeek) {
  const day = e.date < weekStart ? weekStart : e.date;
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(e);
}

// ── Render ──────────────────────────────────────────────────────────────────
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const where = e => (e.location === 'Virtual' ? 'Online' : e.location && e.location !== 'Kansas City, MO' ? e.location : '');
const rangeLabel = e => (endOf(e) !== e.date ? `${fmt(e.date, { month: 'short', day: 'numeric' })}–${fmt(endOf(e), { month: 'short', day: 'numeric' })}` : '');

const weekLabel = `${fmt(weekStart, { month: 'short', day: 'numeric' })}–${fmt(weekEnd, weekStart.slice(5, 7) === weekEnd.slice(5, 7) ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;
const subject = thisWeek.length
  ? `This week in KC tech: ${weekLabel} (${thisWeek.length} event${thisWeek.length === 1 ? '' : 's'})`
  : `This week in KC tech: ${weekLabel}`;
const postal = process.env.DIGEST_POSTAL_ADDRESS;

// Coming-up items show their date, since they aren't under a day heading.
const htmlEvent = (e, withDate) => {
  const date = rangeLabel(e) || (withDate ? fmt(e.date, { weekday: 'short', month: 'short', day: 'numeric' }) : '');
  const meta = [date, where(e), e.cost === 'Free' ? 'Free' : ''].filter(Boolean).join(' · ');
  return `<tr><td style="padding:6px 0 6px 12px;border-left:3px solid #93c5fd">
    <a href="${esc(e.url)}" style="color:#0f172a;font-weight:600;text-decoration:none">${esc(displayTitle(e))}</a>
    ${meta ? `<div style="color:#64748b;font-size:13px;margin-top:2px">${esc(meta)}</div>` : ''}
  </td></tr><tr><td style="height:6px"></td></tr>`;
};

const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:28px">
  <tr><td>
    <div style="font-size:13px;font-weight:700;color:#2563eb;letter-spacing:.04em;text-transform:uppercase">TechKC</div>
    <h1 style="font-size:24px;margin:6px 0 4px">This week in KC tech</h1>
    <div style="color:#64748b;font-size:14px;margin-bottom:20px">${esc(fmt(weekStart, { weekday: 'long', month: 'long', day: 'numeric' }))} – ${esc(fmt(weekEnd, { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
    ${thisWeek.length ? '' : '<p style="color:#475569">A quiet week on the calendar. Here\'s what\'s coming up.</p>'}
    ${[...byDay].map(([day, evs]) => `
      <h2 style="font-size:15px;margin:18px 0 8px;color:#334155">${esc(fmt(day, { weekday: 'long', month: 'short', day: 'numeric' }))}</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${evs.map(e => htmlEvent(e, false)).join('')}</table>`).join('')}
    ${comingUp.length ? `
      <h2 style="font-size:17px;margin:28px 0 8px;padding-top:16px;border-top:1px solid #e2e8f0">Coming up</h2>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${comingUp.map(e => htmlEvent(e, true)).join('')}</table>` : ''}
    <p style="margin:28px 0 0"><a href="${SITE}/events" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600">See the full calendar</a></p>
    <p style="color:#64748b;font-size:13px;margin-top:20px">Know of an event that's missing? <a href="${SITE}/submit#event" style="color:#2563eb">Add it to TechKC</a>.</p>
  </td></tr>
</table>
<p style="color:#94a3b8;font-size:12px;max-width:600px;margin:16px auto 0;line-height:1.5">
  You're getting this because you signed up at <a href="${SITE}/subscribe" style="color:#94a3b8">techkc.org</a>.
  <a href="${UNSUBSCRIBE}" style="color:#94a3b8">Unsubscribe</a>.${postal ? `<br>${esc(postal)}` : ''}
</p>
</td></tr></table></body></html>`;

const textEvent = (e, withDate) => {
  const date = withDate ? `${rangeLabel(e) || fmt(e.date, { month: 'short', day: 'numeric' })} · ` : (rangeLabel(e) ? `${rangeLabel(e)} · ` : '');
  const meta = [where(e), e.cost === 'Free' ? 'Free' : ''].filter(Boolean).join(' · ');
  return `  - ${date}${displayTitle(e)}${meta ? ` (${meta})` : ''}\n    ${e.url}`;
};
const text = [
  `THIS WEEK IN KC TECH`,
  `${fmt(weekStart, { weekday: 'long', month: 'long', day: 'numeric' })} - ${fmt(weekEnd, { weekday: 'long', month: 'long', day: 'numeric' })}`,
  '',
  ...(thisWeek.length ? [] : ["A quiet week on the calendar. Here's what's coming up.", '']),
  ...[...byDay].flatMap(([day, evs]) => [fmt(day, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase(), ...evs.map(e => textEvent(e, false)), '']),
  ...(comingUp.length ? ['COMING UP', ...comingUp.map(e => textEvent(e, true)), ''] : []),
  `Full calendar: ${SITE}/events`,
  `Missing an event? Add it: ${SITE}/submit#event`,
  '',
  `You're getting this because you signed up at ${SITE}/subscribe.`,
  `Unsubscribe: ${UNSUBSCRIBE}`,
  ...(postal ? [postal] : []),
].join('\n');

console.log(`${subject}\n${thisWeek.length} this week, ${comingUp.length} coming up (${weekStart} to ${weekEnd}).`);

// ── Deliver ─────────────────────────────────────────────────────────────────
if (mode === 'preview') {
  writeFileSync(previewFile, html);
  console.log(`Preview written to ${previewFile}`);
  process.exit(0);
}

function env(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name}`); process.exit(1); }
  return v;
}
async function resend(path, body) {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env('RESEND_API_KEY')}`, 'content-type': 'application/json', 'user-agent': 'techkc.org' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) { console.error(`Resend ${path} failed: ${res.status} ${JSON.stringify(data)}`); process.exit(1); }
  return data;
}
const from = process.env.RESEND_FROM_EMAIL || 'TechKC <noreply@techkc.org>';

if (mode === 'test') {
  if (!testTo || testTo.startsWith('--')) { console.error('Usage: --test you@example.com'); process.exit(1); }
  // A single test email has no per-recipient unsubscribe link, so point it at the sign-up page.
  const r = await resend('/emails', {
    from, to: [testTo], subject: `[TEST] ${subject}`,
    html: html.replaceAll(UNSUBSCRIBE, `${SITE}/subscribe`),
    text: text.replaceAll(UNSUBSCRIBE, `${SITE}/subscribe`),
  });
  console.log(`Test email sent to ${testTo} (id ${r.id}).`);
} else {
  const r = await resend('/broadcasts', {
    name: `Weekly digest ${weekStart}`,
    segment_id: env('RESEND_DIGEST_SEGMENT_ID'),
    from, subject, html, text,
    send: true,
  });
  console.log(`Broadcast ${r.id} sent to the digest segment.`);
}
