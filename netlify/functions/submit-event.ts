import {
  HttpError,
  buildNewEvent,
  errorResponse,
  jsonResponse,
  openEventsPr,
  ownerHash,
  ownerSecretConfigured,
  parseEventFields,
  readJson,
  sendEmail,
  slugify,
  verifyRequest,
} from '../lib/common';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const submitter = await verifyRequest(req);
    if (!submitter) throw new HttpError(401, 'Unauthorized');

    const fields = parseEventFields(await readJson(req));
    const id = slugify(fields.name, fields.date);

    // Without OWNER_HASH_SECRET the event still goes through for review, but
    // nobody can edit/delete it later; flag that loudly in the PR.
    const ownerKnown = ownerSecretConfigured();
    if (!ownerKnown) console.warn('OWNER_HASH_SECRET is not set; submitting without an owner.');
    const newEvent = buildNewEvent(id, fields, ownerKnown ? ownerHash(submitter.email) : undefined);

    const prBody =
      `Submitted via techkc.org by **${submitter.name}** (${submitter.email}).\n\n` +
      (ownerKnown ? '' : '> **Warning:** `OWNER_HASH_SECRET` is not set, so no owner was recorded and the submitter will not be able to edit or delete this event.\n\n') +
      `| Field | Value |\n|---|---|\n` +
      `| Date | ${newEvent.date}${newEvent.endDate !== newEvent.date ? ` – ${newEvent.endDate}` : ''} |\n` +
      `| Location | ${newEvent.location ?? '_(not provided)_'} |\n` +
      `| Type | ${newEvent.type} |\n` +
      (newEvent.group ? `| Group | ${newEvent.group} |\n` : '') +
      `| URL | ${newEvent.url} |\n\n` +
      `${newEvent.description ?? '_(no description)_'}\n\n` +
      `Review the diff and merge to publish, or close to reject.`;

    const { prUrl } = await openEventsPr({
      branchSlug: `event-submission-${id}`,
      commitMessage: `Add event: ${newEvent.name}`,
      prTitle: `New event: ${newEvent.name}`,
      mutate: events => {
        if (events.some(e => e.id === id)) {
          throw new HttpError(409, 'An event with this name and year already exists');
        }
        return { events: [...events, newEvent], prBody };
      },
    });

    await sendEmail(
      submitter.email,
      `We received your event submission: ${newEvent.name}`,
      `Hi ${submitter.name},\n\n` +
        `Thanks for submitting "${newEvent.name}" to TechKC! We've received it and it's pending review.\n\n` +
        `Once approved, it'll appear on the events calendar at https://techkc.org/events.\n\n` +
        `— TechKC`,
    );

    return jsonResponse(200, { ok: true, prUrl });
  } catch (err) {
    return errorResponse(err, 'Failed to open pull request. Please try again or contact the site admin.');
  }
};
