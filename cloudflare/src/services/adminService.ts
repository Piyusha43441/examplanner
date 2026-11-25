import { HttpError } from '../http';
import {
  AuditLogRow,
  AuthUser,
  Env,
  InstitutionRow,
  isValidId,
  makeWorkerId,
  PaymentRequestRow,
  PLAN_AMOUNT,
  PLAN_CURRENCY,
  PLAN_NAME,
  PLAN_VALIDITY_MS,
  SubscriptionRow
} from '../types';
import {
  formatTxnRefDisplay,
  serializePaymentRequest,
  serializeSubscription,
  syncInstitutionSubscriptionExpiries
} from './subscriptionService';

export async function getAdminDashboardData(env: Env, nowMs: number) {
  await syncInstitutionSubscriptionExpiries(env.DB, null, nowMs);

  const [instRes, reqRes, subRes, logRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM institutions ORDER BY updated_at_ms DESC').all<InstitutionRow>(),
    env.DB.prepare('SELECT * FROM payment_requests ORDER BY submitted_at_ms DESC').all<PaymentRequestRow>(),
    env.DB.prepare('SELECT * FROM subscriptions ORDER BY created_at_ms DESC').all<SubscriptionRow>(),
    env.DB.prepare('SELECT * FROM subscription_audit_logs ORDER BY created_at_ms DESC LIMIT 200').all<AuditLogRow>()
  ]);

  const institutions = (instRes.results || []).map((i) => ({
    id: i.id,
    ownerId: i.owner_uid,
    name: i.name,
    userEmail: i.user_email,
    createdAt: i.created_at_ms,
    updatedAt: i.updated_at_ms
  }));
  const paymentRequests = (reqRes.results || []).map(serializePaymentRequest);
  const subscriptions = (subRes.results || []).map(serializeSubscription);
  const auditLogs = (logRes.results || []).map((l) => ({
    id: l.id,
    adminUid: l.actor_uid,
    adminEmail: l.actor_email,
    actorRole: l.actor_role,
    action: l.action,
    targetType: l.target_type,
    targetId: l.target_id,
    institutionId: l.institution_id,
    summary: l.summary,
    reason: l.reason,
    createdAt: l.created_at_ms
  }));

  const pendingPayments = paymentRequests.filter((p) => p.status === 'pending').length;
  const approvedPayments = paymentRequests.filter((p) => p.status === 'approved').length;
  const rejectedPayments = paymentRequests.filter((p) => p.status === 'rejected').length;

  const activeSubscriptions = subscriptions.filter(
    (s) => s.approvalStatus === 'approved' && s.paymentStatus === 'approved' && s.expiresAt > nowMs
  ).length;
  const expiredSubscriptions = subscriptions.filter(
    (s) =>
      s.approvalStatus === 'expired' ||
      (s.approvalStatus === 'approved' && s.expiresAt <= nowMs)
  ).length;
  const revokedSubscriptions = subscriptions.filter((s) => s.approvalStatus === 'revoked').length;
  const totalCollectedAmount = paymentRequests
    .filter((p) => p.status === 'approved')
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  return {
    serverNowMs: nowMs,
    stats: {
      totalInstitutions: institutions.length,
      totalPaymentRequests: paymentRequests.length,
      pendingPayments,
      approvedPayments,
      rejectedPayments,
      activeSubscriptions,
      expiredSubscriptions,
      revokedSubscriptions,
      totalCollectedAmount
    },
    institutions,
    paymentRequests,
    subscriptions,
    auditLogs
  };
}

export async function listAdminPayments(
  env: Env,
  filters: { status?: string; search?: string }
) {
  const reqRes = await env.DB.prepare(
    'SELECT * FROM payment_requests ORDER BY submitted_at_ms DESC'
  ).all<PaymentRequestRow>();

  const statusFilter = (filters.status || 'all').toLowerCase();
  const q = (filters.search || '').trim().toLowerCase();

  return (reqRes.results || [])
    .map(serializePaymentRequest)
    .filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.institutionName.toLowerCase().includes(q) ||
        p.userEmail.toLowerCase().includes(q) ||
        p.paymentRequestId.toLowerCase().includes(q) ||
        (p.transactionReferenceId || '').toLowerCase().includes(q)
      );
    });
}

