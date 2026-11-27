import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { type App, getApps, initializeApp } from 'firebase-admin/app';
import { type DecodedIdToken, getAuth } from 'firebase-admin/auth';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const ADMIN_EMAIL = 'agarwalpiyush263@gmail.com';
export const DEFAULT_R2_BUCKET_NAME = 'exam-planner-payment-proofs';
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const SIGNED_UPLOAD_TTL_SECONDS = 300;
export const SIGNED_PREVIEW_TTL_SECONDS = 120;

export const ALLOWED_PROOF_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf'
]);

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{3,128}$/;

export class PaymentStorageApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = 'PaymentStorageApiError';
    this.status = status;
    this.code = code;
  }
}

interface FirebaseRuntimeTarget {
  projectId: string;
  databaseId: string;
}

let cachedFirebaseTarget: FirebaseRuntimeTarget | null = null;

function readAppletConfigFile(): Record<string, any> {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(process.cwd(), 'firebase_applet_config.json')
  ];
  for (const filePath of candidates) {
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8')) || {};
      }
    } catch {
      // Ignore malformed optional config file
    }
  }
  return {};
}

export function getFirebaseRuntimeTarget(): FirebaseRuntimeTarget {
  if (cachedFirebaseTarget) return cachedFirebaseTarget;

  const envProjectId = (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    ''
  ).trim();
  const envDatabaseId = (
    process.env.FIREBASE_FIRESTORE_DATABASE_ID ||
    process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
    ''
  ).trim();

  const applet = readAppletConfigFile();
  const appletProjectId = typeof applet.projectId === 'string' ? applet.projectId.trim() : '';
  const appletDbId =
    typeof applet.firestoreDatabaseId === 'string' ? applet.firestoreDatabaseId.trim() : '';

  const projectId = envProjectId || appletProjectId;
  if (!projectId) {
    throw new PaymentStorageApiError(
      503,
      'Firebase project ID is not configured on the server.',
      'FIREBASE_PROJECT_NOT_CONFIGURED'
    );
  }

  let databaseId = '(default)';
  if (envDatabaseId) {
    databaseId = envDatabaseId;
  } else if (appletDbId && (!envProjectId || envProjectId === appletProjectId)) {
    databaseId = appletDbId;
  }

  cachedFirebaseTarget = { projectId, databaseId };
  return cachedFirebaseTarget;
}

function getFirebaseAdminApp(): App {
  const { projectId } = getFirebaseRuntimeTarget();
  const existing = getApps().find((a) => a.name === 'payment-proof-auth');
  if (existing) return existing;
  return initializeApp({ projectId }, 'payment-proof-auth');
}

export function getR2ConfigurationStatus(): {
  configured: boolean;
  missing: string[];
  bucketName: string | null;
} {
  const missing: string[] = [];
  if (!(process.env.R2_ACCOUNT_ID || '').trim()) missing.push('R2_ACCOUNT_ID');
  if (!(process.env.R2_ACCESS_KEY_ID || '').trim()) missing.push('R2_ACCESS_KEY_ID');
  if (!(process.env.R2_SECRET_ACCESS_KEY || '').trim()) missing.push('R2_SECRET_ACCESS_KEY');
  const bucketName = (process.env.R2_BUCKET_NAME || '').trim();
  if (!bucketName) missing.push('R2_BUCKET_NAME');

  return {
    configured: missing.length === 0,
    missing,
    bucketName: bucketName || null
  };
}

export function isR2StorageConfigured(): boolean {
  return getR2ConfigurationStatus().configured;
}

