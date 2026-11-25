-- Exam Planner Subscription, Payment & Examination-Type Locking Schema (Cloudflare D1 / SQLite)
-- Safe idempotent migration: never drops or resets existing tables.

CREATE TABLE IF NOT EXISTS institutions (
  id TEXT PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  name TEXT NOT NULL,
  user_email TEXT NOT NULL DEFAULT '',
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_institutions_owner_uid ON institutions(owner_uid);

CREATE TABLE IF NOT EXISTS subscription_plans (
  plan_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount = 1),
  currency TEXT NOT NULL DEFAULT 'INR',
  validity_days INTEGER NOT NULL DEFAULT 15,
  payment_method TEXT NOT NULL DEFAULT 'UPI',
  upi_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO subscription_plans (
  plan_id, name, amount, currency, validity_days, payment_method, upi_id, active
) VALUES (
  'exam_planner_access',
  'Exam Planner Access',
  1,
  'INR',
  15,
  'UPI',
  'BHARATPE2N0Y0H9Z0B84598@unitype',
  1
);

CREATE TABLE IF NOT EXISTS admin_users (
  email TEXT PRIMARY KEY,
  uid TEXT,
  role TEXT NOT NULL DEFAULT 'super_admin',
  created_at_ms INTEGER NOT NULL
);

INSERT OR IGNORE INTO admin_users (email, uid, role, created_at_ms)
VALUES ('agarwalpiyush263@gmail.com', NULL, 'super_admin', 1732500000000);

CREATE TABLE IF NOT EXISTS uploaded_proof_objects (
  storage_key TEXT PRIMARY KEY,
  payment_request_id TEXT NOT NULL UNIQUE,
  institution_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  original_file_name TEXT NOT NULL,
  uploaded_at_ms INTEGER NOT NULL,
  committed INTEGER NOT NULL DEFAULT 0 CHECK (committed IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_uploaded_proof_inst_user ON uploaded_proof_objects(institution_id, user_id);

CREATE TABLE IF NOT EXISTS payment_requests (
  payment_request_id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  plan_id TEXT NOT NULL DEFAULT 'exam_planner_access',
  amount INTEGER NOT NULL CHECK (amount = 1),
  currency TEXT NOT NULL DEFAULT 'INR',
  upi_id TEXT NOT NULL DEFAULT 'BHARATPE2N0Y0H9Z0B84598@unitype',
  transaction_reference_id TEXT,
  screenshot_storage_key TEXT NOT NULL UNIQUE,
  screenshot_file_name TEXT NOT NULL,
  screenshot_mime_type TEXT NOT NULL,
  screenshot_size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at_ms INTEGER NOT NULL,
  reviewed_at_ms INTEGER,
  reviewed_by TEXT,
  rejection_reason TEXT,
  subscription_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_inst ON payment_requests(institution_id, submitted_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_user ON payment_requests(user_id, submitted_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status, submitted_at_ms DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  subscription_id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  owner_uid TEXT NOT NULL,
  user_email TEXT NOT NULL,
  payment_request_id TEXT NOT NULL UNIQUE,
  plan_name TEXT NOT NULL DEFAULT 'Exam Planner Access',
  amount INTEGER NOT NULL CHECK (amount = 1),
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_status TEXT NOT NULL CHECK (payment_status IN ('approved', 'revoked')),
  approval_status TEXT NOT NULL CHECK (approval_status IN ('approved', 'expired', 'revoked')),
  activated_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  examination_type_locked INTEGER NOT NULL DEFAULT 0 CHECK (examination_type_locked IN (0, 1)),
  locked_examination_type TEXT,
  first_examination_created_at_ms INTEGER,
  first_exam_id TEXT,
  approved_by TEXT NOT NULL,
  revoked_at_ms INTEGER,
  revoked_by TEXT,
  revocation_reason TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_inst ON subscriptions(institution_id, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_owner ON subscriptions(owner_uid, created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(approval_status, expires_at_ms);

CREATE TABLE IF NOT EXISTS examination_type_locks (
  subscription_id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  locked_examination_type TEXT NOT NULL,
  first_exam_id TEXT NOT NULL,
  locked_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exam_type_locks_inst ON examination_type_locks(institution_id);

CREATE TABLE IF NOT EXISTS exam_creation_authorizations (
  request_id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  exam_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'committed', 'aborted')),
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exam_auth_sub_status ON exam_creation_authorizations(subscription_id, status, expires_at_ms);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  institution_id TEXT NOT NULL,
  owner_uid TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'payment_approved',
    'payment_rejected',
    'subscription_revoked',
    'subscription_expired',
    'subscription_expiring_soon'
  )),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
  related_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_inst_owner ON notifications(institution_id, owner_uid, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS subscription_audit_logs (
  id TEXT PRIMARY KEY,
  actor_uid TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('user', 'admin', 'system')),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  institution_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  reason TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON subscription_audit_logs(created_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_inst ON subscription_audit_logs(institution_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_start_ms INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);
