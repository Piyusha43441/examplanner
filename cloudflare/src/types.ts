export const ADMIN_EMAIL_DEFAULT = 'agarwalpiyush263@gmail.com';
export const PLAN_ID = 'exam_planner_access';
export const PLAN_NAME = 'Exam Planner Access';
export const PLAN_AMOUNT = 1;
export const PLAN_CURRENCY = 'INR';
export const PLAN_VALIDITY_DAYS = 15;
export const PLAN_VALIDITY_MS = PLAN_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
export const PLAN_UPI_ID = 'BHARATPE2N0Y0H9Z0B84598@unitype';
export const MAX_PROOF_BYTES = 5 * 1024 * 1024;
export const EXAM_AUTH_LEASE_MS = 60_000;

export const ALLOWED_EXAMINATION_TYPES = [
  'Semester Final',
  'Mid Term',
  'Annual Examination',
  'Unit Test',
  'Mock / Entrance Test',
  'Practical / Viva'
] as const;

export type AllowedExaminationType = (typeof ALLOWED_EXAMINATION_TYPES)[number];

export interface Env {
  DB: D1Database;
  PROOF_BUCKET: R2Bucket;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_DATABASE_ID: string;
  ADMIN_EMAIL?: string;
  ALLOWED_ORIGINS?: string;
}

export interface AuthUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  adminClaim?: boolean;
  rawToken: string;
}

export interface InstitutionRow {
  id: string;
  owner_uid: string;
  name: string;
  user_email: string;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface UploadedProofRow {
  storage_key: string;
  payment_request_id: string;
  institution_id: string;
  user_id: string;
  mime_type: string;
  size_bytes: number;
  original_file_name: string;
  uploaded_at_ms: number;
  committed: number;
}

export interface PaymentRequestRow {
  payment_request_id: string;
  institution_id: string;
  institution_name: string;
  user_id: string;
  user_email: string;
  plan_id: string;
  amount: number;
  currency: string;
  upi_id: string;
  transaction_reference_id: string | null;
  screenshot_storage_key: string;
  screenshot_file_name: string;
  screenshot_mime_type: string;
  screenshot_size_bytes: number;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at_ms: number;
  reviewed_at_ms: number | null;
  reviewed_by: string | null;
  rejection_reason: string | null;
  subscription_id: string | null;
}

export interface SubscriptionRow {
  subscription_id: string;
  institution_id: string;
  institution_name: string;
  owner_uid: string;
  user_email: string;
  payment_request_id: string;
  plan_name: string;
  amount: number;
  currency: string;
  payment_status: 'approved' | 'revoked';
  approval_status: 'approved' | 'expired' | 'revoked';
  activated_at_ms: number;
  expires_at_ms: number;
  examination_type_locked: number;
  locked_examination_type: string | null;
  first_examination_created_at_ms: number | null;
  first_exam_id: string | null;
  approved_by: string;
  revoked_at_ms: number | null;
  revoked_by: string | null;
  revocation_reason: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface NotificationRow {
  id: string;
  institution_id: string;
  owner_uid: string;
  type:
    | 'payment_approved'
    | 'payment_rejected'
    | 'subscription_revoked'
    | 'subscription_expired'
    | 'subscription_expiring_soon';
  title: string;
  message: string;
  read: number;
  related_id: string;
  created_at_ms: number;
}

export interface AuditLogRow {
  id: string;
  actor_uid: string;
  actor_email: string;
  actor_role: 'user' | 'admin' | 'system';
  action: string;
  target_type: string;
  target_id: string;
  institution_id: string;
  summary: string;
  reason: string | null;
  created_at_ms: number;
}

export interface ExamAuthRow {
  request_id: string;
  institution_id: string;
  subscription_id: string;
  user_id: string;
  exam_id: string;
  exam_type: string;
  status: 'reserved' | 'committed' | 'aborted';
  expires_at_ms: number;
  created_at_ms: number;
}

export interface VerifiedInstitutionInfo {
  id: string;
  ownerUid: string;
  name: string;
  userEmail: string;
}

export interface WorkerDeps {
  nowMs?: () => number;
  verifyFirebaseToken?: (token: string, env: Env) => Promise<AuthUser>;
  verifyFirestoreInstitution?: (
    institutionId: string,
    auth: AuthUser,
    env: Env
  ) => Promise<VerifiedInstitutionInfo | null>;
}

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}

export function makeWorkerId(prefix: string, nowMs: number): string {
  const randomBytes = new Uint8Array(6);
  crypto.getRandomValues(randomBytes);
  const hex = Array.from(randomBytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${nowMs.toString(36)}_${hex}`;
}

export function getLockedTypeMessage(lockedType: string): string {
  return `Your subscription is currently activated for ${lockedType} examinations. Other examination types will become available after your subscription expires and you purchase a new subscription.`;
}

export function isAllowedExamType(value: string): value is AllowedExaminationType {
  return (ALLOWED_EXAMINATION_TYPES as readonly string[]).includes(value);
}
