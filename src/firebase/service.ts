import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
  User as FirebaseUser
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore';
import { getLockedTypeMessage, isAllowedExaminationType } from '../core/subscriptionConstants';
import {
  AuditLogRecord,
  AuditReport,
  ClassroomAllocation,
  ClassroomConfig,
  ExamRecord,
  InstitutionProfile,
  InstitutionType,
  SeatingPlanRecord,
  StudentRecord,
  SubscriptionRecord,
  UserProfile
} from '../core/types';
import { auth, db, isFirebaseConfigured } from './config';

export function makeUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(val: unknown): val is string {
  return typeof val === 'string' && (UUID_REGEX.test(val.trim()) || val.trim().length > 5);
}

export interface RegisterInstitutionInput {
  fullName: string;
  email: string;
  password: string;
  institutionName: string;
  institutionType: InstitutionType;
  address: string;
  city: string;
  state: string;
  pinCode: string;
  mobile: string;
  logoDataUrl?: string;
}

function ensureFirebaseReady() {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured. Set VITE_FIREBASE_* environment variables.');
  }
}

function cleanFirestoreData<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => cleanFirestoreData(item)) as unknown as T;
  }
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = cleanFirestoreData(value);
      }
    }
    return cleaned as T;
  }
  return obj;
}

export async function registerWithEmailAndInstitution(
  input: RegisterInstitutionInput
): Promise<{
  user: UserProfile | null;
  institution: InstitutionProfile | null;
  requiresEmailVerification: boolean;
}> {
  ensureFirebaseReady();
  const cleanEmail = input.email.trim();

  const cred = await createUserWithEmailAndPassword(auth, cleanEmail, input.password);
  if (!cred.user) {
    throw new Error('Registration failed to create a user account.');
  }

  await updateProfile(cred.user, {
    displayName: input.fullName.trim()
  });

  const institutionId = makeUuid();
  const now = new Date().toISOString();

  const institutionDoc: InstitutionProfile = {
    id: institutionId,
    ownerId: cred.user.uid,
    name: input.institutionName.trim(),
    type: input.institutionType,
    address: input.address.trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    pinCode: input.pinCode.trim(),
    mobile: input.mobile.trim(),
    logoDataUrl: input.logoDataUrl && input.logoDataUrl.length <= 300000 ? input.logoDataUrl : undefined,
    createdAt: now,
    updatedAt: now
  };

  const userProfile: UserProfile = {
    uid: cred.user.uid,
    fullName: input.fullName.trim(),
    email: cleanEmail,
    institutionId,
    role: 'coordinator',
    createdAt: now,
    updatedAt: now
  };

  await setDoc(doc(db, 'institutions', institutionId), cleanFirestoreData(institutionDoc));
  await setDoc(doc(db, 'profiles', cred.user.uid), userProfile);
  await setDoc(doc(db, 'institution_members', `${institutionId}_${cred.user.uid}`), {
    institution_id: institutionId,
    user_id: cred.user.uid,
    role: 'owner',
    created_at: now
  });

  return {
    user: userProfile,
    institution: institutionDoc,
    requiresEmailVerification: false
  };
}

export async function createInstitutionAndUserProfile(
  input: Omit<RegisterInstitutionInput, 'password'>
): Promise<{ user: UserProfile; institution: InstitutionProfile }> {
  ensureFirebaseReady();
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('No authenticated user found.');
  }

  const institutionId = makeUuid();
  const now = new Date().toISOString();

  const institutionDoc: InstitutionProfile = {
    id: institutionId,
    ownerId: currentUser.uid,
    name: input.institutionName.trim(),
    type: input.institutionType,
    address: input.address.trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    pinCode: input.pinCode.trim(),
    mobile: input.mobile.trim(),
    logoDataUrl: input.logoDataUrl && input.logoDataUrl.length <= 300000 ? input.logoDataUrl : undefined,
    createdAt: now,
    updatedAt: now
  };

  const userProfile: UserProfile = {
    uid: currentUser.uid,
    fullName: input.fullName.trim() || currentUser.displayName || 'Coordinator',
    email: currentUser.email || input.email.trim(),
    institutionId,
    role: 'coordinator',
    createdAt: now,
    updatedAt: now
  };

  await setDoc(doc(db, 'institutions', institutionId), cleanFirestoreData(institutionDoc));
  await setDoc(doc(db, 'profiles', currentUser.uid), userProfile);
  await setDoc(doc(db, 'institution_members', `${institutionId}_${currentUser.uid}`), {
    institution_id: institutionId,
    user_id: currentUser.uid,
    role: 'owner',
    created_at: now
  });

  return { user: userProfile, institution: institutionDoc };
}

