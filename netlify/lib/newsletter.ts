// Weekly digest sign-up: double opt-in on top of Resend Contacts + Segments.
//
// Nothing is stored until the subscriber clicks the confirmation link. The link
// carries the email, an expiry, and an HMAC signature (NEWSLETTER_SECRET), so no
// pending-subscriber table is needed. On confirmation the address becomes a
// Resend contact in the digest segment (RESEND_DIGEST_SEGMENT_ID), which the
// Sunday job (scripts/send-digest.mjs) sends to as a Resend broadcast. Resend
// handles unsubscribes through the {{{RESEND_UNSUBSCRIBE_URL}}} link in the digest.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './common';

const RESEND_API = 'https://api.resend.com';
const USER_AGENT = 'techkc.org';
const CONFIRM_TTL_DAYS = 7;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new HttpError(503, 'Email sign-up is not configured yet.');
  return v;
}

export function normalizeEmail(raw: unknown): string {
  const email = String(raw ?? '').trim().toLowerCase();
  // Deliberately simple: reject the obviously wrong, let the confirmation email do the rest.
  if (email.length > 254 || !/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(email)) {
    throw new HttpError(400, 'Please enter a valid email address.');
  }
  return email;
}

// ── Signed confirmation links ───────────────────────────────────────────────

function sign(email: string, exp: number): string {
  return createHmac('sha256', requireEnv('NEWSLETTER_SECRET')).update(`subscribe|${email}|${exp}`).digest('base64url');
}

// The link opens /subscribe, which shows a "Confirm" button that POSTs to
// confirm-subscription. Confirming on a plain GET would let email security
// scanners, which open links automatically, subscribe people.
export function confirmationUrl(siteUrl: string, email: string): string {
  const exp = Math.floor(Date.now() / 1000) + CONFIRM_TTL_DAYS * 86400;
  const url = new URL('/subscribe', siteUrl);
  url.searchParams.set('email', email);
  url.searchParams.set('exp', String(exp));
  url.searchParams.set('sig', sign(email, exp));
  return url.href;
}

/** Returns the email if the link's values are genuine and unexpired, otherwise null. */
export function verifyConfirmation(v: { email?: unknown; exp?: unknown; sig?: unknown }): string | null {
  const email = String(v.email ?? '').trim().toLowerCase();
  const exp = Number(v.exp);
  const sig = String(v.sig ?? '');
  if (!email || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  const expected = Buffer.from(sign(email, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given) ? email : null;
}

// ── Resend API ──────────────────────────────────────────────────────────────

async function resend(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(`${RESEND_API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${requireEnv('RESEND_API_KEY')}`,
      'content-type': 'application/json',
      'user-agent': USER_AGENT, // Resend rejects requests without one
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function fail(what: string, r: { status: number; data: any }): never {
  console.error(`Resend ${what} failed:`, r.status, JSON.stringify(r.data));
  throw new HttpError(502, 'Something went wrong on our end. Please try again later.');
}

export async function sendConfirmationEmail(email: string, link: string): Promise<void> {
  const from = process.env.RESEND_FROM_EMAIL || 'TechKC <noreply@techkc.org>';
  const text =
    `Thanks for signing up for the TechKC weekly events email!\n\n` +
    `Please confirm your subscription by opening this link:\n${link}\n\n` +
    `The link works for ${CONFIRM_TTL_DAYS} days. If you didn't sign up, ignore this email and you won't hear from us.\n\n` +
    `— TechKC (https://techkc.org)`;
  const html =
    `<p>Thanks for signing up for the <strong>TechKC weekly events email</strong>!</p>` +
    `<p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600">Confirm my subscription</a></p>` +
    `<p style="color:#64748b;font-size:13px">The link works for ${CONFIRM_TTL_DAYS} days. If you didn't sign up, ignore this email and you won't hear from us.</p>` +
    `<p style="color:#64748b;font-size:13px">— <a href="https://techkc.org">TechKC</a></p>`;
  const r = await resend('/emails', {
    method: 'POST',
    body: { from, to: [email], subject: 'Confirm your TechKC weekly events email', text, html },
  });
  if (r.status >= 300) fail('send confirmation', r);
}

/**
 * Makes the address an active contact in the digest segment. Safe to repeat:
 * a returning subscriber who had unsubscribed is re-subscribed.
 */
export async function addConfirmedSubscriber(email: string): Promise<void> {
  const segmentId = requireEnv('RESEND_DIGEST_SEGMENT_ID');
  const key = encodeURIComponent(email);

  const existing = await resend(`/contacts/${key}`);
  if (existing.status === 404) {
    const created = await resend('/contacts', {
      method: 'POST',
      body: { email, unsubscribed: false, segments: [{ id: segmentId }] },
    });
    if (created.status >= 300) fail('create contact', created);
    return;
  }
  if (existing.status >= 300) fail('look up contact', existing);

  const updated = await resend(`/contacts/${key}`, { method: 'PATCH', body: { unsubscribed: false } });
  if (updated.status >= 300) fail('update contact', updated);
  const joined = await resend(`/contacts/${key}/segments/${segmentId}`, { method: 'POST' });
  // Already being in the segment isn't an error worth failing the confirmation over.
  if (joined.status >= 300 && joined.status !== 409 && joined.status !== 422) fail('add contact to segment', joined);
}
