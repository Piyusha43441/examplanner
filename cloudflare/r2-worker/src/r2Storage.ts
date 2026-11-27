import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertStrictAdminToken,
  DEFAULT_ADMIN_EMAIL,
  fetchFirestoreDocument,
  verifyBearerFirebaseToken,
  verifyInstitutionMembershipViaFirestore,
  WorkerApiError
} from './firebaseAuth';

export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const SIGNED_UPLOAD_TTL_SECONDS = 300;
export const SIGNED_PREVIEW_TTL_SECONDS = 120;

export const ALLOWED_PROOF_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf'
]);

const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{3,128}$/;

export interface R2WorkerEnv {
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_FIRESTORE_DATABASE_ID?: string;
  ADMIN_EMAIL?: string;
  ALLOWED_ORIGINS?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
}

export function getR2ConfigurationStatus(env: R2WorkerEnv): {
  configured: boolean;
  missing: string[];
  bucketName: string | null;
} {
  const missing: string[] = [];
  if (!env.R2_ACCOUNT_ID?.trim()) missing.push('R2_ACCOUNT_ID');
  if (!env.R2_ACCESS_KEY_ID?.trim()) missing.push('R2_ACCESS_KEY_ID');
  if (!env.R2_SECRET_ACCESS_KEY?.trim()) missing.push('R2_SECRET_ACCESS_KEY');
  if (!env.R2_BUCKET_NAME?.trim()) missing.push('R2_BUCKET_NAME');

  return {
    configured: missing.length === 0,
    missing,
    bucketName: env.R2_BUCKET_NAME?.trim() || null
  };
}

function getR2Client(env: R2WorkerEnv): { s3: S3Client; bucketName: string } {
  const status = getR2ConfigurationStatus(env);
  if (!status.configured) {
    throw new WorkerApiError(
      503,
      `Cloudflare R2 storage is not configured on Worker. Missing: ${status.missing.join(', ')}.`,
      'R2_NOT_CONFIGURED'
    );
  }

  const accountId = env.R2_ACCOUNT_ID!.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID!.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY!.trim();
  const bucketName = env.R2_BUCKET_NAME!.trim();

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey
    },
    forcePathStyle: true
  });

  return { s3, bucketName };
}

export function assertSafeIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !SAFE_ID_REGEX.test(value.trim())) {
    throw new WorkerApiError(400, `Invalid or missing ${fieldName}.`, 'INVALID_IDENTIFIER');
  }
  return value.trim();
}

function getLowerExtension(fileName: string): string {
  const clean = fileName.trim().split('/').pop() || '';
  const dot = clean.lastIndexOf('.');
  if (dot <= 0) return '';
  return clean.slice(dot).toLowerCase();
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
    throw new WorkerApiError(400, 'File name is required.', 'INVALID_FILE_NAME');
  }
  if (typeof params.mimeType !== 'string') {
    throw new WorkerApiError(400, 'File MIME type is required.', 'INVALID_FILE_TYPE');
  }

  const rawMime = params.mimeType.trim().toLowerCase();
  const normalizedMime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;

  if (!ALLOWED_PROOF_MIME_TYPES.has(normalizedMime)) {
    throw new WorkerApiError(
      400,
      'Unsupported file type. Only JPG, JPEG, PNG, and PDF payment proofs are allowed.',
      'INVALID_FILE_TYPE'
    );
  }

  const ext = getLowerExtension(params.fileName);
  const validExtForMime: Record<string, string[]> = {
    'image/jpeg': ['.jpg', '.jpeg'],
    'image/png': ['.png'],
    'application/pdf': ['.pdf']
  };
  if (!validExtForMime[normalizedMime].includes(ext)) {
    throw new WorkerApiError(
      400,
      `File extension "${ext || '(none)'}" does not match MIME type "${normalizedMime}".`,
      'EXTENSION_MIME_MISMATCH'
    );
  }

  const size = Number(params.fileSize);
  if (!Number.isFinite(size) || !Number.isInteger(size) || size <= 0 || size > MAX_PROOF_BYTES) {
    throw new WorkerApiError(
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

function assertCallerOwnsStoragePath(
  storagePath: unknown,
  institutionId: string,
  uid: string,
  paymentRequestId?: string
): string {
  if (typeof storagePath !== 'string' || !storagePath.trim() || storagePath.includes('..')) {
    throw new WorkerApiError(400, 'Invalid storagePath.', 'INVALID_STORAGE_PATH');
  }
  const cleanPath = storagePath.trim();
  const requiredPrefix = paymentRequestId
    ? `payment_proofs/${institutionId}/${uid}/${paymentRequestId}_`
    : `payment_proofs/${institutionId}/${uid}/`;

  if (!cleanPath.startsWith(requiredPrefix)) {
    throw new WorkerApiError(
      403,
      'Storage object path does not belong to this authenticated institution user.',
      'STORAGE_PATH_FORBIDDEN'
    );
  }
  return cleanPath;
}

async function ensurePrivateR2BucketAccessible(s3: S3Client, bucketName: string): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucketName }));
  } catch (err: any) {
    const httpStatus = err?.$metadata?.httpStatusCode;
    const codeName = String(err?.name || err?.Code || '');
    if (httpStatus === 404 || codeName === 'NotFound' || codeName === 'NoSuchBucket') {
      throw new WorkerApiError(
        502,
        `Private Cloudflare R2 bucket "${bucketName}" was not found. Create the private bucket in Cloudflare R2 first.`,
        'R2_BUCKET_NOT_FOUND'
      );
    }
    if (httpStatus === 403 || codeName === 'Forbidden' || codeName === 'AccessDenied') {
      throw new WorkerApiError(
        502,
        `Cloudflare R2 API token lacks access to private bucket "${bucketName}".`,
        'R2_ACCESS_DENIED'
      );
    }
    throw new WorkerApiError(
      502,
      `Failed verifying Cloudflare R2 bucket "${bucketName}": ${err?.message || 'Unknown R2 error'}`,
      'R2_BUCKET_ERROR'
    );
  }
}

