import { describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  ALLOWED_EXAMINATION_TYPES,
  buildUpiPaymentUri,
  getLockedTypeMessage,
  isAllowedExaminationType,
  SUBSCRIPTION_PLAN
} from '../subscriptionConstants';

describe('Subscription Plan & Single-Examination-Type Locking Rules', () => {
  it('defines the single ₹1 / 15-day Exam Planner Access UPI subscription plan', () => {
    expect(SUBSCRIPTION_PLAN.planName).toBe('Exam Planner Access');
    expect(SUBSCRIPTION_PLAN.amount).toBe(1);
    expect(SUBSCRIPTION_PLAN.validityDays).toBe(15);
    expect(SUBSCRIPTION_PLAN.paymentMethod).toBe('UPI');
    expect(SUBSCRIPTION_PLAN.upiId).toBe('BHARATPE2N0Y0H9Z0B84598@unitype');
    expect(ADMIN_EMAIL).toBe('agarwalpiyush263@gmail.com');
  });

  it('builds a valid scannable standard UPI payment URI with exact query parameters', () => {
    const uri = buildUpiPaymentUri();
    expect(uri.startsWith('upi://pay?')).toBe(true);
    const parsed = new URL(uri);
    expect(parsed.searchParams.get('pa')).toBe('BHARATPE2N0Y0H9Z0B84598@unitype');
    expect(parsed.searchParams.get('pn')).toBe('Exam Planner');
    expect(parsed.searchParams.get('am')).toBe('1.00');
    expect(parsed.searchParams.get('cu')).toBe('INR');
    expect(parsed.searchParams.get('tn')).toBe('Exam Planner Subscription');
  });

  it('enforces the exact 6 allowed examination types', () => {
    expect(ALLOWED_EXAMINATION_TYPES).toEqual([
      'Semester Final',
      'Mid Term',
      'Annual Examination',
      'Unit Test',
      'Mock / Entrance Test',
      'Practical / Viva'
    ]);
    for (const type of ALLOWED_EXAMINATION_TYPES) {
      expect(isAllowedExaminationType(type)).toBe(true);
    }
    expect(isAllowedExaminationType('Regular Examination')).toBe(false);
    expect(isAllowedExaminationType('Mid-Term')).toBe(false);
  });

  it('formats the required examination type lock notification message', () => {
    expect(getLockedTypeMessage('Mid Term')).toBe(
      'Your subscription is currently activated for Mid Term examinations. Other examination types will become available after your subscription expires and you purchase a new subscription.'
    );
  });

  it('calculates 15-day subscription validity accurately from server approval timestamp', () => {
    const activatedAtMs = Date.UTC(2026, 10, 1, 10, 0, 0);
    const expiresAtMs = activatedAtMs + SUBSCRIPTION_PLAN.validityMs;
    const diffDays = (expiresAtMs - activatedAtMs) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(15);
    expect(expiresAtMs > activatedAtMs + 14 * 24 * 60 * 60 * 1000).toBe(true);
  });
});
