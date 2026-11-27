import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where
} from 'firebase/firestore';
import { ADMIN_EMAIL, isAllowedExaminationType, SUBSCRIPTION_PLAN } from '../core/subscriptionConstants';
import {
  AdminAuditLogRecord,
  InstitutionProfile,
  NotificationRecord,
  PaymentRequestRecord,
  SubscriptionRecord
} from '../core/types';
import { auth, db, isFirebaseConfigured } from './config';
import { makeUuid } from './service';

function cleanFirestoreData<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => cleanFirestoreData(item)) as unknown as T;
  }
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = cleanFirestoreData(value);
      }
    }
    return cleaned as T;
  }
  return obj;
}

export class FirebaseApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, message: string, code = 'FIREBASE_ERROR') {
    super(message);
    this.name = 'FirebaseApiError';
    this.status = status;
    this.code = code;
  }
}

export async function fetchServerNowMs(): Promise<number> {
  try {
    const res = await fetch('/api/server-time', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.nowMs === 'number' && Number.isFinite(data.nowMs)) {
        return data.nowMs;
      }
    }
  } catch {
    // Offline / fallback to local device time
  }
  return Date.now();
}

export function toMillis(val: unknown): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function formatTimestamp(val: unknown): string {
  const ms = toMillis(val);
  if (!ms) return '—';
  return new Date(ms).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatDateOnly(val: unknown): string {
  const ms = toMillis(val);
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
}

export function formatTransactionRefDisplay(refId?: string | null): string {
  const trimmed = (refId ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Not Provided';
}

export function formatPaymentErrorMessage(err: unknown): string {
  if (err instanceof FirebaseApiError) {
    return err.message;
  }
  if (!(err instanceof Error)) {
    return 'Unable to submit payment request. Please try again.';
  }
  return err.message || 'Unable to submit payment request. Please try again.';
}

export const PAYMENT_PROOFS_BUCKET = 'exam-planner-payment-proofs';
export const MAX_STORAGE_PROOF_BYTES = 5 * 1024 * 1024;
export const MAX_RAW_IMAGE_BYTES = 15 * 1024 * 1024;
const COMPRESSION_THRESHOLD_BYTES = 350 * 1024;

const ALLOWED_PROOF_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf'
]);

export function resolveProofMimeType(file: Pick<File, 'name' | 'type'>): string | null {
  const rawType = (file.type || '').toLowerCase().trim();
  if (rawType === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_PROOF_MIME_TYPES.has(rawType)) return rawType;

  const lowerName = (file.name || '').toLowerCase().trim();
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.pdf')) return 'application/pdf';
  return null;
}

export function validateProofFileBasic(file: Pick<File, 'name' | 'type' | 'size'>): {
  valid: boolean;
  mimeType?: string;
  error?: string;
} {
  const mimeType = resolveProofMimeType(file);
  if (!mimeType) {
    return {
      valid: false,
      error: 'Please upload a valid JPG, JPEG, PNG, or PDF payment proof file.'
    };
  }
  if (file.size <= 0) {
    return {
      valid: false,
      error: 'Selected payment proof file is empty.'
    };
  }
  if (mimeType === 'application/pdf' && file.size > MAX_STORAGE_PROOF_BYTES) {
    return {
      valid: false,
      error: 'PDF payment proof file size must not exceed 5 MB.'
    };
  }
  if (mimeType !== 'application/pdf' && file.size > MAX_RAW_IMAGE_BYTES) {
    return {
      valid: false,
      error: 'Screenshot image is too large (maximum 15 MB before optimization).'
    };
  }
  return { valid: true, mimeType };
}

export interface PreparedPaymentProof {
  blob: Blob;
  fileName: string;
  mimeType: string;
  compressed: boolean;
  originalSize: number;
  finalSize: number;
}

