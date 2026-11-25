export type InstitutionType =
  | 'School'
  | 'College'
  | 'University'
  | 'Coaching Institute'
  | 'Examination Center'
  | 'Other';

export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  institutionId: string;
  role: 'coordinator';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InstitutionProfile {
  id: string;
  ownerId: string;
  name: string;
  type: InstitutionType;
  address: string;
  city: string;
  state: string;
  pinCode: string;
  mobile: string;
  logoDataUrl?: string;
  activeSubscriptionId?: string | null;
  pendingPaymentRequestId?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type SeatingMode = 1 | 2;
export type AllocationStrategy = 'sequential' | 'alternate' | 'section_separation' | 'custom';
export type SortOrder = 'original' | 'ascending' | 'custom';
export type ExamStatus = 'draft' | 'generated' | 'verified' | 'archived';

export interface StudentRecord {
  id: string;
  rollNumber: string;
  name?: string;
  className?: string;
  course?: string;
  section?: string;
  subject?: string;
  originalIndex: number;
}

export interface ClassroomConfig {
  id: string;
  name: string;
  roomNumber: string;
  building?: string;
  floor?: string;
  rows: number;
  benchesPerRow: number;
  rowBenchCounts?: number[];
  disabledBenches?: string[]; // Format: "R1-B3"
  disabled: boolean;
  notes?: string;
  orderIndex: number;
}

export interface CustomAllocationRule {
  staggerStep?: number;
  groupByField?: 'course' | 'section' | 'subject';
}

export interface ExamRecord {
  id: string;
  institutionId: string;
  ownerId: string;
  name: string;
  examType: string;
  academicYear: string;
  examDate: string;
  examTime?: string;
  subject?: string;
  classCourse?: string;
  semester?: string;
  notes?: string;
  status: ExamStatus;
  studentCount: number;
  classroomCount: number;
  totalBenches: number;
  totalCapacity: number;
  seatingMode: SeatingMode;
  strategy: AllocationStrategy;
  sortOrder: SortOrder;
  rollRangeStart?: string;
  rollRangeEnd?: string;
  latestPlanId?: string;
  latestAuditStatus?: 'VERIFIED' | 'FAILED' | 'PENDING';
  subscriptionId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SeatAssignment {
  seatNumber: 1 | 2;
  status: 'OCCUPIED' | 'EMPTY' | 'DISABLED';
  rollNumber?: string;
  studentName?: string;
  studentId?: string;
  className?: string;
  course?: string;
  section?: string;
  subject?: string;
}

export interface BenchAllocation {
  benchNumber: number;
  benchLabel: string;
  isDisabled: boolean;
  seats: SeatAssignment[];
}

export interface RowAllocation {
  rowNumber: number;
  rowLabel: string;
  benches: BenchAllocation[];
}

export interface ClassroomAllocation {
  id: string;
  classroomId: string;
  classroomName: string;
  roomNumber: string;
  building?: string;
  floor?: string;
  orderIndex: number;
  totalBenches: number;
  activeBenches: number;
  capacity: number;
  allocatedCount: number;
  unusedSeats: number;
  rows: RowAllocation[];
}

export interface StudentSeatLookup {
  studentId: string;
  rollNumber: string;
  studentName: string;
  classroomId: string;
  classroomName: string;
  roomNumber: string;
  rowNumber: number;
  rowLabel: string;
  benchNumber: number;
  benchLabel: string;
  seatNumber: 1 | 2;
  className?: string;
  course?: string;
  section?: string;
  subject?: string;
}

export interface ValidationIssue {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  agent:
    | 'Data Scanner'
    | 'Data Validation'
    | 'Classroom Capacity'
    | 'Seating Audit'
    | 'PDF Quality Check'
    | 'Orchestrator';
  code: string;
  message: string;
  details?: string;
  affectedRollNumbers?: string[];
}

export interface AuditCheckItem {
  key: string;
  label: string;
  passed: boolean;
  severity: 'critical' | 'warning';
  details: string;
}

export interface AuditReport {
  status: 'VERIFIED' | 'FAILED';
  totalStudents: number;
  allocatedStudents: number;
  unallocatedStudents: number;
  duplicateAssignments: number;
  missingStudents: number;
  totalBenches: number;
  activeBenches: number;
  totalCapacity: number;
  unusedSeats: number;
  capacitySufficient: boolean;
  checklist: AuditCheckItem[];
  issues: ValidationIssue[];
  generatedAt: string;
}

export interface AllocationResult {
  roomAllocations: ClassroomAllocation[];
  lookupIndex: StudentSeatLookup[];
  unallocatedStudents: StudentRecord[];
  totalStudents: number;
  allocatedStudents: number;
  totalBenches: number;
  activeBenches: number;
  totalCapacity: number;
  unusedSeats: number;
  capacitySufficient: boolean;
  errorMessage?: string;
}

export interface SeatingPlanRecord {
  id: string;
  examId: string;
  institutionId: string;
  ownerId: string;
  version: number;
  seatingMode: SeatingMode;
  strategy: AllocationStrategy;
  sortOrder: SortOrder;
  totalStudents: number;
  allocatedStudents: number;
  unallocatedStudents: number;
  totalBenches: number;
  totalCapacity: number;
  unusedSeats: number;
  auditStatus: 'VERIFIED' | 'FAILED';
  auditReport: AuditReport;
  aiSummary?: string;
  createdAt?: unknown;
}

export interface AuditLogRecord {
  id: string;
  ownerId: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt?: unknown;
}

export interface CapacitySummary {
  totalClassrooms: number;
  activeClassrooms: number;
  totalBenches: number;
  activeBenches: number;
  disabledBenches: number;
  totalCapacity: number;
  issues: ValidationIssue[];
}

export type PaymentRequestStatus = 'pending' | 'approved' | 'rejected';

export interface PaymentRequestRecord {
  paymentRequestId: string;
  institutionId: string;
  institutionName: string;
  userId: string;
  userEmail: string;
  planId?: string;
  amount: number;
  currency?: string;
  upiId: string;
  transactionReferenceId?: string | null;
  screenshotStoragePath: string;
  screenshotFileName?: string;
  screenshotMimeType?: string;
  screenshotSizeBytes?: number;
  status: PaymentRequestStatus;
  submittedAt?: unknown;
  reviewedAt?: unknown;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  subscriptionId?: string | null;
}

export type SubscriptionApprovalStatus = 'approved' | 'expired' | 'revoked';
export type SubscriptionPaymentStatus = 'approved' | 'revoked';

export interface SubscriptionRecord {
  subscriptionId: string;
  institutionId: string;
  institutionName: string;
  ownerId: string;
  userEmail: string;
  paymentRequestId: string;
  planName: string;
  amount: number;
  currency?: string;
  paymentStatus: SubscriptionPaymentStatus;
  approvalStatus: SubscriptionApprovalStatus;
  activatedAt?: unknown;
  expiresAt?: unknown;
  examinationTypeLocked: boolean;
  lockedExaminationType: string | null;
  firstExaminationCreatedAt?: unknown;
  firstExamId?: string | null;
  approvedBy: string;
  revokedAt?: unknown;
  revokedBy?: string | null;
  revocationReason?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NotificationRecord {
  id: string;
  institutionId: string;
  ownerId: string;
  type:
    | 'payment_approved'
    | 'payment_rejected'
    | 'subscription_revoked'
    | 'subscription_expired'
    | 'subscription_expiring_soon';
  title: string;
  message: string;
  read: boolean;
  relatedId: string;
  createdAt?: unknown;
}

export interface AdminAuditLogRecord {
  id: string;
  adminUid: string;
  adminEmail: string;
  actorRole?: 'user' | 'admin' | 'system';
  action:
    | 'PAYMENT_APPROVED'
    | 'PAYMENT_REJECTED'
    | 'SUBSCRIPTION_REVOKED'
    | 'PAYMENT_REQUEST_SUBMITTED'
    | 'EXAM_TYPE_LOCKED'
    | string;
  targetType: 'paymentRequest' | 'subscription' | string;
  targetId: string;
  institutionId: string;
  summary: string;
  reason?: string | null;
  createdAt?: unknown;
}


