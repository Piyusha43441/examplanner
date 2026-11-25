import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL
} from 'firebase/storage';
import { isAllowedExaminationType } from '../core/subscriptionConstants';
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
  UserProfile
} from '../core/types';
import {
  abortExamCreateOnCloudflare,
  authorizeExamCreateOnCloudflare,
  confirmExamCreatedOnCloudflare,
  verifyExamFeatureAccessOnCloudflare
} from '../services/cloudflareApi';
import { auth, db, storage } from './config';
import { handleFirestoreError, OperationType } from './errors';

export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (val === null || typeof val !== 'object') return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function stripUndefinedDeep<T>(val: T): T {
  if (Array.isArray(val)) {
    return val
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (isPlainObject(val)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return val;
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

export async function registerWithEmailAndInstitution(
  input: RegisterInstitutionInput
): Promise<{ user: UserProfile; institution: InstitutionProfile }> {
  const cred = await createUserWithEmailAndPassword(auth, input.email.trim(), input.password);
  const uid = cred.user.uid;
  await updateProfile(cred.user, { displayName: input.fullName.trim() });
  void sendEmailVerification(cred.user).catch(() => {});

  return createInstitutionAndUserProfile(uid, {
    fullName: input.fullName.trim(),
    email: input.email.trim(),
    institutionName: input.institutionName.trim(),
    institutionType: input.institutionType,
    address: input.address.trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    pinCode: input.pinCode.trim(),
    mobile: input.mobile.trim(),
    logoDataUrl: input.logoDataUrl
  });
}

export async function createInstitutionAndUserProfile(
  uid: string,
  input: Omit<RegisterInstitutionInput, 'password'>
): Promise<{ user: UserProfile; institution: InstitutionProfile }> {
  const institutionId = makeId('inst');

  const instPayload: Record<string, unknown> = {
    id: institutionId,
    ownerId: uid,
    name: input.institutionName.slice(0, 180),
    type: input.institutionType,
    address: input.address.slice(0, 300),
    city: input.city.slice(0, 100),
    state: input.state.slice(0, 100),
    pinCode: input.pinCode.slice(0, 20),
    mobile: input.mobile.slice(0, 30),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  if (input.logoDataUrl && input.logoDataUrl.length <= 300000) {
    instPayload.logoDataUrl = input.logoDataUrl;
  }

  const instPath = `institutions/${institutionId}`;
  try {
    await setDoc(doc(db, 'institutions', institutionId), instPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, instPath);
  }

  const userPayload = {
    uid,
    fullName: input.fullName.slice(0, 120),
    email: input.email.slice(0, 160),
    institutionId,
    role: 'coordinator' as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  const userPath = `users/${uid}`;
  try {
    await setDoc(doc(db, 'users', uid), userPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, userPath);
  }

  await appendAuditLog(institutionId, uid, 'INSTITUTION_REGISTERED', 'institution', institutionId, `Registered institution "${input.institutionName}"`);

  return {
    user: {
      uid,
      fullName: input.fullName,
      email: input.email,
      institutionId,
      role: 'coordinator'
    },
    institution: {
      id: institutionId,
      ownerId: uid,
      name: input.institutionName,
      type: input.institutionType,
      address: input.address,
      city: input.city,
      state: input.state,
      pinCode: input.pinCode,
      mobile: input.mobile,
      logoDataUrl: input.logoDataUrl
    }
  };
}

export async function loginWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function sendPasswordReset(email: string) {
  return sendPasswordResetEmail(auth, email.trim());
}

export async function logoutUser() {
  return signOut(auth);
}

export async function fetchUserAndInstitution(
  uid: string
): Promise<{ user: UserProfile | null; institution: InstitutionProfile | null }> {
  const userPath = `users/${uid}`;
  let userSnap;
  try {
    userSnap = await getDoc(doc(db, 'users', uid));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, userPath);
  }

  if (!userSnap.exists()) {
    return { user: null, institution: null };
  }

  const userData = userSnap.data() as UserProfile;
  const instPath = `institutions/${userData.institutionId}`;
  let instSnap;
  try {
    instSnap = await getDoc(doc(db, 'institutions', userData.institutionId));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, instPath);
  }

  return {
    user: userData,
    institution: instSnap.exists() ? (instSnap.data() as InstitutionProfile) : null
  };
}

export async function updateInstitutionProfile(
  institutionId: string,
  ownerId: string,
  updates: Partial<
    Pick<
      InstitutionProfile,
      'name' | 'type' | 'address' | 'city' | 'state' | 'pinCode' | 'mobile' | 'logoDataUrl'
    >
  >
): Promise<void> {
  const path = `institutions/${institutionId}`;
  const cleanUpdates: Record<string, unknown> = {
    updatedAt: serverTimestamp()
  };
  if (updates.name !== undefined) cleanUpdates.name = updates.name.trim().slice(0, 180);
  if (updates.type !== undefined) cleanUpdates.type = updates.type;
  if (updates.address !== undefined) cleanUpdates.address = updates.address.trim().slice(0, 300);
  if (updates.city !== undefined) cleanUpdates.city = updates.city.trim().slice(0, 100);
  if (updates.state !== undefined) cleanUpdates.state = updates.state.trim().slice(0, 100);
  if (updates.pinCode !== undefined) cleanUpdates.pinCode = updates.pinCode.trim().slice(0, 20);
  if (updates.mobile !== undefined) cleanUpdates.mobile = updates.mobile.trim().slice(0, 30);
  if (updates.logoDataUrl !== undefined && updates.logoDataUrl.length <= 300000) {
    cleanUpdates.logoDataUrl = updates.logoDataUrl;
  }

  try {
    await updateDoc(doc(db, 'institutions', institutionId), cleanUpdates);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }

  await appendAuditLog(
    institutionId,
    ownerId,
    'INSTITUTION_UPDATED',
    'institution',
    institutionId,
    'Updated institution profile details'
  );
}

export async function updateCoordinatorName(uid: string, fullName: string, email: string): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      fullName: fullName.trim().slice(0, 120),
      email: email.trim().slice(0, 160),
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function listExams(institutionId: string, ownerId: string): Promise<ExamRecord[]> {
  const path = `institutions/${institutionId}/exams`;
  try {
    const q = query(
      collection(db, 'institutions', institutionId, 'exams'),
      where('ownerId', '==', ownerId),
      orderBy('updatedAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ExamRecord);
  } catch (err) {
    // Fallback without orderBy in case composite index is still building
    try {
      const q2 = query(
        collection(db, 'institutions', institutionId, 'exams'),
        where('ownerId', '==', ownerId)
      );
      const snap2 = await getDocs(q2);
      return snap2.docs.map((d) => d.data() as ExamRecord);
    } catch (innerErr) {
      handleFirestoreError(innerErr, OperationType.LIST, path);
    }
  }
}

export async function saveExamWithStudentsAndClassrooms(params: {
  institutionId: string;
  ownerId: string;
  exam: Omit<ExamRecord, 'id' | 'institutionId' | 'ownerId' | 'createdAt' | 'updatedAt'> & { id?: string };
  students: StudentRecord[];
  classrooms: ClassroomConfig[];
  isNew: boolean;
}): Promise<string> {
  const { institutionId, ownerId, exam, students, classrooms, isNew } = params;
  const examId = exam.id && /^[a-zA-Z0-9_-]+$/.test(exam.id) ? exam.id : makeId('exam');
  const examPath = `institutions/${institutionId}/exams/${examId}`;
  const rawType = exam.examType.trim() === 'Mid-Term' ? 'Mid Term' : exam.examType.trim();

  if (isNew && !isAllowedExaminationType(rawType)) {
    throw new Error(
      `Invalid examination type "${rawType}". Please select one of the 6 supported examination types.`
    );
  }

  const examDocPayload: Record<string, unknown> = {
    ...stripUndefinedDeep({
      id: examId,
      institutionId,
      ownerId,
      name: (exam.name.trim() || 'Untitled Examination').slice(0, 200),
      examType: rawType.slice(0, 80),
      academicYear: (exam.academicYear.trim() || `${new Date().getFullYear()}`).slice(0, 40),
      examDate: (exam.examDate.trim() || new Date().toISOString().slice(0, 10)).slice(0, 40),
      ...(exam.examTime?.trim() ? { examTime: exam.examTime.trim().slice(0, 40) } : {}),
      ...(exam.subject?.trim() ? { subject: exam.subject.trim().slice(0, 160) } : {}),
      ...(exam.classCourse?.trim() ? { classCourse: exam.classCourse.trim().slice(0, 120) } : {}),
      ...(exam.semester?.trim() ? { semester: exam.semester.trim().slice(0, 60) } : {}),
      ...(exam.notes?.trim() ? { notes: exam.notes.trim().slice(0, 1000) } : {}),
      status: exam.status,
      studentCount: Math.max(0, Math.min(100000, Math.floor(students.length))),
      classroomCount: Math.max(0, Math.min(1000, Math.floor(classrooms.length))),
      totalBenches: Math.max(0, Math.min(100000, Math.floor(exam.totalBenches || 0))),
      totalCapacity: Math.max(0, Math.min(200000, Math.floor(exam.totalCapacity || 0))),
      seatingMode: exam.seatingMode === 2 ? 2 : 1,
      strategy: exam.strategy,
      sortOrder: exam.sortOrder,
      ...(exam.rollRangeStart?.trim() ? { rollRangeStart: exam.rollRangeStart.trim().slice(0, 64) } : {}),
      ...(exam.rollRangeEnd?.trim() ? { rollRangeEnd: exam.rollRangeEnd.trim().slice(0, 64) } : {}),
      ...(exam.latestPlanId ? { latestPlanId: exam.latestPlanId.slice(0, 128) } : {}),
      ...(exam.latestAuditStatus ? { latestAuditStatus: exam.latestAuditStatus } : {})
    }),
    updatedAt: serverTimestamp()
  };

  let authReservation: { requestId: string; subscriptionId: string } | null = null;

  if (isNew) {
    const reqId = makeId('exauth');
    const authRes = await authorizeExamCreateOnCloudflare({
      institutionId,
      examId,
      examType: rawType,
      requestId: reqId
    });
    authReservation = {
      requestId: authRes.requestId,
      subscriptionId: authRes.subscriptionId
    };

    try {
      await setDoc(doc(db, 'institutions', institutionId, 'exams', examId), {
        ...examDocPayload,
        subscriptionId: authRes.subscriptionId,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      await abortExamCreateOnCloudflare({
        institutionId,
        requestId: authRes.requestId
      });
      if (err instanceof Error && !err.message.includes('Firestore Error:')) {
        const msg = err.message.toLowerCase();
        if (msg.includes('permission') || msg.includes('insufficient')) {
          handleFirestoreError(err, OperationType.CREATE, examPath);
        }
        throw err;
      }
      throw err;
    }
  } else {
    await verifyExamFeatureAccessOnCloudflare(institutionId);
    try {
      const updateFields: Record<string, unknown> = { ...examDocPayload };
      delete updateFields.id;
      delete updateFields.institutionId;
      delete updateFields.ownerId;
      delete updateFields.examType;
      delete updateFields.subscriptionId;
      if (!exam.rollRangeStart?.trim()) {
        updateFields.rollRangeStart = deleteField();
      }
      if (!exam.rollRangeEnd?.trim()) {
        updateFields.rollRangeEnd = deleteField();
      }
      await updateDoc(doc(db, 'institutions', institutionId, 'exams', examId), updateFields);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, examPath);
    }
  }

  // Confirm creation in Cloudflare D1 only after exam document save succeeded
  if (isNew && authReservation) {
    try {
      await confirmExamCreatedOnCloudflare({
        institutionId,
        requestId: authReservation.requestId,
        examId,
        examType: rawType
      });
    } catch (confirmErr) {
      // Best-effort cleanup of Firestore exam doc if D1 final lock confirmation fails
      await deleteDoc(doc(db, 'institutions', institutionId, 'exams', examId)).catch(() => {});
      await abortExamCreateOnCloudflare({
        institutionId,
        requestId: authReservation.requestId
      });
      throw confirmErr;
    }
  }

  // Replace students subcollection cleanly in batches of 400
  const studentsColPath = `institutions/${institutionId}/exams/${examId}/students`;
  if (!isNew) {
    try {
      const existingSnap = await getDocs(
        query(collection(db, 'institutions', institutionId, 'exams', examId, 'students'), where('ownerId', '==', ownerId))
      );
      for (let i = 0; i < existingSnap.docs.length; i += 400) {
        const batch = writeBatch(db);
        existingSnap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, studentsColPath);
    }
  }

  for (let i = 0; i < students.length; i += 400) {
    const batch = writeBatch(db);
    students.slice(i, i + 400).forEach((s, offset) => {
      const idx = i + offset;
      const stuId = (s.id && /^[a-zA-Z0-9_-]+$/.test(s.id) ? s.id : `stu_${idx + 1}`).slice(0, 128);
      const roll = String(s.rollNumber || '').trim().slice(0, 64);
      if (!roll) return;
      const payload = {
        ...stripUndefinedDeep({
          id: stuId,
          ownerId,
          rollNumber: roll,
          ...(s.name?.trim() ? { name: s.name.trim().slice(0, 160) } : {}),
          ...(s.className?.trim() ? { className: s.className.trim().slice(0, 80) } : {}),
          ...(s.course?.trim() ? { course: s.course.trim().slice(0, 120) } : {}),
          ...(s.section?.trim() ? { section: s.section.trim().slice(0, 40) } : {}),
          ...(s.subject?.trim() ? { subject: s.subject.trim().slice(0, 120) } : {}),
          originalIndex: Math.max(0, Math.min(100000, Math.floor(typeof s.originalIndex === 'number' ? s.originalIndex : idx)))
        }),
        createdAt: serverTimestamp()
      };
      batch.set(doc(db, 'institutions', institutionId, 'exams', examId, 'students', stuId), payload);
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, studentsColPath);
    }
  }

  // Replace classrooms subcollection cleanly
  const roomsColPath = `institutions/${institutionId}/exams/${examId}/classrooms`;
  if (!isNew) {
    try {
      const existingRooms = await getDocs(
        query(collection(db, 'institutions', institutionId, 'exams', examId, 'classrooms'), where('ownerId', '==', ownerId))
      );
      for (let i = 0; i < existingRooms.docs.length; i += 400) {
        const batch = writeBatch(db);
        existingRooms.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, roomsColPath);
    }
  }

  for (let i = 0; i < classrooms.length; i += 400) {
    const batch = writeBatch(db);
    classrooms.slice(i, i + 400).forEach((c, offset) => {
      const idx = i + offset;
      const roomId = (c.id && /^[a-zA-Z0-9_-]+$/.test(c.id) ? c.id : `room_${idx + 1}`).slice(0, 128);
      const payload = {
        ...stripUndefinedDeep({
          id: roomId,
          ownerId,
          name: (c.name.trim() || `Classroom ${idx + 1}`).slice(0, 120),
          roomNumber: (c.roomNumber.trim() || `${idx + 1}`).slice(0, 60),
          ...(c.building?.trim() ? { building: c.building.trim().slice(0, 100) } : {}),
          ...(c.floor?.trim() ? { floor: c.floor.trim().slice(0, 40) } : {}),
          rows: Math.max(1, Math.min(100, Math.floor(c.rows || 1))),
          benchesPerRow: Math.max(1, Math.min(100, Math.floor(c.benchesPerRow || 1))),
          ...(c.rowBenchCounts && c.rowBenchCounts.length > 0
            ? { rowBenchCounts: c.rowBenchCounts.slice(0, 100).map((n) => Math.max(1, Math.min(100, Math.floor(n || 1)))) }
            : {}),
          ...(c.disabledBenches && c.disabledBenches.length > 0
            ? { disabledBenches: c.disabledBenches.slice(0, 500).map((b) => String(b)) }
            : {}),
          disabled: Boolean(c.disabled),
          ...(c.notes?.trim() ? { notes: c.notes.trim().slice(0, 500) } : {}),
          orderIndex: Math.max(0, Math.min(1000, Math.floor(typeof c.orderIndex === 'number' ? c.orderIndex : idx)))
        }),
        createdAt: serverTimestamp()
      };
      batch.set(doc(db, 'institutions', institutionId, 'exams', examId, 'classrooms', roomId), payload);
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, roomsColPath);
    }
  }

  await appendAuditLog(
    institutionId,
    ownerId,
    isNew ? 'EXAM_CREATED' : 'EXAM_UPDATED',
    'exam',
    examId,
    `${isNew ? 'Created' : 'Updated'} examination "${exam.name}" (${students.length} students, ${classrooms.length} classrooms)`
  );

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

  await verifyExamFeatureAccessOnCloudflare(institutionId);

  const plansPath = `institutions/${institutionId}/exams/${examId}/seatingPlans`;
  let existingPlans: SeatingPlanRecord[] = [];
  try {
    const snap = await getDocs(
      query(collection(db, 'institutions', institutionId, 'exams', examId, 'seatingPlans'), where('ownerId', '==', ownerId))
    );
    existingPlans = snap.docs.map((d) => d.data() as SeatingPlanRecord);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, plansPath);
  }

  const nextVersion = existingPlans.reduce((max, p) => Math.max(max, Math.floor(p.version || 0)), 0) + 1;
  const planId = makeId(`plan_v${nextVersion}`).slice(0, 128);
  const planPath = `${plansPath}/${planId}`;

  const planPayload = {
    ...stripUndefinedDeep({
      id: planId,
      examId,
      institutionId,
      ownerId,
      version: Math.max(1, Math.min(10000, Math.floor(nextVersion))),
      seatingMode: seatingMode === 2 ? 2 : 1,
      strategy,
      sortOrder,
      totalStudents: Math.max(0, Math.floor(auditReport.totalStudents)),
      allocatedStudents: Math.max(0, Math.floor(auditReport.allocatedStudents)),
      unallocatedStudents: Math.max(0, Math.floor(auditReport.unallocatedStudents)),
      totalBenches: Math.max(0, Math.floor(auditReport.totalBenches)),
      totalCapacity: Math.max(0, Math.floor(auditReport.totalCapacity)),
      unusedSeats: Math.max(0, Math.floor(auditReport.unusedSeats)),
      auditStatus: auditReport.status,
      auditReport,
      ...(aiSummary?.trim() ? { aiSummary: aiSummary.trim().slice(0, 4000) } : {})
    }),
    createdAt: serverTimestamp()
  };

  try {
    await setDoc(doc(db, 'institutions', institutionId, 'exams', examId, 'seatingPlans', planId), planPayload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, planPath);
  }

  // Save per-classroom allocation documents in batches
  const roomsPath = `${planPath}/roomAllocations`;
  for (let i = 0; i < roomAllocations.length; i += 200) {
    const batch = writeBatch(db);
    roomAllocations.slice(i, i + 200).forEach((room, offset) => {
      const rId = (room.id && /^[a-zA-Z0-9_-]+$/.test(room.id) ? room.id : `ralloc_${i + offset + 1}`).slice(0, 128);
      const rPayload = {
        ...stripUndefinedDeep({
          ...room,
          id: rId,
          ownerId,
          orderIndex: Math.max(0, Math.floor(room.orderIndex)),
          totalBenches: Math.max(0, Math.floor(room.totalBenches)),
          activeBenches: Math.max(0, Math.floor(room.activeBenches)),
          capacity: Math.max(0, Math.floor(room.capacity)),
          allocatedCount: Math.max(0, Math.floor(room.allocatedCount)),
          unusedSeats: Math.max(0, Math.floor(room.unusedSeats))
        }),
        createdAt: serverTimestamp()
      };
      batch.set(
        doc(db, 'institutions', institutionId, 'exams', examId, 'seatingPlans', planId, 'roomAllocations', rId),
        rPayload
      );
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, roomsPath);
    }
  }

  // Update exam with latestPlanId and status
  const examPath = `institutions/${institutionId}/exams/${examId}`;
  try {
    await updateDoc(doc(db, 'institutions', institutionId, 'exams', examId), {
      latestPlanId: planId,
      latestAuditStatus: auditReport.status,
      status: auditReport.status === 'VERIFIED' ? 'verified' : 'generated',
      seatingMode: seatingMode === 2 ? 2 : 1,
      strategy,
      sortOrder,
      totalBenches: Math.max(0, Math.floor(auditReport.totalBenches)),
      totalCapacity: Math.max(0, Math.floor(auditReport.totalCapacity)),
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, examPath);
  }

  await appendAuditLog(
    institutionId,
    ownerId,
    'SEATING_PLAN_GENERATED',
    'seatingPlan',
    planId,
    `Generated v${nextVersion} seating plan for "${examName}" — Audit: ${auditReport.status} (${auditReport.allocatedStudents}/${auditReport.totalStudents} seated)`
  );

  return {
    id: planId,
    examId,
    institutionId,
    ownerId,
    version: nextVersion,
    seatingMode,
    strategy,
    sortOrder,
    totalStudents: auditReport.totalStudents,
    allocatedStudents: auditReport.allocatedStudents,
    unallocatedStudents: auditReport.unallocatedStudents,
    totalBenches: auditReport.totalBenches,
    totalCapacity: auditReport.totalCapacity,
    unusedSeats: auditReport.unusedSeats,
    auditStatus: auditReport.status,
    auditReport,
    aiSummary,
    createdAt: new Date().toISOString()
  };
}

export async function loadExamBundle(
  institutionId: string,
  examId: string,
  ownerId: string
): Promise<{
  exam: ExamRecord | null;
  students: StudentRecord[];
  classrooms: ClassroomConfig[];
  plans: SeatingPlanRecord[];
}> {
  const examPath = `institutions/${institutionId}/exams/${examId}`;
  let examSnap;
  try {
    examSnap = await getDoc(doc(db, 'institutions', institutionId, 'exams', examId));
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, examPath);
  }
  if (!examSnap.exists()) {
    return { exam: null, students: [], classrooms: [], plans: [] };
  }

  const [stuSnap, roomSnap, planSnap] = await Promise.all([
    getDocs(
      query(collection(db, 'institutions', institutionId, 'exams', examId, 'students'), where('ownerId', '==', ownerId))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, `${examPath}/students`)),
    getDocs(
      query(collection(db, 'institutions', institutionId, 'exams', examId, 'classrooms'), where('ownerId', '==', ownerId))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, `${examPath}/classrooms`)),
    getDocs(
      query(collection(db, 'institutions', institutionId, 'exams', examId, 'seatingPlans'), where('ownerId', '==', ownerId))
    ).catch((err) => handleFirestoreError(err, OperationType.LIST, `${examPath}/seatingPlans`))
  ]);

  const students = stuSnap.docs
    .map((d) => d.data() as StudentRecord)
    .sort((a, b) => a.originalIndex - b.originalIndex);

  const classrooms = roomSnap.docs
    .map((d) => d.data() as ClassroomConfig)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  const plans = planSnap.docs
    .map((d) => d.data() as SeatingPlanRecord)
    .sort((a, b) => (b.version || 0) - (a.version || 0));

  return {
    exam: examSnap.data() as ExamRecord,
    students,
    classrooms,
    plans
  };
}

export async function loadPlanRoomAllocations(
  institutionId: string,
  examId: string,
  planId: string,
  ownerId: string
): Promise<ClassroomAllocation[]> {
  const path = `institutions/${institutionId}/exams/${examId}/seatingPlans/${planId}/roomAllocations`;
  try {
    const snap = await getDocs(
      query(
        collection(db, 'institutions', institutionId, 'exams', examId, 'seatingPlans', planId, 'roomAllocations'),
        where('ownerId', '==', ownerId)
      )
    );
    return snap.docs
      .map((d) => d.data() as ClassroomAllocation)
      .sort((a, b) => a.orderIndex - b.orderIndex);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function updateExamStatus(
  institutionId: string,
  examId: string,
  ownerId: string,
  status: ExamRecord['status']
): Promise<void> {
  const path = `institutions/${institutionId}/exams/${examId}`;
  try {
    await updateDoc(doc(db, 'institutions', institutionId, 'exams', examId), {
      status,
      updatedAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
  await appendAuditLog(institutionId, ownerId, `EXAM_${status.toUpperCase()}`, 'exam', examId, `Changed exam status to ${status}`);
}

export async function duplicateExamRecord(
  institutionId: string,
  examId: string,
  ownerId: string
): Promise<string> {
  const bundle = await loadExamBundle(institutionId, examId, ownerId);
  if (!bundle.exam) {
    throw new Error('Examination not found.');
  }

  const normalizedType =
    bundle.exam.examType === 'Mid-Term' ? 'Mid Term' : bundle.exam.examType;

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
  ownerId: string,
  examName: string
): Promise<void> {
  const examPath = `institutions/${institutionId}/exams/${examId}`;

  // Clean up subcollections first
  const [stuSnap, roomSnap, planSnap] = await Promise.all([
    getDocs(query(collection(db, 'institutions', institutionId, 'exams', examId, 'students'), where('ownerId', '==', ownerId))),
    getDocs(query(collection(db, 'institutions', institutionId, 'exams', examId, 'classrooms'), where('ownerId', '==', ownerId))),
    getDocs(query(collection(db, 'institutions', institutionId, 'exams', examId, 'seatingPlans'), where('ownerId', '==', ownerId)))
  ]);

  for (const pDoc of planSnap.docs) {
    const rAllocSnap = await getDocs(
      query(
        collection(db, 'institutions', institutionId, 'exams', examId, 'seatingPlans', pDoc.id, 'roomAllocations'),
        where('ownerId', '==', ownerId)
      )
    );
    const batch = writeBatch(db);
    rAllocSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(pDoc.ref);
    await batch.commit();
  }

  const allRefs = [...stuSnap.docs.map((d) => d.ref), ...roomSnap.docs.map((d) => d.ref)];
  for (let i = 0; i < allRefs.length; i += 400) {
    const batch = writeBatch(db);
    allRefs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }

  try {
    await deleteDoc(doc(db, 'institutions', institutionId, 'exams', examId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, examPath);
  }

  await appendAuditLog(institutionId, ownerId, 'EXAM_DELETED', 'exam', examId, `Deleted examination "${examName}"`);
}

export async function appendAuditLog(
  institutionId: string,
  ownerId: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: string
): Promise<void> {
  const logId = makeId('log');
  const path = `institutions/${institutionId}/auditLogs/${logId}`;
  try {
    await setDoc(doc(db, 'institutions', institutionId, 'auditLogs', logId), {
      id: logId,
      ownerId,
      action: action.slice(0, 100),
      entityType: entityType.slice(0, 60),
      entityId: entityId.slice(0, 128),
      summary: summary.slice(0, 500),
      createdAt: serverTimestamp()
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function listAuditLogs(institutionId: string, ownerId: string): Promise<AuditLogRecord[]> {
  const path = `institutions/${institutionId}/auditLogs`;
  try {
    const snap = await getDocs(
      query(collection(db, 'institutions', institutionId, 'auditLogs'), where('ownerId', '==', ownerId))
    );
    return snap.docs.map((d) => d.data() as AuditLogRecord).reverse();
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function uploadFileToFirebaseStorage(
  institutionId: string,
  folder: 'logos' | 'imports' | 'pdfs',
  fileName: string,
  blob: Blob
): Promise<string | null> {
  try {
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageRef = ref(storage, `institutions/${institutionId}/${folder}/${Date.now()}_${safeName}`);
    await uploadBytes(storageRef, blob);
    return await getDownloadURL(storageRef);
  } catch (err) {
    // Gracefully fall back if Storage bucket rules aren't configured in starter project
    console.warn('Firebase Storage upload skipped/unavailable:', err);
    return null;
  }
}