function getR2Client(): { s3: S3Client; bucketName: string; r2Origin: string } {
  const status = getR2ConfigurationStatus();
  if (!status.configured) {
    throw new PaymentStorageApiError(
      503,
      `Cloudflare R2 storage is not configured. Missing server variables: ${status.missing.join(', ')}. Deploy cloudflare/r2-worker and set VITE_R2_WORKER_URL, or configure R2_* variables on the server.`,
      'R2_NOT_CONFIGURED'
    );
  }

  const accountId = process.env.R2_ACCOUNT_ID!.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID!.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY!.trim();
  const bucketName = process.env.R2_BUCKET_NAME!.trim();
  const r2Origin = `https://${accountId}.r2.cloudflarestorage.com`;

  const s3 = new S3Client({
    region: 'auto',
    endpoint: r2Origin,
    credentials: {
      accessKeyId,
      secretAccessKey
    },
    forcePathStyle: true
  });

  return { s3, bucketName, r2Origin };
}

export async function verifyBearerFirebaseToken(authHeader: string | null): Promise<{
  idToken: string;
  decoded: DecodedIdToken;
}> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new PaymentStorageApiError(
      401,
      'Missing or invalid Authorization Bearer token.',
      'AUTH_REQUIRED'
    );
  }

  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    throw new PaymentStorageApiError(401, 'Empty Firebase ID token.', 'AUTH_REQUIRED');
  }

  try {
    const app = getFirebaseAdminApp();
    const decoded = await getAuth(app).verifyIdToken(idToken);
    if (!decoded.uid) {
      throw new PaymentStorageApiError(401, 'Invalid Firebase token subject.', 'INVALID_AUTH_TOKEN');
    }
    return { idToken, decoded };
  } catch (err) {
    if (err instanceof PaymentStorageApiError) throw err;
    throw new PaymentStorageApiError(
      401,
      err instanceof Error
        ? `Authentication verification failed: ${err.message}`
        : 'Invalid or expired Firebase ID token.',
      'INVALID_AUTH_TOKEN'
    );
  }
}

export function isStrictAdminToken(decoded: DecodedIdToken): boolean {
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  const emailVerified = decoded.email_verified === true;
  const hasAdminClaim = (decoded as Record<string, unknown>).admin === true;
  return email === ADMIN_EMAIL && emailVerified && hasAdminClaim;
}

