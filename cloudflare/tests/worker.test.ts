import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { createWorkerHandler } from '../src/index';
import { ADMIN_EMAIL_DEFAULT, AuthUser, Env, getLockedTypeMessage, WorkerDeps } from '../src/types';

const MIGRATION_SQL = fs.readFileSync(
  path.resolve(import.meta.dirname, '../migrations/0001_init.sql'),
  'utf8'
);

const DAY_MS = 24 * 60 * 60 * 1000;

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

function createD1Mock(sqlite: DatabaseSync): D1Database {
  const wrapStmt = (sql: string, boundArgs: unknown[] = []) => {
    const execRun = () => {
      const stmt = sqlite.prepare(sql);
      const info = stmt.run(...(boundArgs as (string | number | Uint8Array | null)[]));
      return {
        success: true,
        meta: {
          duration: 1,
          size_after: 0,
          rows_read: 0,
          rows_written: Number(info.changes || 0),
          last_row_id: Number(info.lastInsertRowid || 0),
          changed_db: Number(info.changes || 0) > 0,
          changes: Number(info.changes || 0)
        },
        results: []
      };
    };

    const stmtObj = {
      bind: (...args: unknown[]) => wrapStmt(sql, args),
      first: async <T = Record<string, unknown>>(colName?: string): Promise<T | null> => {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...(boundArgs as (string | number | Uint8Array | null)[])) as
          | Record<string, unknown>
          | undefined;
        if (!row) return null;
        if (colName) return (row[colName] as T) ?? null;
        return row as T;
      },
      all: async <T = Record<string, unknown>>() => {
        const stmt = sqlite.prepare(sql);
        const rows = stmt.all(...(boundArgs as (string | number | Uint8Array | null)[])) as T[];
        return {
          success: true,
          meta: {
            duration: 1,
            size_after: 0,
            rows_read: rows.length,
            rows_written: 0,
            last_row_id: 0,
            changed_db: false,
            changes: 0
          },
          results: rows
        };
      },
      run: async () => execRun(),
      raw: async () => [],
      _execSync: execRun
    };
    return stmtObj;
  };

  return {
    prepare: (sql: string) => wrapStmt(sql) as unknown as D1PreparedStatement,
    batch: async (statements: D1PreparedStatement[]) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out = statements.map((s) =>
          (s as unknown as { _execSync: () => D1Result })._execSync()
        );
        sqlite.exec('COMMIT');
        return out;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 1, duration: 1 };
    },
    dump: async () => new ArrayBuffer(0),
    withSession: () => {
      throw new Error('withSession not implemented in mock');
    }
  } as unknown as D1Database;
}

function createR2Mock() {
  const store = new Map<
    string,
    {
      bytes: Uint8Array;
      httpMetadata?: { contentType?: string; contentDisposition?: string };
      customMetadata?: Record<string, string>;
    }
  >();

  const bucket = {
    store,
    put: async (
      key: string,
      value: ArrayBuffer | ArrayBufferView | Blob | string,
      opts?: R2PutOptions
    ) => {
      let bytes: Uint8Array;
      if (value instanceof Uint8Array) {
        bytes = new Uint8Array(value);
      } else if (value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
      } else if (typeof value === 'string') {
        bytes = new TextEncoder().encode(value);
      } else {
        bytes = new Uint8Array(await value.arrayBuffer());
      }
      store.set(key, {
        bytes,
        httpMetadata: opts?.httpMetadata as { contentType?: string; contentDisposition?: string },
        customMetadata: opts?.customMetadata
      });
      return { key, size: bytes.byteLength } as unknown as R2Object;
    },
    head: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        size: entry.bytes.byteLength,
        httpMetadata: entry.httpMetadata,
        customMetadata: entry.customMetadata
      } as unknown as R2Object;
    },
    get: async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        size: entry.bytes.byteLength,
        httpMetadata: entry.httpMetadata,
        customMetadata: entry.customMetadata,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(entry.bytes);
            controller.close();
          }
        }),
        arrayBuffer: async () => entry.bytes.buffer.slice(0)
      } as unknown as R2ObjectBody;
    }
  };

  return bucket as unknown as R2Bucket & { store: typeof store };
}

interface TestHarness {
  env: Env;
  r2: ReturnType<typeof createR2Mock>;
  setNow: (ms: number) => void;
  handler: (request: Request) => Promise<Response>;
}

