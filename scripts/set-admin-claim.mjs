import { readFileSync } from 'fs';
import admin from 'firebase-admin';

const [serviceAccountPath, targetEmailArg] = process.argv.slice(2);
const TARGET_EMAIL = (targetEmailArg || 'agarwalpiyush263@gmail.com').toLowerCase().trim();

if (!serviceAccountPath) {
  console.error(`
Usage:
  node scripts/set-admin-claim.mjs <path-to-serviceAccountKey.json> [email]

Example:
  node scripts/set-admin-claim.mjs ./serviceAccountKey.json agarwalpiyush263@gmail.com
`);
  process.exit(1);
}

try {
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  console.log(`Looking up user by email: ${TARGET_EMAIL}...`);
  const user = await admin.auth().getUserByEmail(TARGET_EMAIL);

  console.log(`Found user ${user.uid} (${user.email}). Setting custom claim { admin: true }...`);
  await admin.auth().setCustomUserClaims(user.uid, { admin: true });

  console.log('Verifying assigned custom claims...');
  const updatedUser = await admin.auth().getUser(user.uid);
  console.log('Custom claims assigned successfully:', updatedUser.customClaims);
  console.log('\nIMPORTANT: The user must sign out and sign back in for the new token claims to take effect in the browser session.');
  process.exit(0);
} catch (err) {
  console.error('Failed to set admin custom claim:', err);
  process.exit(1);
}
