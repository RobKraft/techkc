import { createHmac } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTH0_DOMAIN = process.env.PUBLIC_AUTH0_DOMAIN!;
const AUTH0_AUDIENCE = process.env.PUBLIC_AUTH0_AUDIENCE!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'TechKC <onboarding@resend.dev>';
const ALLOWED_SUBMITTER_EMAILS = (process.env.ALLOWED_SUBMITTER_EMAILS ?? '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export const GITHUB_REPO = 'RobKraft/techkc';
const EVENTS_PATH = 'src/data/events.json';

const jwks = createRemoteJWKSet(new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`));

export interface Submitter {
  email: string;
  name: string;
}

/** A stored event. `owner` is an HMAC of the submitter's email, never the email itself. */
export interface StoredEvent {
  id: string;
  name: string;
  group?: string;
  description?: string;
  url: string;
  date: string;
  endDate?: string;
  location?: string;
  type: string;
  cost?: string;
  dateTBD?: boolean;
  tags: string[];
  owner?: string;
}

export interface EventFields {
  name: string;
  group?: string;
  description?: string;
  url: string;
  date: string;
  endDate: string;
  location?: string;
  type: string;
  tags: string[];
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function errorResponse(err: unknown, fallback: string): Response {
  if (err instanceof HttpError) return jsonResponse(err.status, { error: err.message });
  console.error(err);
  return jsonResponse(500, { error: fallback });
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

/**
 * Verifies the bearer JWT against Auth0's public keys (this is the actual
 * access control), then calls Auth0's /userinfo endpoint to get a verified
 * name/email. /userinfo works with any token that had the `openid` scope at
 * authorization time, regardless of the token's audience, so this avoids
 * needing a custom Auth0 Action just to stamp profile claims onto the token.
 */
export async function verifyRequest(req: Request): Promise<Submitter | null> {
  const auth = req.headers.get('authorization') ?? '';
  const match = auth.match(/^Bearer (.+)$/i);
  if (!match) return null;
  const token = match[1];

  try {
    await jwtVerify(token, jwks, {
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUTH0_AUDIENCE,
    });
  } catch {
    return null;
  }

  const userinfoRes = await fetch(`https://${AUTH0_DOMAIN}/userinfo`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!userinfoRes.ok) return null;
  const userinfo = await userinfoRes.json();
  if (!userinfo.email) return null;

  if (
    ALLOWED_SUBMITTER_EMAILS.length &&
    !ALLOWED_SUBMITTER_EMAILS.includes(String(userinfo.email).toLowerCase())
  ) {
    return null;
  }

  return { email: userinfo.email, name: userinfo.name ?? userinfo.email };
}

export function ownerSecretConfigured(): boolean {
  return Boolean(process.env.OWNER_HASH_SECRET);
}

/**
 * Stable, non-reversible owner id stored in the public events.json. Must stay
 * in sync with scripts/owner-hash.mjs, which backfills owners for older events.
 */
export function ownerHash(email: string): string {
  const secret = process.env.OWNER_HASH_SECRET;
  if (!secret) throw new HttpError(503, 'Event editing is not configured yet.');
  return createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

// ── Field validation ────────────────────────────────────────────────────────

function optionalString(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new HttpError(400, `${label} is too long (max ${max} characters).`);
  return trimmed;
}

function requiredString(value: unknown, label: string, max: number): string {
  const result = optionalString(value, label, max);
  if (!result) throw new HttpError(400, `${label} is required.`);
  return result;
}

function validDate(value: string, label: string): string {
  const ok =
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!ok) throw new HttpError(400, `${label} must be a valid date.`);
  return value;
}

/** Required: name, url, type, date. Everything else is optional; empty means "not provided". */
export function parseEventFields(body: unknown): EventFields {
  if (typeof body !== 'object' || body === null) throw new HttpError(400, 'Invalid request body.');
  const b = body as Record<string, unknown>;

  const url = requiredString(b.url, 'Event website', 500);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new HttpError(400, 'Event website must be a valid URL.');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new HttpError(400, 'Event website must start with http:// or https://.');
  }

  const date = validDate(requiredString(b.date, 'Start date', 10), 'Start date');
  const endRaw = optionalString(b.endDate, 'End date', 10);
  const endDate = endRaw ? validDate(endRaw, 'End date') : date;
  if (endDate < date) throw new HttpError(400, 'End date cannot be before the start date.');

  const tags = Array.isArray(b.tags)
    ? b.tags
        .filter((t): t is string => typeof t === 'string')
        .map(t => t.trim())
        .filter(Boolean)
    : [];
  if (tags.length > 10 || tags.some(t => t.length > 40)) {
    throw new HttpError(400, 'Use at most 10 tags of 40 characters each.');
  }

  return {
    name: requiredString(b.name, 'Event name', 200),
    group: optionalString(b.group, 'Organizing group', 200),
    description: optionalString(b.description, 'Description', 2000),
    url,
    date,
    endDate,
    location: optionalString(b.location, 'Location', 200),
    type: requiredString(b.type, 'Event type', 40),
    tags,
  };
}

