import { HttpError } from './http';
import {
  ADMIN_EMAIL_DEFAULT,
  AuthUser,
  Env,
  InstitutionRow,
  isValidId,
  VerifiedInstitutionInfo,
  WorkerDeps
} from './types';

interface FirebaseJwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

interface FirebaseJwtPayload {
  aud?: string;
  iss?: string;
  sub?: string;
  user_id?: string;
  email?: string;
  email_verified?: boolean;
  admin?: unknown;
  iat?: number;
  auth_time?: number;
  exp?: number;
}

const GOOGLE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedJwks: { keys: Record<string, JsonWebKey>; expiresAtMs: number } | null = null;

function base64UrlToUint8Array(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const bytes = base64UrlToUint8Array(segment);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

async function getGoogleJwks(nowMs: number, forceRefresh = false): Promise<Record<string, JsonWebKey>> {
  if (!forceRefresh && cachedJwks && cachedJwks.expiresAtMs > nowMs) {
    return cachedJwks.keys;
  }
  const res = await fetch(GOOGLE_JWK_URL);
  if (!res.ok) {
    throw new HttpError(503, 'Unable to fetch Firebase verification keys.', 'AUTH_KEY_FETCH_FAILED');
  }
  const cacheControl = res.headers.get('Cache-Control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.min(3600, Math.max(60, Number(maxAgeMatch[1]))) : 300;

  const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const keysMap: Record<string, JsonWebKey> = {};
  for (const key of body.keys || []) {
    if (key.kid) {
      keysMap[key.kid] = key;
    }
  }
  cachedJwks = {
    keys: keysMap,
    expiresAtMs: nowMs + maxAgeSec * 1000
  };
  return keysMap;
}

export async function verifyFirebaseIdToken(
  token: string,
  env: Env,
  nowMs: number
): Promise<AuthUser> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new HttpError(401, 'Invalid authentication token format.', 'UNAUTHORIZED');
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: FirebaseJwtHeader;
  let payload: FirebaseJwtPayload;
  try {
    header = decodeBase64UrlJson<FirebaseJwtHeader>(headerB64);
    payload = decodeBase64UrlJson<FirebaseJwtPayload>(payloadB64);
  } catch {
    throw new HttpError(401, 'Malformed authentication token.', 'UNAUTHORIZED');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new HttpError(401, 'Unsupported authentication token algorithm.', 'UNAUTHORIZED');
  }

  const projectId = (env.FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) {
    throw new HttpError(500, 'FIREBASE_PROJECT_ID is not configured on Worker.', 'SERVER_MISCONFIGURED');
  }

  const nowSec = Math.floor(nowMs / 1000);
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  if (payload.aud !== projectId || payload.iss !== expectedIssuer) {
    throw new HttpError(401, 'Authentication token audience or issuer mismatch.', 'UNAUTHORIZED');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new HttpError(401, 'Authentication token missing subject.', 'UNAUTHORIZED');
  }
  if (payload.user_id && payload.user_id !== payload.sub) {
    throw new HttpError(401, 'Authentication token subject mismatch.', 'UNAUTHORIZED');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new HttpError(401, 'Authentication session expired. Please sign in again.', 'TOKEN_EXPIRED');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new HttpError(401, 'Authentication token issued-at timestamp invalid.', 'UNAUTHORIZED');
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowSec + 300) {
    throw new HttpError(401, 'Authentication token auth_time invalid.', 'UNAUTHORIZED');
  }

  let keys = await getGoogleJwks(nowMs, false);
  let jwk = keys[header.kid];
  if (!jwk) {
    keys = await getGoogleJwks(nowMs, true);
    jwk = keys[header.kid];
  }
  if (!jwk) {
    throw new HttpError(401, 'Unknown Firebase signing key.', 'UNAUTHORIZED');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signedBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToUint8Array(sigB64);

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signatureBytes,
    signedBytes
  );
  if (!valid) {
    throw new HttpError(401, 'Invalid Firebase token signature.', 'UNAUTHORIZED');
  }

  return {
    uid: payload.sub,
    email: typeof payload.email === 'string' ? payload.email.trim() : '',
    emailVerified: payload.email_verified === true,
    adminClaim: typeof payload.admin === 'boolean' ? payload.admin : undefined,
    rawToken: token
  };
}

export async function requireAuth(
  request: Request,
  env: Env,
  deps: WorkerDeps,
  nowMs: number
): Promise<AuthUser> {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].trim()) {
    throw new HttpError(401, 'Authentication required. Missing Bearer token.', 'UNAUTHORIZED');
  }
  const token = match[1].trim();
  if (deps.verifyFirebaseToken) {
    return deps.verifyFirebaseToken(token, env);
  }
  return verifyFirebaseIdToken(token, env, nowMs);
}

export function isAdminUser(auth: AuthUser, env: Env): boolean {
  const adminEmail = (env.ADMIN_EMAIL || ADMIN_EMAIL_DEFAULT).trim().toLowerCase();
  const emailMatches = auth.email.trim().toLowerCase() === adminEmail;
  const claimAllowed = auth.adminClaim === undefined || auth.adminClaim === true;
  return emailMatches && auth.emailVerified && claimAllowed;
}