async function decodeImageForCompression(
  file: Blob
): Promise<{
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
      cleanup: () => bitmap.close()
    };
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      const timer = window.setTimeout(() => reject(new Error('Image decoding timed out.')), 8000);
      el.onload = () => {
        window.clearTimeout(timer);
        resolve(el);
      };
      el.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('Unable to read image file.'));
      };
      el.src = objectUrl;
    });
    return {
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      cleanup: () => URL.revokeObjectURL(objectUrl)
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

async function encodeCanvasToJpegBlob(
  decoded: Awaited<ReturnType<typeof decodeImageForCompression>>,
  maxDimension: number,
  quality: number
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const scale = Math.min(1, maxDimension / Math.max(decoded.width, decoded.height, 1));
  const targetW = Math.max(1, Math.round(decoded.width * scale));
  const targetH = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  decoded.draw(ctx, targetW, targetH);

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

export async function preparePaymentProofFile(file: File): Promise<PreparedPaymentProof> {
  const check = validateProofFileBasic(file);
  if (!check.valid || !check.mimeType) {
    throw new Error(check.error || 'Invalid payment proof file.');
  }
  const mimeType = check.mimeType;

  if (mimeType === 'application/pdf') {
    return {
      blob: file,
      fileName: file.name,
      mimeType,
      compressed: false,
      originalSize: file.size,
      finalSize: file.size
    };
  }

  if (file.size <= COMPRESSION_THRESHOLD_BYTES || typeof document === 'undefined') {
    if (file.size > MAX_STORAGE_PROOF_BYTES) {
      throw new Error('Payment proof image must not exceed 5 MB.');
    }
    return {
      blob: file,
      fileName: file.name,
      mimeType,
      compressed: false,
      originalSize: file.size,
      finalSize: file.size
    };
  }

  let decoded: Awaited<ReturnType<typeof decodeImageForCompression>> | null = null;
  try {
    decoded = await decodeImageForCompression(file);
    let compressedBlob = await encodeCanvasToJpegBlob(decoded, 1600, 0.84);
    if (compressedBlob && compressedBlob.size > 4.5 * 1024 * 1024) {
      compressedBlob = await encodeCanvasToJpegBlob(decoded, 1280, 0.74);
    }

    if (
      compressedBlob &&
      compressedBlob.size > 0 &&
      (compressedBlob.size < file.size || file.size > MAX_STORAGE_PROOF_BYTES)
    ) {
      if (compressedBlob.size > MAX_STORAGE_PROOF_BYTES) {
        throw new Error('Screenshot remains larger than 5 MB after optimization.');
      }
      const baseName = file.name.replace(/\.(png|jpe?g)$/i, '');
      return {
        blob: compressedBlob,
        fileName: `${baseName || 'payment_proof'}.jpg`,
        mimeType: 'image/jpeg',
        compressed: true,
        originalSize: file.size,
        finalSize: compressedBlob.size
      };
    }

    return {
      blob: file,
      fileName: file.name,
      mimeType,
      compressed: false,
      originalSize: file.size,
      finalSize: file.size
    };
  } catch (err) {
    if (file.size > MAX_STORAGE_PROOF_BYTES) {
      throw err instanceof Error
        ? err
        : new Error('Payment proof image exceeds 5 MB and could not be compressed.');
    }
    return {
      blob: file,
      fileName: file.name,
      mimeType,
      compressed: false,
      originalSize: file.size,
      finalSize: file.size
    };
  } finally {
    decoded?.cleanup();
  }
}

export interface UploadTaskController {
  cancel: () => void;
  getState: () => 'running' | 'canceled' | 'done';
}

function sanitizeFileName(name: string): string {
  return (name || 'payment_proof').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

async function getFreshIdToken(forceRefresh = false): Promise<string> {
  if (!auth.currentUser) {
    throw new FirebaseApiError(
      401,
      'Stage D Failed (Auth): User is not authenticated. Please log in again.',
      'AUTH_REQUIRED'
    );
  }
  try {
    if (typeof auth.currentUser.getIdToken === 'function') {
      const token = await auth.currentUser.getIdToken(forceRefresh);
      if (!token) {
        throw new Error('Empty ID token returned.');
      }
      return token;
    }
    throw new Error('Firebase Auth token provider unavailable.');
  } catch (err: any) {
    throw new FirebaseApiError(
      401,
      `Stage D Failed (Auth Token) [${err?.code || 'auth/token-error'}]: ${err?.message || 'Unable to verify Firebase Auth session.'}`,
      err?.code || 'AUTH_TOKEN_ERROR'
    );
  }
}

export function sanitizeUrlForError(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return '(empty)';
  }
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const redactedParams = new URLSearchParams();
    parsed.searchParams.forEach((_val, key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === 'token' ||
        lowerKey === 'x-amz-signature' ||
        lowerKey === 'x-amz-credential' ||
        lowerKey === 'x-amz-security-token' ||
        lowerKey === 'x-amz-date' ||
        lowerKey.includes('sig') ||
        lowerKey.includes('key')
      ) {
        redactedParams.set(key, '[REDACTED]');
      } else {
        redactedParams.set(key, '[PARAM]');
      }
    });
    const qs = redactedParams.toString();
    return `${parsed.origin}${parsed.pathname}${qs ? `?${qs}` : ''}`;
  } catch {
    return trimmed.split('?')[0].slice(0, 160) || '(invalid-url)';
  }
}

export function classifyStorageUploadError(status: number, rawBody: string, signedUrl: string): string {
  const safeEndpoint = sanitizeUrlForError(signedUrl);
  const trimmedBody = (rawBody || '').trim();

  let parsedMessage = '';
  let parsedErrorCode = '';
  const xmlCodeMatch = trimmedBody.match(/<Code>([^<]+)<\/Code>/i);
  const xmlMsgMatch = trimmedBody.match(/<Message>([^<]+)<\/Message>/i);

  if (xmlCodeMatch || xmlMsgMatch) {
    parsedErrorCode = (xmlCodeMatch?.[1] || '').trim();
    parsedMessage = (xmlMsgMatch?.[1] || parsedErrorCode || '').trim();
  } else if (trimmedBody && !trimmedBody.startsWith('<')) {
    try {
      const parsed = JSON.parse(trimmedBody);
      parsedMessage = String(parsed?.message || parsed?.error || '').trim();
      parsedErrorCode = String(parsed?.code || parsed?.error || '').trim();
    } catch {
      parsedMessage = trimmedBody.slice(0, 220);
    }
  } else if (trimmedBody.startsWith('<')) {
    parsedMessage = 'HTML page returned instead of Cloudflare R2 XML/empty response';
  }

  const lower = `${parsedErrorCode} ${parsedMessage}`.toLowerCase();
  let causeHint = '';
  if (status === 404) {
    if (lower.includes('nosuchbucket') || lower.includes('bucket')) {
      causeHint = 'Bucket does not exist in Cloudflare R2.';
    } else if (!trimmedBody || trimmedBody.startsWith('<!') || trimmedBody.toLowerCase().includes('<html')) {
      causeHint =
        'Upload target returned HTTP 404 with empty/HTML body. Verify the Cloudflare Worker or /api/payment-proof/upload-url returned a valid R2 presigned URL.';
    } else {
      causeHint = 'Cloudflare R2 storage bucket or presigned upload endpoint returned 404.';
    }
  } else if (status === 403) {
    if (lower.includes('signaturedoesnotmatch')) {
      causeHint =
        'Cloudflare R2 rejected the presigned signature (check Content-Type header match, R2_SECRET_ACCESS_KEY, or system clock).';
    } else if (lower.includes('accessdenied')) {
      causeHint =
        'Cloudflare R2 API token lacks Object Read & Write permissions for this private bucket.';
    } else {
      causeHint = 'Cloudflare R2 presigned upload authorization failed (HTTP 403).';
    }
  } else if (status === 413 || lower.includes('entitytoolarge')) {
    causeHint = 'Uploaded payment proof exceeds the 5 MB file size limit.';
  }

  const detailPart = parsedMessage || `HTTP ${status}`;
  return [
    `Stage F Failed (Cloudflare R2 Upload HTTP ${status}): ${detailPart}`,
    causeHint ? `Cause: ${causeHint}` : '',
    `Endpoint: PUT ${safeEndpoint}`
  ]
    .filter(Boolean)
    .join(' | ');
}

