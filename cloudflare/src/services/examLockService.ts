import { resolveOwnedInstitution } from '../auth';
import { HttpError } from '../http';
import {
  AuthUser,
  Env,
  EXAM_AUTH_LEASE_MS,
  ExamAuthRow,
  getLockedTypeMessage,
  isAllowedExamType,
  isValidId,
  makeWorkerId,
  SubscriptionRow,
  WorkerDeps
} from '../types';
import { syncInstitutionSubscriptionExpiries } from './subscriptionService';

function normalizeExamType(raw: string): string {
  const trimmed = (raw || '').trim();
  return trimmed === 'Mid-Term' ? 'Mid Term' : trimmed;
}

async function getActiveInstitutionSubscription(
  db: D1Database,
  institutionId: string,
  nowMs: number
): Promise<SubscriptionRow> {
  await syncInstitutionSubscriptionExpiries(db, institutionId, nowMs);

  const sub = await db
    .prepare(
      `SELECT * FROM subscriptions
       WHERE institution_id = ? AND approval_status = 'approved' AND payment_status = 'approved'
       ORDER BY created_at_ms DESC LIMIT 1`
    )
    .bind(institutionId)
    .first<SubscriptionRow>();

  if (!sub) {
    throw new HttpError(
      403,
      'An active ₹1 Exam Planner subscription is required to access this feature.',
      'SUBSCRIPTION_REQUIRED'
    );
  }
  if (sub.expires_at_ms <= nowMs) {
    throw new HttpError(
      403,
      'Your subscription has expired. Renew for ₹1 to continue creating examinations.',
      'SUBSCRIPTION_EXPIRED'
    );
  }
  return sub;
}

export async function verifyFeatureAccess(
  institutionId: string,
  examType: string | undefined,
  auth: AuthUser,
  env: Env,
  deps: WorkerDeps,
  nowMs: number
) {
  const institution = await resolveOwnedInstitution(institutionId, auth, env, deps, nowMs);
  const sub = await getActiveInstitutionSubscription(env.DB, institution.id, nowMs);

  if (examType !== undefined) {
    const normalized = normalizeExamType(examType);
    if (!isAllowedExamType(normalized)) {
      throw new HttpError(
        400,
        `Invalid examination type "${normalized}". Select one of the 6 supported examination types.`,
        'INVALID_EXAM_TYPE'
      );
    }
    if (sub.examination_type_locked === 1 && sub.locked_examination_type !== normalized) {
      throw new HttpError(
        403,
        getLockedTypeMessage(sub.locked_examination_type || ''),
        'EXAM_TYPE_LOCKED'
      );
    }
  }

  return {
    authorized: true,
    subscriptionId: sub.subscription_id,
    expiresAt: sub.expires_at_ms,
    examinationTypeLocked: Boolean(sub.examination_type_locked),
    lockedExaminationType: sub.locked_examination_type
  };
}

/**
 * Phase 1 of creating a new examination:
 * Validates active subscription + examination type lock + concurrency lease in D1.
 * Does NOT permanently lock the examination type yet so a failed Firestore write never permanently locks.
 */
