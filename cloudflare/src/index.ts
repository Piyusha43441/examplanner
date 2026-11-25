import { requireAdmin, requireAuth } from './auth';
import { buildCorsHeaders, errorResponse, HttpError, jsonResponse, parseJsonBody } from './http';
import {
  approvePaymentByAdmin,
  getAdminDashboardData,
  getAdminPaymentById,
  listAdminAuditLogs,
  listAdminPayments,
  listAdminSubscriptions,
  rejectPaymentByAdmin,
  revokeSubscriptionByAdmin
} from './services/adminService';
import {
  abortExamCreation,
  authorizeExamCreation,
  confirmExamCreated,
  verifyFeatureAccess
} from './services/examLockService';
import { handleStreamPaymentProof, handleUploadPaymentProof } from './services/proofService';
import {
  getSubscriptionStatusPayload,
  handleSubmitPayment,
  markNotificationRead
} from './services/subscriptionService';
import { Env, WorkerDeps } from './types';

export function createWorkerHandler(deps: WorkerDeps = {}) {
  return async function fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = buildCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    try {
      // Public health & authoritative clock endpoints
      if (request.method === 'GET' && (pathname === '/api/health' || pathname === '/')) {
        return jsonResponse(
          {
            ok: true,
            service: 'exam-planner-cloudflare-api',
            nowMs,
            iso: new Date(nowMs).toISOString()
          },
          200,
          corsHeaders
        );
      }

      if (request.method === 'GET' && pathname === '/api/server-time') {
        return jsonResponse(
          {
            nowMs,
            iso: new Date(nowMs).toISOString()
          },
          200,
          corsHeaders
        );
      }

      // Subscription & Notifications (Authenticated Institution Owner)
      if (request.method === 'GET' && pathname === '/api/subscription/status') {
        const auth = await requireAuth(request, env, deps, nowMs);
        const institutionId = url.searchParams.get('institutionId');
        const institutionName = url.searchParams.get('institutionName');
        const payload = await getSubscriptionStatusPayload(
          institutionId,
          institutionName,
          auth,
          env,
          deps,
          nowMs
        );
        return jsonResponse(payload, 200, corsHeaders);
      }

      if (request.method === 'GET' && pathname === '/api/subscription/history') {
        const auth = await requireAuth(request, env, deps, nowMs);
        const institutionId = url.searchParams.get('institutionId');
        const payload = await getSubscriptionStatusPayload(
          institutionId,
          null,
          auth,
          env,
          deps,
          nowMs
        );
        return jsonResponse(
          {
            serverNowMs: payload.serverNowMs,
            subscriptions: payload.subscriptions,
            paymentRequests: payload.paymentRequests,
            notifications: payload.notifications
          },
          200,
          corsHeaders
        );
      }

      const notifReadMatch = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if (request.method === 'POST' && notifReadMatch) {
        const auth = await requireAuth(request, env, deps, nowMs);
        const res = await markNotificationRead(decodeURIComponent(notifReadMatch[1]), auth, env);
        return jsonResponse(res, 200, corsHeaders);
      }

      // Payment Proof R2 Upload, Submit & Authenticated Streaming
      if (request.method === 'POST' && pathname === '/api/payment/upload') {
        const auth = await requireAuth(request, env, deps, nowMs);
        const uploaded = await handleUploadPaymentProof(request, auth, env, deps, nowMs);
        return jsonResponse(uploaded, 200, corsHeaders);
      }

      if (request.method === 'POST' && pathname === '/api/payment/submit') {
        const auth = await requireAuth(request, env, deps, nowMs);
        const body = await parseJsonBody<{
          paymentRequestId?: string;
          institutionId?: string;
          institutionName?: string;
          transactionReferenceId?: string | null;
          objectKey?: string;
          fileName?: string;
          mimeType?: string;
        }>(request);
        const saved = await handleSubmitPayment(body, auth, env, deps, nowMs);
        return jsonResponse(
          {
            paymentRequest: saved,
            message:
              'Payment submitted successfully! Your payment proof is awaiting admin verification.'
          },
          201,
          corsHeaders
        );
      }

      if (request.method === 'GET' && pathname === '/api/payment/status') {
        const auth = await requireAuth(request, env, deps, nowMs);
        const institutionId = url.searchParams.get('institutionId');
        const payload = await getSubscriptionStatusPayload(
          institutionId,
          null,
          auth,
          env,
          deps,
          nowMs
        );
        return jsonResponse(
          {
            serverNowMs: payload.serverNowMs,
            effectiveStatus: payload.effectiveStatus,
            pendingPaymentRequest: payload.pendingPaymentRequest,
            latestPaymentRequest: payload.latestPaymentRequest,
            paymentRequests: payload.paymentRequests
          },
          200,
          corsHeaders
        );
      }

      const userProofMatch = pathname.match(/^\/api\/payment\/proof\/([^/]+)$/);
      if (request.method === 'GET' && userProofMatch) {
        const auth = await requireAuth(request, env, deps, nowMs);
        return await handleStreamPaymentProof(
          decodeURIComponent(userProofMatch[1]),
          auth,
          env,
          corsHeaders,
          false
        );
      }

      // Examination Type Locking & Protected Feature Access Verification
      if (request.method === 'POST' && pathname === '/api/examinations/verify-access') {
        const auth = await requireAuth(request, env, deps, nowMs);
        const body = await parseJsonBody<{ institutionId?: string; examType?: string }>(request);
        if (!body.institutionId) {
          throw new HttpError(400, 'institutionId is required.', 'INVALID_INSTITUTION_ID');
        }
        const res = await verifyFeatureAccess(
          body.institutionId,
          body.examType,
          auth,
          env,
          deps,
          nowMs
        );
        return jsonResponse(res, 200, corsHeaders);
      }

      if (request.method === 'POST' && pathname === '/api/examinations/authorize-create') {
        const auth = await requireAuth(request, env, deps, nowMs);
        const body = await parseJsonBody<{
          institutionId?: string;
          examId?: string;
          examType?: string;
          requestId?: string;
        }>(request);
        const res = await authorizeExamCreation(body, auth, env, deps, nowMs);
        return jsonResponse(res, 200, corsHeaders);
      }

      if (request.method === 'POST' && pathname === '/api/examinations/confirm-create') {
        const auth = await requireAuth(request, env, deps, nowMs);
        const body = await parseJsonBody<{
          institutionId?: string;
          requestId?: string;
          examId?: string;
          examType?: string;
        }>(request);
        const res = await confirmExamCreated(body, auth, env, deps, nowMs);
        return jsonResponse(res, 200, corsHeaders);
      }

      if (request.method === 'POST' && pathname === '/api/examinations/abort-create') {
        const auth = await requireAuth(request, env, deps, nowMs);
        const body = await parseJsonBody<{ institutionId?: string; requestId?: string }>(request);
        const res = await abortExamCreation(body, auth, env, deps, nowMs);
        return jsonResponse(res, 200, corsHeaders);
      }

      // Admin APIs (Strictly restricted to verified ADMIN_EMAIL)
      if (request.method === 'GET' && pathname === '/api/admin/dashboard') {
        await requireAdmin(request, env, deps, nowMs);
        const data = await getAdminDashboardData(env, nowMs);
        return jsonResponse(data, 200, corsHeaders);
      }

      if (request.method === 'GET' && pathname === '/api/admin/payments') {
        await requireAdmin(request, env, deps, nowMs);
        const status = url.searchParams.get('status') || undefined;
        const search = url.searchParams.get('search') || undefined;
        const payments = await listAdminPayments(env, { status, search });
        return jsonResponse({ serverNowMs: nowMs, paymentRequests: payments }, 200, corsHeaders);
      }

      const adminPayGetMatch = pathname.match(/^\/api\/admin\/payment\/([^/]+)$/);
      if (request.method === 'GET' && adminPayGetMatch) {
        await requireAdmin(request, env, deps, nowMs);
        const paymentRequest = await getAdminPaymentById(
          decodeURIComponent(adminPayGetMatch[1]),
          env
        );
        return jsonResponse({ paymentRequest }, 200, corsHeaders);
      }

      const adminPayProofMatch = pathname.match(/^\/api\/admin\/payment\/([^/]+)\/proof$/);
      if (request.method === 'GET' && adminPayProofMatch) {
        const auth = await requireAdmin(request, env, deps, nowMs);
        return await handleStreamPaymentProof(
          decodeURIComponent(adminPayProofMatch[1]),
          auth,
          env,
          corsHeaders,
          true
        );
      }

      const adminPayApproveMatch = pathname.match(/^\/api\/admin\/payment\/([^/]+)\/approve$/);
      if (request.method === 'POST' && adminPayApproveMatch) {
        const auth = await requireAdmin(request, env, deps, nowMs);
        const result = await approvePaymentByAdmin(
          decodeURIComponent(adminPayApproveMatch[1]),
          auth,
          env,
          nowMs
        );
        return jsonResponse(result, 200, corsHeaders);
      }

      const adminPayRejectMatch = pathname.match(/^\/api\/admin\/payment\/([^/]+)\/reject$/);
      if (request.method === 'POST' && adminPayRejectMatch) {
        const auth = await requireAdmin(request, env, deps, nowMs);
        const body = await parseJsonBody<{ reason?: string }>(request);
        const result = await rejectPaymentByAdmin(
          decodeURIComponent(adminPayRejectMatch[1]),
          body.reason || '',
          auth,
          env,
          nowMs
        );
        return jsonResponse(result, 200, corsHeaders);
      }

      if (request.method === 'GET' && pathname === '/api/admin/subscriptions') {
        await requireAdmin(request, env, deps, nowMs);
        const subscriptions = await listAdminSubscriptions(env, nowMs);
        return jsonResponse({ serverNowMs: nowMs, subscriptions }, 200, corsHeaders);
      }

      const adminSubRevokeMatch = pathname.match(/^\/api\/admin\/subscription\/([^/]+)\/revoke$/);
      if (request.method === 'POST' && adminSubRevokeMatch) {
        const auth = await requireAdmin(request, env, deps, nowMs);
        const body = await parseJsonBody<{ reason?: string }>(request);
        const result = await revokeSubscriptionByAdmin(
          decodeURIComponent(adminSubRevokeMatch[1]),
          body.reason || '',
          auth,
          env,
          nowMs
        );
        return jsonResponse(result, 200, corsHeaders);
      }

      if (request.method === 'GET' && pathname === '/api/admin/audit-logs') {
        await requireAdmin(request, env, deps, nowMs);
        const auditLogs = await listAdminAuditLogs(env);
        return jsonResponse({ serverNowMs: nowMs, auditLogs }, 200, corsHeaders);
      }

      throw new HttpError(404, `Route not found: ${request.method} ${pathname}`, 'NOT_FOUND');
    } catch (err) {
      return errorResponse(err, corsHeaders);
    }
  };
}

export default {
  fetch: createWorkerHandler()
};
