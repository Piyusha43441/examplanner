export const ADMIN_EMAIL = 'agarwalpiyush263@gmail.com';

export const ALLOWED_EXAMINATION_TYPES = [
  'Semester Final',
  'Mid Term',
  'Annual Examination',
  'Unit Test',
  'Mock / Entrance Test',
  'Practical / Viva'
] as const;

export type AllowedExaminationType = (typeof ALLOWED_EXAMINATION_TYPES)[number];

export const SUBSCRIPTION_PLAN = {
  planName: 'Exam Planner Access',
  amount: 1,
  currency: 'INR',
  validityDays: 15,
  validityMs: 15 * 24 * 60 * 60 * 1000,
  paymentMethod: 'UPI',
  upiId: 'BHARATPE2N0Y0H9Z0B84598@unitype',
  payeeName: 'Exam Planner',
  transactionNote: 'Exam Planner Subscription'
} as const;

export function buildUpiPaymentUri(): string {
  const params = new URLSearchParams({
    pa: SUBSCRIPTION_PLAN.upiId,
    pn: SUBSCRIPTION_PLAN.payeeName,
    am: SUBSCRIPTION_PLAN.amount.toFixed(2),
    cu: SUBSCRIPTION_PLAN.currency,
    tn: SUBSCRIPTION_PLAN.transactionNote
  });
  return `upi://pay?${params.toString()}`;
}

export function isAllowedExaminationType(value: string): value is AllowedExaminationType {
  return (ALLOWED_EXAMINATION_TYPES as readonly string[]).includes(value);
}

export function getLockedTypeMessage(lockedType: string): string {
  return `Your subscription is currently activated for ${lockedType} examinations. Other examination types will become available after your subscription expires and you purchase a new subscription.`;
}
