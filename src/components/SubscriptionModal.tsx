import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Lock,
  ShieldCheck,
  X
} from 'lucide-react';
import { useSubscription } from '../context/SubscriptionContext';
import { SUBSCRIPTION_PLAN } from '../core/subscriptionConstants';
import { formatTimestamp } from '../firebase/subscriptionService';

export function SubscriptionModal() {
  const navigate = useNavigate();
  const {
    paywallOpen,
    paywallFeatureLabel,
    closePaywallModal,
    subscriptionStatus,
    pendingPaymentRequest,
    latestPaymentRequest
  } = useSubscription();

  if (!paywallOpen) return null;

  const handleSubscribe = () => {
    closePaywallModal();
    navigate('/subscribe');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="unlock-exam-planner-title"
    >
      <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full overflow-hidden shadow-xl">
        {/* Header */}
        <div className="bg-[#0F172A] text-white px-6 py-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="unlock-exam-planner-title"
                className="font-display text-lg font-bold text-white"
              >
                Unlock Exam Planner
              </h2>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                Get access to Exam Planner for 15 days with a one-time payment of just ₹{SUBSCRIPTION_PLAN.amount}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closePaywallModal}
            className="p-1.5 text-slate-400 hover:text-white rounded-md"
            aria-label="Close subscription dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {paywallFeatureLabel && (
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5">
              <span className="font-semibold text-slate-800">Protected Feature:</span>{' '}
              {paywallFeatureLabel} requires an active {SUBSCRIPTION_PLAN.planName} subscription.
            </div>
          )}

          {subscriptionStatus === 'pending' && pendingPaymentRequest && (
            <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold">Payment Verification Pending</div>
                <div>
                  Request{' '}
                  <span className="font-mono">
                    {pendingPaymentRequest.transactionReferenceId?.trim() || 'Not Provided'}
                  </span>{' '}
                  submitted on {formatTimestamp(pendingPaymentRequest.submittedAt)} is awaiting manual
                  admin approval. Access unlocks immediately once approved.
                </div>
              </div>
            </div>
          )}

          {subscriptionStatus === 'rejected' && latestPaymentRequest && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold">Previous Payment Request Rejected</div>
                <div>
                  Reason: {latestPaymentRequest.rejectionReason || 'Verification failed'}. You may
                  submit a new ₹{SUBSCRIPTION_PLAN.amount} UPI payment request.
                </div>
              </div>
            </div>
          )}

          {subscriptionStatus === 'expired' && (
            <div className="p-3.5 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-800 flex items-start gap-2.5">
              <CalendarClock className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
              <div>
                Your previous 15-day subscription has expired. Existing examinations and generated
                seating plans remain preserved in read-only history. Purchase a new ₹{SUBSCRIPTION_PLAN.amount} subscription
                to resume creating and managing examinations.
              </div>
            </div>
          )}

          {subscriptionStatus === 'revoked' && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-900 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <div>
                Your previous subscription was revoked by the administrator. Purchase a new ₹{SUBSCRIPTION_PLAN.amount}
                subscription to restore access.
              </div>
            </div>
          )}

          {/* Plan Summary */}
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-3">
            <div className="flex items-baseline justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="text-sm font-bold text-slate-900">{SUBSCRIPTION_PLAN.planName}</div>
                <div className="text-xs text-slate-500">Single-institution examination access</div>
              </div>
              <div className="text-right">
                <span className="font-display text-2xl font-bold text-slate-900 tabular-nums">
                  ₹{SUBSCRIPTION_PLAN.amount}
                </span>
                <span className="text-xs text-slate-500 ml-1">/ {SUBSCRIPTION_PLAN.validityDays} days</span>
              </div>
            </div>

            <ul className="space-y-2 text-xs text-slate-700">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-900">₹{SUBSCRIPTION_PLAN.amount} subscription price</strong> via official UPI
                  QR code or UPI app
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-900">15-day validity</strong> calculated from the
                  server timestamp of admin approval
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-900">One examination type per subscription</strong>{' '}
                  — unlocks unlimited schedules under the first examination type you create
                </span>
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  <strong className="text-slate-900">Manual payment verification notice:</strong>{' '}
                  Upload your payment screenshot (UPI reference ID optional). Access activates after
                  manual admin verification.
                </span>
              </li>
            </ul>
          </div>

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={closePaywallModal}
              className="px-4 py-2.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              Maybe Later
            </button>
            <button
              type="button"
              onClick={handleSubscribe}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Subscribe for ₹{SUBSCRIPTION_PLAN.amount}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