function getFirebaseTargets(env: R2WorkerEnv): {
  projectId: string;
  databaseId: string;
  adminEmail: string;
} {
  const projectId = (env.FIREBASE_PROJECT_ID || '').trim();
  if (!projectId) {
    throw new WorkerApiError(503, 'FIREBASE_PROJECT_ID is not configured on Worker.', 'FIREBASE_PROJECT_NOT_CONFIGURED');
  }
  return {
    projectId,
    databaseId: (env.FIREBASE_FIRESTORE_DATABASE_ID || '(default)').trim() || '(default)',
    adminEmail: (env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase()
  };
}

export async function handleWorkerCreateUploadUrl(params: {
  env: R2WorkerEnv;
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
  const { projectId, databaseId } = getFirebaseTargets(params.env);
  const { idToken, decoded } = await verifyBearerFirebaseToken({
    authHeader: params.authHeader,
    firebaseProjectId: projectId
  });

  const institutionId = assertSafeIdentifier(params.body.institutionId, 'institutionId');
  const paymentRequestId = assertSafeIdentifier(params.body.paymentRequestId, 'paymentRequestId');
  const { canonicalMimeType, canonicalExt } = validateUploadMetadata({
    fileName: params.body.fileName,
    mimeType: params.body.mimeType,
    fileSize: params.body.fileSize
  });

  await verifyInstitutionMembershipViaFirestore({
    idToken,
    projectId,
    databaseId,
    uid: decoded.uid,
    institutionId
  });

  const { s3, bucketName } = getR2Client(params.env);
  await ensurePrivateR2BucketAccessible(s3, bucketName);

  const storagePath = `payment_proofs/${institutionId}/${decoded.uid}/${paymentRequestId}_${crypto.randomUUID()}.${canonicalExt}`;
  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: storagePath,
    ContentType: canonicalMimeType
  });

  const signedUrl = await getSignedUrl(s3, putCommand, {
    expiresIn: SIGNED_UPLOAD_TTL_SECONDS
  });

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

export async function handleWorkerVerifyUploadedProof(params: {
  env: R2WorkerEnv;
  authHeader: string | null;
  body: Record<string, unknown>;
}): Promise<{
  verified: boolean;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const { projectId, databaseId } = getFirebaseTargets(params.env);
  const { idToken, decoded } = await verifyBearerFirebaseToken({
    authHeader: params.authHeader,
    firebaseProjectId: projectId
  });

  const institutionId = assertSafeIdentifier(params.body.institutionId, 'institutionId');
  const paymentRequestId = assertSafeIdentifier(params.body.paymentRequestId, 'paymentRequestId');
  const storagePath = assertCallerOwnsStoragePath(
    params.body.storagePath,
    institutionId,
    decoded.uid,
    paymentRequestId
  );

  await verifyInstitutionMembershipViaFirestore({
    idToken,
    projectId,
    databaseId,
    uid: decoded.uid,
    institutionId
  });

  const { s3, bucketName } = getR2Client(params.env);

  let head: { ContentLength?: number; ContentType?: string };
  try {
    head = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: storagePath }));
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound' || err?.name === 'NoSuchKey') {
      throw new WorkerApiError(
        404,
        'Uploaded payment proof object was not found in private Cloudflare R2 storage.',
        'UPLOADED_OBJECT_NOT_FOUND'
      );
    }
    throw new WorkerApiError(
      502,
      `Failed inspecting uploaded R2 object: ${err?.message || 'HeadObject error'}`,
      'R2_HEAD_OBJECT_FAILED'
    );
  }

  const sizeBytes = Number(head.ContentLength ?? 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_PROOF_BYTES) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: storagePath })).catch(() => {});
    throw new WorkerApiError(
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
    throw new WorkerApiError(
      502,
      `Unable to verify uploaded R2 object contents: ${err?.message || 'GetObject failed'}`,
      'UPLOAD_VERIFICATION_FAILED'
    );
  }

  const detectedMime = detectMimeTypeFromMagicBytes(headerSlice);
  const pathExt = getLowerExtension(storagePath);
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
    throw new WorkerApiError(
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

export async function handleWorkerCleanupOrphanProof(params: {
  env: R2WorkerEnv;
  authHeader: string | null;
  body: Record<string, unknown>;
}): Promise<{ cleaned: boolean; storagePath: string }> {
  const { projectId, databaseId } = getFirebaseTargets(params.env);
  const { idToken, decoded } = await verifyBearerFirebaseToken({
    authHeader: params.authHeader,
    firebaseProjectId: projectId
  });

  const institutionId = assertSafeIdentifier(params.body.institutionId, 'institutionId');
  const storagePath = assertCallerOwnsStoragePath(params.body.storagePath, institutionId, decoded.uid);

  await verifyInstitutionMembershipViaFirestore({
    idToken,
    projectId,
    databaseId,
    uid: decoded.uid,
    institutionId
  });

  const { s3, bucketName } = getR2Client(params.env);
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: storagePath }));
  return { cleaned: true, storagePath };
}

