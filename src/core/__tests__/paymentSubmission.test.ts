import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudflareApiError } from '../../services/cloudflareApi';
import {
  approvePaymentRequest,
  fetchAdminDashboardData,
  formatPaymentErrorMessage,
  formatTransactionRefDisplay,
  getPaymentProofUrl,
  preparePaymentProofFile,
  submitPaymentRequest,
  uploadPaymentProof,
  validateProofFileBasic
} from '../../firebase/subscriptionService';

const mockBackend = vi.hoisted(() => ({
  institutions: new Map<string, Record<string, unknown>>(),
  r2Objects: new Map<string, { size: number; contentType: string; fileName: string }>(),
  paymentRequests: new Map<string, Record<string, unknown>>(),
  subscriptions: new Map<string, Record<string, unknown>>(),
  auditLogs: [] as Record<string, unknown>[],
  uploadBehavior: 'success' as
    | 'success'
    | 'transient-then-success'
    | 'network-interruption'
    | 'unauthorized',
  submitBehavior: 'success' as 'success' | 'permission-denied' | 'server-error',
  uploadCalls: 0,
  submitCalls: 0
}));

vi.mock('../../firebase/config', () => ({
  db: { __mockDb: true },
  auth: {
    currentUser: {
      uid: 'user_1',
      email: 'coord@school.edu',
      emailVerified: true,
      getIdToken: vi.fn().mockResolvedValue('mock-firebase-id-token')
    }
  },
  storage: { __mockStorage: true }
}));

class MockXMLHttpRequest {
  public timeout = 0;
  public status = 0;
  public responseText = '';
  public upload: {
    onprogress: ((evt: { lengthComputable: boolean; loaded: number; total: number }) => void) | null;
  } = { onprogress: null };
  public onload: (() => void) | null = null;
  public onerror: (() => void) | null = null;
  public ontimeout: (() => void) | null = null;
  public onabort: (() => void) | null = null;

  private method = 'POST';
  private url = '';
  private headers: Record<string, string> = {};
  private aborted = false;

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  send(body: FormData) {
    mockBackend.uploadCalls += 1;
    const callIdx = mockBackend.uploadCalls;

    queueMicrotask(() => {
      if (this.aborted) return;

      const file = body.get('file') as File | Blob | null;
      const total = file?.size || 1000;
      const instId = String(body.get('institutionId') || '');
      const payReqId = String(body.get('paymentRequestId') || '');

      if (mockBackend.uploadBehavior === 'unauthorized') {
        this.status = 403;
        this.responseText = JSON.stringify({
          error: 'You do not have permission to upload payment proof for this institution.',
          code: 'FORBIDDEN'
        });
        this.onload?.();
        return;
      }

      if (mockBackend.uploadBehavior === 'network-interruption') {
        this.upload.onprogress?.({ lengthComputable: true, loaded: Math.floor(total / 2), total });
        this.onerror?.();
        return;
      }

      if (mockBackend.uploadBehavior === 'transient-then-success' && callIdx === 1) {
        this.upload.onprogress?.({ lengthComputable: true, loaded: Math.floor(total / 3), total });
        this.onerror?.();
        return;
      }

      if (this.headers.Authorization !== 'Bearer mock-firebase-id-token' || !this.url.includes('/api/payment/upload')) {
        this.status = 401;
        this.responseText = JSON.stringify({ error: 'Unauthorized' });
        this.onload?.();
        return;
      }

      this.upload.onprogress?.({ lengthComputable: true, loaded: Math.floor(total / 2), total });
      this.upload.onprogress?.({ lengthComputable: true, loaded: total, total });

      const fileName = file && 'name' in file ? String(file.name) : 'proof.jpg';
      const objectKey = `payment-proofs/${instId}/user_1/${payReqId}_${fileName}`;
      const contentType = file?.type || 'image/jpeg';

      mockBackend.r2Objects.set(objectKey, {
        size: total,
        contentType,
        fileName
      });

      this.status = 200;
      this.responseText = JSON.stringify({
        paymentRequestId: payReqId,
        objectKey,
        fileName,
        mimeType: contentType,
        fileSize: total
      });
      this.onload?.();
    });
  }
}

function makeMockFile(name: string, sizeBytes: number, type: string): File {
  const bytes = new Uint8Array(Math.min(sizeBytes, 64));
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, 'size', { value: sizeBytes });
  return file;
}

