import {
  HttpError,
  applyEdit,
  describeChanges,
  errorResponse,
  jsonResponse,
  openEventsPr,
  ownerHash,
  parseEventFields,
  readJson,
  sendEmail,
  verifyRequest,
} from '../lib/common';

export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const submitter = await verifyRequest(req);
    if (!submitter) throw new HttpError(401, 'Unauthorized');
    const owner = ownerHash(submitter.email);

    const body = await readJson(req);
    const id = (body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'Missing event id.');
    const fields = parseEventFields(body);

    const { prUrl } = await openEventsPr({
      branchSlug: `event-edit-${id}`,
      commitMessage: `Edit event: ${fields.name}`,
      prTitle: `Edit event: ${fields.name}`,
      mutate: events => {
        const index = events.findIndex(e => e.id === id);
        if (index === -1) {
          throw new HttpError(404, 'That event is not published yet. If you just submitted it, wait until it has been approved.');
        }
        const before = events[index];
        if (before.owner !== owner) {
          throw new HttpError(403, 'You can only edit events you submitted.');
        }
        const after = applyEdit(before, fields);
        const changes = describeChanges(before, after);
        if (changes.length === 0) throw new HttpError(400, 'No changes to submit.');

        const prBody =
          `Edit requested via techkc.org by **${submitter.name}** (${submitter.email}), the original submitter.\n\n` +
          `Event: \`${id}\`\n\n` +
          `| Field | Before | After |\n|---|---|---|\n${changes.join('\n')}\n\n` +
          `Review the diff and merge to publish the change, or close to reject.`;

        return { events: events.map((e, i) => (i === index ? after : e)), prBody };
      },
    });

    await sendEmail(
      submitter.email,
      `We received your event change: ${fields.name}`,
      `Hi ${submitter.name},\n\n` +
        `We received your change to "${fields.name}" and it's pending review.\n\n` +
        `Once approved, the update will appear at https://techkc.org/events.\n\n` +
        `— TechKC`,
    );

    return jsonResponse(200, { ok: true, prUrl });
  } catch (err) {
    return errorResponse(err, 'Failed to submit your change. Please try again or contact the site admin.');
  }
};