export async function loginWithEmail(email: string, password: string) {
  ensureFirebaseReady();
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred;
}

export async function sendPasswordReset(email: string) {
  ensureFirebaseReady();
  await sendPasswordResetEmail(auth, email.trim());
}

export async function updateUserPassword(newPassword: string) {
  ensureFirebaseReady();
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('No authenticated user found.');
  }
  await updatePassword(currentUser, newPassword);
}

export async function resendVerificationEmail(_email: string) {
  ensureFirebaseReady();
  if (auth.currentUser) {
    await sendEmailVerification(auth.currentUser);
  }
}

export async function logoutUser() {
  await signOut(auth);
}

export async function fetchUserAndInstitution(
  authUser: FirebaseUser
): Promise<{ user: UserProfile | null; institution: InstitutionProfile | null }> {
  ensureFirebaseReady();

  const profileRef = doc(db, 'profiles', authUser.uid);
  const profileSnap = await getDoc(profileRef);

  let userProfile: UserProfile | null = null;
  let institution: InstitutionProfile | null = null;

  if (profileSnap.exists()) {
    userProfile = profileSnap.data() as UserProfile;
    if (userProfile.institutionId) {
      const instSnap = await getDoc(doc(db, 'institutions', userProfile.institutionId));
      if (instSnap.exists()) {
        institution = instSnap.data() as InstitutionProfile;
      }
    }
  }

  if (!institution) {
    // Check owned institutions
    const q = query(collection(db, 'institutions'), where('ownerId', '==', authUser.uid));
    const snap = await getDocs(q);
    if (!snap.empty) {
      institution = snap.docs[0].data() as InstitutionProfile;
    }
  }

  if (!userProfile && institution) {
    userProfile = {
      uid: authUser.uid,
      fullName: authUser.displayName || 'Coordinator',
      email: authUser.email || '',
      institutionId: institution.id,
      role: 'coordinator'
    };
    await setDoc(doc(db, 'profiles', authUser.uid), userProfile);
  }

  return { user: userProfile, institution };
}

export async function updateInstitutionProfile(
  institutionId: string,
  _ownerId: string,
  updates: Partial<
    Pick<
      InstitutionProfile,
      'name' | 'type' | 'address' | 'city' | 'state' | 'pinCode' | 'mobile' | 'logoDataUrl'
    >
  >
): Promise<void> {
  ensureFirebaseReady();
  const ref = doc(db, 'institutions', institutionId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    throw new Error('Institution not found.');
  }
  const existing = snap.data() as InstitutionProfile;
  const updated: InstitutionProfile = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  await setDoc(ref, cleanFirestoreData(updated), { merge: true });
}

