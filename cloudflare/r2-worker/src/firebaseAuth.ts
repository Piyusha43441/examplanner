export const DEFAULT_ADMIN_EMAIL = 'agarwalpiyush263@gmail.com';
const FIREBASE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export class WorkerApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = 'WorkerApiError';
    this.status = status;
    this.code = code;
  }
}

export interface VerifiedFirebaseToken {
  uid: string;
  email?: string;
  email_verified?: boolean;
  admin?: boolean;
  aud: string;
  iss: string;
  sub: string;
  exp: number;
  iat: number;
  auth_time: number;
  firebase?: {
    sign_in_provider?: string;
  };
  [key: string]: unknown;
}

interface JwkCacheEntry {
  keys: Map<string, JsonWebKey>;
  expiresAtMs: number;
}

let cachedJwks: JwkCacheEntry | null = null;

function base64UrlToUint8Array(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64UrlJson<T>(segment: string): T {
  const bytes = base64UrlToUint8Array(segment);
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text) as T;
}

async function fetchFirebaseJwks(forceRefresh = false): Promise<Map<string, JsonWebKey>> {
  const now = Date.now();
  if (!forceRefresh && cachedJwks && now < cachedJwks.expiresAtMs) {
    return cachedJwks.keys;
  }

  const res = await fetch(FIREBASE_JWK_URL, { method: 'GET' });
  if (!res.ok) {
    throw new WorkerApiError(
      503,
      `Failed fetching Google Firebase public JWKs (HTTP ${res.status}).`,
      'FIREBASE_JWK_FETCH_FAILED'
    );
  }

  const body = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const map = new Map<string, JsonWebKey>();
  for (const key of body.keys || []) {
    if (key.kid) {
      map.set(key.kid, key);
    }
  }

  if (map.size === 0) {
    throw new WorkerApiError(503, 'No Firebase public signing keys returned by Google.', 'FIREBASE_JWK_EMPTY');
  }

  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlSeconds = maxAgeMatch ? Math.max(60, Math.min(21600, Number(maxAgeMatch[1]))) : 3600;
  cachedJwks = {
    keys: map,
    expiresAtMs: now + ttlSeconds * 1000
  };
  return map;
}

export async function verifyBearerFirebaseToken(params: {
  authHeader: string | null;
  firebaseProjectId: string;
}): Promise<{ idToken: string; decoded: VerifiedFirebaseToken }> {
  const { authHeader, firebaseProjectId } = params;
  if (!firebaseProjectId || !firebaseProjectId.trim()) {
    throw new WorkerApiError(503, 'FIREBASE_PROJECT_ID is not configured on Worker.', 'FIREBASE_PROJECT_NOT_CONFIGURED');
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new WorkerApiError(401, 'Missing or invalid Authorization Bearer token.', 'AUTH_REQUIRED');
  }

  const idToken = authHeader.slice(7).trim();
  const parts = idToken.split('.');
  if (!idToken || parts.length !== 3) {
    throw new WorkerApiError(401, 'Malformed Firebase ID token.', 'INVALID_AUTH_TOKEN');
  }

  let header: { alg?: string; kid?: string };
  let payload: VerifiedFirebaseToken;
  try {
    header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(parts[0]);
    payload = decodeBase64UrlJson<VerifiedFirebaseToken>(parts[1]);
  } catch {
    throw new WorkerApiError(401, 'Unable to decode Firebase ID token.', 'INVALID_AUTH_TOKEN');
  }

  if (header.alg !== 'RS256' || !header.kid) {
    throw new WorkerApiError(401, 'Unsupported Firebase token algorithm or missing key ID.', 'INVALID_AUTH_TOKEN');
  }

  let jwks = await fetchFirebaseJwks(false);
  let jwk = jwks.get(header.kid);
  if (!jwk) {
    jwks = await fetchFirebaseJwks(true);
    jwk = jwks.get(header.kid);
  }
  if (!jwk) {
    throw new WorkerApiError(401, 'Firebase token signing key is unknown or rotated.', 'INVALID_AUTH_TOKEN');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const encodedSigned = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signedBytes = new Uint8Array(new ArrayBuffer(encodedSigned.length));
  signedBytes.set(encodedSigned);
  const signatureBytes = base64UrlToUint8Array(parts[2]);
  const signatureValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signatureBytes,
    signedBytes
  );

  if (!signatureValid) {
    throw new WorkerApiError(401, 'Firebase ID token signature verification failed.', 'INVALID_AUTH_TOKEN');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const projectId = firebaseProjectId.trim();
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;

  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new WorkerApiError(401, 'Firebase ID token has expired. Please retry.', 'TOKEN_EXPIRED');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new WorkerApiError(401, 'Firebase ID token issued-at claim is invalid.', 'INVALID_AUTH_TOKEN');
  }
  if (typeof payload.auth_time !== 'number' || payload.auth_time > nowSec + 300) {
    throw new WorkerApiError(401, 'Firebase ID token auth_time claim is invalid.', 'INVALID_AUTH_TOKEN');
  }
  if (payload.aud !== projectId || payload.iss !== expectedIssuer) {
    throw new WorkerApiError(401, 'Firebase ID token does not belong to this project.', 'INVALID_AUTH_TOKEN');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new WorkerApiError(401, 'Invalid Firebase token subject.', 'INVALID_AUTH_TOKEN');
  }
  if (payload.firebase?.sign_in_provider === 'anonymous') {
    throw new WorkerApiError(403, 'Anonymous sessions are not allowed to upload payment proofs.', 'ANONYMOUS_FORBIDDEN');
  }

  return {
    idToken,
    decoded: {
      ...payload,
      uid: payload.sub
    }
  };
}

