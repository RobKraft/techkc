import { errorResponse, jsonResponse, readJson } from '../lib/common';
import { confirmationUrl, normalizeEmail, sendConfirmationEmail } from '../lib/newsletter';

// POST { email, website } from the /subscribe form. Sends a confirmation link;
// the address isn't added to the list until that link is opened.
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = (await readJson(req)) as Record<string, unknown>;
    // Honeypot: real people never see or fill the "website" field. Pretend it worked.
    if (body?.website) return jsonResponse(200, { ok: true });

    const email = normalizeEmail(body?.email);
    const siteUrl = process.env.URL || new URL(req.url).origin;
    await sendConfirmationEmail(email, confirmationUrl(siteUrl, email));
    return jsonResponse(200, { ok: true });
  } catch (err) {
    return errorResponse(err, 'Something went wrong. Please try again later.');
  }
};
