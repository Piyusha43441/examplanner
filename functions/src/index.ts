import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

initializeApp();

const ADMIN_EMAIL = 'agarwalpiyush263@gmail.com';
const DATABASE_ID = 'ai-studio-57bf1b23-c825-4dd4-8d38-a183f4ad98fb';
const PLAN_NAME = 'Exam Planner Access';
const PLAN_AMOUNT = 1;
const VALIDITY_DAYS = 15;
const VALIDITY_MS = VALIDITY_DAYS * 24 * 60 * 60 * 1000;

const db = getFirestore(DATABASE_ID);

function assertAdminCaller(authToken: { uid: string; token: Record<string, unknown> } | undefined) {
  if (!authToken) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const email = String(authToken.token.email || '').toLowerCase();
  const emailVerified = Boolean(authToken.token.email_verified);
  const hasAdminClaim = authToken.token.admin === true;

  if (email !== ADMIN_EMAIL || !emailVerified || !hasAdminClaim) {
    throw new HttpsError(
      'permission-denied',
      'Administrator custom claim (admin: true) and verified admin email are required.'
    );
  }
}

export const approvePaymentRequest = onCall(async (request) => {
  assertAdminCaller(request.auth);
  const paymentRequestId = String(request.data?.paymentRequestId || '').trim();
  if (!paymentRequestId) {
    throw new HttpsError('invalid-argument', 'paymentRequestId is required.');
  }

  const adminUid = request.auth!.uid;
  const adminEmail = String(request.auth!.token.email || ADMIN_EMAIL);
  const subscriptionId = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const notificationId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const auditLogId = `admlog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  await db.runTransaction(async (tx) => {
    const prRef = db.collection('paymentRequests').doc(paymentRequestId);
    const prSnap = await tx.get(prRef);
    if (!prSnap.exists) {
      throw new HttpsError('not-found', 'Payment request not found.');
    }
    const pr = prSnap.data()!;
    if (pr.status !== 'pending') {
      throw new HttpsError('failed-precondition', `Payment request is already ${pr.status}.`);
    }

    const nowMs = Date.now();
    const expiresAt = Timestamp.fromMillis(nowMs + VALIDITY_MS);

    tx.update(prRef, {
      status: 'approved',
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: adminEmail,
      subscriptionId
    });

    tx.set(db.collection('subscriptions').doc(subscriptionId), {
      subscriptionId,
      institutionId: pr.institutionId,
      institutionName: pr.institutionName,
      ownerId: pr.userId,
      userEmail: pr.userEmail,
      paymentRequestId,
      planName: PLAN_NAME,
      amount: PLAN_AMOUNT,
      paymentStatus: 'approved',
      approvalStatus: 'approved',
      activatedAt: FieldValue.serverTimestamp(),
      expiresAt,
      examinationTypeLocked: false,
      lockedExaminationType: null,
      firstExaminationCreatedAt: null,
      firstExamId: null,
      approvedBy: adminEmail,
      revokedAt: null,
      revokedBy: null,
      revocationReason: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });

    tx.update(db.collection('institutions').doc(pr.institutionId), {
      activeSubscriptionId: subscriptionId,
      pendingPaymentRequestId: null,
      updatedAt: FieldValue.serverTimestamp()
    });

    const refDisplay = String(pr.transactionReferenceId || '').trim() || 'Not Provided';

    tx.set(
      db.collection('institutions').doc(pr.institutionId).collection('notifications').doc(notificationId),
      {
        id: notificationId,
        institutionId: pr.institutionId,
        ownerId: pr.userId,
        type: 'payment_approved',
        title: 'Subscription Approved',
        message: `Your ₹1 Exam Planner Access payment (Ref: ${refDisplay}) has been approved. Your 15-day subscription is now active.`,
        read: false,
        relatedId: subscriptionId,
        createdAt: FieldValue.serverTimestamp()
      }
    );

    tx.set(db.collection('adminAuditLogs').doc(auditLogId), {
      id: auditLogId,
      adminUid,
      adminEmail,
      action: 'PAYMENT_APPROVED',
      targetType: 'paymentRequest',
      targetId: paymentRequestId,
      institutionId: pr.institutionId,
      summary: `Approved ₹${pr.amount} UPI payment (${refDisplay}) for "${pr.institutionName}".`,
      reason: null,
      createdAt: FieldValue.serverTimestamp()
    });
  });

  return { subscriptionId };
});

export const rejectPaymentRequest = onCall(async (request) => {
  assertAdminCaller(request.auth);
  const paymentRequestId = String(request.data?.paymentRequestId || '').trim();
  const reason = String(request.data?.reason || '').trim().slice(0, 500);
  if (!paymentRequestId || reason.length < 3) {
    throw new HttpsError('invalid-argument', 'paymentRequestId and a valid rejection reason are required.');
  }

  const adminUid = request.auth!.uid;
  const adminEmail = String(request.auth!.token.email || ADMIN_EMAIL);
  const notificationId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const auditLogId = `admlog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  await db.runTransaction(async (tx) => {
    const prRef = db.collection('paymentRequests').doc(paymentRequestId);
    const prSnap = await tx.get(prRef);
    if (!prSnap.exists) {
      throw new HttpsError('not-found', 'Payment request not found.');
    }
    const pr = prSnap.data()!;
    if (pr.status !== 'pending') {
      throw new HttpsError('failed-precondition', `Payment request is already ${pr.status}.`);
    }

    tx.update(prRef, {
      status: 'rejected',
      reviewedAt: FieldValue.serverTimestamp(),
      reviewedBy: adminEmail,
      rejectionReason: reason
    });

    tx.update(db.collection('institutions').doc(pr.institutionId), {
      pendingPaymentRequestId: null,
      updatedAt: FieldValue.serverTimestamp()
    });

    const refDisplay = String(pr.transactionReferenceId || '').trim() || 'Not Provided';

    tx.set(
      db.collection('institutions').doc(pr.institutionId).collection('notifications').doc(notificationId),
      {
        id: notificationId,
        institutionId: pr.institutionId,
        ownerId: pr.userId,
        type: 'payment_rejected',
        title: 'Payment Verification Rejected',
        message: `Your payment request (Ref: ${refDisplay}) was rejected. Reason: ${reason}.`,
        read: false,
        relatedId: paymentRequestId,
        createdAt: FieldValue.serverTimestamp()
      }
    );

    tx.set(db.collection('adminAuditLogs').doc(auditLogId), {
      id: auditLogId,
      adminUid,
      adminEmail,
      action: 'PAYMENT_REJECTED',
      targetType: 'paymentRequest',
      targetId: paymentRequestId,
      institutionId: pr.institutionId,
      summary: `Rejected ₹${pr.amount} UPI payment (${refDisplay}) for "${pr.institutionName}".`,
      reason,
      createdAt: FieldValue.serverTimestamp()
    });
  });

  return { ok: true };
});

