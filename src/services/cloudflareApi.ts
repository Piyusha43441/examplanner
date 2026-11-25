import {
  AdminAuditLogRecord,
  InstitutionProfile,
  NotificationRecord,
  PaymentRequestRecord,
  SubscriptionRecord
} from '../core/types';
import { auth } from '../firebase/config';

export class CloudflareApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, message: string, code = 'API_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getCloudflareApiBase(): string {
  const configured = (import.meta.env.VITE_CLOUDFLARE_API_URL as string | undefined) || '';
  return configured.trim().replace(/\/+$/, '');
}

export function buildCloudflareUrl(path: string): string {
  const base = getCloudflareApiBase();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

async function getIdTokenOrThrow(): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new CloudflareApiError(
      401,
      'Authentication session is missing or expired. Please sign in again and retry.',
      'UNAUTHORIZED'
    );
  }
  try {
    return await currentUser.getIdToken();
  } catch {
    throw new CloudflareApiError(
      401,
      'Authentication session expired. Please sign in again and retry.',
      'TOKEN_REFRESH_FAILED'
    );
  }
}

async function parseJsonSafe(res: Response): Promise<Record<string, unknown> | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function requestCloudflareJson<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: unknown;
    requireAuth?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const { method = 'GET', body, requireAuth = true, timeoutMs = 20_000 } = options;
  const headers: Record<string, string> = {};
  if (requireAuth) {
    const token = await getIdTokenOrThrow();
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer =
    controller && timeoutMs > 0
      ? globalThis.setTimeout(() => controller.abort(), timeoutMs)
      : null;

  let res: Response;
  try {
    res = await fetch(buildCloudflareUrl(path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: controller?.signal
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new CloudflareApiError(
        408,
        'Request to the Cloudflare backend timed out. Please check your connection and try again.',
        'REQUEST_TIMEOUT'
      );
    }
    throw new CloudflareApiError(
      0,
      'Unable to reach the Cloudflare backend. Check your network connection or VITE_CLOUDFLARE_API_URL configuration.',
      'NETWORK_ERROR'
    );
  } finally {
    if (timer !== null) {
      globalThis.clearTimeout(timer);
    }
  }

  const parsed = await parseJsonSafe(res);
  if (!res.ok) {
    const msg =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      `Cloudflare API returned status ${res.status}.`;
    const code = (parsed && typeof parsed.code === 'string' && parsed.code) || 'API_ERROR';
    throw new CloudflareApiError(res.status, msg, code);
  }

  if (parsed === null) {
    throw new CloudflareApiError(
      502,
      'Unexpected non-JSON response from Cloudflare API. Verify VITE_CLOUDFLARE_API_URL points to your deployed Worker.',
      'INVALID_API_RESPONSE'
    );
  }

  return parsed as unknown as T;
}

export interface CloudflareSubscriptionStatusResponse {
  serverNowMs: number;
  institutionId: string;
  effectiveStatus: 'none' | 'pending' | 'active' | 'expired' | 'rejected' | 'revoked';
  hasActiveAccess: boolean;
  activeSubscription: SubscriptionRecord | null;
  latestSubscription: SubscriptionRecord | null;
  pendingPaymentRequest: PaymentRequestRecord | null;
  latestPaymentRequest: PaymentRequestRecord | null;
  lockedExaminationType: string | null;
  remainingDays: number;
  remainingMs: number;
  subscriptions: SubscriptionRecord[];
  paymentRequests: PaymentRequestRecord[];
  notifications: NotificationRecord[];
  unreadNotificationCount: number;
}

export async function fetchSubscriptionStatusFromCloudflare(
  institutionId: string,
  institutionName?: string
): Promise<CloudflareSubscriptionStatusResponse> {
  const qs = new URLSearchParams({ institutionId });
  if (institutionName) {
    qs.set('institutionName', institutionName);
  }
  return requestCloudflareJson<CloudflareSubscriptionStatusResponse>(
    `/api/subscription/status?${qs.toString()}`
  );
}

export async function markNotificationReadOnCloudflare(notificationId: string): Promise<void> {
  await requestCloudflareJson<{ ok: boolean }>(
    `/api/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: 'POST', body: {} }
  );
}

export interface R2UploadTaskController {
  pause: () => boolean;
  resume: () => boolean;
  cancel: () => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isRetryableUploadStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status !== 503);
}

export async function uploadProofToCloudflareR2(params: {
  institutionId: string;
  institutionName: string;
  paymentRequestId: string;
  blob: Blob;
  fileName: string;
  mimeType: string;
  onProgress?: (percent: number) => void;
  onTaskCreated?: (task: R2UploadTaskController | null) => void;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}): Promise<{
  paymentRequestId: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}> {
  const token = await getIdTokenOrThrow();
  const url = buildCloudflareUrl('/api/payment/upload');
  const maxRetries = Math.max(0, params.maxRetries ?? 2);
  const retryBaseDelayMs = Math.max(10, params.retryBaseDelayMs ?? 1200);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await sleep(retryBaseDelayMs * Math.pow(2, attempt - 1));
    }

    try {
      const result = await new Promise<{
        paymentRequestId: string;
        objectKey: string;
        fileName: string;
        mimeType: string;
        fileSize: number;
      }>((resolve, reject) => {
        const formData = new FormData();
        formData.append('institutionId', params.institutionId);
        formData.append('institutionName', params.institutionName);
        formData.append('paymentRequestId', params.paymentRequestId);
        formData.append('file', params.blob, params.fileName);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.timeout = 120_000;

        params.onTaskCreated?.({
          pause: () => false,
          resume: () => false,
          cancel: () => {
            xhr.abort();
            return true;
          }
        });

        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable && evt.total > 0) {
            const pct = Math.min(99, Math.max(0, Math.round((evt.loaded / evt.total) * 100)));
            params.onProgress?.(pct);
          }
        };

        xhr.onload = () => {
          params.onTaskCreated?.(null);
          let data: Record<string, unknown> | null = null;
          try {
            data = xhr.responseText ? (JSON.parse(xhr.responseText) as Record<string, unknown>) : null;
          } catch {
            data = null;
          }

          if (xhr.status >= 200 && xhr.status < 300 && data && typeof data.objectKey === 'string') {
            params.onProgress?.(100);
            resolve({
              paymentRequestId: String(data.paymentRequestId || params.paymentRequestId),
              objectKey: data.objectKey,
              fileName: String(data.fileName || params.fileName),
              mimeType: String(data.mimeType || params.mimeType),
              fileSize: Number(data.fileSize || params.blob.size)
            });
            return;
          }

          const message =
            (data && typeof data.error === 'string' && data.error) ||
            `Payment proof upload failed (HTTP ${xhr.status}).`;
          const code = (data && typeof data.code === 'string' && data.code) || 'UPLOAD_FAILED';
          reject(new CloudflareApiError(xhr.status, message, code));
        };

        xhr.onerror = () => {
          params.onTaskCreated?.(null);
          reject(
            new CloudflareApiError(
              0,
              'Network interruption while uploading payment proof. Please check your connection and retry.',
              'NETWORK_INTERRUPTED'
            )
          );
        };

        xhr.ontimeout = () => {
          params.onTaskCreated?.(null);
          reject(
            new CloudflareApiError(
              408,
              'Payment proof upload timed out. Please retry the upload.',
              'UPLOAD_TIMEOUT'
            )
          );
        };

        xhr.onabort = () => {
          params.onTaskCreated?.(null);
          reject(new CloudflareApiError(499, 'Payment proof upload was canceled.', 'UPLOAD_CANCELED'));
        };

        xhr.send(formData);
      });

      return result;
    } catch (err) {
      if (
        err instanceof CloudflareApiError &&
        err.code !== 'UPLOAD_CANCELED' &&
        attempt < maxRetries &&
        isRetryableUploadStatus(err.status)
      ) {
        continue;
      }
      throw err;
    }
  }

  throw new CloudflareApiError(500, 'Payment proof upload failed after retries.', 'UPLOAD_FAILED');
}

export async function submitPaymentToCloudflare(params: {
  paymentRequestId: string;
  institutionId: string;
  institutionName: string;
  transactionReferenceId?: string | null;
  objectKey: string;
  fileName: string;
  mimeType: string;
}): Promise<PaymentRequestRecord> {
  const res = await requestCloudflareJson<{ paymentRequest: PaymentRequestRecord; message: string }>(
    '/api/payment/submit',
    {
      method: 'POST',
      body: params
    }
  );
  return res.paymentRequest;
}

export async function fetchProofBlobUrlFromCloudflare(
  paymentRequestId: string,
  adminView = true
): Promise<string> {
  const token = await getIdTokenOrThrow();
  const endpoint = adminView
    ? `/api/admin/payment/${encodeURIComponent(paymentRequestId)}/proof`
    : `/api/payment/proof/${encodeURIComponent(paymentRequestId)}`;

  const res = await fetch(buildCloudflareUrl(endpoint), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    },
    cache: 'no-store'
  });

  if (!res.ok) {
    const parsed = await parseJsonSafe(res);
    const msg =
      (parsed && typeof parsed.error === 'string' && parsed.error) ||
      `Unable to load payment proof (HTTP ${res.status}).`;
    throw new CloudflareApiError(res.status, msg);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export interface CloudflareAdminDashboardResponse {
  serverNowMs: number;
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
}

export async function fetchAdminDashboardFromCloudflare(): Promise<CloudflareAdminDashboardResponse> {
  return requestCloudflareJson<CloudflareAdminDashboardResponse>('/api/admin/dashboard');
}

export async function approvePaymentOnCloudflare(paymentRequestId: string): Promise<string> {
  const res = await requestCloudflareJson<{ subscriptionId: string }>(
    `/api/admin/payment/${encodeURIComponent(paymentRequestId)}/approve`,
    { method: 'POST', body: {} }
  );
  return res.subscriptionId;
}

export async function rejectPaymentOnCloudflare(
  paymentRequestId: string,
  reason: string
): Promise<void> {
  await requestCloudflareJson<{ ok: boolean }>(
    `/api/admin/payment/${encodeURIComponent(paymentRequestId)}/reject`,
    { method: 'POST', body: { reason } }
  );
}

export async function revokeSubscriptionOnCloudflare(
  subscriptionId: string,
  reason: string
): Promise<void> {
  await requestCloudflareJson<{ ok: boolean }>(
    `/api/admin/subscription/${encodeURIComponent(subscriptionId)}/revoke`,
    { method: 'POST', body: { reason } }
  );
}

export async function verifyExamFeatureAccessOnCloudflare(
  institutionId: string,
  examType?: string
): Promise<{
  authorized: boolean;
  subscriptionId: string;
  expiresAt: number;
  examinationTypeLocked: boolean;
  lockedExaminationType: string | null;
}> {
  return requestCloudflareJson('/api/examinations/verify-access', {
    method: 'POST',
    body: { institutionId, examType }
  });
}

export async function authorizeExamCreateOnCloudflare(params: {
  institutionId: string;
  examId: string;
  examType: string;
  requestId: string;
}): Promise<{
  authorized: boolean;
  requestId: string;
  subscriptionId: string;
  examType: string;
  alreadyLocked: boolean;
}> {
  return requestCloudflareJson('/api/examinations/authorize-create', {
    method: 'POST',
    body: params
  });
}

export async function confirmExamCreatedOnCloudflare(params: {
  institutionId: string;
  requestId: string;
  examId: string;
  examType: string;
}): Promise<{
  confirmed: boolean;
  subscriptionId: string;
  examinationTypeLocked: boolean;
  lockedExaminationType: string;
}> {
  return requestCloudflareJson('/api/examinations/confirm-create', {
    method: 'POST',
    body: params
  });
}

export async function abortExamCreateOnCloudflare(params: {
  institutionId: string;
  requestId: string;
}): Promise<void> {
  try {
    await requestCloudflareJson('/api/examinations/abort-create', {
      method: 'POST',
      body: params,
      timeoutMs: 6000
    });
  } catch {
    // Non-blocking cleanup; lease also expires automatically server-side
  }
}