function assertValidSignedUploadUrl(signedUrl: unknown): string {
  if (typeof signedUrl !== 'string' || !signedUrl.trim()) {
    throw new FirebaseApiError(
      502,
      'Stage C/E Failed (Invalid Upload Ticket): Server did not return a signedUrl for Cloudflare R2.',
      'INVALID_SIGNED_UPLOAD_URL'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(signedUrl.trim());
  } catch {
    throw new FirebaseApiError(
      502,
      `Stage C/E Failed (Malformed Upload URL): Received non-URL signedUrl (${sanitizeUrlForError(signedUrl)}).`,
      'INVALID_SIGNED_UPLOAD_URL'
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new FirebaseApiError(
      502,
      `Stage C/E Failed (Insecure Upload URL): Expected HTTPS Cloudflare R2 URL, got ${sanitizeUrlForError(signedUrl)}.`,
      'INVALID_SIGNED_UPLOAD_URL'
    );
  }

  if (typeof window !== 'undefined' && window.location?.origin && parsed.origin === window.location.origin) {
    throw new FirebaseApiError(
      502,
      `Stage C/E Failed (Misrouted Upload URL): Upload URL pointed to app origin (${parsed.origin}) instead of Cloudflare R2.`,
      'INVALID_SIGNED_UPLOAD_URL'
    );
  }

  if (!parsed.searchParams.get('X-Amz-Signature')) {
    throw new FirebaseApiError(
      502,
      `Stage C/E Failed (Missing R2 Signature): Presigned R2 upload URL (${sanitizeUrlForError(signedUrl)}) is missing X-Amz-Signature.`,
      'INVALID_SIGNED_UPLOAD_URL'
    );
  }

  return parsed.toString();
}

export function getPaymentProofWorkerBaseUrl(): string {
  const raw = (import.meta.env?.VITE_R2_WORKER_URL || '').trim();
  if (!raw) return '';
  return raw.replace(/\/+$/, '');
}

const NETLIFY_PAYMENT_FUNCTION_FALLBACK: Record<string, string> = {
  '/api/payment-proof/upload-url': '/.netlify/functions/payment-proof-upload-url',
  '/api/payment-proof/verify': '/.netlify/functions/payment-proof-verify',
  '/api/payment-proof/cleanup': '/.netlify/functions/payment-proof-cleanup',
  '/api/payment-proof/preview-url': '/.netlify/functions/payment-proof-preview-url',
  '/api/payment-proof/institution-preview-url': '/.netlify/functions/payment-proof-institution-preview-url'
};

async function postAuthorizedJsonOnce<T>(
  endpoint: string,
  idToken: string,
  payload: Record<string, unknown>,
  stageLabel: string
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify(payload),
      cache: 'no-store'
    });
  } catch (err) {
    throw new FirebaseApiError(
      503,
      `${stageLabel} [NETWORK_ERROR]: ${err instanceof Error ? err.message : 'Unable to reach Cloudflare R2 payment-proof service.'}`,
      'NETWORK_ERROR'
    );
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const rawText = await response.text().catch(() => '');
  const trimmedText = rawText.trim();

  if (contentType.includes('text/html') || trimmedText.startsWith('<')) {
    throw new FirebaseApiError(
      response.ok ? 502 : response.status,
      `${stageLabel} [NON_JSON_HTML_RESPONSE]: Backend endpoint ${endpoint} returned HTML (HTTP ${response.status}) instead of JSON. Configure VITE_R2_WORKER_URL with your deployed Cloudflare Worker URL, or ensure Netlify Functions (/api/*) are active.`,
      'NON_JSON_HTML_RESPONSE'
    );
  }

  let data: any = {};
  if (trimmedText) {
    try {
      data = JSON.parse(trimmedText);
    } catch {
      if (response.ok) {
        throw new FirebaseApiError(
          502,
          `${stageLabel} [INVALID_JSON_RESPONSE]: Backend endpoint ${endpoint} returned non-JSON body (HTTP ${response.status}).`,
          'INVALID_JSON_RESPONSE'
        );
      }
      data = { error: trimmedText.slice(0, 200) };
    }
  } else if (response.ok) {
    throw new FirebaseApiError(
      502,
      `${stageLabel} [EMPTY_JSON_RESPONSE]: Backend endpoint ${endpoint} returned an empty response (HTTP ${response.status}).`,
      'EMPTY_JSON_RESPONSE'
    );
  }

  if (!response.ok) {
    const code = typeof data?.code === 'string' ? data.code : `HTTP_${response.status}`;
    const msg =
      typeof data?.error === 'string' && data.error.trim()
        ? data.error
        : `Request failed with status ${response.status}`;
    throw new FirebaseApiError(response.status, `${stageLabel} [${code}]: ${msg}`, code);
  }

  return data as T;
}

async function postAuthorizedJson<T>(
  path: string,
  idToken: string,
  payload: Record<string, unknown>,
  stageLabel: string
): Promise<T> {
  const workerBase = getPaymentProofWorkerBaseUrl();
  const primaryEndpoint = workerBase ? `${workerBase}${path}` : path;

  try {
    return await postAuthorizedJsonOnce<T>(primaryEndpoint, idToken, payload, stageLabel);
  } catch (err) {
    const fallbackEndpoint = !workerBase ? NETLIFY_PAYMENT_FUNCTION_FALLBACK[path] : undefined;
    if (
      fallbackEndpoint &&
      err instanceof FirebaseApiError &&
      err.code === 'NON_JSON_HTML_RESPONSE'
    ) {
      return await postAuthorizedJsonOnce<T>(fallbackEndpoint, idToken, payload, stageLabel);
    }
    throw err;
  }
}