export async function updateCoordinatorName(
  uid: string,
  fullName: string,
  email: string
): Promise<void> {
  ensureFirebaseReady();
  const ref = doc(db, 'profiles', uid);
  await setDoc(
    ref,
    {
      fullName: fullName.trim(),
      email: email.trim(),
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function listExams(institutionId: string): Promise<ExamRecord[]> {
  ensureFirebaseReady();
  const q = query(collection(db, 'institutions', institutionId, 'examinations'));
  const snap = await getDocs(q);
  const exams: ExamRecord[] = [];
  snap.forEach((d) => {
    exams.push(d.data() as ExamRecord);
  });
  exams.sort((a, b) => new Date(String(b.updatedAt || 0)).getTime() - new Date(String(a.updatedAt || 0)).getTime());
  return exams;
}

export async function saveExamWithStudentsAndClassrooms(params: {
  institutionId: string;
  ownerId: string;
  exam: Omit<ExamRecord, 'id' | 'institutionId' | 'ownerId' | 'createdAt' | 'updatedAt'> & { id?: string };
  students: StudentRecord[];
  classrooms: ClassroomConfig[];
  isNew: boolean;
}): Promise<string> {
  ensureFirebaseReady();
  const { institutionId, ownerId, exam, students, classrooms, isNew } = params;
  const rawType = exam.examType.trim() === 'Mid-Term' ? 'Mid Term' : exam.examType.trim();

  if (isNew && !isAllowedExaminationType(rawType)) {
    throw new Error(`Invalid examination type "${rawType}". Please select one of the supported types.`);
  }

  const examId = !isNew && exam.id ? exam.id : makeUuid();
  const now = new Date().toISOString();

  let activeSubId = exam.subscriptionId;
  if (isNew) {
    const subSnap = await getDocs(
      query(collection(db, 'subscriptions'), where('institutionId', '==', institutionId))
    );
    const nowMs = Date.now();
    let matchedActiveSub: SubscriptionRecord | null = null;
    subSnap.forEach((d) => {
      const s = d.data() as SubscriptionRecord;
      const expMs = typeof s.expiresAt === 'string' ? Date.parse(s.expiresAt) : 0;
      if (s.paymentStatus === 'approved' && s.approvalStatus === 'approved' && expMs > nowMs) {
        matchedActiveSub = s;
      }
    });

    if (matchedActiveSub) {
      const activeSub = matchedActiveSub as SubscriptionRecord;
      activeSubId = activeSub.subscriptionId;
      if (activeSub.examinationTypeLocked && activeSub.lockedExaminationType) {
        if (rawType !== activeSub.lockedExaminationType) {
          throw new Error(getLockedTypeMessage(activeSub.lockedExaminationType));
        }
      } else {
        // First examination creation on this subscription -> lock the examination type
        await setDoc(
          doc(db, 'subscriptions', activeSub.subscriptionId),
          {
            examinationTypeLocked: true,
            lockedExaminationType: rawType,
            firstExamId: examId,
            firstExaminationCreatedAt: now,
            updatedAt: now
          },
          { merge: true }
        );
      }
    }
  }

  const examRecord: ExamRecord = {
    id: examId,
    institutionId,
    ownerId,
    name: exam.name.trim() || 'Untitled Examination',
    examType: rawType,
    academicYear: exam.academicYear.trim() || `${new Date().getFullYear()}`,
    examDate: exam.examDate.trim() || now.slice(0, 10),
    examTime: exam.examTime?.trim(),
    subject: exam.subject?.trim(),
    classCourse: exam.classCourse?.trim(),
    semester: exam.semester?.trim(),
    notes: exam.notes?.trim(),
    status: exam.status || 'draft',
    studentCount: students.length,
    classroomCount: classrooms.length,
    totalBenches: exam.totalBenches || 0,
    totalCapacity: exam.totalCapacity || 0,
    seatingMode: exam.seatingMode === 2 ? 2 : 1,
    strategy: exam.strategy || 'sequential',
    sortOrder: exam.sortOrder || 'original',
    rollRangeStart: exam.rollRangeStart?.trim(),
    rollRangeEnd: exam.rollRangeEnd?.trim(),
    latestPlanId: exam.latestPlanId,
    latestAuditStatus: exam.latestAuditStatus,
    subscriptionId: activeSubId,
    createdAt: now,
    updatedAt: now
  };

  await setDoc(doc(db, 'institutions', institutionId, 'examinations', examId), cleanFirestoreData(examRecord));

  // Save students
  for (let idx = 0; idx < students.length; idx++) {
    const s = students[idx];
    const sId = s.id || `stu_${idx + 1}`;
    await setDoc(
      doc(db, 'institutions', institutionId, 'examinations', examId, 'students', sId),
      cleanFirestoreData({
        ...s,
        id: sId,
        originalIndex: s.originalIndex ?? idx
      })
    );
  }

  // Save classrooms
  for (let idx = 0; idx < classrooms.length; idx++) {
    const c = classrooms[idx];
    const cId = c.id || `room_${idx + 1}`;
    await setDoc(
      doc(db, 'institutions', institutionId, 'examinations', examId, 'classrooms', cId),
      cleanFirestoreData({
        ...c,
        id: cId,
        orderIndex: c.orderIndex ?? idx
      })
    );
  }

  return examId;
}

export async function saveSeatingPlanVersion(params: {
  institutionId: string;
  ownerId: string;
  examId: string;
  examName: string;
  seatingMode: 1 | 2;
  strategy: ExamRecord['strategy'];
  sortOrder: ExamRecord['sortOrder'];
  auditReport: AuditReport;
  roomAllocations: ClassroomAllocation[];
  aiSummary?: string;
}): Promise<SeatingPlanRecord> {
  ensureFirebaseReady();
  const {
    institutionId,
    ownerId,
    examId,
    examName,
    seatingMode,
    strategy,
    sortOrder,
    auditReport,
    roomAllocations,
    aiSummary
  } = params;

  const planId = makeUuid();
  const now = new Date().toISOString();

  // Determine existing version count
  const plansSnap = await getDocs(collection(db, 'institutions', institutionId, 'examinations', examId, 'seating_plans'));
  const version = plansSnap.size + 1;

  const totalStudents = auditReport.totalStudents || 0;
  const allocatedStudents = auditReport.allocatedStudents || 0;
  const unallocatedStudents = totalStudents - allocatedStudents;
  const totalBenches = roomAllocations.reduce((acc, r) => acc + r.totalBenches, 0);
  const totalCapacity = roomAllocations.reduce((acc, r) => acc + r.capacity, 0);
  const unusedSeats = totalCapacity - allocatedStudents;

  const planRecord: SeatingPlanRecord = {
    id: planId,
    examId,
    institutionId,
    ownerId,
    version,
    seatingMode,
    strategy,
    sortOrder,
    totalStudents,
    allocatedStudents,
    unallocatedStudents,
    totalBenches,
    totalCapacity,
    unusedSeats: Math.max(0, unusedSeats),
    auditStatus: auditReport.status,
    auditReport,
    aiSummary,
    createdAt: now
  };

  await setDoc(
    doc(db, 'institutions', institutionId, 'examinations', examId, 'seating_plans', planId),
    cleanFirestoreData(planRecord)
  );

  // Save room allocations
  for (let idx = 0; idx < roomAllocations.length; idx++) {
    const room = roomAllocations[idx];
    const roomAllocId = room.id || `alloc_${idx + 1}`;
    await setDoc(
      doc(
        db,
        'institutions',
        institutionId,
        'examinations',
        examId,
        'seating_plans',
        planId,
        'room_allocations',
        roomAllocId
      ),
      cleanFirestoreData({
        ...room,
        id: roomAllocId,
        orderIndex: room.orderIndex ?? idx
      })
    );
  }

  // Update exam latest plan
  await setDoc(
    doc(db, 'institutions', institutionId, 'examinations', examId),
    cleanFirestoreData({
      latestPlanId: planId,
      latestAuditStatus: auditReport.status,
      updatedAt: now
    }),
    { merge: true }
  );

  return planRecord;
}

export async function loadExamBundle(
  institutionId: string,
  examId: string
): Promise<{
  exam: ExamRecord | null;
  students: StudentRecord[];
  classrooms: ClassroomConfig[];
  plans: SeatingPlanRecord[];
}> {
  ensureFirebaseReady();

  const examDoc = await getDoc(doc(db, 'institutions', institutionId, 'examinations', examId));
  if (!examDoc.exists()) {
    return { exam: null, students: [], classrooms: [], plans: [] };
  }

  const exam = examDoc.data() as ExamRecord;

  const [stuSnap, roomSnap, planSnap] = await Promise.all([
    getDocs(collection(db, 'institutions', institutionId, 'examinations', examId, 'students')),
    getDocs(collection(db, 'institutions', institutionId, 'examinations', examId, 'classrooms')),
    getDocs(collection(db, 'institutions', institutionId, 'examinations', examId, 'seating_plans'))
  ]);

  const students: StudentRecord[] = [];
  stuSnap.forEach((d) => students.push(d.data() as StudentRecord));
  students.sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));

  const classrooms: ClassroomConfig[] = [];
  roomSnap.forEach((d) => classrooms.push(d.data() as ClassroomConfig));
  classrooms.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  const plans: SeatingPlanRecord[] = [];
  planSnap.forEach((d) => plans.push(d.data() as SeatingPlanRecord));
  plans.sort((a, b) => b.version - a.version);

  return { exam, students, classrooms, plans };
}

export async function loadPlanRoomAllocations(
  institutionId: string,
  examId: string,
  planId: string
): Promise<ClassroomAllocation[]> {
  ensureFirebaseReady();
  const snap = await getDocs(
    collection(
      db,
      'institutions',
      institutionId,
      'examinations',
      examId,
      'seating_plans',
      planId,
      'room_allocations'
    )
  );
  const allocations: ClassroomAllocation[] = [];
  snap.forEach((d) => allocations.push(d.data() as ClassroomAllocation));
  allocations.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  return allocations;
}

export async function updateExamStatus(
  institutionId: string,
  examId: string,
  status: ExamRecord['status']
): Promise<void> {
  ensureFirebaseReady();
  await setDoc(
    doc(db, 'institutions', institutionId, 'examinations', examId),
    {
      status,
      updatedAt: new Date().toISOString()
    },
    { merge: true }
  );
}

export async function duplicateExamRecord(
  institutionId: string,
  examId: string,
  ownerId: string
): Promise<string> {
  const bundle = await loadExamBundle(institutionId, examId);
  if (!bundle.exam) {
    throw new Error('Examination not found.');
  }

  const normalizedType = bundle.exam.examType === 'Mid-Term' ? 'Mid Term' : bundle.exam.examType;

  return saveExamWithStudentsAndClassrooms({
    institutionId,
    ownerId,
    exam: {
      name: `${bundle.exam.name} (Copy)`,
      examType: normalizedType,
      academicYear: bundle.exam.academicYear,
      examDate: bundle.exam.examDate,
      examTime: bundle.exam.examTime,
      subject: bundle.exam.subject,
      classCourse: bundle.exam.classCourse,
      semester: bundle.exam.semester,
      notes: bundle.exam.notes,
      status: 'draft',
      studentCount: bundle.students.length,
      classroomCount: bundle.classrooms.length,
      totalBenches: bundle.exam.totalBenches,
      totalCapacity: bundle.exam.totalCapacity,
      seatingMode: bundle.exam.seatingMode,
      strategy: bundle.exam.strategy,
      sortOrder: bundle.exam.sortOrder,
      rollRangeStart: bundle.exam.rollRangeStart,
      rollRangeEnd: bundle.exam.rollRangeEnd
    },
    students: bundle.students,
    classrooms: bundle.classrooms,
    isNew: true
  });
}

export async function deleteExamRecord(
  institutionId: string,
  examId: string,
  _examName: string
): Promise<void> {
  ensureFirebaseReady();
  await deleteDoc(doc(db, 'institutions', institutionId, 'examinations', examId));
}

export async function listAuditLogs(institutionId: string): Promise<AuditLogRecord[]> {
  ensureFirebaseReady();
  const snap = await getDocs(collection(db, 'institutions', institutionId, 'audit_logs'));
  const logs: AuditLogRecord[] = [];
  snap.forEach((d) => logs.push(d.data() as AuditLogRecord));
  logs.sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());
  return logs.slice(0, 200);
}

