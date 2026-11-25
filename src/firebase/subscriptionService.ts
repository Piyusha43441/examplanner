import {
  isAllowedExaminationType
} from '../core/subscriptionConstants';
import {
  AdminAuditLogRecord,
  InstitutionProfile,
  PaymentRequestRecord,
  SubscriptionRecord
} from '../core/types';
import {
  approvePaymentOnCloudflare,
  buildCloudflareUrl,
  CloudflareApiError,
  fetchAdminDashboardFromCloudflare,
  fetchProofBlobUrlFromCloudflare,
  markNotificationReadOnCloudflare,
  R2UploadTaskController,
  rejectPaymentOnCloudflare,
  revokeSubscriptionOnCloudflare,
  submitPaymentToCloudflare,
  uploadProofToCloudflareR2,
  verifyExamFeatureAccessOnCloudflare
} from '../services/cloudflareApi';
import { auth } from './config';

export async function fetchServerNowMs(): Promise<number> {
  try {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), 3000);
    const res = await fetch(buildCloudflareUrl('/api/server-time'), {
      cache: 'no-store',
      signal: controller.signal
    });
    globalThis.clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { nowMs?: number };
      if (typeof data.nowMs === 'number' && Number.isFinite(data.nowMs)) {
        return data.nowMs;
      }
    }
  } catch {
    // Fallback if offline or timeout
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
  if (typeof val === 'object') {
    const maybeTs = val as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybeTs.toMillis === 'function') {
      return maybeTs.toMillis();
    }
    if (typeof maybeTs.seconds === 'number') {
      return maybeTs.seconds * 1000 + Math.floor((maybeTs.nanoseconds ?? 0) / 1_000_000);
    }
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
  if (err instanceof CloudflareApiError) {
    return err.message;
  }
  if (!(err instanceof Error)) {
    return 'Unable to submit payment request. Please try again.';
  }
  const raw = err.message || '';
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed && typeof parsed.error === 'string') {
      return parsed.error;
    }
  } catch {
    // Non-JSON error message
  }
  return raw || 'Unable to submit payment request. Please try again.';
}

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

  // Never compress PDFs
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

  // Small images upload fast as-is without quality loss
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
        throw new Error(
          'Screenshot remains larger than 5 MB after optimization. Please upload a smaller image or PDF.'
        );
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
  } catch (err) {
    if (file.size <= MAX_STORAGE_PROOF_BYTES) {
      return {
        blob: file,
        fileName: file.name,
        mimeType,
        compressed: false,
        originalSize: file.size,
        finalSize: file.size
      };
    }
    throw err instanceof Error ? err : new Error('Unable to process payment screenshot.');
  } finally {
    decoded?.cleanup();
  }
}

export type UploadTaskController = R2UploadTaskController;