export async function authorizeExamCreation(
  body: {
    institutionId?: string;
    examId?: string;
    examType?: string;
    requestId?: string;
  },
  auth: AuthUser,
  env: Env,
  deps: WorkerDeps,
  nowMs: number
) {
  if (!isValidId(body.institutionId)) {
    throw new HttpError(400, 'Valid institutionId is required.', 'INVALID_INSTITUTION_ID');
  }
  if (!isValidId(body.examId)) {
    throw new HttpError(400, 'Valid examId is required.', 'INVALID_EXAM_ID');
  }
  const normalizedType = normalizeExamType(body.examType || '');
  if (!isAllowedExamType(normalizedType)) {
    throw new HttpError(
      400,
      `Invalid examination type "${normalizedType}". Choose one of the 6 supported examination types.`,
      'INVALID_EXAM_TYPE'
    );
  }

  const institution = await resolveOwnedInstitution(body.institutionId, auth, env, deps, nowMs);
  const sub = await getActiveInstitutionSubscription(env.DB, institution.id, nowMs);

  if (sub.examination_type_locked === 1) {
    if (sub.locked_examination_type !== normalizedType) {
      throw new HttpError(
        403,
        getLockedTypeMessage(sub.locked_examination_type || ''),
        'EXAM_TYPE_LOCKED'
      );
    }
    const reqId = isValidId(body.requestId) ? body.requestId : makeWorkerId('exauth', nowMs);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO exam_creation_authorizations (
        request_id, institution_id, subscription_id, user_id, exam_id, exam_type,
        status, expires_at_ms, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`
    )
      .bind(
        reqId,
        institution.id,
        sub.subscription_id,
        auth.uid,
        body.examId,
        normalizedType,
        nowMs + EXAM_AUTH_LEASE_MS,
        nowMs
      )
      .run();

    return {
      authorized: true,
      requestId: reqId,
      subscriptionId: sub.subscription_id,
      examType: normalizedType,
      alreadyLocked: true
    };
  }

  // Subscription is NOT locked yet: serialize concurrent creation attempts cleanly via lease check
  const reqId = isValidId(body.requestId) ? body.requestId : makeWorkerId('exauth', nowMs);

  // Expire stale leases first
  await env.DB.prepare(
    `UPDATE exam_creation_authorizations
     SET status = 'aborted'
     WHERE subscription_id = ? AND status = 'reserved' AND expires_at_ms <= ?`
  )
    .bind(sub.subscription_id, nowMs)
    .run();

  // Check for idempotent replay of same requestId
  const sameReq = await env.DB.prepare(
    'SELECT * FROM exam_creation_authorizations WHERE request_id = ?'
  )
    .bind(reqId)
    .first<ExamAuthRow>();
  if (sameReq) {
    if (sameReq.user_id !== auth.uid || sameReq.institution_id !== institution.id) {
      throw new HttpError(403, 'Authorization request belongs to another user.', 'FORBIDDEN');
    }
    if (sameReq.exam_type !== normalizedType) {
      throw new HttpError(
        409,
        'Authorization request ID cannot be reused for a different examination type.',
        'AUTH_CONFLICT'
      );
    }
    return {
      authorized: true,
      requestId: reqId,
      subscriptionId: sub.subscription_id,
      examType: normalizedType,
      alreadyLocked: false
    };
  }

  const activeOtherLease = await env.DB.prepare(
    `SELECT * FROM exam_creation_authorizations
     WHERE subscription_id = ? AND status = 'reserved' AND expires_at_ms > ? AND request_id != ?
     LIMIT 1`
  )
    .bind(sub.subscription_id, nowMs, reqId)
    .first<ExamAuthRow>();

  if (activeOtherLease) {
    throw new HttpError(
      409,
      `Another examination creation (${activeOtherLease.exam_type}) is currently in progress. Please wait for it to finish.`,
      'CONCURRENT_EXAM_CREATION'
    );
  }

  await env.DB.prepare(
    `INSERT INTO exam_creation_authorizations (
      request_id, institution_id, subscription_id, user_id, exam_id, exam_type,
      status, expires_at_ms, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, 'reserved', ?, ?)`
  )
    .bind(
      reqId,
      institution.id,
      sub.subscription_id,
      auth.uid,
      body.examId,
      normalizedType,
      nowMs + EXAM_AUTH_LEASE_MS,
      nowMs
    )
    .run();

  return {
    authorized: true,
    requestId: reqId,
    subscriptionId: sub.subscription_id,
    examType: normalizedType,
    alreadyLocked: false
  };
}

/**
 * Phase 2 of creating a new examination:
 * Called ONLY after the examination document is successfully saved.
 * Atomically & permanently locks the subscription's examination type on the first created exam.
 */
export async function confirmExamCreated(
  body: {
    institutionId?: string;
    requestId?: string;
    examId?: string;
    examType?: string;
  },
  auth: AuthUser,
  env: Env,
  deps: WorkerDeps,
  nowMs: number
) {
  if (!isValidId(body.institutionId) || !isValidId(body.requestId) || !isValidId(body.examId)) {
    throw new HttpError(
      400,
      'institutionId, requestId, and examId are required.',
      'INVALID_PARAMETERS'
    );
  }

  const institution = await resolveOwnedInstitution(body.institutionId, auth, env, deps, nowMs);
  const authRow = await env.DB.prepare(
    'SELECT * FROM exam_creation_authorizations WHERE request_id = ?'
  )
    .bind(body.requestId)
    .first<ExamAuthRow>();

  if (!authRow || authRow.user_id !== auth.uid || authRow.institution_id !== institution.id) {
    throw new HttpError(404, 'Examination authorization reservation not found.', 'NOT_FOUND');
  }

  if (authRow.exam_id !== body.examId) {
    throw new HttpError(409, 'Examination ID mismatch for authorization request.', 'EXAM_ID_MISMATCH');
  }

  if (authRow.status === 'aborted') {
    throw new HttpError(409, 'Examination authorization was aborted or expired.', 'AUTH_ABORTED');
  }

  const sub = await getActiveInstitutionSubscription(env.DB, institution.id, nowMs);

  // If already locked to a DIFFERENT type (e.g. race safeguard), reject
  if (sub.examination_type_locked === 1 && sub.locked_examination_type !== authRow.exam_type) {
    await env.DB.prepare(
      `UPDATE exam_creation_authorizations SET status = 'aborted' WHERE request_id = ?`
    )
      .bind(authRow.request_id)
      .run();
    throw new HttpError(
      403,
      getLockedTypeMessage(sub.locked_examination_type || ''),
      'EXAM_TYPE_LOCKED'
    );
  }

  if (sub.examination_type_locked === 0) {
    // Conditional atomic lock: succeeds only if locked_examination_type IS NULL
    const lockRes = await env.DB.prepare(
      `UPDATE subscriptions
       SET examination_type_locked = 1,
           locked_examination_type = ?,
           first_examination_created_at_ms = ?,
           first_exam_id = ?,
           updated_at_ms = ?
       WHERE subscription_id = ? AND examination_type_locked = 0`
    )
      .bind(authRow.exam_type, nowMs, body.examId, nowMs, sub.subscription_id)
      .run();

    if ((lockRes.meta?.changes ?? 0) === 1) {
      const auditId = makeWorkerId('audit', nowMs);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO examination_type_locks (
            subscription_id, institution_id, locked_examination_type, first_exam_id, locked_at_ms
          ) VALUES (?, ?, ?, ?, ?)`
        ).bind(sub.subscription_id, institution.id, authRow.exam_type, body.examId, nowMs),
        env.DB.prepare(
          `INSERT INTO subscription_audit_logs (
            id, actor_uid, actor_email, actor_role, action, target_type, target_id,
            institution_id, summary, reason, created_at_ms
          ) VALUES (?, ?, ?, 'user', 'EXAM_TYPE_LOCKED', 'subscription', ?, ?, ?, NULL, ?)`
        ).bind(
          auditId,
          auth.uid,
          auth.email,
          sub.subscription_id,
          institution.id,
          `Locked subscription ${sub.subscription_id} to "${authRow.exam_type}" upon first examination creation (${body.examId}).`,
          nowMs
        )
      ]);
    } else {
      // Re-verify locked type if another request won the race
      const refreshed = await env.DB.prepare(
        'SELECT locked_examination_type FROM subscriptions WHERE subscription_id = ?'
      )
        .bind(sub.subscription_id)
        .first<{ locked_examination_type: string | null }>();
      if (refreshed?.locked_examination_type !== authRow.exam_type) {
        throw new HttpError(
          403,
          getLockedTypeMessage(refreshed?.locked_examination_type || ''),
          'EXAM_TYPE_LOCKED'
        );
      }
    }
  }

  await env.DB.prepare(
    `UPDATE exam_creation_authorizations SET status = 'committed' WHERE request_id = ?`
  )
    .bind(authRow.request_id)
    .run();

  return {
    confirmed: true,
    subscriptionId: sub.subscription_id,
    examinationTypeLocked: true,
    lockedExaminationType: authRow.exam_type
  };
}

export async function abortExamCreation(
  body: { institutionId?: string; requestId?: string },
  auth: AuthUser,
  env: Env,
  deps: WorkerDeps,
  nowMs: number
) {
  if (!isValidId(body.institutionId) || !isValidId(body.requestId)) {
    throw new HttpError(400, 'institutionId and requestId are required.', 'INVALID_PARAMETERS');
  }
  const institution = await resolveOwnedInstitution(body.institutionId, auth, env, deps, nowMs);
  await env.DB.prepare(
    `UPDATE exam_creation_authorizations
     SET status = 'aborted'
     WHERE request_id = ? AND institution_id = ? AND user_id = ? AND status = 'reserved'`
  )
    .bind(body.requestId, institution.id, auth.uid)
    .run();
  return { aborted: true };
}