export interface LegacyWorkspaceExport {
  version: number;
  exportedAt: string;
  institution?: Partial<InstitutionProfile>;
  examinations: Array<{
    exam: Partial<ExamRecord>;
    students: StudentRecord[];
    classrooms: ClassroomConfig[];
    plans?: Array<Partial<SeatingPlanRecord> & { roomAllocations?: ClassroomAllocation[] }>;
  }>;
}

export async function exportInstitutionWorkspaceBackup(
  institution: InstitutionProfile,
  exams: ExamRecord[]
): Promise<LegacyWorkspaceExport> {
  const bundles = await Promise.all(
    exams.map(async (ex) => {
      const bundle = await loadExamBundle(institution.id, ex.id);
      const plansWithAllocations = await Promise.all(
        bundle.plans.map(async (p) => ({
          ...p,
          roomAllocations: await loadPlanRoomAllocations(institution.id, ex.id, p.id)
        }))
      );
      return {
        exam: bundle.exam || ex,
        students: bundle.students,
        classrooms: bundle.classrooms,
        plans: plansWithAllocations
      };
    })
  );

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    institution,
    examinations: bundles
  };
}

export async function importLegacyWorkspaceBackup(
  institutionId: string,
  payload: LegacyWorkspaceExport
): Promise<{ importedCount: number }> {
  ensureFirebaseReady();
  if (!payload || !Array.isArray(payload.examinations)) {
    throw new Error('Invalid backup JSON format. Expected an "examinations" array.');
  }

  let importedCount = 0;
  const currentUser = auth.currentUser;
  const ownerId = currentUser ? currentUser.uid : 'imported_user';

  for (const entry of payload.examinations) {
    const ex = entry.exam || {};
    await saveExamWithStudentsAndClassrooms({
      institutionId,
      ownerId,
      exam: {
        name: ex.name || 'Imported Examination',
        examType: ex.examType || 'Semester Final',
        academicYear: ex.academicYear || `${new Date().getFullYear()}`,
        examDate: ex.examDate || new Date().toISOString().slice(0, 10),
        examTime: ex.examTime,
        subject: ex.subject,
        classCourse: ex.classCourse,
        semester: ex.semester,
        notes: ex.notes,
        status: ex.status || 'archived',
        studentCount: (entry.students || []).length,
        classroomCount: (entry.classrooms || []).length,
        totalBenches: Number(ex.totalBenches || 0),
        totalCapacity: Number(ex.totalCapacity || 0),
        seatingMode: ex.seatingMode === 2 ? 2 : 1,
        strategy: ex.strategy || 'sequential',
        sortOrder: ex.sortOrder || 'original',
        rollRangeStart: ex.rollRangeStart,
        rollRangeEnd: ex.rollRangeEnd
      },
      students: entry.students || [],
      classrooms: entry.classrooms || [],
      isNew: true
    });
    importedCount += 1;
  }

  return { importedCount };
}
