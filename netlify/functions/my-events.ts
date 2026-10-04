import {
  HttpError,
  type StoredEvent,
  errorResponse,
  jsonResponse,
  loadPublishedEvents,
  ownerHash,
  verifyRequest,
} from '../lib/common';

const SUMMARY_KEYS = ['id', 'name', 'group', 'description', 'url', 'date', 'endDate', 'location', 'type', 'tags'] as const;

function summarize(ev: StoredEvent) {
  const out: Record<string, unknown> = {};
  for (const key of SUMMARY_KEYS) if (ev[key] !== undefined) out[key] = ev[key];
  return out;
}

/** Most recent non-empty value per field, used to pre-fill the submit form. */
function deriveDefaults(owned: StoredEvent[]) {
  const recentFirst = [...owned].sort((a, b) => b.date.localeCompare(a.date));
  const pick = (key: 'group' | 'url' | 'type' | 'location') =>
    recentFirst.find(e => e[key])?.[key];
  return { group: pick('group'), url: pick('url'), type: pick('type'), location: pick('location') };
}

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const submitter = await verifyRequest(req);
    if (!submitter) throw new HttpError(401, 'Unauthorized');

    const owner = ownerHash(submitter.email);
    const owned = (await loadPublishedEvents())
      .filter(e => e.owner === owner)
      .sort((a, b) => a.date.localeCompare(b.date));

    return jsonResponse(200, { events: owned.map(summarize), defaults: deriveDefaults(owned) });
  } catch (err) {
    return errorResponse(err, 'Could not load your events.');
  }
};