export function assertStrictAdminToken(decoded: DecodedIdToken): void {
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (email !== ADMIN_EMAIL) {
    throw new PaymentStorageApiError(
      403,
      'Administrator access is strictly restricted to the authorized admin account.',
      'ADMIN_EMAIL_REQUIRED'
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

async function fetchFirestoreDocument(
  idToken: string,
  collectionPath: string,
  docId: string
): Promise<Record<string, unknown> | null> {
  const { projectId, databaseId } = getFirebaseRuntimeTarget();
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}` +
    `/databases/${encodeURIComponent(databaseId)}/documents/${collectionPath}/${encodeURIComponent(docId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`
    }
  });

  if (res.status === 404) {
    return null;
  }
  if (res.status === 401 || res.status === 403) {
    throw new PaymentStorageApiError(
      403,
      `Firestore access denied reading ${collectionPath}/${docId}.`,
      'FIRESTORE_PERMISSION_DENIED'
    );
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new PaymentStorageApiError(
      502,
      `Firestore REST verification failed (${res.status}): ${errText.slice(0, 200)}`,
      'FIRESTORE_REST_ERROR'
    );
  }

  const json = await res.json();
  const fields = json?.fields || {};
  const decoded: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    decoded[k] = decodeFirestoreValue(v);
  }
  return decoded;
}

export async function verifyInstitutionMembershipViaFirestore(
  idToken: string,
  uid: string,
  institutionId: string
): Promise<void> {
  assertSafeIdentifier(institutionId, 'institutionId');

  try {
    const inst = await fetchFirestoreDocument(idToken, 'institutions', institutionId);
    if (inst && inst.ownerId === uid) {
      return;
    }
  } catch (err) {
    if (err instanceof PaymentStorageApiError && err.code !== 'FIRESTORE_PERMISSION_DENIED') {
      throw err;
    }
  }

  const membership = await fetchFirestoreDocument(
    idToken,
    'institution_members',
    `${institutionId}_${uid}`
  ).catch((err) => {
    if (err instanceof PaymentStorageApiError && err.code === 'FIRESTORE_PERMISSION_DENIED') {
      return null;
    }
    throw err;
  });

  if (
    membership &&
    membership.user_id === uid &&
    membership.institution_id === institutionId
  ) {
    return;
  }

  throw new PaymentStorageApiError(
    403,
    `Account ${uid} is not authorized as an owner or member of institution ${institutionId}.`,
    'INSTITUTION_MEMBERSHIP_REQUIRED'
  );
}

export function assertSafeIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !SAFE_ID_REGEX.test(value.trim())) {
    throw new PaymentStorageApiError(
      400,
      `Invalid or missing ${fieldName}.`,
      'INVALID_IDENTIFIER'
    );
  }
  return value.trim();
}

export function validateUploadMetadata(params: {
  fileName: unknown;
  mimeType: unknown;
  fileSize: unknown;
}): {
  canonicalMimeType: 'image/jpeg' | 'image/png' | 'application/pdf';
  canonicalExt: 'jpg' | 'png' | 'pdf';
  fileSize: number;
} {
  if (typeof params.fileName !== 'string' || !params.fileName.trim()) {
    throw new PaymentStorageApiError(400, 'File name is required.', 'INVALID_FILE_NAME');
  }
  if (typeof params.mimeType !== 'string') {
    throw new PaymentStorageApiError(400, 'File MIME type is required.', 'INVALID_FILE_TYPE');
  }

  const normalizedMime =
    params.mimeType.trim().toLowerCase() === 'image/jpg'
      ? 'image/jpeg'
      : params.mimeType.trim().toLowerCase();

  if (!ALLOWED_PROOF_MIME_TYPES.has(normalizedMime)) {
    throw new PaymentStorageApiError(
      400,
      'Unsupported file type. Only JPG, JPEG, PNG, and PDF payment proofs are allowed.',
      'INVALID_FILE_TYPE'
    );
  }

  const ext = path.extname(params.fileName.trim()).toLowerCase();
  const validExtForMime: Record<string, string[]> = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'application/pdf': ['.pdf']
  };
  if (!validExtForMime[normalizedMime].includes(ext)) {
    throw new PaymentStorageApiError(
      400,
      `File extension "${ext || '(none)'}" does not match MIME type "${normalizedMime}".`,
      'EXTENSION_MIME_MISMATCH'
    );
  }

  const size = Number(params.fileSize);
  if (!Number.isFinite(size) || !Number.isInteger(size) || size <= 0 || size > MAX_PROOF_BYTES) {
    throw new PaymentStorageApiError(
      400,
      'Payment proof size must be between 1 byte and 5 MB.',
      'FILE_TOO_LARGE'
    );
  }

  const canonicalExt =
    normalizedMime === 'image/png' ? 'png' : normalizedMime === 'application/pdf' ? 'pdf' : 'jpg';

  return {
    canonicalMimeType: normalizedMime as 'image/jpeg' | 'image/png' | 'application/pdf',
    canonicalExt,
    fileSize: size
  };
}

export function detectMimeTypeFromMagicBytes(
  bytes: Uint8Array
): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'application/pdf';
  }
  return null;
}

export async function ensurePrivateR2BucketAccessible(s3: S3Client, bucketName: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (err: any) {
    const httpStatus = err?.$metadata?.httpStatusCode;
    const errName = String(err?.name || err?.Code || '');
    if (httpStatus === 404 || errName === 'NotFound' || errName === 'NoSuchBucket') {
      throw new PaymentStorageApiError(
        502,
        `Private Cloudflare R2 bucket "${bucketName}" was not found. Create it as a private bucket in Cloudflare R2.`,
        'R2_BUCKET_NOT_FOUND'
      );
    }
    if (httpStatus === 403 || errName === 'Forbidden' || errName === 'AccessDenied') {
      throw new PaymentStorageApiError(
        502,
        `Cloudflare R2 credentials lack permission to access private bucket "${bucketName}".`,
        'R2_ACCESS_DENIED'
      );
    }
    throw new PaymentStorageApiError(
      502,
      `Failed verifying Cloudflare R2 bucket "${bucketName}": ${err?.message || 'Unknown R2 error'}`,
      'R2_BUCKET_ERROR'
    );
  }
}

export async function handleCreateUploadUrl(params: {
  authHeader: string | null;
  body: Record<string, unknown>;
}): Promise<{
  signedUrl: string;
  storagePath: string;
  bucket: string;
  canonicalMimeType: string;
  requiredHeaders: Record<string, string>;
  method: 'PUT';
  expiresInSeconds: number;
  storageProvider: 'cloudflare-r2';
}> {
  const { idToken, decoded } = await verifyBearerFirebaseToken(params.authHeader);
  const institutionId = assertSafeIdentifier(params.body.institutionId, 'institutionId');
  const paymentRequestId = assertSafeIdentifier(params.body.paymentRequestId, 'paymentRequestId');
  const { canonicalMimeType, canonicalExt } = validateUploadMetadata({
    fileName: params.body.fileName,
    mimeType: params.body.mimeType,
    fileSize: params.body.fileSize
  });

  await verifyInstitutionMembershipViaFirestore(idToken, decoded.uid, institutionId);

  const { s3, bucketName, r2Origin } = getR2Client();
  await ensurePrivateR2BucketAccessible(s3, bucketName);

  const storagePath = `payment_proofs/${institutionId}/${decoded.uid}/${paymentRequestId}_${randomUUID()}.${canonicalExt}`;
  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: storagePath,
    ContentType: canonicalMimeType
  });

  const signedUrl = await getSignedUrl(s3, putCommand, {
    expiresIn: SIGNED_UPLOAD_TTL_SECONDS
  });

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(signedUrl);
  } catch {
    throw new PaymentStorageApiError(
      502,
      'Cloudflare R2 returned a malformed presigned upload URL.',
      'R2_INVALID_SIGNED_URL'
    );
  }

  if (parsedUrl.origin !== r2Origin) {
    throw new PaymentStorageApiError(
      502,
      `Unexpected R2 presigned upload endpoint origin: ${parsedUrl.origin}`,
      'R2_INVALID_SIGNED_URL'
    );
  }

  return {
    signedUrl,
    storagePath,
    bucket: bucketName,
    canonicalMimeType,
    requiredHeaders: {
      'Content-Type': canonicalMimeType
    },
    method: 'PUT',
    expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS,
    storageProvider: 'cloudflare-r2'
  };
}

function assertCallerOwnsStoragePath(
  storagePath: unknown,
  institutionId: string,
  uid: string,
  paymentRequestId?: string
): string {
  if (typeof storagePath !== 'string' || !storagePath.trim() || storagePath.includes('..')) {
    throw new PaymentStorageApiError(400, 'Invalid storagePath.', 'INVALID_STORAGE_PATH');
  }
  const cleanPath = storagePath.trim();
  const requiredPrefix = paymentRequestId
    ? `payment_proofs/${institutionId}/${uid}/${paymentRequestId}_`
    : `payment_proofs/${institutionId}/${uid}/`;

  if (!cleanPath.startsWith(requiredPrefix)) {
    throw new PaymentStorageApiError(
      403,
      'Storage object path does not belong to this authenticated institution user.',
      'STORAGE_PATH_FORBIDDEN'
    );
  }
  return cleanPath;
}

export async function handleVerifyUploadedProof(params: {
  authHeader: string | null;
  body: Record<string, unknown>;
}): Promise<{
  verified: boolean;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const { idToken, decoded } = await verifyBearerFirebaseToken(params.authHeader);
  const institutionId = assertSafeIdentifier(params.body.institutionId, 'institutionId');
  const paymentRequestId = assertSafeIdentifier(params.body.paymentRequestId, 'paymentRequestId');
  const storagePath = assertCallerOwnsStoragePath(
    params.body.storagePath,
    institutionId,
    decoded.uid,
    paymentRequestId
  );

  await verifyInstitutionMembershipViaFirestore(idToken, decoded.uid, institutionId);

  const { s3, bucketName } = getR2Client();

  let head: { ContentLength?: number; ContentType?: string };
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: storagePath }));
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') {
      throw new PaymentStorageApiError(
        404,
        'Uploaded payment proof object was not found in private Cloudflare R2 storage.',
        'UPLOADED_OBJECT_NOT_FOUND'
      );
    }
    throw new PaymentStorageApiError(
      502,
      `Failed inspecting uploaded R2 object: ${err?.message || 'HeadObject error'}`,
      'R2_HEAD_OBJECT_FAILED'
    );
  }

  const sizeBytes = Number(head.ContentLength ?? 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PROOF_BYTES) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: storagePath })).catch(() => {});
    throw new PaymentStorageApiError(
      400,
      `Uploaded file size (${sizeBytes} bytes) violates the 5 MB limit.`,
      'UPLOADED_FILE_SIZE_INVALID'
    );
  }

  let headerSlice: Uint8Array;
  try {
    const obj = await s3.send(
      new GetObjectCommand({
        Bucket: bucketName,
        Key: storagePath,
        Range: 'bytes=0-15'
      })
    );
    headerSlice = obj.Body ? await obj.Body.transformToByteArray() : new Uint8Array();
  } catch (err: any) {
    throw new PaymentStorageApiError(
      502,
      `Unable to verify uploaded R2 object contents: ${err?.message || 'GetObject failed'}`,
      'UPLOAD_VERIFICATION_FAILED'
    );
  }

  const detectedMime = detectMimeTypeFromMagicBytes(headerSlice);
  const pathExt = path.extname(storagePath).toLowerCase();
  const expectedMimeForExt =
    pathExt === '.png'
      ? 'image/png'
      : pathExt === '.pdf'
      ? 'application/pdf'
      : pathExt === '.jpg' || pathExt === '.jpeg'
      ? 'image/jpeg'
      : null;

  if (!detectedMime || !expectedMimeForExt || detectedMime !== expectedMimeForExt) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: storagePath })).catch(() => {});
    throw new PaymentStorageApiError(
      400,
      'Uploaded file failed binary signature verification. Only genuine JPG, PNG, or PDF files are accepted.',
      'INVALID_FILE_SIGNATURE'
    );
  }

  return {
    verified: true,
    storagePath,
    mimeType: detectedMime,
    sizeBytes
  };
}

export async function handleCleanupOrphanProof(params: {
  authHeader: string | null;
  body: Record<string, unknown>;
}): Promise<{ cleaned: boolean; storagePath: string }> {
  const { idToken, decoded } = await verifyBearerFirebaseToken(params.authHeader);
  const institutionId = assertSafeIdentifier(params.body.institutionId, 'institutionId');
  const storagePath = assertCallerOwnsStoragePath(
    params.body.storagePath,
    institutionId,
    decoded.uid
  );

  await verifyInstitutionMembershipViaFirestore(idToken, decoded.uid, institutionId);

  const { s3, bucketName } = getR2Client();
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: storagePath }));
  return { cleaned: true, storagePath };
}

function sanitizeDispositionName(name: string): string {
  return (path.basename(name) || 'payment-proof').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

export async function handleAdminPreviewUrl(params: {
  authHeader: string | null;
  body: Record<string, unknown>;
}): Promise<{
  signedUrl: string;
  expiresInSeconds: number;
  mimeType: string;
  fileName: string;
}> {
  const { idToken, decoded } = await verifyBearerFirebaseToken(params.authHeader);
  assertStrictAdminToken(decoded);

  const paymentRequestId = assertSafeIdentifier(params.body.paymentRequestId, 'paymentRequestId');
  const paymentDoc = await fetchFirestoreDocument(idToken, 'payment_requests', paymentRequestId);

  if (!paymentDoc) {
    throw new PaymentStorageApiError(
      404,
      `Payment request "${paymentRequestId}" was not found.`,
      'PAYMENT_REQUEST_NOT_FOUND'
    );
  }

  const recordPath =
    typeof paymentDoc.screenshotStoragePath === 'string'
      ? paymentDoc.screenshotStoragePath.trim()
      : '';

  if (!recordPath || !recordPath.startsWith('payment_proofs/')) {
    throw new PaymentStorageApiError(
      400,
      'Payment request does not reference a valid Cloudflare R2 storage proof path.',
      'INVALID_STORAGE_PATH'
    );
  }

  if (
    typeof params.body.storagePath === 'string' &&
    params.body.storagePath.trim() &&
    params.body.storagePath.trim() !== recordPath
  ) {
    throw new PaymentStorageApiError(
      403,
      'Requested storage path does not match the payment request record.',
      'STORAGE_PATH_MISMATCH'
    );
  }

  const mimeType =
    typeof paymentDoc.screenshotMimeType === 'string' ? paymentDoc.screenshotMimeType : 'image/jpeg';
  const fileName =
    typeof paymentDoc.screenshotFileName === 'string'
      ? paymentDoc.screenshotFileName
      : path.basename(recordPath);

  const { s3, bucketName } = getR2Client();
  const signedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: recordPath,
      ResponseContentType: mimeType,
      ResponseContentDisposition: `inline; filename="${sanitizeDispositionName(fileName)}"`
    }),
    { expiresIn: SIGNED_PREVIEW_TTL_SECONDS }
  );

  return {
    signedUrl,
    expiresInSeconds: SIGNED_PREVIEW_TTL_SECONDS,
    mimeType,
    fileName
  };
}

export async function handleInstitutionPreviewUrl(params: {
  authHeader: string | null;
  body: Record<string, unknown>;
}): Promise<{
  signedUrl: string;
  expiresInSeconds: number;
  mimeType: string;
  fileName: string;
}> {
  const { idToken, decoded } = await verifyBearerFirebaseToken(params.authHeader);
  const paymentRequestId = assertSafeIdentifier(params.body.paymentRequestId, 'paymentRequestId');

  const paymentDoc = await fetchFirestoreDocument(idToken, 'payment_requests', paymentRequestId);
  if (!paymentDoc) {
    throw new PaymentStorageApiError(
      404,
      `Payment request "${paymentRequestId}" was not found.`,
      'PAYMENT_REQUEST_NOT_FOUND'
    );
  }

  const institutionId = assertSafeIdentifier(paymentDoc.institutionId, 'institutionId');
  await verifyInstitutionMembershipViaFirestore(idToken, decoded.uid, institutionId);

  const recordPath =
    typeof paymentDoc.screenshotStoragePath === 'string'
      ? paymentDoc.screenshotStoragePath.trim()
      : '';

  if (!recordPath || !recordPath.startsWith(`payment_proofs/${institutionId}/`)) {
    throw new PaymentStorageApiError(
      403,
      'Payment proof path does not belong to your institution.',
      'STORAGE_PATH_FORBIDDEN'
    );
  }

  if (
    typeof params.body.storagePath === 'string' &&
    params.body.storagePath.trim() &&
    params.body.storagePath.trim() !== recordPath
  ) {
    throw new PaymentStorageApiError(
      403,
      'Requested storage path does not match the payment request record.',
      'STORAGE_PATH_MISMATCH'
    );
  }

  const mimeType =
    typeof paymentDoc.screenshotMimeType === 'string' ? paymentDoc.screenshotMimeType : 'image/jpeg';
  const fileName =
    typeof paymentDoc.screenshotFileName === 'string'
      ? paymentDoc.screenshotFileName
      : path.basename(recordPath);

  const { s3, bucketName } = getR2Client();
  const signedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: recordPath,
      ResponseContentType: mimeType,
      ResponseContentDisposition: `inline; filename="${sanitizeDispositionName(fileName)}"`
    }),
    { expiresIn: SIGNED_PREVIEW_TTL_SECONDS }
  );

  return {
    signedUrl,
    expiresInSeconds: SIGNED_PREVIEW_TTL_SECONDS,
    mimeType,
    fileName
  };
}