export async function getAdminPaymentById(paymentRequestId: string, env: Env) {
  if (!isValidId(paymentRequestId)) {
    throw new HttpError(400, 'Invalid paymentRequestId.', 'INVALID_ID');
  }
  const pr = await env.DB.prepare('SELECT * FROM payment_requests WHERE payment_request_id = ?')
    .bind(paymentRequestId)
    .first<PaymentRequestRow>();
  if (!pr) {
    throw new HttpError(404, 'Payment request not found.', 'NOT_FOUND');
  }
  return serializePaymentRequest(pr);
}

export async function approvePaymentByAdmin(
  paymentRequestId: string,
  auth: AuthUser,
  env: Env,
  nowMs: number
) {
  if (!isValidId(paymentRequestId)) {
    throw new HttpError(400, 'Invalid paymentRequestId.', 'INVALID_ID');
  }

  const pr = await env.DB.prepare('SELECT * FROM payment_requests WHERE payment_request_id = ?')
    .bind(paymentRequestId)
    .first<PaymentRequestRow>();
  if (!pr) {
    throw new HttpError(404, 'Payment request not found.', 'NOT_FOUND');
  }

  // Idempotent return if this payment request was already approved
  if (pr.status === 'approved' && pr.subscription_id) {
    const existingSub = await env.DB.prepare('SELECT * FROM subscriptions WHERE subscription_id = ?')
      .bind(pr.subscription_id)
      .first<SubscriptionRow>();
    return {
      alreadyProcessed: true,
      subscriptionId: pr.subscription_id,
      subscription: existingSub ? serializeSubscription(existingSub) : null
    };
  }

  if (pr.status !== 'pending') {
    throw new HttpError(
      409,
      `Payment request is already ${pr.status} and cannot be approved.`,
      'PAYMENT_NOT_PENDING'
    );
  }

  const subscriptionId = makeWorkerId('sub', nowMs);
  const notificationId = makeWorkerId('notif', nowMs);
  const auditId = makeWorkerId('audit', nowMs);
  const expiresAtMs = nowMs + PLAN_VALIDITY_MS;
  const refDisplay = formatTxnRefDisplay(pr.transaction_reference_id);

  // Atomic conditional status transition prevents double-approval race conditions
  const claimRes = await env.DB.prepare(
    `UPDATE payment_requests
     SET status = 'approved', reviewed_at_ms = ?, reviewed_by = ?, subscription_id = ?
     WHERE payment_request_id = ? AND status = 'pending'`
  )
    .bind(nowMs, auth.email, subscriptionId, paymentRequestId)
    .run();

  if ((claimRes.meta?.changes ?? 0) !== 1) {
    const reread = await env.DB.prepare('SELECT * FROM payment_requests WHERE payment_request_id = ?')
      .bind(paymentRequestId)
      .first<PaymentRequestRow>();
    if (reread?.status === 'approved' && reread.subscription_id) {
      return {
        alreadyProcessed: true,
        subscriptionId: reread.subscription_id,
        subscription: null
      };
    }
    throw new HttpError(409, 'Payment request status changed concurrently.', 'CONCURRENT_CONFLICT');
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO subscriptions (
        subscription_id, institution_id, institution_name, owner_uid, user_email,
        payment_request_id, plan_name, amount, currency, payment_status, approval_status,
        activated_at_ms, expires_at_ms, examination_type_locked, locked_examination_type,
        first_examination_created_at_ms, first_exam_id, approved_by,
        revoked_at_ms, revoked_by, revocation_reason, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', 'approved', ?, ?, 0, NULL, NULL, NULL, ?, NULL, NULL, NULL, ?, ?)`
    ).bind(
      subscriptionId,
      pr.institution_id,
      pr.institution_name,
      pr.user_id,
      pr.user_email,
      pr.payment_request_id,
      PLAN_NAME,
      PLAN_AMOUNT,
      PLAN_CURRENCY,
      nowMs,
      expiresAtMs,
      auth.email,
      nowMs,
      nowMs
    ),
    env.DB.prepare(
      `INSERT INTO notifications (
        id, institution_id, owner_uid, type, title, message, read, related_id, created_at_ms
      ) VALUES (?, ?, ?, 'payment_approved', ?, ?, 0, ?, ?)`
    ).bind(
      notificationId,
      pr.institution_id,
      pr.user_id,
      'Subscription Approved',
      `Your ₹1 Exam Planner Access payment (Ref: ${refDisplay}) has been approved. Your 15-day subscription is now active.`,
      subscriptionId,
      nowMs
    ),
    env.DB.prepare(
      `INSERT INTO subscription_audit_logs (
        id, actor_uid, actor_email, actor_role, action, target_type, target_id,
        institution_id, summary, reason, created_at_ms
      ) VALUES (?, ?, ?, 'admin', 'PAYMENT_APPROVED', 'paymentRequest', ?, ?, ?, NULL, ?)`
    ).bind(
      auditId,
      auth.uid,
      auth.email,
      pr.payment_request_id,
      pr.institution_id,
      `Approved ₹${pr.amount} UPI payment (${refDisplay}) for "${pr.institution_name}" and activated 15-day subscription ${subscriptionId}.`,
      nowMs
    )
  ]);

  const createdSub = await env.DB.prepare('SELECT * FROM subscriptions WHERE subscription_id = ?')
    .bind(subscriptionId)
    .first<SubscriptionRow>();

  return {
    alreadyProcessed: false,
    subscriptionId,
    subscription: createdSub ? serializeSubscription(createdSub) : null
  };
}

