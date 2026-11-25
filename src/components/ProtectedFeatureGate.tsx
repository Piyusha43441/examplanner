import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Clock, History, Loader2, Lock } from 'lucide-react';
import { useSubscription } from '../context/SubscriptionContext';
import { SUBSCRIPTION_PLAN } from '../core/subscriptionConstants';

interface ProtectedFeatureGateProps {
  featureName: string;
  allowReadOnlyHistoryNotice?: boolean;
  children: React.ReactNode;
}

export function ProtectedFeatureGate({
  featureName,
  allowReadOnlyHistoryNotice = false,
  children
}: ProtectedFeatureGateProps) {
  const navigate = useNavigate();
  const {
    loadingSubscription,
    hasActiveAccess,
    subscriptionStatus,
    pendingPaymentRequest,
    openPaywallModal
  } = useSubscription();

  if (loadingSubscription) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center justify-center gap-3 text-slate-600">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
        <div className="text-sm font-medium">Verifying subscription access...</div>
      </div>
    );
  }

  if (hasActiveAccess) {
    return <>{children}</>;
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-10 max-w-2xl mx-auto text-center space-y-5">
      <div className="w-12 h-12 rounded-xl bg-slate-900 text-white flex items-center justify-center mx-auto">
        {subscriptionStatus === 'pending' ? (
          <Clock className="w-6 h-6 text-amber-400" />
        ) : (
          <Lock className="w-6 h-6 text-blue-400" />
        )}
      </div>

      <div className="space-y-2">
        <h2 className="font-display text-xl font-bold text-slate-900">
          {subscriptionStatus === 'pending'
            ? 'Subscription Pending Admin Verification'
            : subscriptionStatus === 'expired'
            ? 'Subscription Expired — Renew to Continue'
            : 'Unlock Exam Planner'}
        </h2>
        <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
          {subscriptionStatus === 'pending' && pendingPaymentRequest
            ? `Your ₹1 UPI payment (Ref: ${pendingPaymentRequest.transactionReferenceId?.trim() || 'Not Provided'}) has been submitted and is waiting for manual administrator approval before "${featureName}" unlocks.`
            : subscriptionStatus === 'expired'
            ? `Your 15-day subscription has expired. "${featureName}" is locked until a new ₹${SUBSCRIPTION_PLAN.amount} subscription is approved. All existing examinations and seating plans remain safely preserved.`
            : `Get access to Exam Planner for 15 days with a one-time payment of just ₹${SUBSCRIPTION_PLAN.amount} to access ${featureName}.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
        <button
          type="button"
          onClick={() => navigate('/subscribe')}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
        >
          {subscriptionStatus === 'pending' ? 'View Payment Request' : 'Subscribe for ₹1'}
          <ArrowRight className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => openPaywallModal(featureName)}
          className="px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
        >
          View Plan Details
        </button>

        {allowReadOnlyHistoryNotice && (
          <button
            type="button"
            onClick={() => navigate('/history')}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
          >
            <History className="w-4 h-4" />
            View Preserved History
          </button>
        )}
      </div>
    </div>
  );
}
