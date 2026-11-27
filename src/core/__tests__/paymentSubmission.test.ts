import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  approvePaymentRequest,
  classifyStorageUploadError,
  FirebaseApiError,
  formatPaymentErrorMessage,
  formatTransactionRefDisplay,
  getPaymentProofUrl,
  sanitizeUrlForError,
  submitPaymentRequest,
  validateProofFileBasic
} from '../../firebase/subscriptionService';
import { ADMIN_EMAIL, SUBSCRIPTION_PLAN } from '../subscriptionConstants';

const firestoreMocks = vi.hoisted(() => {
  const docsStore = new Map<string, Record<string, any>>();
  return {
    docsStore,
    setDocError: null as Error | null,
    setDocErrorForPrefix: null as string | null,
    mockSetDoc: vi.fn(async (ref: { path: string }, data: any, options?: { merge?: boolean }) => {
      if (
        firestoreMocks.setDocError &&
        (!firestoreMocks.setDocErrorForPrefix || ref.path.startsWith(firestoreMocks.setDocErrorForPrefix))
      ) {
        throw firestoreMocks.setDocError;
      }
      const existing = firestoreMocks.docsStore.get(ref.path) || {};
      firestoreMocks.docsStore.set(ref.path, options?.merge ? { ...existing, ...data } : data);
    }),
    mockGetDoc: vi.fn(async (ref: { path: string }) => {
      const data = firestoreMocks.docsStore.get(ref.path);
      return {
        exists: () => Boolean(data),
        data: () => data
      };
    }),
    mockDeleteDoc: vi.fn(async (ref: { path: string }) => {
      firestoreMocks.docsStore.delete(ref.path);
    }),
    mockGetDocs: vi.fn(async (colRef: { path?: string }) => {
      const prefix = colRef?.path ? `${colRef.path}/` : '';
      const matched: Array<{ id: string; data: () => Record<string, any> }> = [];
      if (prefix) {
        for (const [k, v] of firestoreMocks.docsStore.entries()) {
          if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
            matched.push({ id: k.slice(prefix.length), data: () => v });
          }
        }
      }
      return {
        forEach: (cb: (d: { id: string; data: () => Record<string, any> }) => void) => matched.forEach(cb)
      };
    })
  };
});

const authMocks = vi.hoisted(() => ({
  currentUser: {
    uid: 'user_1',
    email: 'coord@school.edu',
    emailVerified: true,
    getIdToken: vi.fn(async () => 'mock-firebase-id-token'),
    getIdTokenResult: vi.fn(async () => ({ claims: {} as Record<string, any> }))
  } as any
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: any, ...segments: string[]) => ({ path: segments.join('/') })),
  deleteDoc: firestoreMocks.mockDeleteDoc,
  doc: vi.fn((_db: any, ...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: firestoreMocks.mockGetDoc,
  getDocs: firestoreMocks.mockGetDocs,
  query: vi.fn(),
  setDoc: firestoreMocks.mockSetDoc,
  where: vi.fn()
}));

vi.mock('../../firebase/config', () => ({
  isFirebaseConfigured: true,
  auth: authMocks,
  db: {}
}));

const r2Mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  s3Send: vi.fn(),
  getSignedUrl: vi.fn()
}));

vi.mock('firebase-admin/app', () => ({
  getApps: vi.fn(() => [{ name: 'payment-proof-auth' }]),
  initializeApp: vi.fn(() => ({ name: 'payment-proof-auth' }))
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    verifyIdToken: r2Mocks.verifyIdToken
  }))
}));

vi.mock('@aws-sdk/client-s3', () => {
  class MockCommand {
    public readonly input: any;
    public readonly commandName: string;
    constructor(name: string, input: any) {
      this.commandName = name;
      this.input = input;
    }
  }
  return {
    S3Client: vi.fn().mockImplementation(function () {
      return { send: r2Mocks.s3Send };
    }),
    HeadBucketCommand: vi.fn().mockImplementation(function (input: any) {
      return new MockCommand('HeadBucketCommand', input);
    }),
    HeadObjectCommand: vi.fn().mockImplementation(function (input: any) {
      return new MockCommand('HeadObjectCommand', input);
    }),
    GetObjectCommand: vi.fn().mockImplementation(function (input: any) {
      return new MockCommand('GetObjectCommand', input);
    }),
    PutObjectCommand: vi.fn().mockImplementation(function (input: any) {
      return new MockCommand('PutObjectCommand', input);
    }),
    DeleteObjectCommand: vi.fn().mockImplementation(function (input: any) {
      return new MockCommand('DeleteObjectCommand', input);
    })
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: r2Mocks.getSignedUrl
}));

