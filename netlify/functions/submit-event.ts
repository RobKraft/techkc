import { createRemoteJWKSet, jwtVerify } from 'jose';

const AUTH0_DOMAIN = process.env.PUBLIC_AUTH0_DOMAIN!;
const AUTH0_AUDIENCE = process.env.PUBLIC_AUTH0_AUDIENCE!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const GITHUB_REPO = 'RobKraft/techkc';
const ALLOWED_SUBMITTER_EMAILS = (process.env.ALLOWED_SUBMITTER_EMAILS ?? '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

const jwks = createRemoteJWKSet(new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`));

interface EventSubmission {
  name: string;
  group?: string;
  description: string;
  url: string;
  date: string;
  endDate?: string;
  location: string;
  type: string;
  cost: string;
  tags?: string[];
}

interface Submitter {
  email: string;
  name: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function slugify(name: string, date: string): string {
  const year = date.slice(0, 4);
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base}-${year}`;
}

/**
 * Verifies the bearer JWT against Auth0's public keys (this is the actual
 * access control), then calls Auth0's /userinfo endpoint to get a verified
 * name/email. /userinfo works with any token that had the `openid` scope at
 * authorization time, regardless of the token's audience, so this avoids
 * needing a custom Auth0 Action just to stamp profile claims onto the token.
 */
async function verifyRequest(req: Request): Promise<Submitter | null> {
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

function validateSubmission(body: unknown): body is EventSubmission {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.name === 'string' && b.name.trim() !== '' &&
    typeof b.description === 'string' && b.description.trim() !== '' &&
    typeof b.url === 'string' && b.url.trim() !== '' &&
    typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) &&
    typeof b.location === 'string' && b.location.trim() !== '' &&
    typeof b.type === 'string' && b.type.trim() !== '' &&
    typeof b.cost === 'string' && b.cost.trim() !== ''
  );
}

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

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  const submitter = await verifyRequest(req);
  if (!submitter) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  if (!validateSubmission(body)) {
    return jsonResponse(400, { error: 'Missing or invalid required fields' });
  }

  const id = slugify(body.name, body.date);
  const newEvent = {
    id,
    name: body.name.trim(),
    ...(body.group?.trim() ? { group: body.group.trim() } : {}),
    description: body.description.trim(),
    url: body.url.trim(),
    date: body.date,
    endDate: body.endDate?.trim() || body.date,
    location: body.location.trim(),
    type: body.type.trim(),
    cost: body.cost.trim(),
    tags: Array.isArray(body.tags) ? body.tags.filter((t: unknown) => typeof t === 'string') : [],
  };

  try {
    const ref = await gh(`/repos/${GITHUB_REPO}/git/ref/heads/main`);
    const baseSha = ref.object.sha;

    const branch = `event-submission-${id}-${Date.now()}`;
    await gh(`/repos/${GITHUB_REPO}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });

    const file = await gh(`/repos/${GITHUB_REPO}/contents/src/data/events.json?ref=${branch}`);
    const currentContent = Buffer.from(file.content, 'base64').toString('utf-8');
    const events = JSON.parse(currentContent);

    if (events.some((e: { id: string }) => e.id === id)) {
      return jsonResponse(409, { error: 'An event with this name and year already exists' });
    }

    events.push(newEvent);
    const updatedContent = JSON.stringify(events, null, 2) + '\n';

    await gh(`/repos/${GITHUB_REPO}/contents/src/data/events.json`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `Add event: ${newEvent.name}`,
        content: Buffer.from(updatedContent, 'utf-8').toString('base64'),
        sha: file.sha,
        branch,
      }),
    });

    const prBody =
      `Submitted via techkc.org by **${submitter.name}** (${submitter.email}).\n\n` +
      `| Field | Value |\n|---|---|\n` +
      `| Date | ${newEvent.date}${newEvent.endDate !== newEvent.date ? ` – ${newEvent.endDate}` : ''} |\n` +
      `| Location | ${newEvent.location} |\n` +
      `| Type | ${newEvent.type} |\n` +
      `| Cost | ${newEvent.cost} |\n` +
      (newEvent.group ? `| Group | ${newEvent.group} |\n` : '') +
      `| URL | ${newEvent.url} |\n\n` +
      `${newEvent.description}\n\n` +
      `Review the diff and merge to publish, or close to reject.`;

    const pr = await gh(`/repos/${GITHUB_REPO}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: `New event: ${newEvent.name}`,
        head: branch,
        base: 'main',
        body: prBody,
      }),
    });

    return jsonResponse(200, { ok: true, prUrl: pr.html_url });
  } catch (err) {
    console.error(err);
    return jsonResponse(500, {
      error: 'Failed to open pull request. Please try again or contact the site admin.',
    });
  }
};