function buildSafeDispositionFileName(rawName: string): string {
  return (rawName.split('/').pop() || 'payment-proof').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

export async function handleWorkerAdminPreviewUrl(params: {
  env: R2WorkerEnv;
  authHeader: string | null;
  body: Record<string, unknown>;
}): Promise<{
  signedUrl: string;
  expiresInSeconds: number;
  mimeType: string;
  fileName: string;
}> {
  const { projectId, databaseId, adminEmail } = getFirebaseTargets(params.env);
  const { idToken, decoded } = await verifyBearerFirebaseToken({
    authHeader: params.authHeader,
    firebaseProjectId: projectId
  });
  assertStrictAdminToken(decoded, adminEmail);

  const paymentRequestId = assertSafeIdentifier(params.body.paymentRequestId, 'paymentRequestId');
  const paymentDoc = await fetchFirestoreDocument({
    idToken,
    projectId,
    databaseId,
    collectionPath: 'payment_requests',
    docId: paymentRequestId
  });

  if (!paymentDoc) {
    throw new WorkerApiError(404, `Payment request "${paymentRequestId}" was not found.`, 'PAYMENT_REQUEST_NOT_FOUND');
  }

  const recordPath =
    typeof paymentDoc.screenshotStoragePath === 'string' ? paymentDoc.screenshotStoragePath.trim() : '';

  if (!recordPath || !recordPath.startsWith('payment_proofs/')) {
    throw new WorkerApiError(
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
    throw new WorkerApiError(
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
      : recordPath.split('/').pop() || 'payment-proof';

  const { s3, bucketName } = getR2Client(params.env);
  const signedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: recordPath,
      ResponseContentType: mimeType,
      ResponseContentDisposition: `inline; filename="${buildSafeDispositionFileName(fileName)}"`
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

export async function handleWorkerInstitutionPreviewUrl(params: {
  env: R2WorkerEnv;
  authHeader: string | null;
  body: Record<string, unknown>;
}): Promise<{
  signedUrl: string;
  expiresInSeconds: number;
  mimeType: string;
  fileName: string;
}> {
  const { projectId, databaseId } = getFirebaseTargets(params.env);
  const { idToken, decoded } = await verifyBearerFirebaseToken({
    authHeader: params.authHeader,
    firebaseProjectId: projectId
  });

  const paymentRequestId = assertSafeIdentifier(params.body.paymentRequestId, 'paymentRequestId');
  const paymentDoc = await fetchFirestoreDocument({
    idToken,
    projectId,
    databaseId,
    collectionPath: 'payment_requests',
    docId: paymentRequestId
  });

  if (!paymentDoc) {
    throw new WorkerApiError(404, `Payment request "${paymentRequestId}" was not found.`, 'PAYMENT_REQUEST_NOT_FOUND');
  }

  const institutionId = assertSafeIdentifier(paymentDoc.institutionId, 'institutionId');
  await verifyInstitutionMembershipViaFirestore({
    idToken,
    projectId,
    databaseId,
    uid: decoded.uid,
    institutionId
  });

  const recordPath =
    typeof paymentDoc.screenshotStoragePath === 'string' ? paymentDoc.screenshotStoragePath.trim() : '';

  if (!recordPath || !recordPath.startsWith(`payment_proofs/${institutionId}/`)) {
    throw new WorkerApiError(
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
    throw new WorkerApiError(
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
      : recordPath.split('/').pop() || 'payment-proof';

  const { s3, bucketName } = getR2Client(params.env);
  const signedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: recordPath,
      ResponseContentType: mimeType,
      ResponseContentDisposition: `inline; filename="${buildSafeDispositionFileName(fileName)}"`
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
