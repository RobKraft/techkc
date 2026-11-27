import { HttpError, errorResponse, jsonResponse, readJson } from '../lib/common';
import { addConfirmedSubscriber, verifyConfirmation } from '../lib/newsletter';

// POST { email, exp, sig } from the "Confirm" button on /subscribe (the values
// come from the link in the confirmation email). POST-only so that email
// scanners opening the link can't subscribe anyone.
export default async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const email = verifyConfirmation((await readJson(req)) as Record<string, unknown>);
    if (!email) throw new HttpError(400, 'This confirmation link is invalid or has expired. Please sign up again.');
    await addConfirmedSubscriber(email);
    return jsonResponse(200, { ok: true });
  } catch (err) {
    return errorResponse(err, 'Something went wrong. Please try again later.');
  }
};