export function assertStrictAdminToken(
  decoded: VerifiedFirebaseToken,
  expectedAdminEmail = DEFAULT_ADMIN_EMAIL
): void {
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (email !== expectedAdminEmail.trim().toLowerCase()) {
    throw new WorkerApiError(
      403,
      'Administrator access is strictly restricted to the authorized admin account.',
      'ADMIN_EMAIL_REQUIRED'
    );
  }
  if (decoded.email_verified !== true) {
    throw new WorkerApiError(
      403,
      'Administrator email address must be verified before viewing payment proofs.',
      'ADMIN_EMAIL_UNVERIFIED'
    );
  }
  if (decoded.admin !== true) {
    throw new WorkerApiError(
      403,
      'Verified Firebase custom claim admin === true is required on this administrator account.',
      'ADMIN_CLAIM_REQUIRED'
    );
  }
}

function decodeFirestoreValue(value: any): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return String(value.stringValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return String(value.timestampValue);
  if ('arrayValue' in value) {
    return Array.isArray(value.arrayValue?.values)
      ? value.arrayValue.values.map(decodeFirestoreValue)
      : [];
  }
  if ('mapValue' in value) {
    const out: Record<string, unknown> = {};
    const fields = value.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  }
  return undefined;
}

export async function fetchFirestoreDocument(params: {
  idToken: string;
  projectId: string;
  databaseId: string;
  collectionPath: string;
  docId: string;
}): Promise<Record<string, unknown> | null> {
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(params.projectId)}` +
    `/databases/${encodeURIComponent(params.databaseId || '(default)')}/documents/` +
    `${params.collectionPath}/${encodeURIComponent(params.docId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.idToken}`
    }
  });

  if (res.status === 404) {
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    throw new WorkerApiError(
      403,
      `Firestore access denied reading ${params.collectionPath}/${params.docId}.`,
      'FIRESTORE_PERMISSION_DENIED'
    );
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new WorkerApiError(
      502,
      `Firestore REST verification failed (${res.status}): ${errText.slice(0, 200)}`,
      'FIRESTORE_REST_ERROR'
    );
  }

  const json = (await res.json()) as { fields?: Record<string, unknown> };
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(json?.fields || {})) {
    decoded[k] = decodeFirestoreValue(v);
  }
  return decoded;
}

export async function verifyInstitutionMembershipViaFirestore(params: {
  idToken: string;
  projectId: string;
  databaseId: string;
  uid: string;
  institutionId: string;
}): Promise<void> {
  try {
    const inst = await fetchFirestoreDocument({
      idToken: params.idToken,
      projectId: params.projectId,
      databaseId: params.databaseId,
      collectionPath: 'institutions',
      docId: params.institutionId
    });
    if (inst && inst.ownerId === params.uid) {
      return;
    }
  } catch (err) {
    if (err instanceof WorkerApiError && err.code !== 'FIRESTORE_PERMISSION_DENIED') {
      throw err;
    }
  }

  const membership = await fetchFirestoreDocument({
    idToken: params.idToken,
    projectId: params.projectId,
    databaseId: params.databaseId,
    collectionPath: 'institution_members',
    docId: `${params.institutionId}_${params.uid}`
  }).catch((err) => {
    if (err instanceof WorkerApiError && err.code === 'FIRESTORE_PERMISSION_DENIED') {
      return null;
    }
    throw err;
  });

  if (
    membership &&
    membership.user_id === params.uid &&
    membership.institution_id === params.institutionId
  ) {
    return;
  }

  throw new WorkerApiError(
    403,
    `Account ${params.uid} is not authorized as an owner or member of institution ${params.institutionId}.`,
    'INSTITUTION_MEMBERSHIP_REQUIRED'
  );
}