function uploadBlobWithProgress(params: {
  signedUrl: string;
  blob: Blob;
  mimeType: string;
  requiredHeaders?: Record<string, string>;
  onProgress?: (progressPercent: number) => void;
  onTaskCreated?: (task: UploadTaskController | null) => void;
}): Promise<void> {
  const safeEndpoint = sanitizeUrlForError(params.signedUrl);
  const uploadHeaders: Record<string, string> = {
    'Content-Type': params.mimeType,
    ...(params.requiredHeaders || {})
  };
  const uploadBody =
    params.blob.type === uploadHeaders['Content-Type']
      ? params.blob
      : new Blob([params.blob], { type: uploadHeaders['Content-Type'] });

  if (typeof XMLHttpRequest === 'undefined') {
    const controller = new AbortController();
    let state: 'running' | 'canceled' | 'done' = 'running';
    params.onTaskCreated?.({
      cancel: () => {
        state = 'canceled';
        controller.abort();
      },
      getState: () => state
    });

    return fetch(params.signedUrl, {
      method: 'PUT',
      headers: uploadHeaders,
      body: uploadBody,
      signal: controller.signal
    })
      .then(async (res) => {
        state = 'done';
        params.onTaskCreated?.(null);
        if (!res.ok) {
          const text = await res.text().catch(() => res.statusText || '');
          throw new FirebaseApiError(
            res.status,
            classifyStorageUploadError(res.status, text, params.signedUrl),
            `R2_UPLOAD_HTTP_${res.status}`
          );
        }
        params.onProgress?.(100);
      })
      .catch((err: any) => {
        if (err instanceof FirebaseApiError) throw err;
        if (err?.name === 'AbortError') {
          throw new FirebaseApiError(499, 'Stage F Canceled by user.', 'UPLOAD_CANCELED');
        }
        throw new FirebaseApiError(
          502,
          `Stage F Failed (Cloudflare R2 Upload): ${err?.message || 'Network error during upload'} | Endpoint: PUT ${safeEndpoint}`,
          'UPLOAD_NETWORK_ERROR'
        );
      });
  }

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let state: 'running' | 'canceled' | 'done' = 'running';
    let settled = false;

    const controller: UploadTaskController = {
      cancel: () => {
        if (settled) return;
        state = 'canceled';
        xhr.abort();
      },
      getState: () => state
    };
    params.onTaskCreated?.(controller);

    xhr.open('PUT', params.signedUrl, true);
    xhr.timeout = 45_000;
    for (const [headerName, headerValue] of Object.entries(uploadHeaders)) {
      xhr.setRequestHeader(headerName, headerValue);
    }

    xhr.upload.onprogress = (event) => {
      if (settled) return;
      if (event.lengthComputable && event.total > 0) {
        const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
        params.onProgress?.(pct);
      }
    };

    xhr.onload = () => {
      if (settled) return;
      settled = true;
      state = 'done';
      params.onTaskCreated?.(null);

      if (xhr.status >= 200 && xhr.status < 300) {
        params.onProgress?.(100);
        resolve();
        return;
      }

      const rawBody = xhr.responseText || xhr.statusText || '';
      reject(
        new FirebaseApiError(
          xhr.status || 502,
          classifyStorageUploadError(xhr.status || 502, rawBody, params.signedUrl),
          `R2_UPLOAD_HTTP_${xhr.status || 502}`
        )
      );
    };

    xhr.onerror = () => {
      if (settled) return;
      settled = true;
      state = 'done';
      params.onTaskCreated?.(null);
      reject(
        new FirebaseApiError(
          502,
          `Stage F Failed (Network / CORS Error): Could not reach Cloudflare R2 presigned upload endpoint (verify R2 bucket CORS policy allows PUT from ${typeof window !== 'undefined' ? window.location.origin : 'this origin'}). | Endpoint: PUT ${safeEndpoint}`,
          'UPLOAD_NETWORK_ERROR'
        )
      );
    };

    xhr.ontimeout = () => {
      if (settled) return;
      settled = true;
      state = 'done';
      params.onTaskCreated?.(null);
      reject(
        new FirebaseApiError(
          504,
          `Stage F Failed (Upload Timeout): Upload timed out after 45 seconds. | Endpoint: PUT ${safeEndpoint}`,
          'UPLOAD_TIMEOUT'
        )
      );
    };

    xhr.onabort = () => {
      if (settled) return;
      settled = true;
      state = 'canceled';
      params.onTaskCreated?.(null);
      reject(
        new FirebaseApiError(499, 'Stage F Canceled by user.', 'UPLOAD_CANCELED')
      );
    };

    xhr.send(uploadBody);
  });
}

const FIRESTORE_PROOF_CHUNK_BYTES = 450 * 1024;
const FIRESTORE_PROOF_MARKER = '_fs.';

export function isFirestoreProofPath(storagePath: string): boolean {
  return typeof storagePath === 'string' && storagePath.includes(FIRESTORE_PROOF_MARKER);
}

