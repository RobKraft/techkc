// Prints the "owner" value to paste into src/data/events.json so a submitter can
// edit/delete an event that was added before ownership tracking existed.
//   OWNER_HASH_SECRET=<same value as Netlify> node scripts/owner-hash.mjs person@example.com
import { createHmac } from 'node:crypto';

const email = process.argv[2];
const secret = process.env.OWNER_HASH_SECRET;

if (!email || !secret) {
  console.error('Usage: OWNER_HASH_SECRET=<secret> node scripts/owner-hash.mjs <submitter-email>');
  process.exit(1);
}

// Must match ownerHash() in netlify/lib/common.ts.
const hash = createHmac('sha256', secret).update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
console.log(`"owner": "${hash}"`);
