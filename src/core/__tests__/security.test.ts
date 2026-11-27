import { describe, expect, it, vi } from 'vitest';
import { ADMIN_EMAIL, getLockedTypeMessage, SUBSCRIPTION_PLAN } from '../subscriptionConstants';
import {
  approvePaymentRequest,
  rejectPaymentRequest,
  revokeSubscription,
  submitPaymentRequest,
  validateActiveSubscriptionForExam
} from '../../firebase/subscriptionService';

// Mock Firebase config for security unit testing
vi.mock('../../firebase/config', () => {
  let mockUser: { uid: string; email: string } | null = {
    uid: 'user_attacker',
    email: 'attacker@random.com'
  };

  return {
    isFirebaseConfigured: true,
    auth: {
      get currentUser() {
        return mockUser;
      }
    },
    db: {},
    storage: {},
    __setMockUser: (user: { uid: string; email: string } | null) => {
      mockUser = user;
    }
  };
});

describe('Security & Authorization Audit Tests', () => {
  it('TEST 1 (Admin Authorization): Non-admin user cannot approve payment requests', async () => {
    // Current user is attacker@random.com
    await expect(
      approvePaymentRequest({ paymentRequestId: 'req_123' })
    ).rejects.toThrow(/Only authorized administrator/i);
  });

  it('TEST 2 (Admin Authorization): Non-admin user cannot reject payment requests', async () => {
    await expect(
      rejectPaymentRequest({ paymentRequestId: 'req_123', reason: 'Invalid' })
    ).rejects.toThrow(/Only authorized administrator/i);
  });

  it('TEST 3 (Admin Authorization): Non-admin user cannot revoke subscriptions', async () => {
    await expect(
      revokeSubscription({ subscriptionId: 'sub_123', reason: 'Policy breach' })
    ).rejects.toThrow(/Only authorized administrator/i);
  });

  it('TEST 4 (Subscription Validity): Subscription validity must be exactly 15 days (not 365 days)', () => {
    expect(SUBSCRIPTION_PLAN.validityDays).toBe(15);
    expect(SUBSCRIPTION_PLAN.validityMs).toBe(15 * 24 * 60 * 60 * 1000);
    const startMs = Date.now();
    const expiryMs = startMs + SUBSCRIPTION_PLAN.validityMs;
    const diffDays = Math.round((expiryMs - startMs) / (24 * 60 * 60 * 1000));
    expect(diffDays).toBe(15);
  });

  it('TEST 5 (Exam-Type Locking): Correct error message is generated for locked examination types', () => {
    const errorMsg = getLockedTypeMessage('Semester Final');
    expect(errorMsg).toContain('Semester Final');
    expect(errorMsg).toContain('Other examination types will become available after your subscription expires');
  });

  it('TEST 6 (Admin Identity Guard): ADMIN_EMAIL constant is strictly agarwalpiyush263@gmail.com', () => {
    expect(ADMIN_EMAIL).toBe('agarwalpiyush263@gmail.com');
  });
});