function setupHarness(initialNowMs = Date.UTC(2026, 10, 1, 10, 0, 0)): TestHarness {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(MIGRATION_SQL);

  const db = createD1Mock(sqlite);
  const r2 = createR2Mock();

  const env: Env = {
    DB: db,
    PROOF_BUCKET: r2,
    FIREBASE_PROJECT_ID: 'abstract-freehold-6cf5x',
    FIREBASE_DATABASE_ID: 'ai-studio-57bf1b23-c825-4dd4-8d38-a183f4ad98fb',
    ADMIN_EMAIL: ADMIN_EMAIL_DEFAULT,
    ALLOWED_ORIGINS: 'http://localhost:3000'
  };

  let currentNowMs = initialNowMs;

  const users: Record<string, AuthUser> = {
    token_user_a: {
      uid: 'uid_a',
      email: 'inst_a@school.edu',
      emailVerified: true,
      rawToken: 'token_user_a'
    },
    token_user_b: {
      uid: 'uid_b',
      email: 'inst_b@school.edu',
      emailVerified: true,
      rawToken: 'token_user_b'
    },
    token_admin: {
      uid: 'uid_admin',
      email: ADMIN_EMAIL_DEFAULT,
      emailVerified: true,
      adminClaim: true,
      rawToken: 'token_admin'
    },
    token_fake_admin_unverified: {
      uid: 'uid_fake_admin',
      email: ADMIN_EMAIL_DEFAULT,
      emailVerified: false,
      rawToken: 'token_fake_admin_unverified'
    }
  };

  const firestoreInstitutions: Record<string, { id: string; ownerUid: string; name: string }> = {
    inst_a: { id: 'inst_a', ownerUid: 'uid_a', name: 'Alpha Academy' },
    inst_b: { id: 'inst_b', ownerUid: 'uid_b', name: 'Beta College' }
  };

  const deps: WorkerDeps = {
    nowMs: () => currentNowMs,
    verifyFirebaseToken: async (token) => {
      const user = users[token];
      if (!user) throw new Error('Invalid token');
      return user;
    },
    verifyFirestoreInstitution: async (institutionId) => {
      const rec = firestoreInstitutions[institutionId];
      if (!rec) return null;
      return { ...rec, userEmail: `${rec.ownerUid}@school.edu` };
    }
  };

  const workerFetch = createWorkerHandler(deps);

  return {
    env,
    r2,
    setNow: (ms: number) => {
      currentNowMs = ms;
    },
    handler: (request: Request) => workerFetch(request, env)
  };
}

async function uploadAndSubmit(
  h: TestHarness,
  opts: {
    token: string;
    institutionId: string;
    institutionName: string;
    paymentRequestId: string;
    bytes?: Uint8Array;
    mimeType?: string;
    fileName?: string;
    transactionReferenceId?: string | null;
  }
) {
  const bytes = opts.bytes ?? JPEG_BYTES;
  const mime = opts.mimeType ?? 'image/jpeg';
  const fileName = opts.fileName ?? 'upi_proof.jpg';

  const form = new FormData();
  form.append('institutionId', opts.institutionId);
  form.append('institutionName', opts.institutionName);
  form.append('paymentRequestId', opts.paymentRequestId);
  form.append('file', new File([bytes], fileName, { type: mime }));

  const upRes = await h.handler(
    new Request('https://worker.local/api/payment/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}`, Origin: 'http://localhost:3000' },
      body: form
    })
  );
  const upBody = (await upRes.json()) as Record<string, unknown>;
  if (!upRes.ok) {
    return { uploadStatus: upRes.status, uploadBody: upBody, submitStatus: 0, submitBody: {} };
  }

  const subRes = await h.handler(
    new Request('https://worker.local/api/payment/submit', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Origin: 'http://localhost:3000',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        paymentRequestId: opts.paymentRequestId,
        institutionId: opts.institutionId,
        institutionName: opts.institutionName,
        transactionReferenceId: opts.transactionReferenceId,
        objectKey: upBody.objectKey,
        fileName: upBody.fileName,
        mimeType: upBody.mimeType
      })
    })
  );
  const subBody = (await subRes.json()) as Record<string, unknown>;
  return { uploadStatus: upRes.status, uploadBody: upBody, submitStatus: subRes.status, submitBody: subBody };
}