export async function requireAdmin(
  request: Request,
  env: Env,
  deps: WorkerDeps,
  nowMs: number
): Promise<AuthUser> {
  const auth = await requireAuth(request, env, deps, nowMs);
  if (!isAdminUser(auth, env)) {
    throw new HttpError(
      403,
      'Administrator access required. This endpoint is restricted to the authorized administrator.',
      'FORBIDDEN_ADMIN_ONLY'
    );
  }
  return auth;
}

async function defaultVerifyFirestoreInstitution(
  institutionId: string,
  auth: AuthUser,
  env: Env
): Promise<VerifiedInstitutionInfo | null> {
  const projectId = (env.FIREBASE_PROJECT_ID || '').trim();
  const databaseId = (env.FIREBASE_DATABASE_ID || '(default)').trim();
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/${encodeURIComponent(databaseId)}/documents/institutions/${encodeURIComponent(
    institutionId
  )}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${auth.rawToken}`
    }
  });

  if (res.status === 404 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    throw new HttpError(
      502,
      'Unable to verify institution ownership with Firebase Firestore.',
      'INSTITUTION_VERIFY_FAILED'
    );
  }

  const docJson = (await res.json()) as {
    fields?: {
      ownerId?: { stringValue?: string };
      name?: { stringValue?: string };
    };
  };
  const ownerUid = docJson.fields?.ownerId?.stringValue || '';
  const name = docJson.fields?.name?.stringValue || 'Institution';
  if (!ownerUid || ownerUid !== auth.uid) {
    return null;
  }

  return {
    id: institutionId,
    ownerUid,
    name,
    userEmail: auth.email
  };
}

export async function resolveOwnedInstitution(
  institutionId: string | null | undefined,
  auth: AuthUser,
  env: Env,
  deps: WorkerDeps,
  nowMs: number,
  optionalInstitutionName?: string
): Promise<InstitutionRow> {
  if (institutionId !== undefined && institutionId !== null && !isValidId(institutionId)) {
    throw new HttpError(400, 'Invalid institution ID format.', 'INVALID_INSTITUTION_ID');
  }

  if (institutionId) {
    const existingById = await env.DB.prepare('SELECT * FROM institutions WHERE id = ?')
      .bind(institutionId)
      .first<InstitutionRow>();

    if (existingById) {
      if (existingById.owner_uid !== auth.uid) {
        throw new HttpError(
          403,
          'Access denied. You do not own this institution workspace.',
          'FORBIDDEN_INSTITUTION_MISMATCH'
        );
      }
      if (
        (optionalInstitutionName &&
          optionalInstitutionName.trim() &&
          optionalInstitutionName.trim() !== existingById.name) ||
        (auth.email && auth.email !== existingById.user_email)
      ) {
        const nextName = optionalInstitutionName?.trim().slice(0, 180) || existingById.name;
        const nextEmail = auth.email || existingById.user_email;
        await env.DB.prepare(
          'UPDATE institutions SET name = ?, user_email = ?, updated_at_ms = ? WHERE id = ?'
        )
          .bind(nextName, nextEmail, nowMs, existingById.id)
          .run();
        return {
          ...existingById,
          name: nextName,
          user_email: nextEmail,
          updated_at_ms: nowMs
        };
      }
      return existingById;
    }

    // Ensure a single user cannot bind arbitrary extra institution IDs if they already own one
    const ownedOther = await env.DB.prepare('SELECT id FROM institutions WHERE owner_uid = ? LIMIT 1')
      .bind(auth.uid)
      .first<{ id: string }>();
    if (ownedOther && ownedOther.id !== institutionId) {
      throw new HttpError(
        403,
        'Institution ownership mismatch. Authenticated user belongs to a different institution.',
        'FORBIDDEN_INSTITUTION_MISMATCH'
      );
    }

    const verifier = deps.verifyFirestoreInstitution || defaultVerifyFirestoreInstitution;
    const verified = await verifier(institutionId, auth, env);
    if (!verified || verified.ownerUid !== auth.uid) {
      throw new HttpError(
        403,
        'Institution ownership could not be verified for your account.',
        'FORBIDDEN_INSTITUTION_MISMATCH'
      );
    }

    const finalName = (optionalInstitutionName?.trim() || verified.name || 'Institution').slice(0, 180);
    const finalEmail = (auth.email || verified.userEmail || '').slice(0, 160);

    await env.DB.prepare(
      `INSERT OR IGNORE INTO institutions (id, owner_uid, name, user_email, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(institutionId, auth.uid, finalName, finalEmail, nowMs, nowMs)
      .run();

    const created = await env.DB.prepare('SELECT * FROM institutions WHERE id = ?')
      .bind(institutionId)
      .first<InstitutionRow>();
    if (!created || created.owner_uid !== auth.uid) {
      throw new HttpError(403, 'Institution ownership verification failed.', 'FORBIDDEN');
    }
    return created;
  }

  // Fallback lookup by owner_uid when query doesn't specify institutionId
  const byOwner = await env.DB.prepare('SELECT * FROM institutions WHERE owner_uid = ? LIMIT 1')
    .bind(auth.uid)
    .first<InstitutionRow>();
  if (!byOwner) {
    throw new HttpError(404, 'Institution workspace not registered yet.', 'INSTITUTION_NOT_FOUND');
  }
  return byOwner;
}