export async function rejectPaymentByAdmin(
  paymentRequestId: string,
  reason: string,
  auth: AuthUser,
  env: Env,
  nowMs: number
) {
  if (!isValidId(paymentRequestId)) {
    throw new HttpError(400, 'Invalid paymentRequestId.', 'INVALID_ID');
  }
  const cleanReason = (reason || '').trim().slice(0, 500);
  if (cleanReason.length < 3) {
    throw new HttpError(400, 'Please provide a rejection reason (at least 3 characters).', 'INVALID_REASON');
  }

  const pr = await env.DB.prepare('SELECT * FROM payment_requests WHERE payment_request_id = ?')
    .bind(paymentRequestId)
    .first<PaymentRequestRow>();
  if (!pr) {
    throw new HttpError(404, 'Payment request not found.', 'NOT_FOUND');
  }
  if (pr.status !== 'pending') {
    throw new HttpError(409, `Payment request is already ${pr.status}.`, 'PAYMENT_NOT_PENDING');
  }

  const updateRes = await env.DB.prepare(
    `UPDATE payment_requests
     SET status = 'rejected', reviewed_at_ms = ?, reviewed_by = ?, rejection_reason = ?
     WHERE payment_request_id = ? AND status = 'pending'`
  )
    .bind(nowMs, auth.email, cleanReason, paymentRequestId)
    .run();

  if ((updateRes.meta?.changes ?? 0) !== 1) {
    throw new HttpError(409, 'Payment request status changed concurrently.', 'CONCURRENT_CONFLICT');
  }

  const notificationId = makeWorkerId('notif', nowMs);
  const auditId = makeWorkerId('audit', nowMs);
  const refDisplay = formatTxnRefDisplay(pr.transaction_reference_id);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO notifications (
        id, institution_id, owner_uid, type, title, message, read, related_id, created_at_ms
      ) VALUES (?, ?, ?, 'payment_rejected', ?, ?, 0, ?, ?)`
    ).bind(
      notificationId,
      pr.institution_id,
      pr.user_id,
      'Payment Verification Rejected',
      `Your payment request (Ref: ${refDisplay}) was rejected. Reason: ${cleanReason}. You may submit a new payment request.`,
      pr.payment_request_id,
      nowMs
    ),
    env.DB.prepare(
      `INSERT INTO subscription_audit_logs (
        id, actor_uid, actor_email, actor_role, action, target_type, target_id,
        institution_id, summary, reason, created_at_ms
      ) VALUES (?, ?, ?, 'admin', 'PAYMENT_REJECTED', 'paymentRequest', ?, ?, ?, ?, ?)`
    ).bind(
      auditId,
      auth.uid,
      auth.email,
      pr.payment_request_id,
      pr.institution_id,
      `Rejected ₹${pr.amount} UPI payment (${refDisplay}) for "${pr.institution_name}".`,
      cleanReason,
      nowMs
    )
  ]);

  return { ok: true, paymentRequestId, status: 'rejected', rejectionReason: cleanReason };
}

export async function listAdminSubscriptions(env: Env, nowMs: number) {
  await syncInstitutionSubscriptionExpiries(env.DB, null, nowMs);
  const res = await env.DB.prepare('SELECT * FROM subscriptions ORDER BY created_at_ms DESC').all<SubscriptionRow>();
  return (res.results || []).map(serializeSubscription);
}

export async function revokeSubscriptionByAdmin(
  subscriptionId: string,
  reason: string,
  auth: AuthUser,
  env: Env,
  nowMs: number
) {
  if (!isValidId(subscriptionId)) {
    throw new HttpError(400, 'Invalid subscriptionId.', 'INVALID_ID');
  }
  const cleanReason = (reason || '').trim().slice(0, 500);
  if (cleanReason.length < 3) {
    throw new HttpError(400, 'Please provide a revocation reason (at least 3 characters).', 'INVALID_REASON');
  }

  const sub = await env.DB.prepare('SELECT * FROM subscriptions WHERE subscription_id = ?')
    .bind(subscriptionId)
    .first<SubscriptionRow>();
  if (!sub) {
    throw new HttpError(404, 'Subscription not found.', 'NOT_FOUND');
  }
  if (sub.approval_status === 'revoked') {
    throw new HttpError(409, 'Subscription is already revoked.', 'ALREADY_REVOKED');
  }

  const notificationId = makeWorkerId('notif', nowMs);
  const auditId = makeWorkerId('audit', nowMs);

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE subscriptions
       SET approval_status = 'revoked', payment_status = 'revoked',
           revoked_at_ms = ?, revoked_by = ?, revocation_reason = ?, updated_at_ms = ?
       WHERE subscription_id = ?`
    ).bind(nowMs, auth.email, cleanReason, nowMs, subscriptionId),
    env.DB.prepare(
      `INSERT INTO notifications (
        id, institution_id, owner_uid, type, title, message, read, related_id, created_at_ms
      ) VALUES (?, ?, ?, 'subscription_revoked', ?, ?, 0, ?, ?)`
    ).bind(
      notificationId,
      sub.institution_id,
      sub.owner_uid,
      'Subscription Revoked',
      `Your subscription (${sub.subscription_id}) was revoked by the administrator. Reason: ${cleanReason}.`,
      sub.subscription_id,
      nowMs
    ),
    env.DB.prepare(
      `INSERT INTO subscription_audit_logs (
        id, actor_uid, actor_email, actor_role, action, target_type, target_id,
        institution_id, summary, reason, created_at_ms
      ) VALUES (?, ?, ?, 'admin', 'SUBSCRIPTION_REVOKED', 'subscription', ?, ?, ?, ?, ?)`
    ).bind(
      auditId,
      auth.uid,
      auth.email,
      sub.subscription_id,
      sub.institution_id,
      `Revoked subscription ${sub.subscription_id} for "${sub.institution_name}".`,
      cleanReason,
      nowMs
    )
  ]);

  return { ok: true, subscriptionId, status: 'revoked' };
}

export async function listAdminAuditLogs(env: Env) {
  const res = await env.DB.prepare(
    'SELECT * FROM subscription_audit_logs ORDER BY created_at_ms DESC LIMIT 250'
  ).all<AuditLogRow>();

  return (res.results || []).map((l) => ({
    id: l.id,
    adminUid: l.actor_uid,
    adminEmail: l.actor_email,
    actorRole: l.actor_role,
    action: l.action,
    targetType: l.target_type,
    targetId: l.target_id,
    institutionId: l.institution_id,
    summary: l.summary,
    reason: l.reason,
    createdAt: l.created_at_ms
  }));
}
