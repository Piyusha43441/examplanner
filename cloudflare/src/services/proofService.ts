import { isAdminUser, resolveOwnedInstitution } from '../auth';
import { HttpError } from '../http';
import { enforceRateLimit } from '../rateLimit';
import {
  AuthUser,
  Env,
  isValidId,
  makeWorkerId,
  MAX_PROOF_BYTES,
  PaymentRequestRow,
  UploadedProofRow,
  WorkerDeps
} from '../types';

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);

function detectMagicMimeType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'application/pdf' | null {
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

function sanitizeFileName(name: string): string {
  const cleaned = (name || 'payment_proof')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .slice(0, 80);
  return cleaned || 'payment_proof';
}

export async function handleUploadPaymentProof(
  request: Request,
  auth: AuthUser,
  env: Env,
  deps: WorkerDeps,
  nowMs: number
): Promise<{
  paymentRequestId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}> {
  await enforceRateLimit(env.DB, `upload:${auth.uid}`, 20, 15 * 60 * 1000, nowMs);

  const contentType = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!contentType.includes('multipart/form-data')) {
    throw new HttpError(400, 'Upload must use multipart/form-data.', 'INVALID_CONTENT_TYPE');
  }

  const formData = await request.formData();
  const institutionIdRaw = formData.get('institutionId');
  const institutionNameRaw = formData.get('institutionName');
  const paymentRequestIdRaw = formData.get('paymentRequestId');
  const fileEntry = formData.get('file');

  if (typeof institutionIdRaw !== 'string' || !isValidId(institutionIdRaw)) {
    throw new HttpError(400, 'Valid institutionId is required.', 'INVALID_INSTITUTION_ID');
  }

  const institutionName =
    typeof institutionNameRaw === 'string' && institutionNameRaw.trim()
      ? institutionNameRaw.trim().slice(0, 180)
      : undefined;

  const institution = await resolveOwnedInstitution(
    institutionIdRaw,
    auth,
    env,
    deps,
    nowMs,
    institutionName
  );

  // Prevent uploading new proofs if institution already has an active subscription or pending request
  const activeSub = await env.DB.prepare(
    `SELECT subscription_id FROM subscriptions
     WHERE institution_id = ? AND approval_status = 'approved' AND payment_status = 'approved' AND expires_at_ms > ?
     LIMIT 1`
  )
    .bind(institution.id, nowMs)
    .first<{ subscription_id: string }>();
  if (activeSub) {
    throw new HttpError(
      409,
      'Your institution already has an active subscription.',
      'ALREADY_SUBSCRIBED'
    );
  }

  const paymentRequestId =
    typeof paymentRequestIdRaw === 'string' && isValidId(paymentRequestIdRaw)
      ? paymentRequestIdRaw
      : makeWorkerId('payreq', nowMs);

  const existingPending = await env.DB.prepare(
    `SELECT payment_request_id FROM payment_requests
     WHERE institution_id = ? AND status = 'pending'
     LIMIT 1`
  )
    .bind(institution.id)
    .first<{ payment_request_id: string }>();
  if (existingPending) {
    throw new HttpError(
      409,
      'You already have a pending payment verification request awaiting administrator review.',
      'PENDING_PAYMENT_EXISTS'
    );
  }

  if (!fileEntry || typeof fileEntry === 'string') {
    throw new HttpError(400, 'Payment proof file is required.', 'MISSING_FILE');
  }

  const file = fileEntry as File;
  if (file.size <= 0) {
    throw new HttpError(400, 'Payment proof file cannot be empty.', 'EMPTY_FILE');
  }
  if (file.size > MAX_PROOF_BYTES) {
    throw new HttpError(
      413,
      'Payment proof file exceeds the maximum allowed size of 5 MB.',
      'FILE_TOO_LARGE'
    );
  }

  const declaredMime = (file.type || '').toLowerCase().trim();
  if (declaredMime && !ALLOWED_MIME_TYPES.has(declaredMime)) {
    throw new HttpError(
      400,
      'Unsupported file type. Only JPG, JPEG, PNG, and PDF files are accepted.',
      'INVALID_FILE_TYPE'
    );
  }

  const arrayBuf = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PROOF_BYTES) {
    throw new HttpError(
      413,
      'Payment proof file size must be between 1 byte and 5 MB.',
      'FILE_TOO_LARGE'
    );
  }

  const detectedMime = detectMagicMimeType(bytes);
  if (!detectedMime) {
    throw new HttpError(
      400,
      'File signature could not be verified as a valid JPG, PNG, or PDF document.',
      'INVALID_FILE_SIGNATURE'
    );
  }

  const existingUpload = await env.DB.prepare(
    'SELECT * FROM uploaded_proof_objects WHERE payment_request_id = ?'
  )
    .bind(paymentRequestId)
    .first<UploadedProofRow>();

  if (existingUpload) {
    if (existingUpload.user_id !== auth.uid || existingUpload.institution_id !== institution.id) {
      throw new HttpError(403, 'Payment request ID belongs to another account.', 'FORBIDDEN');
    }
    if (existingUpload.committed === 1) {
      throw new HttpError(409, 'This payment request has already been submitted.', 'ALREADY_SUBMITTED');
    }
  }

  const safeName = sanitizeFileName(file.name);
  const objectKey = `payment-proofs/${institution.id}/${auth.uid}/${paymentRequestId}_${nowMs}_${safeName}`;

  await env.PROOF_BUCKET.put(objectKey, bytes, {
    httpMetadata: {
      contentType: detectedMime
    },
    customMetadata: {
      institutionId: institution.id,
      userId: auth.uid,
      paymentRequestId
    }
  });

  await env.DB.prepare(
    `INSERT INTO uploaded_proof_objects (
      storage_key, payment_request_id, institution_id, user_id,
      mime_type, size_bytes, original_file_name, uploaded_at_ms, committed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(payment_request_id) DO UPDATE SET
      storage_key = excluded.storage_key,
      mime_type = excluded.mime_type,
      size_bytes = excluded.size_bytes,
      original_file_name = excluded.original_file_name,
      uploaded_at_ms = excluded.uploaded_at_ms`
  )
    .bind(
      objectKey,
      paymentRequestId,
      institution.id,
      auth.uid,
      detectedMime,
      bytes.byteLength,
      safeName,
      nowMs
    )
    .run();

  return {
    paymentRequestId,
    objectKey,
    fileName: safeName,
    mimeType: detectedMime,
    fileSize: bytes.byteLength
  };
}