import {
  detectMimeTypeFromMagicBytes,
  handleAdminPreviewUrl,
  handleCleanupOrphanProof,
  handleCreateUploadUrl,
  handleInstitutionPreviewUrl,
  handleVerifyUploadedProof
} from '../../../server/paymentProofService';
import workerEntry from '../../../cloudflare/r2-worker/src/index';

const TEST_R2_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
const TEST_R2_BUCKET = 'exam-planner-payment-proofs';
const TEST_R2_ORIGIN = `https://${TEST_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

describe('Payment Screenshot Storage & Verification (Cloudflare R2 + Worker + Firebase Auth/Firestore)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.R2_ACCOUNT_ID = TEST_R2_ACCOUNT_ID;
    process.env.R2_ACCESS_KEY_ID = 'test-r2-access-key-id';
    process.env.R2_SECRET_ACCESS_KEY = 'test-r2-secret-access-key';
    process.env.R2_BUCKET_NAME = TEST_R2_BUCKET;
    process.env.FIREBASE_PROJECT_ID = 'abstract-freehold-6cf5x';

    firestoreMocks.docsStore.clear();
    firestoreMocks.setDocError = null;
    firestoreMocks.setDocErrorForPrefix = null;
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    authMocks.currentUser = {
      uid: 'user_1',
      email: 'coord@school.edu',
      emailVerified: true,
      getIdToken: vi.fn(async () => 'mock-firebase-id-token'),
      getIdTokenResult: vi.fn(async () => ({ claims: {} }))
    };

    r2Mocks.s3Send.mockResolvedValue({});
    r2Mocks.getSignedUrl.mockImplementation(async (_client: any, command: any) => {
      const key = command?.input?.Key || 'sample.jpg';
      if (command?.commandName === 'GetObjectCommand') {
        return `${TEST_R2_ORIGIN}/${TEST_R2_BUCKET}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=cred&X-Amz-Signature=view-sig`;
      }
      return `${TEST_R2_ORIGIN}/${TEST_R2_BUCKET}/${key}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=cred&X-Amz-Signature=put-sig`;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('1. validates proof file basic rules, transaction ref formatting, and error messages', () => {
    const validFile = new File(['dummy content'], 'proof.jpg', { type: 'image/jpeg' });
    expect(validateProofFileBasic(validFile)).toEqual({ valid: true, mimeType: 'image/jpeg' });

    const oversizedPdf = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'receipt.pdf', {
      type: 'application/pdf'
    });
    expect(validateProofFileBasic(oversizedPdf).valid).toBe(false);

    const invalidFile = new File(['dummy content'], 'doc.exe', { type: 'application/x-msdownload' });
    expect(validateProofFileBasic(invalidFile).valid).toBe(false);

    expect(formatTransactionRefDisplay(' UPI/123456 ')).toBe('UPI/123456');
    expect(formatTransactionRefDisplay(null)).toBe('Not Provided');
    expect(formatPaymentErrorMessage(new FirebaseApiError(400, 'Custom error', 'ERR'))).toBe('Custom error');
  });

  it('2. detects genuine JPEG, PNG, and PDF magic bytes and rejects forged headers', () => {
    expect(detectMimeTypeFromMagicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(
      detectMimeTypeFromMagicBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toBe('image/png');
    expect(detectMimeTypeFromMagicBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(
      'application/pdf'
    );
    expect(detectMimeTypeFromMagicBytes(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
  });

  it('3. rejects unauthenticated upload-url request (401)', async () => {
    await expect(
      handleCreateUploadUrl({
        authHeader: null,
        body: {
          institutionId: 'inst_1',
          paymentRequestId: 'req_1',
          fileName: 'receipt.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024
        }
      })
    ).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });
  });

  it('4. allows verified institution member upload-url (presigned R2 PUT) and rejects non-member (403)', async () => {
    r2Mocks.verifyIdToken.mockResolvedValue({ uid: 'user_1', email: 'coord@school.edu' });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/institutions/inst_1')) {
        return new Response(
          JSON.stringify({ fields: { ownerId: { stringValue: 'user_1' } } }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as any;

    const ticket = await handleCreateUploadUrl({
      authHeader: 'Bearer valid-token',
      body: {
        institutionId: 'inst_1',
        paymentRequestId: 'req_123',
        fileName: 'upi_receipt.jpeg',
        mimeType: 'image/jpeg',
        fileSize: 20480
      }
    });

    expect(ticket.bucket).toBe(TEST_R2_BUCKET);
    expect(ticket.storageProvider).toBe('cloudflare-r2');
    expect(ticket.method).toBe('PUT');
    expect(ticket.requiredHeaders).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(ticket.storagePath).toMatch(/^payment_proofs\/inst_1\/user_1\/req_123_[a-f0-9-]+\.jpg$/);
    expect(ticket.signedUrl).toContain('X-Amz-Signature=put-sig');

    // Non-member fails with 403
    r2Mocks.verifyIdToken.mockResolvedValue({ uid: 'stranger_99', email: 'other@school.edu' });
    await expect(
      handleCreateUploadUrl({
        authHeader: 'Bearer valid-token',
        body: {
          institutionId: 'inst_1',
          paymentRequestId: 'req_124',
          fileName: 'upi_receipt.jpg',
          mimeType: 'image/jpeg',
          fileSize: 20480
        }
      })
    ).rejects.toMatchObject({ status: 403, code: 'INSTITUTION_MEMBERSHIP_REQUIRED' });
  });

  it('5. server rejects >5 MB files, mismatched extensions, missing R2 bucket, and invalid magic bytes (and cleans up invalid object)', async () => {
    r2Mocks.verifyIdToken.mockResolvedValue({ uid: 'user_1', email: 'coord@school.edu' });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ fields: { ownerId: { stringValue: 'user_1' } } }), { status: 200 })
    ) as any;

    await expect(
      handleCreateUploadUrl({
        authHeader: 'Bearer valid-token',
        body: {
          institutionId: 'inst_1',
          paymentRequestId: 'req_big',
          fileName: 'huge.jpg',
          mimeType: 'image/jpeg',
          fileSize: 5 * 1024 * 1024 + 1
        }
      })
    ).rejects.toMatchObject({ status: 400, code: 'FILE_TOO_LARGE' });

    await expect(
      handleCreateUploadUrl({
        authHeader: 'Bearer valid-token',
        body: {
          institutionId: 'inst_1',
          paymentRequestId: 'req_mismatch',
          fileName: 'evil.png',
          mimeType: 'image/jpeg',
          fileSize: 1024
        }
      })
    ).rejects.toMatchObject({ status: 400, code: 'EXTENSION_MIME_MISMATCH' });

    // Missing R2 bucket on HeadBucket fails loudly with R2_BUCKET_NOT_FOUND
    r2Mocks.s3Send.mockRejectedValueOnce(
      Object.assign(new Error('NoSuchBucket'), {
        name: 'NoSuchBucket',
        $metadata: { httpStatusCode: 404 }
      })
    );
    await expect(
      handleCreateUploadUrl({
        authHeader: 'Bearer valid-token',
        body: {
          institutionId: 'inst_1',
          paymentRequestId: 'req_nobucket',
          fileName: 'ok.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024
        }
      })
    ).rejects.toMatchObject({ status: 502, code: 'R2_BUCKET_NOT_FOUND' });

    // Magic bytes failure during server verify deletes object from R2 and rejects 400
    const badPath = 'payment_proofs/inst_1/user_1/req_bad_uuid.jpg';
    r2Mocks.s3Send
      .mockResolvedValueOnce({ ContentLength: 500, ContentType: 'image/jpeg' }) // HeadObjectCommand
      .mockResolvedValueOnce({
        Body: { transformToByteArray: async () => new Uint8Array([0x00, 0x01, 0x02, 0x03]) }
      }) // GetObjectCommand
      .mockResolvedValueOnce({}); // DeleteObjectCommand

    await expect(
      handleVerifyUploadedProof({
        authHeader: 'Bearer valid-token',
        body: {
          institutionId: 'inst_1',
          paymentRequestId: 'req_bad',
          storagePath: badPath
        }
      })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_FILE_SIGNATURE' });

    const deleteCall = r2Mocks.s3Send.mock.calls.find(
      (call) => call[0]?.commandName === 'DeleteObjectCommand'
    );
    expect(deleteCall?.[0]?.input).toEqual({ Bucket: TEST_R2_BUCKET, Key: badPath });
  });

  it('6. completes full client payment submission workflow with raw Blob PUT to R2 (no FormData)', async () => {
    const fetchCalls: Array<{ method: string; url: string; contentType: string | null; isBlob: boolean }> = [];
    const presignedPutUrl = `${TEST_R2_ORIGIN}/${TEST_R2_BUCKET}/payment_proofs/inst_1/user_1/req_ok_abc.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=sig1`;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers || {});
      fetchCalls.push({
        method: init?.method || 'GET',
        url,
        contentType: headers.get('content-type'),
        isBlob: init?.body instanceof Blob
      });

      if (url === '/api/payment-proof/upload-url') {
        return new Response(
          JSON.stringify({
            signedUrl: presignedPutUrl,
            storagePath: 'payment_proofs/inst_1/user_1/req_ok_abc.jpg',
            bucket: TEST_R2_BUCKET,
            canonicalMimeType: 'image/jpeg',
            requiredHeaders: { 'Content-Type': 'image/jpeg' }
          }),
          { status: 200 }
        );
      }
      if (url.startsWith(TEST_R2_ORIGIN)) {
        return new Response('', { status: 200, headers: { ETag: '"etag1"' } });
      }
      if (url === '/api/payment-proof/verify') {
        return new Response(
          JSON.stringify({
            verified: true,
            storagePath: 'payment_proofs/inst_1/user_1/req_ok_abc.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 120
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as any;

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'proof.jpg', {
      type: 'image/jpeg'
    });

    const record = await submitPaymentRequest({
      paymentRequestId: 'req_ok',
      institutionId: 'inst_1',
      institutionName: 'Model High School',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      transactionReferenceId: '  ',
      file
    });

    expect(record.paymentRequestId).toBe('req_ok');
    expect(record.status).toBe('pending');
    expect(record.amount).toBe(499);
    expect(record.currency).toBe('INR');
    expect(record.transactionReferenceId).toBeNull();
    expect(record.subscriptionId).toBeNull();
    expect(record.screenshotStoragePath).toBe('payment_proofs/inst_1/user_1/req_ok_abc.jpg');
    expect(fetchCalls[0].url).toBe('/api/payment-proof/upload-url');
    expect(fetchCalls[1]).toEqual({
      method: 'PUT',
      url: presignedPutUrl,
      contentType: 'image/jpeg',
      isBlob: true
    });
    expect(fetchCalls[2].url).toBe('/api/payment-proof/verify');
    expect(firestoreMocks.docsStore.get('payment_requests/req_ok')).toMatchObject({
      status: 'pending',
      screenshotStoragePath: 'payment_proofs/inst_1/user_1/req_ok_abc.jpg'
    });
  });

  it('7. triggers orphan cleanup in Cloudflare R2 if Firestore payment_requests write fails', async () => {
    const cleanupBodies: any[] = [];
    firestoreMocks.setDocError = Object.assign(new Error('Simulated Firestore write failure'), {
      code: 'permission-denied'
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/payment-proof/upload-url') {
        return new Response(
          JSON.stringify({
            signedUrl: `${TEST_R2_ORIGIN}/${TEST_R2_BUCKET}/p?X-Amz-Signature=1`,
            storagePath: 'payment_proofs/inst_1/user_1/req_fail_xyz.jpg',
            bucket: TEST_R2_BUCKET,
            canonicalMimeType: 'image/jpeg',
            requiredHeaders: { 'Content-Type': 'image/jpeg' }
          }),
          { status: 200 }
        );
      }
      if (url.startsWith(TEST_R2_ORIGIN)) {
        return new Response('', { status: 200 });
      }
      if (url === '/api/payment-proof/verify') {
        return new Response(
          JSON.stringify({
            verified: true,
            storagePath: 'payment_proofs/inst_1/user_1/req_fail_xyz.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 120
          }),
          { status: 200 }
        );
      }
      if (url === '/api/payment-proof/cleanup') {
        cleanupBodies.push(JSON.parse(String(init?.body || '{}')));
        return new Response(JSON.stringify({ cleaned: true }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as any;

    const onOrphanCleaned = vi.fn();
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'proof.jpg', { type: 'image/jpeg' });

    await expect(
      submitPaymentRequest({
        paymentRequestId: 'req_fail',
        institutionId: 'inst_1',
        institutionName: 'Model High School',
        userId: 'user_1',
        userEmail: 'coord@school.edu',
        file,
        onOrphanCleaned
      })
    ).rejects.toMatchObject({ status: 400, code: 'permission-denied' });

    expect(cleanupBodies).toEqual([
      {
        institutionId: 'inst_1',
        storagePath: 'payment_proofs/inst_1/user_1/req_fail_xyz.jpg'
      }
    ]);
    expect(onOrphanCleaned).toHaveBeenCalledTimes(1);

    // Server cleanup rejects cross-user path attempts
    r2Mocks.verifyIdToken.mockResolvedValue({ uid: 'user_1', email: 'coord@school.edu' });
    await expect(
      handleCleanupOrphanProof({
        authHeader: 'Bearer valid-token',
        body: {
          institutionId: 'inst_1',
          storagePath: 'payment_proofs/inst_1/other_user/req_other.jpg'
        }
      })
    ).rejects.toMatchObject({ status: 403, code: 'STORAGE_PATH_FORBIDDEN' });
  });

  it('8. admin preview requires verified agarwalpiyush263@gmail.com email', async () => {
    const targetPath = 'payment_proofs/inst_1/user_1/req_1_abc.pdf';
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          fields: {
            institutionId: { stringValue: 'inst_1' },
            screenshotStoragePath: { stringValue: targetPath },
            screenshotMimeType: { stringValue: 'application/pdf' },
            screenshotFileName: { stringValue: 'receipt.pdf' }
          }
        }),
        { status: 200 }
      )
    ) as any;

    r2Mocks.verifyIdToken.mockResolvedValue({
      uid: 'other_uid',
      email: 'other@school.edu',
      email_verified: true
    });
    await expect(
      handleAdminPreviewUrl({
        authHeader: 'Bearer non-admin-token',
        body: { paymentRequestId: 'req_1', storagePath: targetPath }
      })
    ).rejects.toMatchObject({ status: 403, code: 'ADMIN_EMAIL_REQUIRED' });

    r2Mocks.verifyIdToken.mockResolvedValue({
      uid: 'admin_uid',
      email: ADMIN_EMAIL,
      email_verified: true
    });
    const res = await handleAdminPreviewUrl({
      authHeader: 'Bearer admin-token',
      body: { paymentRequestId: 'req_1', storagePath: targetPath }
    });
    expect(res.signedUrl).toContain('X-Amz-Signature=view-sig');
    expect(res.expiresInSeconds).toBe(120);
    expect(res.mimeType).toBe('application/pdf');
  });

  it('9. institution preview allows own member and blocks another institution (403)', async () => {
    const targetPath = 'payment_proofs/inst_1/user_1/req_1_abc.jpg';
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/payment_requests/req_1')) {
        return new Response(
          JSON.stringify({
            fields: {
              institutionId: { stringValue: 'inst_1' },
              screenshotStoragePath: { stringValue: targetPath },
              screenshotMimeType: { stringValue: 'image/jpeg' },
              screenshotFileName: { stringValue: 'proof.jpg' }
            }
          }),
          { status: 200 }
        );
      }
      if (url.includes('/institutions/inst_1')) {
        return new Response(
          JSON.stringify({ fields: { ownerId: { stringValue: 'user_1' } } }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 404 });
    }) as any;

    r2Mocks.verifyIdToken.mockResolvedValue({ uid: 'user_1', email: 'coord@school.edu' });
    const ownPreview = await handleInstitutionPreviewUrl({
      authHeader: 'Bearer user-token',
      body: { paymentRequestId: 'req_1', storagePath: targetPath }
    });
    expect(ownPreview.signedUrl).toContain('X-Amz-Signature=view-sig');

    r2Mocks.verifyIdToken.mockResolvedValue({ uid: 'other_inst_user', email: 'other@school.edu' });
    await expect(
      handleInstitutionPreviewUrl({
        authHeader: 'Bearer other-token',
        body: { paymentRequestId: 'req_1', storagePath: targetPath }
      })
    ).rejects.toMatchObject({ status: 403, code: 'INSTITUTION_MEMBERSHIP_REQUIRED' });
  });

  it('10. preserves exact 15-day subscription activation upon strict admin approval', async () => {
    firestoreMocks.docsStore.set('payment_requests/req_approve', {
      paymentRequestId: 'req_approve',
      institutionId: 'inst_1',
      institutionName: 'Model High School',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      amount: 499,
      status: 'pending',
      screenshotStoragePath: 'payment_proofs/inst_1/user_1/req_approve_uuid.jpg'
    });

    authMocks.currentUser = {
      uid: 'admin_uid',
      email: ADMIN_EMAIL,
      emailVerified: true,
      getIdToken: vi.fn(async () => 'admin-token'),
      getIdTokenResult: vi.fn(async () => ({ claims: { admin: true } }))
    };

    const subId = await approvePaymentRequest({ paymentRequestId: 'req_approve' });
    const subDoc = firestoreMocks.docsStore.get(`subscriptions/${subId}`);
    expect(subDoc).toBeDefined();
    expect(subDoc?.approvalStatus).toBe('approved');
    expect(subDoc?.paymentStatus).toBe('approved');
    expect(subDoc?.amount).toBe(499);
    expect(subDoc?.examinationTypeLocked).toBe(false);

    const activatedMs = Date.parse(subDoc?.activatedAt);
    const expiresMs = Date.parse(subDoc?.expiresAt);
    expect(expiresMs - activatedMs).toBe(SUBSCRIPTION_PLAN.validityMs);
  });

  it('11. client getPaymentProofUrl uses VITE_R2_WORKER_URL when set and relative /api routes otherwise', async () => {
    const calledUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calledUrls.push(String(input));
      return new Response(JSON.stringify({ signedUrl: 'https://signed.example/file' }), { status: 200 });
    }) as any;

    const instUrl = await getPaymentProofUrl('payment_proofs/inst_1/user_1/p.jpg', 'req_1', 'institution');
    const adminUrl = await getPaymentProofUrl('payment_proofs/inst_1/user_1/p.jpg', 'req_1', 'admin');

    expect(instUrl).toBe('https://signed.example/file');
    expect(adminUrl).toBe('https://signed.example/file');
    expect(calledUrls).toEqual([
      '/api/payment-proof/institution-preview-url',
      '/api/payment-proof/preview-url'
    ]);

    // When VITE_R2_WORKER_URL is configured, routes straight to Cloudflare Worker
    vi.stubEnv('VITE_R2_WORKER_URL', 'https://exam-planner-r2.example.workers.dev/');
    calledUrls.length = 0;
    await getPaymentProofUrl('payment_proofs/inst_1/user_1/p.jpg', 'req_1', 'admin');
    expect(calledUrls).toEqual(['https://exam-planner-r2.example.workers.dev/api/payment-proof/preview-url']);
  });

  it('12. redacts AWS SigV4 credentials/signatures and classifies R2 XML & HTML errors', async () => {
    const signedUrl = `${TEST_R2_ORIGIN}/${TEST_R2_BUCKET}/payment_proofs/inst/u/req.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=secretcred&X-Amz-Signature=supersecretvalue`;
    const redacted = sanitizeUrlForError(signedUrl);
    expect(redacted).not.toContain('secretcred');
    expect(redacted).not.toContain('supersecretvalue');
    expect(redacted).toContain('X-Amz-Signature=%5BREDACTED%5D');

    const bucket404Msg = classifyStorageUploadError(
      404,
      '<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist.</Message></Error>',
      signedUrl
    );
    expect(bucket404Msg).toContain('Bucket does not exist in Cloudflare R2');
    expect(bucket404Msg).not.toContain('supersecretvalue');

    const sig403Msg = classifyStorageUploadError(
      403,
      '<Error><Code>SignatureDoesNotMatch</Code><Message>Signature mismatch</Message></Error>',
      signedUrl
    );
    expect(sig403Msg).toContain('rejected the presigned signature');

    // Missing R2 server config returns 503 R2_NOT_CONFIGURED
    delete process.env.R2_SECRET_ACCESS_KEY;
    r2Mocks.verifyIdToken.mockResolvedValue({ uid: 'user_1', email: 'coord@school.edu' });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ fields: { ownerId: { stringValue: 'user_1' } } }), { status: 200 })
    ) as any;

    await expect(
      handleCreateUploadUrl({
        authHeader: 'Bearer valid-token',
        body: {
          institutionId: 'inst_1',
          paymentRequestId: 'req_missing_cfg',
          fileName: 'ok.jpg',
          mimeType: 'image/jpeg',
          fileSize: 1024
        }
      })
    ).rejects.toMatchObject({ status: 503, code: 'R2_NOT_CONFIGURED' });
  });

  it('13. rejects HTML SPA fallback from configured Worker and unsigned R2 upload URLs before Stage F', async () => {
    vi.stubEnv('VITE_R2_WORKER_URL', 'https://worker.example.workers.dev');
    globalThis.fetch = vi.fn(async () =>
      new Response('<!doctype html><html><body>SPA</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' }
      })
    ) as any;

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], 'proof.jpg', {
      type: 'image/jpeg'
    });

    await expect(
      submitPaymentRequest({
        paymentRequestId: 'req_html',
        institutionId: 'inst_1',
        institutionName: 'Model High School',
        userId: 'user_1',
        userEmail: 'coord@school.edu',
        file
      })
    ).rejects.toMatchObject({ code: 'NON_JSON_HTML_RESPONSE' });

    vi.unstubAllEnvs();
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ signedUrl: 'https://example.r2.cloudflarestorage.com/no-sig.jpg' }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
    ) as any;

    await expect(
      submitPaymentRequest({
        paymentRequestId: 'req_unsigned',
        institutionId: 'inst_1',
        institutionName: 'Model High School',
        userId: 'user_1',
        userEmail: 'coord@school.edu',
        file
      })
    ).rejects.toMatchObject({ code: 'INVALID_SIGNED_UPLOAD_URL' });
  });

  it('14. falls back to /.netlify/functions/payment-proof-* when /api/payment-proof/* returns HTML and VITE_R2_WORKER_URL is unset', async () => {
    const calls: string[] = [];
    const presignedPutUrl = `${TEST_R2_ORIGIN}/${TEST_R2_BUCKET}/p?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=sig`;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);

      if (url === '/api/payment-proof/upload-url') {
        return new Response('<!doctype html><html><body>SPA</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' }
        });
      }
      if (url === '/.netlify/functions/payment-proof-upload-url') {
        return new Response(
          JSON.stringify({
            signedUrl: presignedPutUrl,
            storagePath: 'payment_proofs/inst_1/user_1/req_fb_abc.jpg',
            bucket: TEST_R2_BUCKET,
            canonicalMimeType: 'image/jpeg',
            requiredHeaders: { 'Content-Type': 'image/jpeg' }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.startsWith(TEST_R2_ORIGIN)) {
        return new Response('', { status: 200 });
      }
      if (url === '/api/payment-proof/verify') {
        return new Response(
          JSON.stringify({
            verified: true,
            storagePath: 'payment_proofs/inst_1/user_1/req_fb_abc.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 100
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 404 });
    }) as any;

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])], 'proof.jpg', {
      type: 'image/jpeg'
    });

    const record = await submitPaymentRequest({
      paymentRequestId: 'req_fb',
      institutionId: 'inst_1',
      institutionName: 'Model High School',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      file
    });

    expect(record.screenshotStoragePath).toBe('payment_proofs/inst_1/user_1/req_fb_abc.jpg');
    expect(calls).toEqual([
      '/api/payment-proof/upload-url',
      '/.netlify/functions/payment-proof-upload-url',
      presignedPutUrl,
      '/api/payment-proof/verify'
    ]);
  });

  it('15. Cloudflare Worker enforces CORS allowlist, reports /api/health, and rejects unauthenticated requests', async () => {
    const workerEnv = {
      FIREBASE_PROJECT_ID: 'abstract-freehold-6cf5x',
      FIREBASE_FIRESTORE_DATABASE_ID: 'ai-studio-57bf1b23-c825-4dd4-8d38-a183f4ad98fb',
      ADMIN_EMAIL,
      ALLOWED_ORIGINS: 'https://examplanner.netlify.app,https://*.run.app',
      R2_ACCOUNT_ID: TEST_R2_ACCOUNT_ID,
      R2_ACCESS_KEY_ID: 'test-access-key',
      R2_SECRET_ACCESS_KEY: 'test-secret-key',
      R2_BUCKET_NAME: TEST_R2_BUCKET
    };

    // Allowed origin /api/health
    const okRes = await workerEntry.fetch(
      new Request('https://worker.example.workers.dev/api/health', {
        method: 'GET',
        headers: { Origin: 'https://examplanner.netlify.app' }
      }),
      workerEnv
    );
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get('Access-Control-Allow-Origin')).toBe('https://examplanner.netlify.app');
    const healthJson = await okRes.json();
    expect(healthJson.storageProvider).toBe('cloudflare-r2');
    expect(healthJson.r2Configured).toBe(true);

    // Blocked origin -> 403 ORIGIN_NOT_ALLOWED
    const blockedRes = await workerEntry.fetch(
      new Request('https://worker.example.workers.dev/api/health', {
        method: 'GET',
        headers: { Origin: 'https://evil-site.example.com' }
      }),
      workerEnv
    );
    expect(blockedRes.status).toBe(403);
    const blockedJson = await blockedRes.json();
    expect(blockedJson.code).toBe('ORIGIN_NOT_ALLOWED');

    // Missing Bearer token -> 401 AUTH_REQUIRED
    const unauthRes = await workerEntry.fetch(
      new Request('https://worker.example.workers.dev/api/payment-proof/upload-url', {
        method: 'POST',
        headers: {
          Origin: 'https://examplanner.netlify.app',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ institutionId: 'inst_1' })
      }),
      workerEnv
    );
    expect(unauthRes.status).toBe(401);
    const unauthJson = await unauthRes.json();
    expect(unauthJson.code).toBe('AUTH_REQUIRED');
  });

  it('16. automatically stores and previews payment proof in private Firestore chunks when R2 is not configured', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'Cloudflare R2 storage is not configured.',
          code: 'R2_NOT_CONFIGURED'
        }),
        { status: 503, headers: { 'content-type': 'application/json' } }
      )
    ) as any;

    const progressHistory: number[] = [];
    const sampleBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 10, 20, 30, 40]);
    const file = new File([sampleBytes], 'upi_screenshot.jpg', { type: 'image/jpeg' });

    const record = await submitPaymentRequest({
      paymentRequestId: 'req_fs_fallback',
      institutionId: 'inst_1',
      institutionName: 'Model High School',
      userId: 'user_1',
      userEmail: 'coord@school.edu',
      file,
      onUploadProgress: (pct) => progressHistory.push(pct)
    });

    expect(record.screenshotStoragePath).toBe('payment_proofs/inst_1/user_1/req_fs_fallback_fs.jpg');
    expect(progressHistory[progressHistory.length - 1]).toBe(100);
    expect(progressHistory.some((p) => p > 0 && p < 100)).toBe(true);

    expect(firestoreMocks.docsStore.get('payment_proof_files/req_fs_fallback')).toMatchObject({
      paymentRequestId: 'req_fs_fallback',
      institutionId: 'inst_1',
      userId: 'user_1',
      mimeType: 'image/jpeg',
      sizeBytes: sampleBytes.length,
      chunkCount: 1
    });
    expect(
      firestoreMocks.docsStore.get('payment_proof_files/req_fs_fallback/chunks/chunk_000')
    ).toMatchObject({
      chunkIndex: 0
    });

    // Both institution user and verified admin can reassemble a valid blob preview URL
    const instPreviewUrl = await getPaymentProofUrl(
      record.screenshotStoragePath,
      'req_fs_fallback',
      'institution'
    );
    expect(instPreviewUrl.startsWith('blob:')).toBe(true);

    authMocks.currentUser = {
      uid: 'admin_uid',
      email: ADMIN_EMAIL,
      emailVerified: true,
      getIdToken: vi.fn(async () => 'admin-token'),
      getIdTokenResult: vi.fn(async () => ({ claims: { admin: true } }))
    };
    const adminPreviewUrl = await getPaymentProofUrl(
      record.screenshotStoragePath,
      'req_fs_fallback',
      'admin'
    );
    expect(adminPreviewUrl.startsWith('blob:')).toBe(true);
  });

  it('17. rejects forged non-image bytes and cleans up Firestore proof chunks if payment_requests write fails', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'R2_NOT_CONFIGURED', error: 'Not configured' }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      })
    ) as any;

    const fakeFile = new File([new Uint8Array([0x3c, 0x73, 0x76, 0x67])], 'forged.jpg', {
      type: 'image/jpeg'
    });
    await expect(
      submitPaymentRequest({
        paymentRequestId: 'req_forged_fs',
        institutionId: 'inst_1',
        institutionName: 'Model High School',
        userId: 'user_1',
        userEmail: 'coord@school.edu',
        file: fakeFile
      })
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_FILE_SIGNATURE' });
    expect(firestoreMocks.docsStore.get('payment_proof_files/req_forged_fs')).toBeUndefined();

    // Valid JPEG succeeds uploading chunks, then payment_requests save fails -> chunks & metadata cleaned up
    firestoreMocks.setDocError = Object.assign(new Error('Simulated request save failure'), {
      code: 'permission-denied'
    });
    firestoreMocks.setDocErrorForPrefix = 'payment_requests/';

    const onOrphanCleaned = vi.fn();
    const validFile = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6])], 'proof.jpg', {
      type: 'image/jpeg'
    });

    await expect(
      submitPaymentRequest({
        paymentRequestId: 'req_fs_orphan',
        institutionId: 'inst_1',
        institutionName: 'Model High School',
        userId: 'user_1',
        userEmail: 'coord@school.edu',
        file: validFile,
        onOrphanCleaned
      })
    ).rejects.toMatchObject({ status: 400, code: 'permission-denied' });

    expect(onOrphanCleaned).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.docsStore.get('payment_proof_files/req_fs_orphan')).toBeUndefined();
    expect(
      firestoreMocks.docsStore.get('payment_proof_files/req_fs_orphan/chunks/chunk_000')
    ).toBeUndefined();
  });
});
