import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  FileText,
  History,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useSubscription } from '../context/SubscriptionContext';
import { ADMIN_EMAIL } from '../core/subscriptionConstants';
import {
  AdminAuditLogRecord,
  InstitutionProfile,
  PaymentRequestRecord,
  SubscriptionRecord
} from '../core/types';
import { auth } from '../firebase/config';
import { resendVerificationEmail } from '../firebase/service';
import {
  approvePaymentRequest,
  fetchAdminDashboardData,
  formatDateOnly,
  formatTimestamp,
  formatTransactionRefDisplay,
  getPaymentProofUrl,
  rejectPaymentRequest,
  revokeSubscription,
  toMillis
} from '../firebase/subscriptionService';

type AdminTab = 'pending' | 'subscriptions' | 'payments' | 'audit';

export function AdminPanelPage() {
  const { authUser } = useAuth();
  const {
    isAdmin,
    isAdminEmail,
    emailVerified,
    hasAdminClaim,
    serverNowMs,
    refreshSubscription,
    refreshAdminVerification
  } = useSubscription();
  const [sendingVerification, setSendingVerification] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(false);
  const [verificationMsg, setVerificationMsg] = useState<string | null>(null);
  const [verificationErr, setVerificationErr] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('pending');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [institutions, setInstitutions] = useState<InstitutionProfile[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestRecord[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogRecord[]>([]);
  const [serverStats, setServerStats] = useState<{
    totalInstitutions: number;
    totalPaymentRequests: number;
    pendingPayments: number;
    approvedPayments: number;
    rejectedPayments: number;
    activeSubscriptions: number;
    expiredSubscriptions: number;
    revokedSubscriptions: number;
    totalCollectedAmount: number;
  } | null>(null);

  // Search & filter for Subscriptions & Payment History
  const [subSearch, setSubSearch] = useState('');
  const [subStatusFilter, setSubStatusFilter] = useState<'all' | 'active' | 'expired' | 'revoked'>('all');
  const [payFilter, setPayFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');

  // Inspect Payment Verification Modal
  const [inspectingPayment, setInspectingPayment] = useState<PaymentRequestRecord | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Reject Modal (used both from table button & inside verification modal)
  const [rejectTarget, setRejectTarget] = useState<PaymentRequestRecord | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  // Revoke Subscription Modal
  const [revokeTarget, setRevokeTarget] = useState<SubscriptionRecord | null>(null);
  const [revocationReason, setRevocationReason] = useState('');

  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchAdminDashboardData();
      setServerStats(data.stats);
      setInstitutions(data.institutions);
      setPaymentRequests(data.paymentRequests);
      setSubscriptions(data.subscriptions);
      setAuditLogs(data.auditLogs);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Unable to load admin records.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    return () => {
      if (proofUrl && proofUrl.startsWith('blob:')) {
        URL.revokeObjectURL(proofUrl);
      }
    };
  }, [proofUrl]);

  const openPaymentVerification = async (req: PaymentRequestRecord) => {
    setInspectingPayment(req);
    setProofUrl((prev) => {
      if (prev && prev.startsWith('blob:')) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setProofError(null);
    setZoomLevel(1);
    setProofLoading(true);
    try {
      const url = await getPaymentProofUrl(
        req.screenshotStoragePath,
        req.paymentRequestId,
        'admin'
      );
      setProofUrl(url);
    } catch (err) {
      setProofError(
        err instanceof Error
          ? err.message
          : 'Could not load payment proof.'
      );
    } finally {
      setProofLoading(false);
    }
  };

  const handleApprove = async (req: PaymentRequestRecord) => {
    if (!authUser) return;
    setActionBanner(null);
    setActionError(null);
    setProcessingId(req.paymentRequestId);
    try {
      const subId = await approvePaymentRequest({
        paymentRequestId: req.paymentRequestId
      });
      setInspectingPayment(null);
      setActionBanner(
        `Approved payment (${formatTransactionRefDisplay(req.transactionReferenceId)}) for "${req.institutionName}". 15-day subscription ${subId} is now active.`
      );
      await Promise.all([loadData(), refreshSubscription()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Payment approval failed.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmReject = async () => {
    if (!authUser || !rejectTarget) return;
    setActionBanner(null);
    setActionError(null);
    setProcessingId(rejectTarget.paymentRequestId);
    try {
      await rejectPaymentRequest({
        paymentRequestId: rejectTarget.paymentRequestId,
        reason: rejectionReason
      });
      setRejectTarget(null);
      setRejectionReason('');
      setInspectingPayment(null);
      setActionBanner(
        `Rejected payment request (${formatTransactionRefDisplay(rejectTarget.transactionReferenceId)}) for "${rejectTarget.institutionName}".`
      );
      await Promise.all([loadData(), refreshSubscription()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Payment rejection failed.');
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!authUser || !revokeTarget) return;
    setActionBanner(null);
    setActionError(null);
    setProcessingId(revokeTarget.subscriptionId);
    try {
      await revokeSubscription({
        subscriptionId: revokeTarget.subscriptionId,
        reason: revocationReason
      });
      setRevokeTarget(null);
      setRevocationReason('');
      setActionBanner(
        `Revoked subscription ${revokeTarget.subscriptionId} for "${revokeTarget.institutionName}".`
      );
      await Promise.all([loadData(), refreshSubscription()]);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Subscription revocation failed.');
    } finally {
      setProcessingId(null);
    }
  };

  const kpis = useMemo(() => {
    if (serverStats) {
      return {
        totalInstitutions: serverStats.totalInstitutions,
        totalPaymentRequests: serverStats.totalPaymentRequests,
        pendingPayments: serverStats.pendingPayments,
        approvedPayments: serverStats.approvedPayments,
        rejectedPayments: serverStats.rejectedPayments,
        activeSubscriptions: serverStats.activeSubscriptions,
        expiredSubscriptions: serverStats.expiredSubscriptions,
        revokedSubscriptions: serverStats.revokedSubscriptions,
        totalCollected: serverStats.totalCollectedAmount
      };
    }

    const pendingPayments = paymentRequests.filter((p) => p.status === 'pending').length;
    const approvedPayments = paymentRequests.filter((p) => p.status === 'approved').length;
    const rejectedPayments = paymentRequests.filter((p) => p.status === 'rejected').length;

    let activeSubs = 0;
    let expiredSubs = 0;
    let revokedSubs = 0;
    for (const s of subscriptions) {
      const expMs = toMillis(s.expiresAt);
      if (s.approvalStatus === 'revoked') {
        revokedSubs += 1;
      } else if (s.approvalStatus === 'approved' && s.paymentStatus === 'approved' && expMs > serverNowMs) {
        activeSubs += 1;
      } else if (
        s.approvalStatus === 'expired' ||
        (s.approvalStatus === 'approved' && expMs > 0 && expMs <= serverNowMs)
      ) {
        expiredSubs += 1;
      }
    }

    const totalCollected = paymentRequests
      .filter((p) => p.status === 'approved')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    return {
      totalInstitutions: institutions.length,
      totalPaymentRequests: paymentRequests.length,
      pendingPayments,
      approvedPayments,
      rejectedPayments,
      activeSubscriptions: activeSubs,
      expiredSubscriptions: expiredSubs,
      revokedSubscriptions: revokedSubs,
      totalCollected
    };
  }, [serverStats, institutions, paymentRequests, subscriptions, serverNowMs]);

  const pendingList = useMemo(
    () => paymentRequests.filter((p) => p.status === 'pending'),
    [paymentRequests]
  );

  const filteredSubscriptions = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return subscriptions.filter((sub) => {
      const expMs = toMillis(sub.expiresAt);
      const isExpiredNow =
        sub.approvalStatus === 'expired' ||
        (sub.approvalStatus === 'approved' && expMs > 0 && expMs <= serverNowMs);
      const effectiveStatus =
        sub.approvalStatus === 'revoked'
          ? 'revoked'
          : isExpiredNow
          ? 'expired'
          : 'active';

      if (subStatusFilter !== 'all' && effectiveStatus !== subStatusFilter) return false;
      if (!q) return true;
      return (
        sub.institutionName.toLowerCase().includes(q) ||
        sub.userEmail.toLowerCase().includes(q) ||
        sub.subscriptionId.toLowerCase().includes(q)
      );
    });
  }, [subscriptions, subSearch, subStatusFilter, serverNowMs]);

  const filteredPayments = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return paymentRequests.filter((p) => {
      if (payFilter !== 'all' && p.status !== payFilter) return false;
      if (!q) return true;
      return (
        p.institutionName.toLowerCase().includes(q) ||
        p.userEmail.toLowerCase().includes(q) ||
        p.paymentRequestId.toLowerCase().includes(q) ||
        (p.transactionReferenceId || '').toLowerCase().includes(q)
      );
    });
  }, [paymentRequests, payFilter, subSearch]);

  const handleSendAdminVerification = async () => {
    if (!authUser?.email) return;
    setSendingVerification(true);
    setVerificationMsg(null);
    setVerificationErr(null);
    try {
      await resendVerificationEmail(authUser.email);
      setVerificationMsg(
        `Verification link sent to ${authUser.email}. Open your inbox, click the link, then click "I've Verified — Refresh Access".`
      );
    } catch (err) {
      setVerificationErr(
        err instanceof Error ? err.message : 'Unable to send verification email right now.'
      );
    } finally {
      setSendingVerification(false);
    }
  };

  const handleCheckAdminVerification = async () => {
    setCheckingVerification(true);
    setVerificationMsg(null);
    setVerificationErr(null);
    try {
      const ok = await refreshAdminVerification();
      if (!ok) {
        setVerificationErr(
          !auth.currentUser?.emailVerified
            ? 'Email is not verified yet. Please click the verification link sent to your inbox first.'
            : 'Firebase custom claim admin === true is not present on this token yet. Run the admin claim script, then sign out and sign back in.'
        );
      }
    } catch (err) {
      setVerificationErr(
        err instanceof Error ? err.message : 'Unable to refresh verification status.'
      );
    } finally {
      setCheckingVerification(false);
    }
  };

  if (!isAdminEmail) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-10 max-w-xl mx-auto text-center space-y-3">
        <ShieldAlert className="w-10 h-10 text-red-600 mx-auto" />
        <h2 className="font-display text-lg font-bold text-slate-900">
          Administrator Access Required
        </h2>
        <p className="text-sm text-slate-600">
          The Admin Panel is strictly restricted to {ADMIN_EMAIL}.
        </p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="bg-white border border-amber-200 rounded-xl p-8 sm:p-10 max-w-xl mx-auto text-center space-y-4">
        <ShieldAlert className="w-10 h-10 text-amber-600 mx-auto" />
        <h2 className="font-display text-lg font-bold text-slate-900">
          Verify Administrator Email
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed">
          You are signed in as{' '}
          <span className="font-mono font-semibold text-slate-900">{authUser?.email}</span>,
          but your email address is not verified yet. A verified email is required before unlocking Admin Panel controls.
        </p>

        {verificationMsg && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
            {verificationMsg}
          </div>
        )}
        {verificationErr && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
            {verificationErr}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSendAdminVerification}
            disabled={sendingVerification}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
          >
            {sendingVerification && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Send Verification Email
          </button>
          <button
            type="button"
            onClick={handleCheckAdminVerification}
            disabled={checkingVerification}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg disabled:opacity-50"
          >
            {checkingVerification ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Refresh Verification
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Admin Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <h2 className="font-display text-xl font-bold text-slate-900">
              Admin Panel — Payments &amp; Subscriptions
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Signed in as <span className="font-mono text-slate-800">{authUser?.email}</span> ·{' '}
            <span className="text-emerald-700 font-semibold">
              Verified Firebase Administrator
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Data
        </button>
      </div>

      {loadError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{loadError}</span>
        </div>
      )}

      {actionBanner && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <span>{actionBanner}</span>
          </div>
          <button type="button" onClick={() => setActionBanner(null)} className="text-emerald-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
          <button type="button" onClick={() => setActionError(null)} className="text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* A. Dashboard KPIs (9 Metrics) */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <AdminKpi label="Total Registered Institutions" value={kpis.totalInstitutions} />
        <AdminKpi label="Total Payment Requests" value={kpis.totalPaymentRequests} />
        <AdminKpi label="Pending Payments" value={kpis.pendingPayments} tone="amber" />
        <AdminKpi label="Approved Payments" value={kpis.approvedPayments} tone="emerald" />
        <AdminKpi label="Rejected Payments" value={kpis.rejectedPayments} tone="red" />
        <AdminKpi label="Active Subscriptions" value={kpis.activeSubscriptions} tone="emerald" />
        <AdminKpi label="Expired Subscriptions" value={kpis.expiredSubscriptions} />
        <AdminKpi label="Revoked Subscriptions" value={kpis.revokedSubscriptions} tone="red" />
        <AdminKpi
          label="Total Approved Revenue"
          value={`₹${kpis.totalCollected.toLocaleString('en-IN')}`}
          tone="blue"
        />
      </section>

      {/* Section Switcher Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white border border-slate-200 rounded-xl p-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'pending'
                ? 'bg-[#0F172A] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Pending Payment Approvals ({kpis.pendingPayments})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('subscriptions')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'subscriptions'
                ? 'bg-[#0F172A] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Subscription Management ({subscriptions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('payments')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'payments'
                ? 'bg-[#0F172A] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            All Payment History ({paymentRequests.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'audit'
                ? 'bg-[#0F172A] text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Admin Audit Log ({auditLogs.length})
          </button>
        </div>

        {(activeTab === 'subscriptions' || activeTab === 'payments') && (
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
              placeholder="Search institution, email, or ID..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        )}
      </div>

      {/* B. Pending Payment Approvals */}
      {activeTab === 'pending' && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Pending Payment Approvals
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Click any payment row or "Inspect Proof" to open full verification details with
                zoomable screenshot.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="p-10 flex items-center justify-center text-slate-500 gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading pending requests...
            </div>
          ) : pendingList.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              No pending UPI payment requests right now.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-3 px-4 font-medium">Institution Name</th>
                    <th className="py-3 px-4 font-medium">User Email</th>
                    <th className="py-3 px-4 font-medium">Amount</th>
                    <th className="py-3 px-4 font-medium">Transaction / Ref ID</th>
                    <th className="py-3 px-4 font-medium">Submitted</th>
                    <th className="py-3 px-4 font-medium">Screenshot</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingList.map((req) => (
                    <tr
                      key={req.paymentRequestId}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
                    >
                      <td
                        className="py-3 px-4 font-semibold text-slate-900 cursor-pointer"
                        onClick={() => openPaymentVerification(req)}
                      >
                        {req.institutionName}
                      </td>
                      <td className="py-3 px-4 text-slate-600">{req.userEmail}</td>
                      <td className="py-3 px-4 font-mono tabular-nums font-semibold text-slate-900">
                        ₹{req.amount}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-800">
                        {req.transactionReferenceId?.trim() ? (
                          req.transactionReferenceId.trim()
                        ) : (
                          <span className="text-slate-400 italic font-sans">Not Provided</span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {formatTimestamp(req.submittedAt)}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => openPaymentVerification(req)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Inspect Proof
                        </button>
                      </td>
                      <td className="py-3 px-4 font-semibold text-amber-700 capitalize">
                        {req.status}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={processingId === req.paymentRequestId}
                            onClick={() => handleApprove(req)}
                            className="px-3 py-1.5 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
                          >
                            APPROVE PAYMENT
                          </button>
                          <button
                            type="button"
                            disabled={processingId === req.paymentRequestId}
                            onClick={() => {
                              setRejectTarget(req);
                              setRejectionReason('');
                            }}
                            className="px-3 py-1.5 text-[11px] font-bold text-white bg-red-600 hover:bg-red-700 rounded-md disabled:opacity-50"
                          >
                            REJECT PAYMENT
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* D. Subscription Management */}
      {activeTab === 'subscriptions' && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-base font-bold text-slate-900">
              Subscription Management
            </h3>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              {(['all', 'active', 'expired', 'revoked'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setSubStatusFilter(status)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize ${
                    subStatusFilter === status
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {filteredSubscriptions.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No subscriptions match your filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <th className="py-3 px-4 font-medium">Institution / Email</th>
                    <th className="py-3 px-4 font-medium">Subscription ID</th>
                    <th className="py-3 px-4 font-medium">Activated</th>
                    <th className="py-3 px-4 font-medium">Expires</th>
                    <th className="py-3 px-4 font-medium">Locked Exam Type</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubscriptions.map((sub) => {
                    const expMs = toMillis(sub.expiresAt);
                    const isExpiredNow =
                      sub.approvalStatus === 'expired' ||
                      (sub.approvalStatus === 'approved' && expMs > 0 && expMs <= serverNowMs);
                    const effectiveStatus =
                      sub.approvalStatus === 'revoked'
                        ? 'revoked'
                        : isExpiredNow
                        ? 'expired'
                        : 'active';

                    return (
                      <tr key={sub.subscriptionId} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{sub.institutionName}</div>
                          <div className="text-slate-500">{sub.userEmail}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-600">{sub.subscriptionId}</td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {formatDateOnly(sub.activatedAt)}
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {formatDateOnly(sub.expiresAt)}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-800">
                          {sub.examinationTypeLocked && sub.lockedExaminationType
                            ? sub.lockedExaminationType
                            : 'Not yet locked'}
                        </td>
                        <td className="py-3 px-4 font-semibold capitalize">
                          <span
                            className={
                              effectiveStatus === 'active'
                                ? 'text-emerald-700'
                                : effectiveStatus === 'revoked'
                                ? 'text-red-700'
                                : 'text-slate-500'
                            }
                          >
                            {effectiveStatus}
                          </span>
                          {sub.revocationReason && (
                            <div className="text-[11px] font-normal text-red-600 mt-0.5">
                              Reason: {sub.revocationReason}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {sub.approvalStatus === 'approved' && (
                            <button
                              type="button"
                              onClick={() => {
                                setRevokeTarget(sub);
                                setRevocationReason('');
                              }}
                              className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-md"
                            >
                              Revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Payment History (All statuses) */}
      {activeTab === 'payments' && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-base font-bold text-slate-900">
              Complete Payment Request History
            </h3>
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              {(['all', 'pending', 'approved', 'rejected'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setPayFilter(status)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md capitalize ${
                    payFilter === status ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-3 px-4 font-medium">Institution / User</th>
                  <th className="py-3 px-4 font-medium">Txn / Ref ID</th>
                  <th className="py-3 px-4 font-medium">Amount</th>
                  <th className="py-3 px-4 font-medium">Submitted</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Review Details</th>
                  <th className="py-3 px-4 font-medium text-right">Proof</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map((p) => (
                  <tr key={p.paymentRequestId} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{p.institutionName}</div>
                      <div className="text-slate-500">{p.userEmail}</div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-800">
                      {p.transactionReferenceId?.trim() ? (
                        p.transactionReferenceId.trim()
                      ) : (
                        <span className="text-slate-400 italic font-sans">Not Provided</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-900">₹{p.amount}</td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {formatTimestamp(p.submittedAt)}
                    </td>
                    <td className="py-3 px-4 font-semibold capitalize">
                      <span
                        className={
                          p.status === 'approved'
                            ? 'text-emerald-700'
                            : p.status === 'rejected'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-600">
                      {p.status === 'approved' && p.subscriptionId
                        ? `Sub: ${p.subscriptionId}`
                        : p.status === 'rejected'
                        ? p.rejectionReason || 'Rejected'
                        : 'Awaiting review'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openPaymentVerification(p)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Immutable Admin Audit Log */}
      {activeTab === 'audit' && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500" />
            <h3 className="font-display text-base font-bold text-slate-900">
              Immutable Administrator Audit Log
            </h3>
          </div>
          {auditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No administrator actions recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <div key={log.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="space-y-0.5">
                    <div>
                      <span className="font-mono font-bold text-slate-900">{log.action}</span>
                      <span className="text-slate-400 mx-2">·</span>
                      <span className="text-slate-700">{log.summary}</span>
                    </div>
                    {log.reason && (
                      <div className="text-red-700">Reason: {log.reason}</div>
                    )}
                  </div>
                  <div className="font-mono text-slate-400 whitespace-nowrap shrink-0">
                    {formatTimestamp(log.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* C. Payment Verification Modal (Zoomable Screenshot + Details + Approve/Reject) */}
      {inspectingPayment && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Payment Verification — {inspectingPayment.institutionName}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Request ID: <span className="font-mono">{inspectingPayment.paymentRequestId}</span>{' '}
                  · Status: <span className="font-semibold capitalize">{inspectingPayment.status}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectingPayment(null)}
                className="p-1.5 text-slate-400 hover:text-slate-800 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Screenshot / PDF Viewer with Zoom */}
              <div className="lg:col-span-7 flex flex-col border border-slate-200 rounded-xl overflow-hidden bg-slate-100">
                <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-700 truncate">
                    {inspectingPayment.screenshotFileName || 'Payment Proof'}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => setZoomLevel((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                      className="p-1.5 text-slate-600 hover:bg-slate-100 rounded"
                      title="Zoom out"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-mono tabular-nums px-1.5 text-slate-700">
                      {Math.round(zoomLevel * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoomLevel((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                      className="p-1.5 text-slate-600 hover:bg-slate-100 rounded"
                      title="Zoom in"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-[340px] max-h-[460px] overflow-auto p-4 flex items-center justify-center">
                  {proofLoading ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading payment proof...
                    </div>
                  ) : proofError ? (
                    <div className="text-xs text-red-700 text-center p-4">{proofError}</div>
                  ) : proofUrl &&
                    (inspectingPayment.screenshotMimeType === 'application/pdf' ||
                      inspectingPayment.screenshotStoragePath.toLowerCase().endsWith('.pdf')) ? (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                      <iframe
                        title="PDF Payment Receipt"
                        src={proofUrl}
                        className="w-full h-80 rounded-lg border border-slate-200 bg-white"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <a
                          href={proofUrl}
                          download={inspectingPayment.screenshotFileName || 'payment_receipt.pdf'}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Download PDF Receipt
                        </a>
                        <a
                          href={proofUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
                        >
                          Open in New Tab
                        </a>
                      </div>
                    </div>
                  ) : proofUrl ? (
                    <img
                      src={proofUrl}
                      alt="Uploaded UPI Payment Proof"
                      style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }}
                      className="max-w-full max-h-full object-contain rounded transition-transform duration-150"
                    />
                  ) : null}
                </div>
              </div>

              {/* Metadata & Approval Controls */}
              <div className="lg:col-span-5 space-y-4">
                <div className="border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
                  <div className="font-semibold text-slate-900">Submission Details</div>
                  <DetailRow label="Institution" value={inspectingPayment.institutionName} />
                  <DetailRow label="Institution ID" value={inspectingPayment.institutionId} mono />
                  <DetailRow label="User Email" value={inspectingPayment.userEmail} />
                  <DetailRow label="Amount Paid" value={`₹${inspectingPayment.amount}.00`} mono />
                  <DetailRow label="Payee UPI ID" value={inspectingPayment.upiId} mono />
                  <DetailRow
                    label="UPI Reference / UTR"
                    value={formatTransactionRefDisplay(inspectingPayment.transactionReferenceId)}
                    mono
                  />
                  <DetailRow
                    label="Submitted At"
                    value={formatTimestamp(inspectingPayment.submittedAt)}
                    mono
                  />
                  {Boolean(inspectingPayment.reviewedAt) && (
                    <DetailRow
                      label="Reviewed At"
                      value={formatTimestamp(inspectingPayment.reviewedAt)}
                      mono
                    />
                  )}
                  {inspectingPayment.rejectionReason && (
                    <DetailRow
                      label="Rejection Reason"
                      value={inspectingPayment.rejectionReason}
                    />
                  )}
                </div>

                {inspectingPayment.status === 'pending' && (
                  <div className="space-y-2.5 pt-2">
                    <button
                      type="button"
                      disabled={processingId === inspectingPayment.paymentRequestId}
                      onClick={() => handleApprove(inspectingPayment)}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50"
                    >
                      {processingId === inspectingPayment.paymentRequestId ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      APPROVE PAYMENT (Activate 15-Day Access)
                    </button>
                    <button
                      type="button"
                      disabled={processingId === inspectingPayment.paymentRequestId}
                      onClick={() => {
                        setRejectTarget(inspectingPayment);
                        setRejectionReason('');
                      }}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
                    >
                      <XCircle className="w-4 h-4" />
                      REJECT PAYMENT
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal */}
      {rejectTarget && (
        <div className="fixed inset-0 z-[60] bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">
              Reject Payment Request
            </h3>
            <p className="text-xs text-slate-600">
              Provide a clear reason for rejecting <strong>{rejectTarget.institutionName}</strong>{' '}
              (Ref:{' '}
              <span className="font-mono">
                {formatTransactionRefDisplay(rejectTarget.transactionReferenceId)}
              </span>
              ). The user will be notified and allowed to submit a new request.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Rejection Reason *
              </label>
              <textarea
                rows={3}
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Transaction reference ID could not be matched in UPI statement."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  rejectionReason.trim().length < 3 ||
                  processingId === rejectTarget.paymentRequestId
                }
                onClick={handleConfirmReject}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
              >
                {processingId === rejectTarget.paymentRequestId && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Revoke Subscription Modal */}
      {revokeTarget && (
        <div className="fixed inset-0 z-[60] bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">
              Revoke Active Subscription
            </h3>
            <p className="text-xs text-slate-600">
              This immediately locks examination features for{' '}
              <strong>{revokeTarget.institutionName}</strong> ({revokeTarget.subscriptionId}) while
              preserving historical records.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Revocation Reason *
              </label>
              <textarea
                rows={3}
                value={revocationReason}
                onChange={(e) => setRevocationReason(e.target.value)}
                placeholder="e.g. Payment chargeback / invalid verification."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  revocationReason.trim().length < 3 ||
                  processingId === revokeTarget.subscriptionId
                }
                onClick={handleConfirmRevoke}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50"
              >
                {processingId === revokeTarget.subscriptionId && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                )}
                Confirm Revocation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminKpi({
  label,
  value,
  tone = 'slate'
}: {
  label: string;
  value: number | string;
  tone?: 'slate' | 'amber' | 'emerald' | 'red' | 'blue';
}) {
  const colorMap: Record<string, string> = {
    slate: 'text-slate-900',
    amber: 'text-amber-700',
    emerald: 'text-emerald-700',
    red: 'text-red-700',
    blue: 'text-blue-700'
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`font-display text-2xl font-bold tabular-nums mt-1.5 ${colorMap[tone]}`}>
        {value}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`text-right text-slate-900 break-all ${mono ? 'font-mono' : 'font-medium'}`}>
        {value}
      </span>
    </div>
  );
}
