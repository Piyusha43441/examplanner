import { resolveOwnedInstitution } from '../auth';
import { HttpError } from '../http';
import { enforceRateLimit } from '../rateLimit';
import {
  AuthUser,
  Env,
  isValidId,
  makeWorkerId,
  NotificationRow,
  PaymentRequestRow,
  PLAN_AMOUNT,
  PLAN_CURRENCY,
  PLAN_ID,
  PLAN_UPI_ID,
  SubscriptionRow,
  UploadedProofRow,
  WorkerDeps
} from '../types';

const EXPIRING_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

export function formatTxnRefDisplay(refId: string | null | undefined): string {
  const trimmed = (refId ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Not Provided';
}

export async function syncInstitutionSubscriptionExpiries(
  db: D1Database,
  institutionId: string | null,
  nowMs: number
): Promise<void> {
  const expiredQuery = institutionId
    ? db
        .prepare(
          `SELECT * FROM subscriptions
           WHERE institution_id = ? AND approval_status = 'approved' AND expires_at_ms <= ?`
        )
        .bind(institutionId, nowMs)
    : db
        .prepare(
          `SELECT * FROM subscriptions
           WHERE approval_status = 'approved' AND expires_at_ms <= ?`
        )
        .bind(nowMs);

  const expiredRes = await expiredQuery.all<SubscriptionRow>();
  for (const sub of expiredRes.results || []) {
    const updateRes = await db
      .prepare(
        `UPDATE subscriptions
         SET approval_status = 'expired', updated_at_ms = ?
         WHERE subscription_id = ? AND approval_status = 'approved'`
      )
      .bind(nowMs, sub.subscription_id)
      .run();

    if ((updateRes.meta?.changes ?? 0) > 0) {
      await db
        .prepare(
          `INSERT OR IGNORE INTO notifications (
            id, institution_id, owner_uid, type, title, message, read, related_id, created_at_ms
          ) VALUES (?, ?, ?, 'subscription_expired', ?, ?, 0, ?, ?)`
        )
        .bind(
          `notif_exp_${sub.subscription_id}`,
          sub.institution_id,
          sub.owner_uid,
          'Subscription Expired',
          'Your 15-day Exam Planner Access subscription has expired. Renew for ₹1 to continue creating examinations.',
          sub.subscription_id,
          nowMs
        )
        .run();
    }
  }

  if (institutionId) {
    const expiringSoon = await db
      .prepare(
        `SELECT * FROM subscriptions
         WHERE institution_id = ? AND approval_status = 'approved' AND payment_status = 'approved'
           AND expires_at_ms > ? AND expires_at_ms <= ?`
      )
      .bind(institutionId, nowMs, nowMs + EXPIRING_SOON_WINDOW_MS)
      .all<SubscriptionRow>();

    for (const sub of expiringSoon.results || []) {
      const hoursLeft = Math.max(1, Math.ceil((sub.expires_at_ms - nowMs) / (60 * 60 * 1000)));
      await db
        .prepare(
          `INSERT OR IGNORE INTO notifications (
            id, institution_id, owner_uid, type, title, message, read, related_id, created_at_ms
          ) VALUES (?, ?, ?, 'subscription_expiring_soon', ?, ?, 0, ?, ?)`
        )
        .bind(
          `notif_soon_${sub.subscription_id}`,
          sub.institution_id,
          sub.owner_uid,
          'Subscription Expiring Soon',
          `Your Exam Planner subscription expires in approximately ${hoursLeft} hour(s). Renew for ₹1 once expired to continue creating examinations.`,
          sub.subscription_id,
          nowMs
        )
        .run();
    }
  }
}

export function serializeSubscription(row: SubscriptionRow) {
  return {
    subscriptionId: row.subscription_id,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    ownerId: row.owner_uid,
    userEmail: row.user_email,
    paymentRequestId: row.payment_request_id,
    planName: row.plan_name,
    amount: row.amount,
    currency: row.currency,
    paymentStatus: row.payment_status,
    approvalStatus: row.approval_status,
    activatedAt: row.activated_at_ms,
    expiresAt: row.expires_at_ms,
    examinationTypeLocked: Boolean(row.examination_type_locked),
    lockedExaminationType: row.locked_examination_type,
    firstExaminationCreatedAt: row.first_examination_created_at_ms,
    firstExamId: row.first_exam_id,
    approvedBy: row.approved_by,
    revokedAt: row.revoked_at_ms,
    revokedBy: row.revoked_by,
    revocationReason: row.revocation_reason,
    createdAt: row.created_at_ms,
    updatedAt: row.updated_at_ms
  };
}

export function serializePaymentRequest(row: PaymentRequestRow) {
  return {
    paymentRequestId: row.payment_request_id,
    institutionId: row.institution_id,
    institutionName: row.institution_name,
    userId: row.user_id,
    userEmail: row.user_email,
    planId: row.plan_id,
    amount: row.amount,
    currency: row.currency,
    upiId: row.upi_id,
    transactionReferenceId: row.transaction_reference_id,
    screenshotStoragePath: row.screenshot_storage_key,
    screenshotFileName: row.screenshot_file_name,
    screenshotMimeType: row.screenshot_mime_type,
    screenshotSizeBytes: row.screenshot_size_bytes,
    status: row.status,
    submittedAt: row.submitted_at_ms,
    reviewedAt: row.reviewed_at_ms,
    reviewedBy: row.reviewed_by,
    rejectionReason: row.rejection_reason,
    subscriptionId: row.subscription_id
  };
}

export function serializeNotification(row: NotificationRow) {
  return {
    id: row.id,
    institutionId: row.institution_id,
    ownerId: row.owner_uid,
    type: row.type,
    title: row.title,
    message: row.message,
    read: Boolean(row.read),
    relatedId: row.related_id,
    createdAt: row.created_at_ms
  };
}

export async function handleSubmitPayment(
  body: {
    paymentRequestId?: string;
    institutionId?: string;
    institutionName?: string;
    transactionReferenceId?: string | null;
    objectKey?: string;
    fileName?: string;
    mimeType?: string;
  },
  auth: AuthUser,
  env: Env,
  deps: WorkerDeps,
  nowMs: number
) {
  await enforceRateLimit(env.DB, `submit:${auth.uid}`, 15, 15 * 60 * 1000, nowMs);

  if (!isValidId(body.institutionId)) {
    throw new HttpError(400, 'Valid institutionId is required.', 'INVALID_INSTITUTION_ID');
  }
  if (!isValidId(body.paymentRequestId)) {
    throw new HttpError(400, 'Valid paymentRequestId is required.', 'INVALID_PAYMENT_REQUEST_ID');
  }
  if (typeof body.objectKey !== 'string' || !body.objectKey.trim()) {
    throw new HttpError(
      400,
      'Please upload your payment proof screenshot or PDF first.',
      'MISSING_PROOF_OBJECT'
    );
  }

  const trimmedTxn = (body.transactionReferenceId ?? '').trim();
  if (trimmedTxn.length > 120) {
    throw new HttpError(400, 'UPI Transaction ID must not exceed 120 characters.', 'INVALID_TXN_ID');
  }
  const normalizedTxn: string | null = trimmedTxn.length > 0 ? trimmedTxn : null;

  const institution = await resolveOwnedInstitution(
    body.institutionId,
    auth,
    env,
    deps,
    nowMs,
    body.institutionName
  );

  await syncInstitutionSubscriptionExpiries(env.DB, institution.id, nowMs);

  // Idempotent replay check: if this exact paymentRequestId already saved by same user, return it cleanly
  const existingPr = await env.DB.prepare(
    'SELECT * FROM payment_requests WHERE payment_request_id = ?'
  )
    .bind(body.paymentRequestId)
    .first<PaymentRequestRow>();

  if (existingPr) {
    if (existingPr.user_id !== auth.uid || existingPr.institution_id !== institution.id) {
      throw new HttpError(
        409,
        'Payment request ID conflict with another submission.',
        'PAYMENT_REQUEST_CONFLICT'
      );
    }
    return serializePaymentRequest(existingPr);
  }

  // Block if institution already has an active subscription
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

  // Block duplicate pending requests for same institution
  const otherPending = await env.DB.prepare(
    `SELECT payment_request_id FROM payment_requests
     WHERE institution_id = ? AND status = 'pending'
     LIMIT 1`
  )
    .bind(institution.id)
    .first<{ payment_request_id: string }>();
  if (otherPending) {
    throw new HttpError(
      409,
      'You already have a pending payment verification request awaiting administrator review.',
      'PENDING_PAYMENT_EXISTS'
    );
  }

  // Verify the uploaded proof exists in uploaded_proof_objects AND in R2 bucket
  const uploadedProof = await env.DB.prepare(
    'SELECT * FROM uploaded_proof_objects WHERE payment_request_id = ? AND storage_key = ?'
  )
    .bind(body.paymentRequestId, body.objectKey.trim())
    .first<UploadedProofRow>();

  if (!uploadedProof || uploadedProof.user_id !== auth.uid || uploadedProof.institution_id !== institution.id) {
    throw new HttpError(
      400,
      'Uploaded payment proof record could not be verified for your account. Please upload the proof again.',
      'PROOF_UPLOAD_NOT_FOUND'
    );
  }

  const r2Head = await env.PROOF_BUCKET.head(uploadedProof.storage_key);
  if (!r2Head) {
    throw new HttpError(
      400,
      'Payment proof file is missing from R2 storage. Please upload the proof again.',
      'R2_OBJECT_MISSING'
    );
  }

  const auditId = makeWorkerId('audit', nowMs);
  const instDisplayName = (body.institutionName?.trim() || institution.name || 'Institution').slice(0, 180);
  const userEmail = (auth.email || institution.user_email || '').slice(0, 160);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO payment_requests (
        payment_request_id, institution_id, institution_name, user_id, user_email,
        plan_id, amount, currency, upi_id, transaction_reference_id,
        screenshot_storage_key, screenshot_file_name, screenshot_mime_type, screenshot_size_bytes,
        status, submitted_at_ms, reviewed_at_ms, reviewed_by, rejection_reason, subscription_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL)`
    ).bind(
      body.paymentRequestId,
      institution.id,
      instDisplayName,
      auth.uid,
      userEmail,
      PLAN_ID,
      PLAN_AMOUNT,
      PLAN_CURRENCY,
      PLAN_UPI_ID,
      normalizedTxn,
      uploadedProof.storage_key,
      uploadedProof.original_file_name,
      uploadedProof.mime_type,
      uploadedProof.size_bytes,
      nowMs
    ),
    env.DB.prepare('UPDATE uploaded_proof_objects SET committed = 1 WHERE payment_request_id = ?').bind(
      body.paymentRequestId
    ),
    env.DB.prepare(
      `INSERT INTO subscription_audit_logs (
        id, actor_uid, actor_email, actor_role, action, target_type, target_id,
        institution_id, summary, reason, created_at_ms
      ) VALUES (?, ?, ?, 'user', 'PAYMENT_REQUEST_SUBMITTED', 'paymentRequest', ?, ?, ?, NULL, ?)`
    ).bind(
      auditId,
      auth.uid,
      userEmail,
      body.paymentRequestId,
      institution.id,
      `Submitted ₹${PLAN_AMOUNT} UPI payment request (Ref: ${formatTxnRefDisplay(normalizedTxn)}) for manual verification.`,
      nowMs
    )
  ]);

  const saved = await env.DB.prepare(
    'SELECT * FROM payment_requests WHERE payment_request_id = ?'
  )
    .bind(body.paymentRequestId)
    .first<PaymentRequestRow>();

  if (!saved) {
    throw new HttpError(500, 'Payment request failed to persist.', 'PERSIST_FAILED');
  }
  return serializePaymentRequest(saved);
}

export async function getSubscriptionStatusPayload(
  institutionIdParam: string | null,
  institutionNameParam: string | null,
  auth: AuthUser,
  env: Env,
  deps: WorkerDeps,
  nowMs: number
) {
  const institution = await resolveOwnedInstitution(
    institutionIdParam,
    auth,
    env,
    deps,
    nowMs,
    institutionNameParam || undefined
  );

  await syncInstitutionSubscriptionExpiries(env.DB, institution.id, nowMs);

  const [subsRes, reqsRes, notifsRes] = await Promise.all([
    env.DB.prepare(
      'SELECT * FROM subscriptions WHERE institution_id = ? ORDER BY created_at_ms DESC'
    )
      .bind(institution.id)
      .all<SubscriptionRow>(),
    env.DB.prepare(
      'SELECT * FROM payment_requests WHERE institution_id = ? ORDER BY submitted_at_ms DESC'
    )
      .bind(institution.id)
      .all<PaymentRequestRow>(),
    env.DB.prepare(
      'SELECT * FROM notifications WHERE institution_id = ? AND owner_uid = ? ORDER BY created_at_ms DESC LIMIT 30'
    )
      .bind(institution.id, auth.uid)
      .all<NotificationRow>()
  ]);

  const subscriptions = (subsRes.results || []).map(serializeSubscription);
  const paymentRequests = (reqsRes.results || []).map(serializePaymentRequest);
  const notifications = (notifsRes.results || []).map(serializeNotification);

  const activeSubscription =
    subscriptions.find(
      (s) =>
        s.approvalStatus === 'approved' &&
        s.paymentStatus === 'approved' &&
        s.expiresAt > nowMs
    ) ?? null;

  const latestSubscription = subscriptions[0] ?? null;
  const pendingPaymentRequest = paymentRequests.find((r) => r.status === 'pending') ?? null;
  const latestPaymentRequest = paymentRequests[0] ?? null;

  let effectiveStatus: 'none' | 'pending' | 'active' | 'expired' | 'rejected' | 'revoked' = 'none';
  if (activeSubscription) {
    effectiveStatus = 'active';
  } else if (pendingPaymentRequest) {
    effectiveStatus = 'pending';
  } else if (latestSubscription) {
    if (latestSubscription.approvalStatus === 'revoked') {
      effectiveStatus = 'revoked';
    } else if (
      latestSubscription.approvalStatus === 'expired' ||
      (latestSubscription.approvalStatus === 'approved' && latestSubscription.expiresAt <= nowMs)
    ) {
      effectiveStatus = 'expired';
    }
  } else if (latestPaymentRequest?.status === 'rejected') {
    effectiveStatus = 'rejected';
  }

  // Handle case where user had an older expired sub and then submitted & got rejected on a renewal
  if (
    !activeSubscription &&
    !pendingPaymentRequest &&
    latestPaymentRequest?.status === 'rejected' &&
    latestSubscription &&
    latestPaymentRequest.submittedAt > latestSubscription.createdAt
  ) {
    effectiveStatus = 'rejected';
  }

  const remainingMs = activeSubscription ? Math.max(0, activeSubscription.expiresAt - nowMs) : 0;
  const remainingDays =
    remainingMs > 0 ? Math.ceil(remainingMs / (24 * 60 * 60 * 1000)) : 0;

  return {
    serverNowMs: nowMs,
    institutionId: institution.id,
    effectiveStatus,
    hasActiveAccess: Boolean(activeSubscription),
    activeSubscription,
    latestSubscription,
    pendingPaymentRequest,
    latestPaymentRequest,
    lockedExaminationType: activeSubscription?.examinationTypeLocked
      ? activeSubscription.lockedExaminationType
      : null,
    remainingDays,
    remainingMs,
    subscriptions,
    paymentRequests,
    notifications,
    unreadNotificationCount: notifications.filter((n) => !n.read).length
  };
}

export async function markNotificationRead(
  notificationId: string,
  auth: AuthUser,
  env: Env
): Promise<{ ok: true }> {
  if (!isValidId(notificationId)) {
    throw new HttpError(400, 'Invalid notification ID.', 'INVALID_ID');
  }
  const existing = await env.DB.prepare('SELECT id, owner_uid FROM notifications WHERE id = ?')
    .bind(notificationId)
    .first<{ id: string; owner_uid: string }>();
  if (!existing) {
    throw new HttpError(404, 'Notification not found.', 'NOT_FOUND');
  }
  if (existing.owner_uid !== auth.uid) {
    throw new HttpError(403, 'Access denied.', 'FORBIDDEN');
  }
  await env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND owner_uid = ?')
    .bind(notificationId, auth.uid)
    .run();
  return { ok: true };
}