export function detectProofMimeTypeFromBytes(
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

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  return new Uint8Array(await new Response(blob).arrayBuffer());
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const sliceSize = 8192;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += sliceSize) {
    const end = Math.min(offset + sliceSize, bytes.length);
    let chunk = '';
    for (let i = offset; i < end; i++) {
      chunk += String.fromCharCode(bytes[i]);
    }
    binary += chunk;
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function buildChunkDocId(index: number): string {
  return `chunk_${String(index).padStart(3, '0')}`;
}

async function deleteFirestoreProofDocuments(paymentRequestId: string, chunkCountHint?: number): Promise<void> {
  try {
    const chunksSnap = await getDocs(collection(db, 'payment_proof_files', paymentRequestId, 'chunks'));
    const deleteChunkPromises: Promise<void>[] = [];
    const seenIds = new Set<string>();
    chunksSnap.forEach((snapDoc) => {
      seenIds.add(snapDoc.id);
      deleteChunkPromises.push(
        deleteDoc(doc(db, 'payment_proof_files', paymentRequestId, 'chunks', snapDoc.id)).catch(() => {})
      );
    });
    if (typeof chunkCountHint === 'number' && chunkCountHint > 0) {
      for (let i = 0; i < chunkCountHint; i++) {
        const cid = buildChunkDocId(i);
        if (!seenIds.has(cid)) {
          deleteChunkPromises.push(
            deleteDoc(doc(db, 'payment_proof_files', paymentRequestId, 'chunks', cid)).catch(() => {})
          );
        }
      }
    }
    await Promise.all(deleteChunkPromises);
    await deleteDoc(doc(db, 'payment_proof_files', paymentRequestId)).catch(() => {});
  } catch (err) {
    console.warn('[subscriptionService] Failed to delete Firestore proof chunks:', err);
  }
}

async function uploadProofToFirestorePrivateStorage(params: {
  institutionId: string;
  userId: string;
  paymentRequestId: string;
  prepared: PreparedPaymentProof;
  onStageChange?: (stage: 'preparing' | 'uploading' | 'paused' | 'verifying') => void;
  onProgress?: (progressPercent: number) => void;
  onTaskCreated?: (task: UploadTaskController | null) => void;
}): Promise<{
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  compressed: boolean;
  fileSize: number;
}> {
  const bytes = await readBlobBytes(params.prepared.blob);
  if (bytes.length <= 0 || bytes.length > MAX_STORAGE_PROOF_BYTES) {
    throw new FirebaseApiError(
      400,
      'Stage B Failed (File Size): Payment proof must be between 1 byte and 5 MB.',
      'FILE_TOO_LARGE'
    );
  }

  const detectedMime = detectProofMimeTypeFromBytes(bytes);
  if (!detectedMime) {
    throw new FirebaseApiError(
      400,
      'Stage B Failed (File Format): File content is not a valid JPG, PNG, or PDF document.',
      'INVALID_FILE_SIGNATURE'
    );
  }

  const canonicalMimeType = detectedMime;
  const ext = canonicalMimeType === 'image/png' ? 'png' : canonicalMimeType === 'application/pdf' ? 'pdf' : 'jpg';
  const safeName = sanitizeFileName(params.prepared.fileName);
  const storagePath = `payment_proofs/${params.institutionId}/${params.userId}/${params.paymentRequestId}_fs.${ext}`;
  const chunkCount = Math.max(1, Math.ceil(bytes.length / FIRESTORE_PROOF_CHUNK_BYTES));

  let canceled = false;
  let state: 'running' | 'canceled' | 'done' = 'running';
  params.onTaskCreated?.({
    cancel: () => {
      canceled = true;
      state = 'canceled';
    },
    getState: () => state
  });

  params.onStageChange?.('uploading');
  params.onProgress?.(5);

  let wroteChunks = 0;
  try {
    await setDoc(
      doc(db, 'payment_proof_files', params.paymentRequestId),
      cleanFirestoreData({
        paymentRequestId: params.paymentRequestId,
        institutionId: params.institutionId,
        userId: params.userId,
        storagePath,
        fileName: safeName,
        mimeType: canonicalMimeType,
        sizeBytes: bytes.length,
        chunkCount,
        createdAt: new Date().toISOString()
      })
    );

    params.onProgress?.(15);

    for (let i = 0; i < chunkCount; i++) {
      if (canceled) {
        throw new FirebaseApiError(499, 'Stage F Canceled by user.', 'UPLOAD_CANCELED');
      }
      const start = i * FIRESTORE_PROOF_CHUNK_BYTES;
      const end = Math.min(start + FIRESTORE_PROOF_CHUNK_BYTES, bytes.length);
      const dataBase64 = uint8ArrayToBase64(bytes.subarray(start, end));

      await setDoc(
        doc(db, 'payment_proof_files', params.paymentRequestId, 'chunks', buildChunkDocId(i)),
        cleanFirestoreData({
          chunkIndex: i,
          dataBase64
        })
      );
      wroteChunks = i + 1;

      const pct = Math.min(98, 15 + Math.round(((i + 1) / chunkCount) * 80));
      params.onProgress?.(pct);
    }

    if (canceled) {
      throw new FirebaseApiError(499, 'Stage F Canceled by user.', 'UPLOAD_CANCELED');
    }

    state = 'done';
    params.onTaskCreated?.(null);
    params.onStageChange?.('verifying');
    params.onProgress?.(100);

    return {
      storagePath,
      downloadUrl: '',
      fileName: params.prepared.fileName,
      mimeType: canonicalMimeType,
      compressed: params.prepared.compressed,
      fileSize: bytes.length
    };
  } catch (err: any) {
    state = canceled ? 'canceled' : 'done';
    params.onTaskCreated?.(null);
    await deleteFirestoreProofDocuments(params.paymentRequestId, wroteChunks || chunkCount);
    if (err instanceof FirebaseApiError) throw err;
    const code = err?.code || 'FIRESTORE_PROOF_UPLOAD_ERROR';
    throw new FirebaseApiError(
      code === 'permission-denied' ? 403 : 500,
      `Stage F Failed (Firestore Proof Upload) [${code}]: ${err?.message || 'Unable to store payment proof.'}`,
      code
    );
  }
}

export async function cleanupOrphanedPaymentProof(
  institutionId: string,
  storagePath: string,
  paymentRequestId?: string
): Promise<void> {
  if (!storagePath || !auth.currentUser) return;
  try {
    if (paymentRequestId && isFirestoreProofPath(storagePath)) {
      await deleteFirestoreProofDocuments(paymentRequestId);
      return;
    }
    const idToken = await getFreshIdToken();
    await postAuthorizedJson(
      '/api/payment-proof/cleanup',
      idToken,
      { institutionId, storagePath },
      'Orphan Cleanup'
    );
  } catch (err) {
    console.warn('[subscriptionService] Failed to clean up orphaned payment proof:', err);
  }
}

function shouldFallbackToFirestoreStorage(err: unknown): boolean {
  if (!(err instanceof FirebaseApiError)) return false;
  if (err.code === 'R2_NOT_CONFIGURED') return true;
  const workerConfigured = Boolean(getPaymentProofWorkerBaseUrl());
  if (!workerConfigured) {
    return (
      err.code === 'NON_JSON_HTML_RESPONSE' ||
      err.code === 'NETWORK_ERROR' ||
      err.status === 404
    );
  }
  return false;
}

export async function uploadPaymentProof(params: {
  institutionId: string;
  institutionName?: string;
  institutionOwnerId?: string;
  userId: string;
  paymentRequestId: string;
  file: File;
  onStageChange?: (stage: 'preparing' | 'uploading' | 'paused' | 'verifying') => void;
  onProgress?: (progressPercent: number) => void;
  onTaskCreated?: (task: UploadTaskController | null) => void;
}): Promise<{
  storagePath: string;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  compressed: boolean;
  fileSize: number;
}> {
  if (!isFirebaseConfigured) {
    throw new FirebaseApiError(503, 'Stage C Failed: Firebase Auth is not configured.', 'FIREBASE_NOT_CONFIGURED');
  }

  // Stage D: User authentication & fresh ID token
  const idToken = await getFreshIdToken();

  // Stage B: File validation & compression
  params.onStageChange?.('preparing');
  let prepared: PreparedPaymentProof;
  try {
    prepared = await preparePaymentProofFile(params.file);
  } catch (err) {
    throw new FirebaseApiError(
      400,
      `Stage B Failed (File Validation/Compression): ${err instanceof Error ? err.message : 'Invalid file'}`,
      'FILE_VALIDATION_ERROR'
    );
  }

  // Stage C & E: Try Cloudflare R2 upload authorization first; if R2 is not configured, use Firestore private storage
  let uploadTicket: {
    signedUrl: string;
    storagePath: string;
    bucket: string;
    canonicalMimeType: string;
    requiredHeaders?: Record<string, string>;
  };

  try {
    uploadTicket = await postAuthorizedJson<{
      signedUrl: string;
      storagePath: string;
      bucket: string;
      canonicalMimeType: string;
      requiredHeaders?: Record<string, string>;
    }>(
      '/api/payment-proof/upload-url',
      idToken,
      {
        institutionId: params.institutionId,
        paymentRequestId: params.paymentRequestId,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        fileSize: prepared.blob.size
      },
      'Stage C/E Failed (Upload Authorization)'
    );
  } catch (err) {
    if (shouldFallbackToFirestoreStorage(err)) {
      return await uploadProofToFirestorePrivateStorage({
        institutionId: params.institutionId,
        userId: params.userId,
        paymentRequestId: params.paymentRequestId,
        prepared,
        onStageChange: params.onStageChange,
        onProgress: params.onProgress,
        onTaskCreated: params.onTaskCreated
      });
    }
    throw err;
  }

  const validatedSignedUrl = assertValidSignedUploadUrl(uploadTicket?.signedUrl);
  const canonicalMimeType = uploadTicket.canonicalMimeType || prepared.mimeType;

  // Stage F: Direct presigned PUT upload of raw file Blob to private Cloudflare R2 bucket
  params.onStageChange?.('uploading');
  params.onProgress?.(0);

  await uploadBlobWithProgress({
    signedUrl: validatedSignedUrl,
    blob: prepared.blob,
    mimeType: canonicalMimeType,
    requiredHeaders: uploadTicket.requiredHeaders,
    onProgress: params.onProgress,
    onTaskCreated: params.onTaskCreated
  });

  // Stage G: Server-side verification of uploaded R2 object existence, size, and binary magic bytes
  params.onStageChange?.('verifying');
  const verified = await postAuthorizedJson<{
    verified: boolean;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
  }>(
    '/api/payment-proof/verify',
    idToken,
    {
      institutionId: params.institutionId,
      paymentRequestId: params.paymentRequestId,
      storagePath: uploadTicket.storagePath,
      expectedMimeType: canonicalMimeType
    },
    'Stage G Failed (Server File Verification)'
  );

  return {
    storagePath: verified.storagePath || uploadTicket.storagePath,
    downloadUrl: '',
    fileName: prepared.fileName,
    mimeType: verified.mimeType || canonicalMimeType,
    compressed: prepared.compressed,
    fileSize: verified.sizeBytes || prepared.blob.size
  };
}

export async function fetchSubscriptionStatus(institutionId: string): Promise<{
  serverNowMs: number;
  subscriptions: SubscriptionRecord[];
  paymentRequests: PaymentRequestRecord[];
  notifications: NotificationRecord[];
}> {
  if (!isFirebaseConfigured) {
    throw new FirebaseApiError(503, 'Firebase is not configured.', 'NOT_CONFIGURED');
  }
  if (!auth.currentUser) {
    throw new FirebaseApiError(401, 'Authentication required to fetch subscription status.', 'AUTH_REQUIRED');
  }

  const runQuery = async <T,>(collectionName: string): Promise<T[]> => {
    try {
      const snap = await getDocs(
        query(collection(db, collectionName), where('institutionId', '==', institutionId))
      );
      const items: T[] = [];
      snap.forEach((d) => items.push(d.data() as T));
      return items;
    } catch (err: any) {
      const code = err?.code || 'FIRESTORE_QUERY_ERROR';
      const msg = err?.message || `Failed reading ${collectionName}`;
      throw new FirebaseApiError(
        code === 'permission-denied' ? 403 : 503,
        `Firestore query on "${collectionName}" failed [${code}]: ${msg}`,
        code
      );
    }
  };

  const [subscriptions, paymentRequests, notifications] = await Promise.all([
    runQuery<SubscriptionRecord>('subscriptions'),
    runQuery<PaymentRequestRecord>('payment_requests'),
    runQuery<NotificationRecord>('notifications')
  ]);

  return {
    serverNowMs: Date.now(),
    subscriptions,
    paymentRequests,
    notifications
  };
}

export async function submitPaymentRequest(params: {
  paymentRequestId?: string;
  institutionId: string;
  institutionOwnerId?: string;
  institutionName: string;
  userId: string;
  userEmail: string;
  transactionReferenceId?: string | null;
  file?: File;
  existingScreenshotStoragePath?: string;
  existingScreenshotFileName?: string;
  existingScreenshotMimeType?: string;
  existingScreenshotSizeBytes?: number;
  onStageChange?: (stage: 'preparing' | 'uploading' | 'paused' | 'verifying' | 'saving') => void;
  onUploadProgress?: (percent: number) => void;
  onUploadTaskCreated?: (task: UploadTaskController | null) => void;
  onUploaded?: (uploaded: {
    paymentRequestId: string;
    screenshotStoragePath: string;
    screenshotFileName: string;
    screenshotMimeType: string;
    screenshotSizeBytes: number;
  }) => void;
  onOrphanCleaned?: () => void;
}): Promise<PaymentRequestRecord> {
  const trimmedTxn = (params.transactionReferenceId ?? '').trim();
  const paymentRequestId = params.paymentRequestId || makeUuid();
  let storagePath = params.existingScreenshotStoragePath || '';
  let fileName = params.existingScreenshotFileName || params.file?.name || 'proof';
  let mimeType = params.existingScreenshotMimeType || params.file?.type || 'image/jpeg';
  let fileSize = params.existingScreenshotSizeBytes || params.file?.size || 0;
  let uploadedThisAttempt = false;

  if (!storagePath) {
    if (!params.file) {
      throw new Error('Please upload a payment screenshot or PDF receipt.');
    }
    const uploaded = await uploadPaymentProof({
      institutionId: params.institutionId,
      institutionName: params.institutionName,
      institutionOwnerId: params.institutionOwnerId,
      userId: params.userId,
      paymentRequestId,
      file: params.file,
      onStageChange: params.onStageChange,
      onProgress: params.onUploadProgress,
      onTaskCreated: params.onUploadTaskCreated
    });
    storagePath = uploaded.storagePath;
    fileName = uploaded.fileName;
    mimeType = uploaded.mimeType;
    fileSize = uploaded.fileSize;
    uploadedThisAttempt = true;

    params.onUploaded?.({
      paymentRequestId,
      screenshotStoragePath: storagePath,
      screenshotFileName: fileName,
      screenshotMimeType: mimeType,
      screenshotSizeBytes: fileSize
    });
  } else {
    params.onUploadProgress?.(100);
  }

  params.onStageChange?.('saving');
  const now = new Date().toISOString();

  const record: PaymentRequestRecord = {
    paymentRequestId,
    institutionId: params.institutionId,
    institutionName: params.institutionName,
    userId: params.userId,
    userEmail: params.userEmail,
    planId: 'Exam Planner Access',
    amount: SUBSCRIPTION_PLAN.amount,
    currency: 'INR',
    upiId: 'BHARATPE2N0Y0H9Z0B84598@unitype',
    transactionReferenceId: trimmedTxn || null,
    screenshotStoragePath: storagePath,
    screenshotFileName: fileName,
    screenshotMimeType: mimeType,
    screenshotSizeBytes: fileSize,
    status: 'pending',
    subscriptionId: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    submittedAt: now
  };

  try {
    await setDoc(doc(db, 'payment_requests', paymentRequestId), cleanFirestoreData(record));
  } catch (err: any) {
    if (uploadedThisAttempt && storagePath) {
      await cleanupOrphanedPaymentProof(params.institutionId, storagePath, paymentRequestId);
      params.onOrphanCleaned?.();
    }
    const code = err?.code || 'FIRESTORE_WRITE_ERROR';
    throw new FirebaseApiError(
      400,
      `Stage H Failed (Firestore Payment Request Save) [${code}]: ${err?.message || 'Permission denied or network error'}`,
      code
    );
  }

  return record;
}

export async function getPaymentProofUrl(
  storagePath: string,
  paymentRequestId?: string,
  scope: 'admin' | 'institution' = 'institution'
): Promise<string> {
  if (!storagePath) {
    throw new Error('Payment proof storage path is missing.');
  }
  if (!paymentRequestId) {
    throw new Error('Payment request ID is required to generate a secure signed preview URL.');
  }

  if (isFirestoreProofPath(storagePath)) {
    if (scope === 'admin') {
      await assertStrictAdminClient();
    } else if (!auth.currentUser) {
      throw new FirebaseApiError(401, 'Authentication required to view payment proof.', 'AUTH_REQUIRED');
    }

    const fileSnap = await getDoc(doc(db, 'payment_proof_files', paymentRequestId));
    if (!fileSnap.exists()) {
      throw new Error('Stored payment proof record was not found in Firestore.');
    }
    const meta = fileSnap.data() as {
      mimeType?: string;
      chunkCount?: number;
      sizeBytes?: number;
    };
    const chunkCount = Number(meta?.chunkCount || 0);
    if (!Number.isInteger(chunkCount) || chunkCount <= 0) {
      throw new Error('Stored payment proof metadata is invalid.');
    }

    const chunkSnaps = await Promise.all(
      Array.from({ length: chunkCount }, (_, i) =>
        getDoc(doc(db, 'payment_proof_files', paymentRequestId, 'chunks', buildChunkDocId(i)))
      )
    );

    const decodedChunks: Uint8Array[] = [];
    let totalBytes = 0;
    for (let i = 0; i < chunkSnaps.length; i++) {
      const snap = chunkSnaps[i];
      if (!snap.exists()) {
        throw new Error(`Stored payment proof chunk ${i} is missing.`);
      }
      const chunkData = snap.data() as { dataBase64?: string };
      if (!chunkData?.dataBase64) {
        throw new Error(`Stored payment proof chunk ${i} is empty.`);
      }
      const decoded = base64ToUint8Array(chunkData.dataBase64);
      decodedChunks.push(decoded);
      totalBytes += decoded.length;
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of decodedChunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const blob = new Blob([merged], { type: meta?.mimeType || 'image/jpeg' });
    return URL.createObjectURL(blob);
  }

  const idToken = await getFreshIdToken();
  const endpoint =
    scope === 'admin'
      ? '/api/payment-proof/preview-url'
      : '/api/payment-proof/institution-preview-url';

  const result = await postAuthorizedJson<{ signedUrl: string }>(
    endpoint,
    idToken,
    {
      paymentRequestId,
      storagePath
    },
    'Proof Preview Failed'
  );

  if (!result.signedUrl) {
    throw new Error('Server did not return a valid signed preview URL.');
  }
  return result.signedUrl;
}

export async function markNotificationAsRead(
  institutionId: string,
  notificationId: string
): Promise<void> {
  const refDoc = doc(db, 'notifications', notificationId);
  await setDoc(refDoc, cleanFirestoreData({ read: true }), { merge: true });
}

export async function validateActiveSubscriptionForExam(
  institutionId: string,
  examType: string
): Promise<string> {
  if (!isAllowedExaminationType(examType)) {
    throw new Error('Invalid examination type selected.');
  }
  const status = await fetchSubscriptionStatus(institutionId);
  const active = status.subscriptions.find(
    (s) =>
      s.approvalStatus === 'approved' &&
      s.paymentStatus === 'approved' &&
      toMillis(s.expiresAt) > Date.now()
  );
  if (!active) {
    throw new Error(`An active ₹${SUBSCRIPTION_PLAN.amount} Exam Planner subscription is required to access this feature.`);
  }
  return active.subscriptionId;
}

async function assertStrictAdminClient(): Promise<void> {
  const user = auth.currentUser;
  if (!user || (user.email || '').trim().toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    throw new FirebaseApiError(403, 'Access denied: Only authorized administrator can access this panel.', 'FORBIDDEN');
  }
}

export async function fetchAdminDashboardData(): Promise<{
  stats: {
    totalInstitutions: number;
    totalPaymentRequests: number;
    pendingPayments: number;
    approvedPayments: number;
    rejectedPayments: number;
    activeSubscriptions: number;
    expiredSubscriptions: number;
    revokedSubscriptions: number;
    totalCollectedAmount: number;
  };
  institutions: InstitutionProfile[];
  paymentRequests: PaymentRequestRecord[];
  subscriptions: SubscriptionRecord[];
  auditLogs: AdminAuditLogRecord[];
  serverNowMs: number;
}> {
  await assertStrictAdminClient();

  const [instSnap, reqSnap, subSnap] = await Promise.all([
    getDocs(collection(db, 'institutions')).catch(() => ({ forEach: () => {} })),
    getDocs(collection(db, 'payment_requests')).catch(() => ({ forEach: () => {} })),
    getDocs(collection(db, 'subscriptions')).catch(() => ({ forEach: () => {} }))
  ]);

  const institutions: InstitutionProfile[] = [];
  instSnap.forEach((d) => institutions.push(d.data() as InstitutionProfile));

  const paymentRequests: PaymentRequestRecord[] = [];
  reqSnap.forEach((d) => paymentRequests.push(d.data() as PaymentRequestRecord));

  const subscriptions: SubscriptionRecord[] = [];
  subSnap.forEach((d) => subscriptions.push(d.data() as SubscriptionRecord));

  const pendingPayments = paymentRequests.filter((r) => r.status === 'pending').length;
  const approvedPayments = paymentRequests.filter((r) => r.status === 'approved').length;
  const rejectedPayments = paymentRequests.filter((r) => r.status === 'rejected').length;
  const activeSubscriptions = subscriptions.filter((s) => toMillis(s.expiresAt) > Date.now()).length;
  const totalCollectedAmount = paymentRequests
    .filter((r) => r.status === 'approved')
    .reduce((sum, r) => sum + (Number(r.amount) || SUBSCRIPTION_PLAN.amount), 0);

  return {
    stats: {
      totalInstitutions: institutions.length,
      totalPaymentRequests: paymentRequests.length,
      pendingPayments,
      approvedPayments,
      rejectedPayments,
      activeSubscriptions,
      expiredSubscriptions: subscriptions.length - activeSubscriptions,
      revokedSubscriptions: 0,
      totalCollectedAmount
    },
    institutions,
    paymentRequests,
    subscriptions,
    auditLogs: [],
    serverNowMs: Date.now()
  };
}

export async function approvePaymentRequest(params: {
  paymentRequestId: string;
}): Promise<string> {
  await assertStrictAdminClient();

  const reqRef = doc(db, 'payment_requests', params.paymentRequestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) {
    throw new Error('Payment request not found.');
  }
  const reqData = reqSnap.data() as PaymentRequestRecord;
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  // Subscription valid for exactly 15 days (SUBSCRIPTION_PLAN.validityMs)
  const expiresAt = new Date(nowMs + SUBSCRIPTION_PLAN.validityMs).toISOString();
  const subId = makeUuid();

  const reviewedByEmail = auth.currentUser?.email || ADMIN_EMAIL;
  await setDoc(
    reqRef,
    cleanFirestoreData({ status: 'approved', reviewedBy: reviewedByEmail, reviewedAt: now, subscriptionId: subId }),
    { merge: true }
  );

  const subRecord: SubscriptionRecord = {
    subscriptionId: subId,
    institutionId: reqData.institutionId,
    institutionName: reqData.institutionName,
    ownerId: reqData.userId,
    userEmail: reqData.userEmail,
    paymentRequestId: reqData.paymentRequestId,
    planName: 'Exam Planner Access',
    amount: Number(reqData.amount) || SUBSCRIPTION_PLAN.amount,
    currency: 'INR',
    paymentStatus: 'approved',
    approvalStatus: 'approved',
    activatedAt: now,
    expiresAt,
    examinationTypeLocked: false,
    lockedExaminationType: null,
    firstExaminationCreatedAt: null,
    firstExamId: null,
    approvedBy: auth.currentUser?.email || ADMIN_EMAIL,
    createdAt: now,
    updatedAt: now
  };

  await setDoc(doc(db, 'subscriptions', subId), cleanFirestoreData(subRecord));

  // Update institution profile active subscription
  await setDoc(
    doc(db, 'institutions', reqData.institutionId),
    cleanFirestoreData({
      activeSubscriptionId: subId,
      pendingPaymentRequestId: null,
      updatedAt: now
    }),
    { merge: true }
  );

  return subId;
}

export async function rejectPaymentRequest(params: {
  paymentRequestId: string;
  reason: string;
}): Promise<void> {
  await assertStrictAdminClient();

  const reqRef = doc(db, 'payment_requests', params.paymentRequestId);
  const reqSnap = await getDoc(reqRef);
  if (reqSnap.exists()) {
    const reqData = reqSnap.data() as PaymentRequestRecord;
    await setDoc(
      doc(db, 'institutions', reqData.institutionId),
      cleanFirestoreData({ pendingPaymentRequestId: null, updatedAt: new Date().toISOString() }),
      { merge: true }
    );
  }
  await setDoc(
    reqRef,
    cleanFirestoreData({ status: 'rejected', rejectionReason: params.reason, reviewedAt: new Date().toISOString() }),
    { merge: true }
  );
}

export async function revokeSubscription(params: {
  subscriptionId: string;
  reason: string;
}): Promise<void> {
  await assertStrictAdminClient();

  const subRef = doc(db, 'subscriptions', params.subscriptionId);
  await setDoc(
    subRef,
    cleanFirestoreData({ approvalStatus: 'revoked', revocationReason: params.reason, revokedAt: new Date().toISOString() }),
    { merge: true }
  );
}