describe('Cloudflare R2 & Worker Payment Submission, Resilience & Admin Approval', () => {
  beforeEach(() => {
    mockBackend.institutions.clear();
    mockBackend.r2Objects.clear();
    mockBackend.paymentRequests.clear();
    mockBackend.subscriptions.clear();
    mockBackend.auditLogs.length = 0;
    mockBackend.uploadBehavior = 'success';
    mockBackend.submitBehavior = 'success';
    mockBackend.uploadCalls = 0;
    mockBackend.submitCalls = 0;

    mockBackend.institutions.set('inst_1', {
      id: 'inst_1',
      ownerId: 'user_1',
      name: 'Springfield Academy'
    });

    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest as unknown as typeof XMLHttpRequest);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);

        if (url.endsWith('/api/payment/submit')) {
          mockBackend.submitCalls += 1;
          if (mockBackend.submitBehavior === 'permission-denied') {
            return new Response(
              JSON.stringify({
                error: 'You do not have permission to submit payment for this institution.',
                code: 'FORBIDDEN'
              }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (mockBackend.submitBehavior === 'server-error') {
            return new Response(
              JSON.stringify({ error: 'Temporary D1 write error.', code: 'SERVER_ERROR' }),
              { status: 500, headers: { 'Content-Type': 'application/json' } }
            );
          }

          const payload = JSON.parse(String(init?.body || '{}')) as {
            paymentRequestId: string;
            institutionId: string;
            institutionName: string;
            transactionReferenceId?: string | null;
            objectKey: string;
            fileName: string;
            mimeType: string;
          };

          const existing = mockBackend.paymentRequests.get(payload.paymentRequestId);
          if (existing) {
            return new Response(
              JSON.stringify({ paymentRequest: existing, message: 'Already recorded.' }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }

          const cleanTxn = (payload.transactionReferenceId ?? '').trim();
          const record = {
            paymentRequestId: payload.paymentRequestId,
            institutionId: payload.institutionId,
            institutionName: payload.institutionName,
            userId: 'user_1',
            userEmail: 'coord@school.edu',
            amount: 1,
            currency: 'INR',
            upiId: 'BHARATPE2N0Y0H9Z0B84598@unitype',
            transactionReferenceId: cleanTxn.length > 0 ? cleanTxn : null,
            screenshotStoragePath: payload.objectKey,
            screenshotFileName: payload.fileName,
            screenshotMimeType: payload.mimeType,
            status: 'pending',
            submittedAt: Date.now()
          };
          mockBackend.paymentRequests.set(payload.paymentRequestId, record);

          return new Response(
            JSON.stringify({ paymentRequest: record, message: 'Submitted' }),
            { status: 201, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (url.endsWith('/api/admin/dashboard')) {
          return new Response(
            JSON.stringify({
              serverNowMs: Date.now(),
              stats: {
                totalInstitutions: mockBackend.institutions.size,
                totalPaymentRequests: mockBackend.paymentRequests.size,
                pendingPayments: Array.from(mockBackend.paymentRequests.values()).filter(
                  (p) => p.status === 'pending'
                ).length,
                approvedPayments: Array.from(mockBackend.paymentRequests.values()).filter(
                  (p) => p.status === 'approved'
                ).length,
                rejectedPayments: 0,
                activeSubscriptions: mockBackend.subscriptions.size,
                expiredSubscriptions: 0,
                revokedSubscriptions: 0,
                totalCollectedAmount: mockBackend.subscriptions.size
              },
              institutions: Array.from(mockBackend.institutions.values()),
              paymentRequests: Array.from(mockBackend.paymentRequests.values()),
              subscriptions: Array.from(mockBackend.subscriptions.values()),
              auditLogs: mockBackend.auditLogs
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        const approveMatch = url.match(/\/api\/admin\/payment\/([^/]+)\/approve$/);
        if (approveMatch) {
          const payReqId = decodeURIComponent(approveMatch[1]);
          const pr = mockBackend.paymentRequests.get(payReqId);
          if (!pr) {
            return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
          }
          const subId = `sub_${payReqId}`;
          pr.status = 'approved';
          pr.subscriptionId = subId;
          mockBackend.subscriptions.set(subId, {
            subscriptionId: subId,
            institutionId: pr.institutionId,
            institutionName: pr.institutionName,
            ownerId: pr.userId,
            userEmail: pr.userEmail,
            paymentRequestId: payReqId,
            planName: 'Exam Planner Access',
            amount: 1,
            paymentStatus: 'approved',
            approvalStatus: 'approved',
            activatedAt: Date.now(),
            expiresAt: Date.now() + 15 * 24 * 60 * 60 * 1000,
            examinationTypeLocked: false,
            lockedExaminationType: null,
            approvedBy: 'agarwalpiyush263@gmail.com'
          });
          return new Response(JSON.stringify({ subscriptionId: subId }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        if (url.includes('/proof')) {
          return new Response(new Blob(['proof-bytes'], { type: 'image/jpeg' }), {
            status: 200,
            headers: { 'Content-Type': 'image/jpeg' }
          });
        }

        return new Response(JSON.stringify({ nowMs: Date.now() }), { status: 200 });
      })
    );
  });

  it('TEST 1: uploads PNG/JPG without UPI Transaction ID (saves null, status pending, tracks R2 progress)', async () => {
    const pngFile = makeMockFile('upi_receipt.png', 180_000, 'image/png');
    const stages: string[] = [];
    const progressValues: number[] = [];

    const record = await submitPaymentRequest({
      paymentRequestId: 'payreq_no_txn',
      institutionId: 'inst_1',
      institutionOwnerId: 'user_1',
      institutionName: 'Springfield Academy',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      transactionReferenceId: '   ',
      file: pngFile,
      onStageChange: (s) => stages.push(s),
      onUploadProgress: (p) => progressValues.push(p)
    });

    expect(record.status).toBe('pending');
    expect(record.amount).toBe(1);
    expect(record.transactionReferenceId).toBeNull();
    expect(record.screenshotStoragePath).toMatch(/^payment-proofs\/inst_1\/user_1\/payreq_no_txn_/);
    expect(stages).toEqual(['preparing', 'uploading', 'saving']);
    expect(progressValues[0]).toBe(0);
    expect(progressValues[progressValues.length - 1]).toBe(100);
    expect(mockBackend.r2Objects.has(record.screenshotStoragePath)).toBe(true);
    expect(mockBackend.subscriptions.size).toBe(0);

    const smallJpg = makeMockFile('small_upi.jpg', 95_000, 'image/jpeg');
    const preparedJpg = await preparePaymentProofFile(smallJpg);
    expect(preparedJpg.mimeType).toBe('image/jpeg');
    expect(preparedJpg.compressed).toBe(false);
    expect(preparedJpg.finalSize).toBe(95_000);
  });

  it('TEST 2: submits PDF receipt uncompressed with optional UPI Transaction ID and saves trimmed value', async () => {
    const file = makeMockFile('payment_slip.pdf', 220_000, 'application/pdf');

    const record = await submitPaymentRequest({
      paymentRequestId: 'payreq_with_txn',
      institutionId: 'inst_1',
      institutionName: 'Springfield Academy',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      transactionReferenceId: '  432910847512  ',
      file
    });

    expect(record.status).toBe('pending');
    expect(record.screenshotMimeType).toBe('application/pdf');
    expect(record.transactionReferenceId).toBe('432910847512');
    expect(mockBackend.paymentRequests.get('payreq_with_txn')?.transactionReferenceId).toBe('432910847512');
  });

  it('TEST 3: enforces 5 MB limit on PDFs, skips PDF compression, and rejects oversized raw images', async () => {
    const pdfFile = makeMockFile('receipt.pdf', 1_200_000, 'application/pdf');
    const preparedPdf = await preparePaymentProofFile(pdfFile);
    expect(preparedPdf.compressed).toBe(false);
    expect(preparedPdf.mimeType).toBe('application/pdf');
    expect(preparedPdf.finalSize).toBe(1_200_000);

    const oversizedPdf = makeMockFile('huge.pdf', 6 * 1024 * 1024, 'application/pdf');
    expect(validateProofFileBasic(oversizedPdf).valid).toBe(false);

    const nearLimitImage = makeMockFile('big_phone_shot.png', 4.8 * 1024 * 1024, 'image/png');
    expect(validateProofFileBasic(nearLimitImage).valid).toBe(true);

    const tooLargeScreenshot = makeMockFile('raw_4k.png', 18 * 1024 * 1024, 'image/png');
    expect(validateProofFileBasic(tooLargeScreenshot).valid).toBe(false);
  });

  it('TEST 4: recovers via bounded exponential backoff on transient XHR network interruption and avoids infinite retries', async () => {
    const file = makeMockFile('shot.jpg', 120_000, 'image/jpeg');

    mockBackend.uploadBehavior = 'transient-then-success';
    const recovered = await submitPaymentRequest({
      paymentRequestId: 'payreq_auto_recover',
      institutionId: 'inst_1',
      institutionName: 'Springfield Academy',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      file,
      maxUploadRetries: 2,
      retryBaseDelayMs: 10
    });

    expect(mockBackend.uploadCalls).toBe(2);
    expect(recovered.status).toBe('pending');

    mockBackend.uploadCalls = 0;
    mockBackend.uploadBehavior = 'network-interruption';
    await expect(
      submitPaymentRequest({
        paymentRequestId: 'payreq_net_fail',
        institutionId: 'inst_1',
        institutionName: 'Springfield Academy',
        userId: 'user_1',
        userEmail: 'coord@school.edu',
        file,
        maxUploadRetries: 2,
        retryBaseDelayMs: 10
      })
    ).rejects.toThrow(/Network interruption/i);
    expect(mockBackend.uploadCalls).toBe(3);

    mockBackend.uploadBehavior = 'success';
    const retriedAfterManual = await submitPaymentRequest({
      paymentRequestId: 'payreq_net_fail',
      institutionId: 'inst_1',
      institutionName: 'Springfield Academy',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      file
    });
    expect(retriedAfterManual.paymentRequestId).toBe('payreq_net_fail');
  });

  it('TEST 5: rejects unauthorized/ownership errors immediately without retrying R2 upload', async () => {
    const file = makeMockFile('shot.jpg', 120_000, 'image/jpeg');

    mockBackend.uploadBehavior = 'unauthorized';
    await expect(
      uploadPaymentProof({
        institutionId: 'inst_1',
        userId: 'user_1',
        paymentRequestId: 'payreq_denied',
        file,
        maxRetries: 2,
        retryBaseDelayMs: 10
      })
    ).rejects.toThrow(CloudflareApiError);
    expect(mockBackend.uploadCalls).toBe(1);

    mockBackend.uploadBehavior = 'success';
    await expect(
      submitPaymentRequest({
        paymentRequestId: 'payreq_wrong_owner',
        institutionId: 'inst_other',
        institutionOwnerId: 'user_other',
        institutionName: 'Other School',
        userId: 'user_1',
        userEmail: 'coord@school.edu',
        file
      })
    ).rejects.toThrow(/ownership verification failed/i);
  });

  it('TEST 6: retains uploaded R2 object key when D1 submit fails and retries save without re-uploading', async () => {
    const file = makeMockFile('shot.jpg', 120_000, 'image/jpeg');
    mockBackend.submitBehavior = 'permission-denied';

    let retainedUpload: {
      paymentRequestId: string;
      screenshotStoragePath: string;
      screenshotFileName: string;
      screenshotMimeType: string;
    } | null = null;

    let caughtErr: unknown;
    try {
      await submitPaymentRequest({
        paymentRequestId: 'payreq_d1_fail',
        institutionId: 'inst_1',
        institutionName: 'Springfield Academy',
        userId: 'user_1',
        userEmail: 'coord@school.edu',
        file,
        onUploaded: (u) => {
          retainedUpload = u;
        }
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(formatPaymentErrorMessage(caughtErr)).toMatch(/permission/i);
    expect(retainedUpload).not.toBeNull();
    expect(mockBackend.uploadCalls).toBe(1);
    expect(mockBackend.paymentRequests.size).toBe(0);

    mockBackend.submitBehavior = 'success';
    const retried = await submitPaymentRequest({
      paymentRequestId: retainedUpload!.paymentRequestId,
      institutionId: 'inst_1',
      institutionName: 'Springfield Academy',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      existingScreenshotStoragePath: retainedUpload!.screenshotStoragePath,
      existingScreenshotFileName: retainedUpload!.screenshotFileName,
      existingScreenshotMimeType: retainedUpload!.screenshotMimeType
    });

    expect(mockBackend.uploadCalls).toBe(1);
    expect(retried.status).toBe('pending');
    expect(mockBackend.paymentRequests.size).toBe(1);
  });

  it('TEST 7: supports authenticated R2 proof streaming, idempotent retries, and admin-only approval', async () => {
    const file = makeMockFile('upi_proof.jpg', 140_000, 'image/jpeg');
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cloudflare-r2-proof');

    const submitted = await submitPaymentRequest({
      paymentRequestId: 'payreq_admin_flow',
      institutionId: 'inst_1',
      institutionName: 'Springfield Academy',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      transactionReferenceId: '',
      file
    });

    await submitPaymentRequest({
      paymentRequestId: 'payreq_admin_flow',
      institutionId: 'inst_1',
      institutionName: 'Springfield Academy',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      existingScreenshotStoragePath: submitted.screenshotStoragePath,
      existingScreenshotFileName: submitted.screenshotFileName,
      existingScreenshotMimeType: submitted.screenshotMimeType
    });
    expect(mockBackend.paymentRequests.size).toBe(1);

    const dashboard = await fetchAdminDashboardData();
    expect(dashboard.paymentRequests).toHaveLength(1);
    expect(formatTransactionRefDisplay(dashboard.paymentRequests[0].transactionReferenceId)).toBe(
      'Not Provided'
    );

    const blobUrl = await getPaymentProofUrl(submitted.screenshotStoragePath, submitted.paymentRequestId, true);
    expect(blobUrl).toBe('blob:cloudflare-r2-proof');

    const subId = await approvePaymentRequest({ paymentRequestId: submitted.paymentRequestId });
    expect(mockBackend.subscriptions.get(subId)?.approvalStatus).toBe('approved');
    expect(mockBackend.paymentRequests.get(submitted.paymentRequestId)?.status).toBe('approved');

    createUrlSpy.mockRestore();
  });
});