export const revokeSubscription = onCall(async (request) => {
  assertAdminCaller(request.auth);
  const subscriptionId = String(request.data?.subscriptionId || '').trim();
  const reason = String(request.data?.reason || '').trim().slice(0, 500);
  if (!subscriptionId || reason.length < 3) {
    throw new HttpsError('invalid-argument', 'subscriptionId and revocation reason are required.');
  }

  const adminUid = request.auth!.uid;
  const adminEmail = String(request.auth!.token.email || ADMIN_EMAIL);
  const notificationId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const auditLogId = `admlog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  await db.runTransaction(async (tx) => {
    const subRef = db.collection('subscriptions').doc(subscriptionId);
    const subSnap = await tx.get(subRef);
    if (!subSnap.exists) {
      throw new HttpsError('not-found', 'Subscription not found.');
    }
    const sub = subSnap.data()!;
    if (sub.approvalStatus !== 'approved') {
      throw new HttpsError('failed-precondition', `Subscription is already ${sub.approvalStatus}.`);
    }

    tx.update(subRef, {
      approvalStatus: 'revoked',
      paymentStatus: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: adminEmail,
      revocationReason: reason,
      updatedAt: FieldValue.serverTimestamp()
    });

    const instRef = db.collection('institutions').doc(sub.institutionId);
    const instSnap = await tx.get(instRef);
    if (instSnap.exists && instSnap.data()?.activeSubscriptionId === subscriptionId) {
      tx.update(instRef, {
        activeSubscriptionId: null,
        updatedAt: FieldValue.serverTimestamp()
      });
    }

    tx.set(
      db.collection('institutions').doc(sub.institutionId).collection('notifications').doc(notificationId),
      {
        id: notificationId,
        institutionId: sub.institutionId,
        ownerId: sub.ownerId,
        type: 'subscription_revoked',
        title: 'Subscription Revoked',
        message: `Your subscription (${subscriptionId}) was revoked by the administrator. Reason: ${reason}.`,
        read: false,
        relatedId: subscriptionId,
        createdAt: FieldValue.serverTimestamp()
      }
    );

    tx.set(db.collection('adminAuditLogs').doc(auditLogId), {
      id: auditLogId,
      adminUid,
      adminEmail,
      action: 'SUBSCRIPTION_REVOKED',
      targetType: 'subscription',
      targetId: subscriptionId,
      institutionId: sub.institutionId,
      summary: `Revoked subscription ${subscriptionId} for "${sub.institutionName}".`,
      reason,
      createdAt: FieldValue.serverTimestamp()
    });
  });

  return { ok: true };
});

export const expireSubscriptionsCron = onSchedule('every 60 minutes', async () => {
  const nowTs = Timestamp.now();
  const expiredSnap = await db
    .collection('subscriptions')
    .where('approvalStatus', '==', 'approved')
    .where('expiresAt', '<=', nowTs)
    .get();

  for (const subDoc of expiredSnap.docs) {
    const sub = subDoc.data();
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(subDoc.ref);
      if (!fresh.exists || fresh.data()?.approvalStatus !== 'approved') return;

      tx.update(subDoc.ref, {
        approvalStatus: 'expired',
        updatedAt: FieldValue.serverTimestamp()
      });

      const instRef = db.collection('institutions').doc(sub.institutionId);
      const instSnap = await tx.get(instRef);
      if (instSnap.exists && instSnap.data()?.activeSubscriptionId === sub.subscriptionId) {
        tx.update(instRef, {
          activeSubscriptionId: null,
          updatedAt: FieldValue.serverTimestamp()
        });
      }

      const notifId = `notif_exp_${sub.subscriptionId}`;
      tx.set(
        instRef.collection('notifications').doc(notifId),
        {
          id: notifId,
          institutionId: sub.institutionId,
          ownerId: sub.ownerId,
          type: 'subscription_expired',
          title: 'Subscription Expired',
          message:
            'Your 15-day Exam Planner subscription has expired. Existing records remain preserved. Purchase a new ₹1 subscription to unlock creation features.',
          read: false,
          relatedId: sub.subscriptionId,
          createdAt: FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });
  }
});

export const ensureAdminClaim = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const email = String(request.auth.token.email || '').toLowerCase();
  const emailVerified = Boolean(request.auth.token.email_verified);
  if (email !== ADMIN_EMAIL || !emailVerified) {
    throw new HttpsError('permission-denied', 'Unauthorized admin claim request.');
  }

  await getAuth().setCustomUserClaims(request.auth.uid, { admin: true });
  return { ok: true, admin: true, email: ADMIN_EMAIL };
});
