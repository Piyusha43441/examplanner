import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const ADMIN_EMAIL = 'agarwalpiyush263@gmail.com';
const PROJECT_ID = 'abstract-freehold-6cf5x';

async function main() {
  initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID
  });

  const auth = getAuth();
  const user = await auth.getUserByEmail(ADMIN_EMAIL);

  if (!user.emailVerified) {
    throw new Error(
      `Account ${ADMIN_EMAIL} exists (uid=${user.uid}) but emailVerified is false. Verify the email before granting admin claims.`
    );
  }

  await auth.setCustomUserClaims(user.uid, {
    ...(user.customClaims || {}),
    admin: true
  });

  const updated = await auth.getUser(user.uid);
  console.log('Successfully assigned custom claims:', {
    uid: updated.uid,
    email: updated.email,
    customClaims: updated.customClaims
  });
}

main().catch((err) => {
  console.error('Failed setting admin custom claim:', err);
  process.exit(1);
});