export function slugify(name: string, date: string): string {
  const year = date.slice(0, 4);
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-${year}`;
}

/** Key order matches the hand-edited entries already in events.json. */
export function buildNewEvent(id: string, f: EventFields, owner?: string): StoredEvent {
  return {
    id,
    name: f.name,
    ...(f.group ? { group: f.group } : {}),
    ...(f.description ? { description: f.description } : {}),
    url: f.url,
    date: f.date,
    endDate: f.endDate,
    ...(f.location ? { location: f.location } : {}),
    type: f.type,
    tags: f.tags,
    ...(owner ? { owner } : {}),
  };
}

const EDITABLE_OPTIONAL = ['group', 'description', 'location'] as const;

/** Applies a full set of editable fields; omitted optional fields are removed. Other keys (cost, owner, ...) are kept. */
export function applyEdit(existing: StoredEvent, f: EventFields): StoredEvent {
  const next: StoredEvent = {
    ...existing,
    name: f.name,
    url: f.url,
    date: f.date,
    endDate: f.endDate,
    type: f.type,
    tags: f.tags,
  };
  for (const key of EDITABLE_OPTIONAL) {
    if (f[key]) next[key] = f[key];
    else delete next[key];
  }
  return next;
}

export function describeChanges(before: StoredEvent, after: StoredEvent): string[] {
  const keys = ['name', 'group', 'description', 'url', 'date', 'endDate', 'location', 'type', 'tags'] as const;
  const show = (v: unknown) =>
    v === undefined ? '_(none)_' : Array.isArray(v) ? v.join(', ') || '_(none)_' : String(v);
  const rows: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      rows.push(`| ${key} | ${show(before[key])} | ${show(after[key])} |`);
    }
  }
  return rows;
}

// ── GitHub ──────────────────────────────────────────────────────────────────

async function gh(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

async function readEventsFile(ref: string): Promise<{ events: StoredEvent[]; sha: string }> {
  const file = await gh(`/repos/${GITHUB_REPO}/contents/${EVENTS_PATH}?ref=${ref}`);
  const events = JSON.parse(Buffer.from(file.content, 'base64').toString('utf-8')) as StoredEvent[];
  return { events, sha: file.sha };
}

/** Current events on main, straight from GitHub (fresher than the deployed build). */
export async function loadPublishedEvents(): Promise<StoredEvent[]> {
  return (await readEventsFile('main')).events;
}

/**
 * Matches the formatting of the hand-maintained file (tags on one line) so a
 * PR diff only shows the entries that actually changed.
 */
export function serializeEvents(events: StoredEvent[]): string {
  const value = (v: unknown) =>
    Array.isArray(v) ? `[${v.map(x => JSON.stringify(x)).join(', ')}]` : JSON.stringify(v);
  const body = events
    .map(ev => {
      const lines = Object.entries(ev)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `    ${JSON.stringify(k)}: ${value(v)}`);
      return `  {\n${lines.join(',\n')}\n  }`;
    })
    .join(',\n');
  return `[\n${body}\n]\n`;
}

/**
 * Reads events.json at main's current commit, lets `mutate` produce the new
 * list and PR body (it may throw HttpError to abort before anything is
 * written), then commits the result to a fresh branch and opens a PR for review.
 */
export async function openEventsPr(opts: {
  branchSlug: string;
  commitMessage: string;
  prTitle: string;
  mutate: (events: StoredEvent[]) => { events: StoredEvent[]; prBody: string };
}): Promise<{ prUrl: string }> {
  const ref = await gh(`/repos/${GITHUB_REPO}/git/ref/heads/main`);
  const baseSha: string = ref.object.sha;

  const { events, sha } = await readEventsFile(baseSha);
  const { events: updated, prBody } = opts.mutate(events);

  const branch = `${opts.branchSlug}-${Date.now()}`;
  await gh(`/repos/${GITHUB_REPO}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
  });

  await gh(`/repos/${GITHUB_REPO}/contents/${EVENTS_PATH}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: opts.commitMessage,
      content: Buffer.from(serializeEvents(updated), 'utf-8').toString('base64'),
      sha,
      branch,
    }),
  });

  const pr = await gh(`/repos/${GITHUB_REPO}/pulls`, {
    method: 'POST',
    body: JSON.stringify({ title: opts.prTitle, head: branch, base: 'main', body: prBody }),
  });

  return { prUrl: pr.html_url };
}

// ── Email ───────────────────────────────────────────────────────────────────

/**
 * Best-effort — failure here must never fail the request itself, since the PR
 * (the thing that actually matters) has already been created by the time this runs.
 */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  if (!RESEND_API_KEY) return;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to, subject, text }),
    });
    if (!res.ok) {
      console.error('Resend API error:', res.status, await res.text());
    }
  } catch (err) {
    console.error('Failed to send email:', err);
  }
}
