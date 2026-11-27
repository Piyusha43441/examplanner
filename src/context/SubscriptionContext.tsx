import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ADMIN_EMAIL } from '../core/subscriptionConstants';
import {
  NotificationRecord,
  PaymentRequestRecord,
  SubscriptionRecord
} from '../core/types';
import { auth } from '../firebase/config';
import {
  fetchServerNowMs,
  fetchSubscriptionStatus,
  FirebaseApiError,
  markNotificationAsRead,
  toMillis
} from '../firebase/subscriptionService';
import { useAuth } from './AuthContext';

export type EffectiveSubscriptionStatus =
  | 'none'
  | 'pending'
  | 'active'
  | 'expired'
  | 'rejected'
  | 'revoked';

interface SubscriptionContextValue {
  loadingSubscription: boolean;
  subscriptions: SubscriptionRecord[];
  paymentRequests: PaymentRequestRecord[];
  notifications: NotificationRecord[];
  unreadNotifications: NotificationRecord[];
  activeSubscription: SubscriptionRecord | null;
  latestSubscription: SubscriptionRecord | null;
  pendingPaymentRequest: PaymentRequestRecord | null;
  latestPaymentRequest: PaymentRequestRecord | null;
  subscriptionStatus: EffectiveSubscriptionStatus;
  hasActiveAccess: boolean;
  lockedExaminationType: string | null;
  remainingDays: number;
  serverNowMs: number;
  isAdmin: boolean;
  isAdminEmail: boolean;
  emailVerified: boolean;
  hasAdminClaim: boolean;
  firebaseReachable: boolean;
  firebaseError: string | null;
  paywallOpen: boolean;
  paywallFeatureLabel: string | null;
  openPaywallModal: (featureLabel?: string) => void;
  closePaywallModal: () => void;
  requireActiveSubscription: (featureLabel?: string) => boolean;
  dismissNotification: (notificationId: string) => Promise<void>;
  refreshSubscription: () => Promise<void>;
  refreshAdminVerification: () => Promise<boolean>;
  refreshServerClock: () => Promise<number>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { authUser, institution } = useAuth();

  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loadingSubscription, setLoadingSubscription] = useState(true);
  const [firebaseReachable, setFirebaseReachable] = useState(true);
  const [firebaseError, setFirebaseError] = useState<string | null>(null);

  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tickNowMs, setTickNowMs] = useState(() => Date.now());
  const [emailVerifiedState, setEmailVerifiedState] = useState(false);
  const [hasAdminClaimState, setHasAdminClaimState] = useState(false);

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallFeatureLabel, setPaywallFeatureLabel] = useState<string | null>(null);

  const refreshServerClock = useCallback(async () => {
    const srvMs = await fetchServerNowMs();
    const localMs = Date.now();
    setServerOffsetMs(srvMs - localMs);
    setTickNowMs(srvMs);
    return srvMs;
  }, []);

  const refreshSubscription = useCallback(async () => {
    if (!authUser || !institution || !auth.currentUser) {
      setSubscriptions([]);
      setPaymentRequests([]);
      setNotifications([]);
      setLoadingSubscription(false);
      setFirebaseError(null);
      return;
    }

    try {
      const payload = await fetchSubscriptionStatus(institution.id);
      setSubscriptions(payload.subscriptions || []);
      setPaymentRequests(payload.paymentRequests || []);
      setNotifications(payload.notifications || []);
      setServerOffsetMs(payload.serverNowMs - Date.now());
      setTickNowMs(payload.serverNowMs);
      setFirebaseReachable(true);
      setFirebaseError(null);
    } catch (err: any) {
      console.error('[SubscriptionContext] fetchSubscriptionStatus failed:', err);
      if (err instanceof FirebaseApiError) {
        setFirebaseReachable(err.status !== 503);
        setFirebaseError(err.message);
      } else {
        setFirebaseReachable(false);
        const code = err?.code ? `[${err.code}] ` : '';
        const msg = err?.message || 'Unable to reach Firebase subscription service.';
        setFirebaseError(`${code}${msg}`);
      }
    } finally {
      setLoadingSubscription(false);
    }
  }, [authUser, institution]);

  useEffect(() => {
    setLoadingSubscription(true);
    void refreshSubscription();

    const refreshInterval = window.setInterval(() => {
      void refreshSubscription();
    }, 30_000);

    const onFocus = () => {
      void refreshSubscription();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(refreshInterval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshSubscription]);

  useEffect(() => {
    const tickTimer = window.setInterval(() => {
      setTickNowMs(Date.now() + serverOffsetMs);
    }, 30_000);
    return () => {
      window.clearInterval(tickTimer);
    };
  }, [serverOffsetMs]);

  const syncAdminClaims = useCallback(async (forceRefresh = false) => {
    const current = auth.currentUser || authUser;
    if (!current) {
      setEmailVerifiedState(false);
      setHasAdminClaimState(false);
      return false;
    }

    const verified = Boolean(current.emailVerified);
    setEmailVerifiedState(verified);

    let hasClaim = false;
    if (typeof current.getIdTokenResult === 'function') {
      try {
        const result = await current.getIdTokenResult(forceRefresh);
        hasClaim = result?.claims?.admin === true;
      } catch {
        hasClaim = false;
      }
    }
    setHasAdminClaimState(hasClaim);
    return verified && hasClaim;
  }, [authUser]);

  useEffect(() => {
    void syncAdminClaims(false);
  }, [syncAdminClaims]);

  const refreshAdminVerification = useCallback(async () => {
    if (!authUser) return false;
    await auth.currentUser?.reload();
    if (typeof auth.currentUser?.getIdToken === 'function') {
      await auth.currentUser.getIdToken(true);
    }
    const ok = await syncAdminClaims(true);
    if (ok) {
      await refreshSubscription();
    }
    return ok;
  }, [authUser, refreshSubscription, syncAdminClaims]);

  const serverNowMs = useMemo(
    () => Math.max(tickNowMs, Date.now() + serverOffsetMs),
    [tickNowMs, serverOffsetMs]
  );

  const isAdminEmail = useMemo(() => {
    if (!authUser) return false;
    return (authUser.email || '').trim().toLowerCase() === ADMIN_EMAIL;
  }, [authUser]);

  const isAdmin = useMemo(() => {
    return isAdminEmail;
  }, [isAdminEmail]);

  const activeSubscription = useMemo(() => {
    const candidates = subscriptions.filter((sub) => {
      if (sub.approvalStatus !== 'approved' || sub.paymentStatus !== 'approved') return false;
      const expMs = toMillis(sub.expiresAt);
      return expMs > serverNowMs;
    });
    return candidates[0] ?? null;
  }, [subscriptions, serverNowMs]);

  const latestSubscription = subscriptions[0] ?? null;

  const pendingPaymentRequest = useMemo(
    () => paymentRequests.find((pr) => pr.status === 'pending') ?? null,
    [paymentRequests]
  );

  const latestPaymentRequest = paymentRequests[0] ?? null;

  const subscriptionStatus: EffectiveSubscriptionStatus = useMemo(() => {
    if (activeSubscription) return 'active';
    if (pendingPaymentRequest) return 'pending';
    if (
      latestPaymentRequest?.status === 'rejected' &&
      (!latestSubscription ||
        toMillis(latestPaymentRequest.submittedAt) > toMillis(latestSubscription.createdAt))
    ) {
      return 'rejected';
    }
    if (latestSubscription) {
      if (latestSubscription.approvalStatus === 'revoked') return 'revoked';
      const expMs = toMillis(latestSubscription.expiresAt);
      if (
        latestSubscription.approvalStatus === 'expired' ||
        (latestSubscription.approvalStatus === 'approved' && expMs > 0 && expMs <= serverNowMs)
      ) {
        return 'expired';
      }
    }
    if (latestPaymentRequest?.status === 'rejected') return 'rejected';
    return 'none';
  }, [activeSubscription, pendingPaymentRequest, latestSubscription, latestPaymentRequest, serverNowMs]);

  const hasActiveAccess = Boolean(activeSubscription);

  const lockedExaminationType = useMemo(() => {
    if (!activeSubscription) return null;
    return activeSubscription.examinationTypeLocked
      ? activeSubscription.lockedExaminationType
      : null;
  }, [activeSubscription]);

  const remainingDays = useMemo(() => {
    if (!activeSubscription) return 0;
    const diff = toMillis(activeSubscription.expiresAt) - serverNowMs;
    if (diff <= 0) return 0;
    return Math.ceil(diff / (24 * 60 * 60 * 1000));
  }, [activeSubscription, serverNowMs]);

  const unreadNotifications = useMemo(
    () => notifications.filter((n) => !n.read),
    [notifications]
  );

  const openPaywallModal = useCallback((featureLabel?: string) => {
    setPaywallFeatureLabel(featureLabel ?? null);
    setPaywallOpen(true);
  }, []);

  const closePaywallModal = useCallback(() => {
    setPaywallOpen(false);
    setPaywallFeatureLabel(null);
  }, []);

  const requireActiveSubscription = useCallback(
    (featureLabel?: string) => {
      if (hasActiveAccess) return true;
      openPaywallModal(featureLabel);
      return false;
    },
    [hasActiveAccess, openPaywallModal]
  );

  const dismissNotification = useCallback(
    async (notificationId: string) => {
      if (!institution) return;
      await markNotificationAsRead(institution.id, notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      );
    },
    [institution]
  );

  return (
    <SubscriptionContext.Provider
      value={{
        loadingSubscription,
        subscriptions,
        paymentRequests,
        notifications,
        unreadNotifications,
        activeSubscription,
        latestSubscription,
        pendingPaymentRequest,
        latestPaymentRequest,
        subscriptionStatus,
        hasActiveAccess,
        lockedExaminationType,
        remainingDays,
        serverNowMs,
        isAdmin,
        isAdminEmail,
        emailVerified: emailVerifiedState,
        hasAdminClaim: hasAdminClaimState,
        firebaseReachable,
        firebaseError,
        paywallOpen,
        paywallFeatureLabel,
        openPaywallModal,
        closePaywallModal,
        requireActiveSubscription,
        dismissNotification,
        refreshSubscription,
        refreshAdminVerification,
        refreshServerClock
      }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error('useSubscription must be used inside SubscriptionProvider');
  }
  return ctx;
}