export async function handleStreamPaymentProof(
  paymentRequestId: string,
  auth: AuthUser,
  env: Env,
  corsHeaders: Record<string, string>,
  adminOnly: boolean
): Promise<Response> {
  if (!isValidId(paymentRequestId)) {
    throw new HttpError(400, 'Invalid paymentRequestId.', 'INVALID_ID');
  }

  const pr = await env.DB.prepare('SELECT * FROM payment_requests WHERE payment_request_id = ?')
    .bind(paymentRequestId)
    .first<PaymentRequestRow>();

  if (!pr) {
    throw new HttpError(404, 'Payment request not found.', 'NOT_FOUND');
  }

  const callerIsAdmin = isAdminUser(auth, env);
  if (adminOnly && !callerIsAdmin) {
    throw new HttpError(403, 'Administrator access required.', 'FORBIDDEN_ADMIN_ONLY');
  }
  if (!callerIsAdmin && pr.user_id !== auth.uid) {
    throw new HttpError(
      403,
      'Access denied. You do not have permission to view this payment proof.',
      'FORBIDDEN'
    );
  }

  const object = await env.PROOF_BUCKET.get(pr.screenshot_storage_key);
  if (!object) {
    throw new HttpError(404, 'Payment proof file not found in R2 storage.', 'PROOF_NOT_FOUND');
  }

  const safeDownloadName = sanitizeFileName(pr.screenshot_file_name || 'payment_proof');
  const contentType =
    pr.screenshot_mime_type || object.httpMetadata?.contentType || 'application/octet-stream';

  return new Response(object.body, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${safeDownloadName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
