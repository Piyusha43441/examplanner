import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ADMIN_EMAIL } from '../core/subscriptionConstants';
import {
  NotificationRecord,
  PaymentRequestRecord,
  SubscriptionRecord
} from '../core/types';
import {
  fetchServerNowMs,
  markNotificationAsRead,
  toMillis
} from '../firebase/subscriptionService';
import {
  CloudflareApiError,
  fetchSubscriptionStatusFromCloudflare
} from '../services/cloudflareApi';
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
  hasAdminCustomClaim: boolean;
  cloudflareReachable: boolean;
  cloudflareError: string | null;
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
  const { firebaseUser, institution } = useAuth();

  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<PaymentRequestRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loadingSubscription, setLoadingSubscription] = useState(true);
  const [cloudflareReachable, setCloudflareReachable] = useState(true);
  const [cloudflareError, setCloudflareError] = useState<string | null>(null);

  // Server-synced clock offset: serverNow = Date.now() + serverOffsetMs
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tickNowMs, setTickNowMs] = useState(() => Date.now());

  const [hasAdminCustomClaim, setHasAdminCustomClaim] = useState(false);
  const [adminClaimBlocked, setAdminClaimBlocked] = useState(false);
  const [emailVerifiedState, setEmailVerifiedState] = useState(false);

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
    if (!firebaseUser || !institution) {
      setSubscriptions([]);
      setPaymentRequests([]);
      setNotifications([]);
      setLoadingSubscription(false);
      setCloudflareError(null);
      return;
    }

    try {
      const payload = await fetchSubscriptionStatusFromCloudflare(
        institution.id,
        institution.name
      );
      setSubscriptions(payload.subscriptions || []);
      setPaymentRequests(payload.paymentRequests || []);
      setNotifications(payload.notifications || []);
      setServerOffsetMs(payload.serverNowMs - Date.now());
      setTickNowMs(payload.serverNowMs);
      setCloudflareReachable(true);
      setCloudflareError(null);
    } catch (err) {
      if (err instanceof CloudflareApiError) {
        setCloudflareReachable(err.code !== 'CLOUDFLARE_NOT_CONFIGURED' && err.status !== 0);
        setCloudflareError(err.message);
        console.warn('Cloudflare subscription API notice:', err.message);
      } else {
        setCloudflareReachable(false);
        setCloudflareError('Unable to reach Cloudflare subscription API.');
        console.warn('Cloudflare subscription API notice:', err);
      }
    } finally {
      setLoadingSubscription(false);
    }
  }, [firebaseUser, institution]);

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

  useEffect(() => {
    let active = true;
    if (!firebaseUser) {
      setHasAdminCustomClaim(false);
      setAdminClaimBlocked(false);
      setEmailVerifiedState(false);
      return;
    }
    setEmailVerifiedState(Boolean(firebaseUser.emailVerified));
    firebaseUser
      .getIdTokenResult()
      .then((result) => {
        if (!active) return;
        const claimVal = result.claims.admin;
        setHasAdminCustomClaim(claimVal === true);
        setAdminClaimBlocked(claimVal !== undefined && claimVal !== true);
      })
      .catch(() => {
        if (!active) return;
        setHasAdminCustomClaim(false);
      });
    return () => {
      active = false;
    };
  }, [firebaseUser]);

  const refreshAdminVerification = useCallback(async () => {
    if (!firebaseUser) return false;
    await firebaseUser.reload();
    const tokenRes = await firebaseUser.getIdTokenResult(true);
    const verified = Boolean(firebaseUser.emailVerified);
    setEmailVerifiedState(verified);
    const claimVal = tokenRes.claims.admin;
    setHasAdminCustomClaim(claimVal === true);
    setAdminClaimBlocked(claimVal !== undefined && claimVal !== true);
    if (verified) {
      await refreshSubscription();
    }
    return verified;
  }, [firebaseUser, refreshSubscription]);

  const serverNowMs = useMemo(
    () => Math.max(tickNowMs, Date.now() + serverOffsetMs),
    [tickNowMs, serverOffsetMs]
  );

  const isAdminEmail = useMemo(() => {
    if (!firebaseUser) return false;
    const emailMatches = (firebaseUser.email || '').trim().toLowerCase() === ADMIN_EMAIL;
    return emailMatches && !adminClaimBlocked;
  }, [firebaseUser, adminClaimBlocked]);

  const isAdmin = useMemo(() => {
    return isAdminEmail && emailVerifiedState;
  }, [isAdminEmail, emailVerifiedState]);

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
        hasAdminCustomClaim,
        cloudflareReachable,
        cloudflareError,
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