function makeClientRequestId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export async function uploadPaymentProof(params: {
  institutionId: string;
  institutionName?: string;
  institutionOwnerId?: string;
  userId: string;
  paymentRequestId: string;
  file: File;
  onStageChange?: (stage: 'preparing' | 'uploading' | 'paused') => void;
  onProgress?: (progressPercent: number) => void;
  onTaskCreated?: (task: UploadTaskController | null) => void;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}): Promise<{
  storagePath: string;
  fileName: string;
  mimeType: string;
  compressed: boolean;
  fileSize: number;
}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('No internet connection detected. Please check your network and try again.');
  }

  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== params.userId) {
    throw new Error('Authentication session is missing or expired. Please sign in again and retry.');
  }

  if (params.institutionOwnerId && params.institutionOwnerId !== params.userId) {
    throw new Error(
      'Institution ownership verification failed. You can only upload payment proofs for your own institution.'
    );
  }

  params.onStageChange?.('preparing');
  const prepared = await preparePaymentProofFile(params.file);

  params.onStageChange?.('uploading');
  params.onProgress?.(0);

  const uploaded = await uploadProofToCloudflareR2({
    institutionId: params.institutionId,
    institutionName: params.institutionName || 'Institution',
    paymentRequestId: params.paymentRequestId,
    blob: prepared.blob,
    fileName: prepared.fileName,
    mimeType: prepared.mimeType,
    onProgress: params.onProgress,
    onTaskCreated: params.onTaskCreated,
    maxRetries: params.maxRetries,
    retryBaseDelayMs: params.retryBaseDelayMs
  });

  return {
    storagePath: uploaded.objectKey,
    fileName: uploaded.fileName,
    mimeType: uploaded.mimeType,
    compressed: prepared.compressed,
    fileSize: uploaded.fileSize
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
  maxUploadRetries?: number;
  retryBaseDelayMs?: number;
  onStageChange?: (stage: 'preparing' | 'uploading' | 'paused' | 'saving') => void;
  onUploadProgress?: (percent: number) => void;
  onUploadTaskCreated?: (task: UploadTaskController | null) => void;
  onUploaded?: (uploaded: {
    paymentRequestId: string;
    screenshotStoragePath: string;
    screenshotFileName: string;
    screenshotMimeType: string;
  }) => void;
}): Promise<PaymentRequestRecord> {
  const trimmedTxn = (params.transactionReferenceId ?? '').trim();
  if (trimmedTxn.length > 120) {
    throw new Error('UPI Transaction ID must not exceed 120 characters.');
  }

  const paymentRequestId = params.paymentRequestId || makeClientRequestId('payreq');
  let objectKey = params.existingScreenshotStoragePath || '';
  let fileName = params.existingScreenshotFileName || params.file?.name || 'proof';
  let mimeType = params.existingScreenshotMimeType || params.file?.type || 'image/jpeg';

  if (!objectKey) {
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
      onTaskCreated: params.onUploadTaskCreated,
      maxRetries: params.maxUploadRetries,
      retryBaseDelayMs: params.retryBaseDelayMs
    });
    objectKey = uploaded.storagePath;
    fileName = uploaded.fileName;
    mimeType = uploaded.mimeType;

    params.onUploaded?.({
      paymentRequestId,
      screenshotStoragePath: objectKey,
      screenshotFileName: fileName,
      screenshotMimeType: mimeType
    });
  } else {
    params.onUploadProgress?.(100);
  }

  params.onStageChange?.('saving');
  return submitPaymentToCloudflare({
    paymentRequestId,
    institutionId: params.institutionId,
    institutionName: params.institutionName,
    transactionReferenceId: trimmedTxn.length > 0 ? trimmedTxn : null,
    objectKey,
    fileName,
    mimeType
  });
}

export async function getPaymentProofUrl(
  _storagePath: string,
  paymentRequestId?: string,
  adminView = true
): Promise<string> {
  if (!paymentRequestId) {
    throw new Error('Payment request ID is required to stream proof from R2.');
  }
  return fetchProofBlobUrlFromCloudflare(paymentRequestId, adminView);
}

export async function markNotificationAsRead(
  _institutionId: string,
  notificationId: string
): Promise<void> {
  await markNotificationReadOnCloudflare(notificationId);
}

export async function validateActiveSubscriptionForExam(
  institutionId: string,
  examType: string
): Promise<string> {
  if (!isAllowedExaminationType(examType)) {
    throw new Error(
      'Invalid examination type selected. Choose one of the 6 supported examination types.'
    );
  }
  const result = await verifyExamFeatureAccessOnCloudflare(institutionId, examType);
  return result.subscriptionId;
}

// ---------------- ADMIN OPERATIONS (CLOUDFLARE D1 + R2) ----------------

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
  return fetchAdminDashboardFromCloudflare();
}

export async function approvePaymentRequest(params: {
  paymentRequestId: string;
}): Promise<string> {
  return approvePaymentOnCloudflare(params.paymentRequestId);
}

export async function rejectPaymentRequest(params: {
  paymentRequestId: string;
  reason: string;
}): Promise<void> {
  await rejectPaymentOnCloudflare(params.paymentRequestId, params.reason);
}

export async function revokeSubscription(params: {
  subscriptionId: string;
  reason: string;
}): Promise<void> {
  await revokeSubscriptionOnCloudflare(params.subscriptionId, params.reason);
}