describe('Cloudflare Worker + D1 + R2 Subscription & Locking Integration Tests', () => {
  let h: TestHarness;

  beforeEach(() => {
    h = setupHarness();
  });

  describe('1. Payment Submission & R2 Proof Validation Tests', () => {
    it('submits valid JPG/PNG/PDF proofs without Transaction ID (stored as null) and with trimmed Transaction ID', async () => {
      const jpgRes = await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_no_txn_1',
        bytes: JPEG_BYTES,
        mimeType: 'image/jpeg',
        fileName: 'receipt.jpg',
        transactionReferenceId: '   '
      });

      expect(jpgRes.uploadStatus).toBe(200);
      expect(jpgRes.submitStatus).toBe(201);
      const pr = jpgRes.submitBody.paymentRequest as Record<string, unknown>;
      expect(pr.status).toBe('pending');
      expect(pr.amount).toBe(1);
      expect(pr.currency).toBe('INR');
      expect(pr.transactionReferenceId).toBeNull();
      expect(h.r2.store.has(String(pr.screenshotStoragePath))).toBe(true);

      // Duplicate pending request blocked cleanly (409)
      const dupPending = await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_second_pending',
        bytes: PNG_BYTES,
        mimeType: 'image/png',
        fileName: 'second.png'
      });
      expect(dupPending.uploadStatus).toBe(409);

      // Institution B submits PDF with optional Transaction ID
      const pdfRes = await uploadAndSubmit(h, {
        token: 'token_user_b',
        institutionId: 'inst_b',
        institutionName: 'Beta College',
        paymentRequestId: 'pay_b_pdf',
        bytes: PDF_BYTES,
        mimeType: 'application/pdf',
        fileName: 'slip.pdf',
        transactionReferenceId: '  UTR43219876  '
      });
      expect(pdfRes.submitStatus).toBe(201);
      expect((pdfRes.submitBody.paymentRequest as Record<string, unknown>).transactionReferenceId).toBe(
        'UTR43219876'
      );
      expect((pdfRes.submitBody.paymentRequest as Record<string, unknown>).screenshotMimeType).toBe(
        'application/pdf'
      );
    });

    it('rejects files > 5 MB and rejects spoofed MIME / executable magic bytes', async () => {
      const bigBytes = new Uint8Array(5 * 1024 * 1024 + 10);
      bigBytes.set(JPEG_BYTES, 0);

      const bigRes = await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_too_big',
        bytes: bigBytes,
        mimeType: 'image/jpeg',
        fileName: 'huge.jpg'
      });
      expect(bigRes.uploadStatus).toBe(413);
      expect(String(bigRes.uploadBody.error)).toMatch(/5 MB/i);

      const exeSpoof = await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_spoof',
        bytes: EXE_BYTES,
        mimeType: 'image/jpeg',
        fileName: 'malware.jpg'
      });
      expect(exeSpoof.uploadStatus).toBe(400);
      expect(String(exeSpoof.uploadBody.error)).toMatch(/signature could not be verified/i);
      expect(h.r2.store.size).toBe(0);
    });

    it('recovers idempotently if client retries submitPayment with same paymentRequestId', async () => {
      const first = await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_idem_1',
        bytes: PNG_BYTES,
        mimeType: 'image/png',
        fileName: 'proof.png'
      });
      expect(first.submitStatus).toBe(201);

      const retryRes = await h.handler(
        new Request('https://worker.local/api/payment/submit', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            paymentRequestId: 'pay_idem_1',
            institutionId: 'inst_a',
            institutionName: 'Alpha Academy',
            objectKey: first.uploadBody.objectKey,
            fileName: 'proof.png',
            mimeType: 'image/png'
          })
        })
      );
      expect(retryRes.status).toBe(201);
      const countRow = await h.env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM payment_requests WHERE payment_request_id = ?'
      )
        .bind('pay_idem_1')
        .first<{ cnt: number }>();
      expect(countRow?.cnt).toBe(1);
    });
  });

  describe('2. Admin Access Control, Approval, Rejection, Revocation & R2 Streaming', () => {
    it('blocks non-admin and unverified-email tokens from /api/admin/*', async () => {
      const userRes = await h.handler(
        new Request('https://worker.local/api/admin/dashboard', {
          headers: { Authorization: 'Bearer token_user_a' }
        })
      );
      expect(userRes.status).toBe(403);

      const unverifiedAdminRes = await h.handler(
        new Request('https://worker.local/api/admin/dashboard', {
          headers: { Authorization: 'Bearer token_fake_admin_unverified' }
        })
      );
      expect(unverifiedAdminRes.status).toBe(403);
    });

    it('allows admin to inspect R2 proof, approve (15-day expiry), reject (reason required), and revoke', async () => {
      await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_adm_1',
        bytes: JPEG_BYTES,
        mimeType: 'image/jpeg',
        fileName: 'shot.jpg'
      });

      // Stream private proof from R2 as admin
      const proofRes = await h.handler(
        new Request('https://worker.local/api/admin/payment/pay_adm_1/proof', {
          headers: { Authorization: 'Bearer token_admin' }
        })
      );
      expect(proofRes.status).toBe(200);
      expect(proofRes.headers.get('Content-Type')).toBe('image/jpeg');
      expect(proofRes.headers.get('Cache-Control')).toBe('private, no-store');
      const streamed = new Uint8Array(await proofRes.arrayBuffer());
      expect(streamed).toEqual(JPEG_BYTES);

      // Approve payment -> 15 days validity from server time
      const t0 = Date.UTC(2026, 10, 5, 12, 0, 0);
      h.setNow(t0);
      const approveRes = await h.handler(
        new Request('https://worker.local/api/admin/payment/pay_adm_1/approve', {
          method: 'POST',
          headers: { Authorization: 'Bearer token_admin' }
        })
      );
      expect(approveRes.status).toBe(200);
      const approveData = (await approveRes.json()) as {
        alreadyProcessed: boolean;
        subscriptionId: string;
        subscription: { activatedAt: number; expiresAt: number };
      };
      expect(approveData.alreadyProcessed).toBe(false);
      expect(approveData.subscription.activatedAt).toBe(t0);
      expect(approveData.subscription.expiresAt).toBe(t0 + 15 * DAY_MS);

      // Duplicate approve does not create duplicate subscription
      const dupApprove = await h.handler(
        new Request('https://worker.local/api/admin/payment/pay_adm_1/approve', {
          method: 'POST',
          headers: { Authorization: 'Bearer token_admin' }
        })
      );
      expect(dupApprove.status).toBe(200);
      expect(((await dupApprove.json()) as { alreadyProcessed: boolean }).alreadyProcessed).toBe(true);

      // Revoke active subscription
      const revokeRes = await h.handler(
        new Request(
          `https://worker.local/api/admin/subscription/${approveData.subscriptionId}/revoke`,
          {
            method: 'POST',
            headers: {
              Authorization: 'Bearer token_admin',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ reason: 'Duplicate UTR refund requested' })
          }
        )
      );
      expect(revokeRes.status).toBe(200);

      // Revoked subscription immediately loses exam access
      const verifyAfterRevoke = await h.handler(
        new Request('https://worker.local/api/examinations/verify-access', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ institutionId: 'inst_a', examType: 'Mid Term' })
        })
      );
      expect(verifyAfterRevoke.status).toBe(403);

      // Submit & reject institution B without reason -> 400, with reason -> 200
      await uploadAndSubmit(h, {
        token: 'token_user_b',
        institutionId: 'inst_b',
        institutionName: 'Beta College',
        paymentRequestId: 'pay_b_rej'
      });
      const badRej = await h.handler(
        new Request('https://worker.local/api/admin/payment/pay_b_rej/reject', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_admin',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ reason: 'no' })
        })
      );
      expect(badRej.status).toBe(400);

      const okRej = await h.handler(
        new Request('https://worker.local/api/admin/payment/pay_b_rej/reject', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_admin',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ reason: 'Screenshot does not match ₹1 UPI credit' })
        })
      );
      expect(okRej.status).toBe(200);
    });
  });

  describe('3. Subscription Lifecycle, Expiry & Renewal Tests', () => {
    it('blocks pending access, unlocks for 15 days, expires cleanly, and unlocks new type on renewal', async () => {
      await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_life_1'
      });

      // Pending cannot create exams
      const pendingAccess = await h.handler(
        new Request('https://worker.local/api/examinations/verify-access', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ institutionId: 'inst_a', examType: 'Unit Test' })
        })
      );
      expect(pendingAccess.status).toBe(403);

      const startMs = Date.UTC(2026, 10, 1, 0, 0, 0);
      h.setNow(startMs);
      await h.handler(
        new Request('https://worker.local/api/admin/payment/pay_life_1/approve', {
          method: 'POST',
          headers: { Authorization: 'Bearer token_admin' }
        })
      );

      // Lock first exam to "Unit Test" on Day 1
      const authRes = await h.handler(
        new Request('https://worker.local/api/examinations/authorize-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            institutionId: 'inst_a',
            examId: 'exam_1',
            examType: 'Unit Test',
            requestId: 'req_1'
          })
        })
      );
      expect(authRes.status).toBe(200);
      const confirmRes = await h.handler(
        new Request('https://worker.local/api/examinations/confirm-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            institutionId: 'inst_a',
            examId: 'exam_1',
            examType: 'Unit Test',
            requestId: 'req_1'
          })
        })
      );
      expect(confirmRes.status).toBe(200);

      // Day 14 -> generates expiring-soon notification
      h.setNow(startMs + 14 * DAY_MS);
      const statusDay14 = await (
        await h.handler(
          new Request('https://worker.local/api/subscription/status?institutionId=inst_a', {
            headers: { Authorization: 'Bearer token_user_a' }
          })
        )
      ).json();
      expect((statusDay14 as { hasActiveAccess: boolean }).hasActiveAccess).toBe(true);
      expect(
        (statusDay14 as { notifications: { type: string }[] }).notifications.some(
          (n) => n.type === 'subscription_expiring_soon'
        )
      ).toBe(true);

      // Day 16 -> expired, blocked from creating, notification inserted
      h.setNow(startMs + 16 * DAY_MS);
      const expiredVerify = await h.handler(
        new Request('https://worker.local/api/examinations/verify-access', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ institutionId: 'inst_a', examType: 'Unit Test' })
        })
      );
      expect(expiredVerify.status).toBe(403);

      const statusExpired = await (
        await h.handler(
          new Request('https://worker.local/api/subscription/status?institutionId=inst_a', {
            headers: { Authorization: 'Bearer token_user_a' }
          })
        )
      ).json();
      expect((statusExpired as { effectiveStatus: string }).effectiveStatus).toBe('expired');
      expect((statusExpired as { lockedExaminationType: string | null }).lockedExaminationType).toBeNull();
      expect(
        (statusExpired as { notifications: { type: string }[] }).notifications.some(
          (n) => n.type === 'subscription_expired'
        )
      ).toBe(true);

      // Renew subscription after expiry -> new subscription unlocks ALL 6 exam types again!
      await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_life_2'
      });
      await h.handler(
        new Request('https://worker.local/api/admin/payment/pay_life_2/approve', {
          method: 'POST',
          headers: { Authorization: 'Bearer token_admin' }
        })
      );

      const newSubAuth = await h.handler(
        new Request('https://worker.local/api/examinations/authorize-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            institutionId: 'inst_a',
            examId: 'exam_2',
            examType: 'Semester Final',
            requestId: 'req_2'
          })
        })
      );
      expect(newSubAuth.status).toBe(200);
    });
  });

  describe('4. Examination-Type Locking Concurrency & Edge-Case Tests', () => {
    beforeEach(async () => {
      await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_lock_1'
      });
      await h.handler(
        new Request('https://worker.local/api/admin/payment/pay_lock_1/approve', {
          method: 'POST',
          headers: { Authorization: 'Bearer token_admin' }
        })
      );
    });

    it('does NOT lock when authorize-create is aborted or failed, and rejects concurrent creation of a second type', async () => {
      // Reserve then abort (simulating draft cancel or failed Firestore write)
      const firstAuth = await h.handler(
        new Request('https://worker.local/api/examinations/authorize-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            institutionId: 'inst_a',
            examId: 'exam_aborted',
            examType: 'Mid Term',
            requestId: 'req_aborted'
          })
        })
      );
      expect(firstAuth.status).toBe(200);

      // Concurrent attempt for a DIFFERENT type while req_aborted is active -> 409 Conflict
      const concurrentAuth = await h.handler(
        new Request('https://worker.local/api/examinations/authorize-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            institutionId: 'inst_a',
            examId: 'exam_race',
            examType: 'Annual Examination',
            requestId: 'req_race'
          })
        })
      );
      expect(concurrentAuth.status).toBe(409);

      // Abort the first attempt
      await h.handler(
        new Request('https://worker.local/api/examinations/abort-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ institutionId: 'inst_a', requestId: 'req_aborted' })
        })
      );

      // Subscription must STILL be unlocked!
      const statusAfterAbort = await (
        await h.handler(
          new Request('https://worker.local/api/subscription/status?institutionId=inst_a', {
            headers: { Authorization: 'Bearer token_user_a' }
          })
        )
      ).json();
      expect((statusAfterAbort as { lockedExaminationType: string | null }).lockedExaminationType).toBeNull();

      // Now successfully create & confirm an "Annual Examination"
      const okAuth = await h.handler(
        new Request('https://worker.local/api/examinations/authorize-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            institutionId: 'inst_a',
            examId: 'exam_annual_1',
            examType: 'Annual Examination',
            requestId: 'req_annual_1'
          })
        })
      );
      expect(okAuth.status).toBe(200);

      const confirmAnnual = await h.handler(
        new Request('https://worker.local/api/examinations/confirm-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            institutionId: 'inst_a',
            examId: 'exam_annual_1',
            examType: 'Annual Examination',
            requestId: 'req_annual_1'
          })
        })
      );
      expect(confirmAnnual.status).toBe(200);

      // Creating second exam of SAME type ("Annual Examination") succeeds
      const sameTypeAuth = await h.handler(
        new Request('https://worker.local/api/examinations/authorize-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            institutionId: 'inst_a',
            examId: 'exam_annual_2',
            examType: 'Annual Examination',
            requestId: 'req_annual_2'
          })
        })
      );
      expect(sameTypeAuth.status).toBe(200);

      // Direct API call for DIFFERENT type ("Practical / Viva") fails with exact Section 5 message
      const wrongTypeAuth = await h.handler(
        new Request('https://worker.local/api/examinations/authorize-create', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_a',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            institutionId: 'inst_a',
            examId: 'exam_viva',
            examType: 'Practical / Viva',
            requestId: 'req_viva'
          })
        })
      );
      expect(wrongTypeAuth.status).toBe(403);
      const wrongBody = (await wrongTypeAuth.json()) as { error: string; code: string };
      expect(wrongBody.code).toBe('EXAM_TYPE_LOCKED');
      expect(wrongBody.error).toBe(getLockedTypeMessage('Annual Examination'));

      // Even if exam docs are deleted in Firestore, D1 lock persists
      const locks = await h.env.DB.prepare(
        'SELECT locked_examination_type FROM examination_type_locks WHERE institution_id = ?'
      )
        .bind('inst_a')
        .first<{ locked_examination_type: string }>();
      expect(locks?.locked_examination_type).toBe('Annual Examination');
    });
  });

  describe('5. Strict Institution Ownership Isolation Tests', () => {
    it('prevents Institution B from reading status, uploading, submitting, verifying, or streaming Institution A data', async () => {
      await uploadAndSubmit(h, {
        token: 'token_user_a',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_iso_a'
      });

      const statusCross = await h.handler(
        new Request('https://worker.local/api/subscription/status?institutionId=inst_a', {
          headers: { Authorization: 'Bearer token_user_b' }
        })
      );
      expect(statusCross.status).toBe(403);

      const uploadCross = await uploadAndSubmit(h, {
        token: 'token_user_b',
        institutionId: 'inst_a',
        institutionName: 'Alpha Academy',
        paymentRequestId: 'pay_iso_hack'
      });
      expect(uploadCross.uploadStatus).toBe(403);

      const proofCross = await h.handler(
        new Request('https://worker.local/api/payment/proof/pay_iso_a', {
          headers: { Authorization: 'Bearer token_user_b' }
        })
      );
      expect(proofCross.status).toBe(403);

      const accessCross = await h.handler(
        new Request('https://worker.local/api/examinations/verify-access', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token_user_b',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ institutionId: 'inst_a', examType: 'Unit Test' })
        })
      );
      expect(accessCross.status).toBe(403);
    });
  });
});
