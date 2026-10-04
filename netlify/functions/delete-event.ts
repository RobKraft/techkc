import {
  HttpError,
  errorResponse,
  jsonResponse,
  openEventsPr,
  ownerHash,
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

    const id = ((await readJson(req)) as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !id) throw new HttpError(400, 'Missing event id.');

    let eventName = id;

    const { prUrl } = await openEventsPr({
      branchSlug: `event-removal-${id}`,
      commitMessage: `Remove event: ${id}`,
      prTitle: `Remove event: ${id}`,
      mutate: events => {
        const target = events.find(e => e.id === id);
        if (!target) {
          throw new HttpError(404, 'That event is not published yet. If you just submitted it, wait until it has been approved.');
        }
        if (target.owner !== owner) {
          throw new HttpError(403, 'You can only delete events you submitted.');
        }
        eventName = target.name;

        const prBody =
          `Removal requested via techkc.org by **${submitter.name}** (${submitter.email}), the original submitter.\n\n` +
          `Event: **${target.name}** (\`${id}\`), ${target.date}\n\n` +
          `Review the diff and merge to remove the event, or close to reject.`;

        return { events: events.filter(e => e.id !== id), prBody };
      },
    });

    await sendEmail(
      submitter.email,
      `We received your event removal request: ${eventName}`,
      `Hi ${submitter.name},\n\n` +
        `We received your request to remove "${eventName}" and it's pending review.\n\n` +
        `— TechKC`,
    );

    return jsonResponse(200, { ok: true, prUrl });
  } catch (err) {
    return errorResponse(err, 'Failed to submit your removal request. Please try again or contact the site admin.');
  }
};
