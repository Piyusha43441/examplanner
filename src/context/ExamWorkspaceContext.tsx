import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { runSeatingAudit } from '../core/auditEngine';
import { calculateTotalCapacity, generateSimpleClassrooms } from '../core/classroomEngine';
import { generateRollNumberRange } from '../core/rollNumberEngine';
import { allocateSeating } from '../core/seatingEngine';
import {
  AllocationResult,
  AllocationStrategy,
  AuditLogRecord,
  AuditReport,
  ClassroomAllocation,
  ClassroomConfig,
  CustomAllocationRule,
  ExamRecord,
  SeatingMode,
  SeatingPlanRecord,
  SortOrder,
  StudentRecord
} from '../core/types';
import {
  deleteExamRecord,
  duplicateExamRecord,
  listAuditLogs,
  listExams,
  loadExamBundle,
  loadPlanRoomAllocations,
  saveExamWithStudentsAndClassrooms,
  saveSeatingPlanVersion,
  updateExamStatus
} from '../firebase/service';
import { useAuth } from './AuthContext';

export interface QuickGenerateInput {
  examName: string;
  examDate: string;
  academicYear: string;
  examType: string;
  rollStart: string;
  rollEnd: string;
  classroomCount: number;
  rowsPerClassroom: number;
  benchesPerRow: number;
  seatingMode: SeatingMode;
  strategy?: AllocationStrategy;
  sortOrder?: SortOrder;
}

interface WorkspaceContextValue {
  exams: ExamRecord[];
  activeExam: ExamRecord | null;
  students: StudentRecord[];
  classrooms: ClassroomConfig[];
  plans: SeatingPlanRecord[];
  activePlan: SeatingPlanRecord | null;
  roomAllocations: ClassroomAllocation[];
  currentAllocation: AllocationResult | null;
  currentAuditReport: AuditReport | null;
  auditLogs: AuditLogRecord[];
  loadingWorkspace: boolean;
  savingWorkspace: boolean;
  aiAssistantEnabled: boolean;
  setAiAssistantEnabled: (val: boolean) => void;
  refreshExams: () => Promise<void>;
  selectExam: (examId: string) => Promise<void>;
  selectPlanVersion: (plan: SeatingPlanRecord) => Promise<void>;
  setLocalStudents: (students: StudentRecord[]) => void;
  setLocalClassrooms: (classrooms: ClassroomConfig[]) => void;
  saveCurrentExamData: (params: {
    examMeta: Partial<ExamRecord> & { name: string; examType: string; academicYear: string; examDate: string };
    students: StudentRecord[];
    classrooms: ClassroomConfig[];
    isNew?: boolean;
  }) => Promise<string>;
  runAndSaveSeatingPlan: (params: {
    examId?: string;
    examMeta?: Partial<ExamRecord> & { name: string; examType: string; academicYear: string; examDate: string };
    students: StudentRecord[];
    classrooms: ClassroomConfig[];
    seatingMode: SeatingMode;
    strategy: AllocationStrategy;
    sortOrder: SortOrder;
    customRule?: CustomAllocationRule;
    aiSummary?: string;
  }) => Promise<{
    examId: string;
    allocation: AllocationResult;
    auditReport: AuditReport;
    savedPlan: SeatingPlanRecord;
  }>;
  quickGenerateExamAndPlan: (input: QuickGenerateInput) => Promise<{
    examId: string;
    allocation: AllocationResult;
    auditReport: AuditReport;
  }>;
  duplicateExam: (examId: string) => Promise<string>;
  setExamStatus: (examId: string, status: ExamRecord['status']) => Promise<void>;
  deleteExam: (examId: string, examName: string) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function ExamWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, institution } = useAuth();
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [activeExam, setActiveExam] = useState<ExamRecord | null>(null);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [classrooms, setClassrooms] = useState<ClassroomConfig[]>([]);
  const [plans, setPlans] = useState<SeatingPlanRecord[]>([]);
  const [activePlan, setActivePlan] = useState<SeatingPlanRecord | null>(null);
  const [roomAllocations, setRoomAllocations] = useState<ClassroomAllocation[]>([]);
  const [currentAllocation, setCurrentAllocation] = useState<AllocationResult | null>(null);
  const [currentAuditReport, setCurrentAuditReport] = useState<AuditReport | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [aiAssistantEnabled, setAiAssistantEnabled] = useState(true);

  const selectPlanVersion = useCallback(
    async (plan: SeatingPlanRecord, examOverride?: ExamRecord) => {
      if (!firebaseUser || !institution) return;
      const targetExam = examOverride ?? activeExam;
      if (!targetExam) return;
      const rooms = await loadPlanRoomAllocations(
        institution.id,
        targetExam.id,
        plan.id,
        firebaseUser.uid
      );
      setActivePlan(plan);
      setRoomAllocations(rooms);
      setCurrentAuditReport(plan.auditReport);

      const lookupIndex = rooms.flatMap((room) =>
        room.rows.flatMap((row) =>
          row.benches.flatMap((bench) =>
            bench.seats
              .filter((s) => s.status === 'OCCUPIED' && s.rollNumber)
              .map((s) => ({
                studentId: s.studentId || s.rollNumber || '',
                rollNumber: s.rollNumber || '',
                studentName: s.studentName || 'Name Not Provided',
                classroomId: room.classroomId,
                classroomName: room.classroomName,
                roomNumber: room.roomNumber,
                rowNumber: row.rowNumber,
                rowLabel: row.rowLabel,
                benchNumber: bench.benchNumber,
                benchLabel: bench.benchLabel,
                seatNumber: s.seatNumber,
                className: s.className,
                course: s.course,
                section: s.section,
                subject: s.subject
              }))
          )
        )
      );

      setCurrentAllocation({
        roomAllocations: rooms,
        lookupIndex,
        unallocatedStudents: [],
        totalStudents: plan.totalStudents,
        allocatedStudents: plan.allocatedStudents,
        totalBenches: plan.totalBenches,
        activeBenches: plan.auditReport.activeBenches,
        totalCapacity: plan.totalCapacity,
        unusedSeats: plan.unusedSeats,
        capacitySufficient: plan.auditReport.capacitySufficient
      });
    },
    [firebaseUser, institution, activeExam]
  );

  const selectExam = useCallback(
    async (examId: string) => {
      if (!firebaseUser || !institution) return;
      setLoadingWorkspace(true);
      try {
        const bundle = await loadExamBundle(institution.id, examId, firebaseUser.uid);
        setActiveExam(bundle.exam);
        setStudents(bundle.students);
        setClassrooms(bundle.classrooms);
        setPlans(bundle.plans);

        if (bundle.exam && bundle.plans.length > 0) {
          const latest = bundle.plans[0];
          await selectPlanVersion(latest, bundle.exam);
        } else {
          setActivePlan(null);
          setRoomAllocations([]);
          setCurrentAllocation(null);
          setCurrentAuditReport(null);
        }
      } finally {
        setLoadingWorkspace(false);
      }
    },
    [firebaseUser, institution, selectPlanVersion]
  );

  const refreshExams = useCallback(async () => {
    if (!firebaseUser || !institution) {
      setExams([]);
      setAuditLogs([]);
      return;
    }
    setLoadingWorkspace(true);
    try {
      const [examList, logs] = await Promise.all([
        listExams(institution.id, firebaseUser.uid),
        listAuditLogs(institution.id, firebaseUser.uid)
      ]);
      setExams(examList);
      setAuditLogs(logs);
      if (examList.length > 0 && !activeExam) {
        await selectExam(examList[0].id);
      }
    } finally {
      setLoadingWorkspace(false);
    }
  }, [firebaseUser, institution, activeExam, selectExam]);

  useEffect(() => {
    if (firebaseUser && institution) {
      refreshExams();
    } else {
      setExams([]);
      setActiveExam(null);
      setStudents([]);
      setClassrooms([]);
      setPlans([]);
      setActivePlan(null);
      setRoomAllocations([]);
      setCurrentAllocation(null);
      setCurrentAuditReport(null);
      setAuditLogs([]);
    }
  }, [firebaseUser, institution]);

  const saveCurrentExamData = useCallback(
    async (params: {
      examMeta: Partial<ExamRecord> & {
        name: string;
        examType: string;
        academicYear: string;
        examDate: string;
      };
      students: StudentRecord[];
      classrooms: ClassroomConfig[];
      isNew?: boolean;
    }) => {
      if (!firebaseUser || !institution) {
        throw new Error('Authentication and institution profile required.');
      }
      setSavingWorkspace(true);
      try {
        const mode: SeatingMode = params.examMeta.seatingMode === 2 ? 2 : 1;
        const cap = calculateTotalCapacity(params.classrooms, mode);
        const isNew = params.isNew ?? !params.examMeta.id;

        const savedId = await saveExamWithStudentsAndClassrooms({
          institutionId: institution.id,
          ownerId: firebaseUser.uid,
          exam: {
            id: params.examMeta.id,
            name: params.examMeta.name,
            examType: params.examMeta.examType,
            academicYear: params.examMeta.academicYear,
            examDate: params.examMeta.examDate,
            examTime: params.examMeta.examTime,
            subject: params.examMeta.subject,
            classCourse: params.examMeta.classCourse,
            semester: params.examMeta.semester,
            notes: params.examMeta.notes,
            status: params.examMeta.status ?? 'draft',
            studentCount: params.students.length,
            classroomCount: params.classrooms.length,
            totalBenches: cap.totalBenches,
            totalCapacity: cap.totalCapacity,
            seatingMode: mode,
            strategy: params.examMeta.strategy ?? 'sequential',
            sortOrder: params.examMeta.sortOrder ?? 'original',
            rollRangeStart: params.examMeta.rollRangeStart,
            rollRangeEnd: params.examMeta.rollRangeEnd,
            latestPlanId: params.examMeta.latestPlanId,
            latestAuditStatus: params.examMeta.latestAuditStatus
          },
          students: params.students,
          classrooms: params.classrooms,
          isNew
        });

        const [examList, logs] = await Promise.all([
          listExams(institution.id, firebaseUser.uid),
          listAuditLogs(institution.id, firebaseUser.uid)
        ]);
        setExams(examList);
        setAuditLogs(logs);
        await selectExam(savedId);
        return savedId;
      } finally {
        setSavingWorkspace(false);
      }
    },
    [firebaseUser, institution, selectExam]
  );

  const runAndSaveSeatingPlan = useCallback(
    async (params: {
      examId?: string;
      examMeta?: Partial<ExamRecord> & {
        name: string;
        examType: string;
        academicYear: string;
        examDate: string;
      };
      students: StudentRecord[];
      classrooms: ClassroomConfig[];
      seatingMode: SeatingMode;
      strategy: AllocationStrategy;
      sortOrder: SortOrder;
      customRule?: CustomAllocationRule;
      aiSummary?: string;
    }) => {
      if (!firebaseUser || !institution) {
        throw new Error('Authentication and institution profile required.');
      }

      setSavingWorkspace(true);
      try {
        const isCreatingNew = !params.examId;
        let targetExamId = params.examId;
        const targetExamName =
          params.examMeta?.name ??
          (!isCreatingNew ? activeExam?.name : undefined) ??
          'Untitled Examination';

        const cap = calculateTotalCapacity(params.classrooms, params.seatingMode);

        if (isCreatingNew) {
          if (!params.examMeta) {
            throw new Error('Examination details are required.');
          }
          targetExamId = await saveExamWithStudentsAndClassrooms({
            institutionId: institution.id,
            ownerId: firebaseUser.uid,
            exam: {
              ...params.examMeta,
              id: undefined,
              rollRangeStart: params.examMeta.rollRangeStart?.trim() || undefined,
              rollRangeEnd: params.examMeta.rollRangeEnd?.trim() || undefined,
              status: 'generated',
              studentCount: params.students.length,
              classroomCount: params.classrooms.length,
              totalBenches: cap.totalBenches,
              totalCapacity: cap.totalCapacity,
              seatingMode: params.seatingMode,
              strategy: params.strategy,
              sortOrder: params.sortOrder
            },
            students: params.students,
            classrooms: params.classrooms,
            isNew: true
          });
        } else if (params.examMeta && targetExamId) {
          await saveExamWithStudentsAndClassrooms({
            institutionId: institution.id,
            ownerId: firebaseUser.uid,
            exam: {
              ...params.examMeta,
              id: targetExamId,
              rollRangeStart: params.examMeta.rollRangeStart?.trim() || undefined,
              rollRangeEnd: params.examMeta.rollRangeEnd?.trim() || undefined,
              status: 'generated',
              studentCount: params.students.length,
              classroomCount: params.classrooms.length,
              totalBenches: cap.totalBenches,
              totalCapacity: cap.totalCapacity,
              seatingMode: params.seatingMode,
              strategy: params.strategy,
              sortOrder: params.sortOrder
            },
            students: params.students,
            classrooms: params.classrooms,
            isNew: false
          });
        }

        if (!targetExamId) {
          throw new Error('Examination ID could not be resolved.');
        }

        // 1. Deterministic seating allocation
        const allocation = allocateSeating({
          students: params.students,
          classrooms: params.classrooms,
          seatingMode: params.seatingMode,
          strategy: params.strategy,
          sortOrder: params.sortOrder,
          customRule: params.customRule
        });

        // 2. Deterministic 15-point seating audit
        // Never fall back to activeExam's roll range when creating a new exam
        const existingExam = !isCreatingNew
          ? targetExamId === activeExam?.id
            ? activeExam
            : exams.find((e) => e.id === targetExamId)
          : undefined;
        const rollStart = params.examMeta
          ? params.examMeta.rollRangeStart?.trim() || undefined
          : existingExam?.rollRangeStart?.trim() || undefined;
        const rollEnd = params.examMeta
          ? params.examMeta.rollRangeEnd?.trim() || undefined
          : existingExam?.rollRangeEnd?.trim() || undefined;

        const auditReport = runSeatingAudit({
          students: params.students,
          classrooms: params.classrooms,
          allocation,
          seatingMode: params.seatingMode,
          expectedRange: rollStart && rollEnd ? { start: rollStart, end: rollEnd } : undefined,
          isSequentialMode: params.strategy === 'sequential'
        });

        // 3. Persist versioned seating plan + room allocations in Firestore
        const savedPlan = await saveSeatingPlanVersion({
          institutionId: institution.id,
          ownerId: firebaseUser.uid,
          examId: targetExamId,
          examName: targetExamName,
          seatingMode: params.seatingMode,
          strategy: params.strategy,
          sortOrder: params.sortOrder,
          auditReport,
          roomAllocations: allocation.roomAllocations,
          aiSummary: params.aiSummary
        });

        setCurrentAllocation(allocation);
        setCurrentAuditReport(auditReport);
        setRoomAllocations(allocation.roomAllocations);
        setActivePlan(savedPlan);

        const [examList, logs, bundle] = await Promise.all([
          listExams(institution.id, firebaseUser.uid),
          listAuditLogs(institution.id, firebaseUser.uid),
          loadExamBundle(institution.id, targetExamId, firebaseUser.uid)
        ]);
        setExams(examList);
        setAuditLogs(logs);
        setActiveExam(bundle.exam);
        setStudents(bundle.students);
        setClassrooms(bundle.classrooms);
        setPlans(bundle.plans);

        return { examId: targetExamId, allocation, auditReport, savedPlan };
      } finally {
        setSavingWorkspace(false);
      }
    },
    [firebaseUser, institution, activeExam, exams]
  );

  const quickGenerateExamAndPlan = useCallback(
    async (input: QuickGenerateInput) => {
      const rangeResult = generateRollNumberRange(input.rollStart, input.rollEnd);
      if (rangeResult.error) {
        throw new Error(rangeResult.error);
      }
      const generatedStudents = rangeResult.students;
      const generatedClassrooms = generateSimpleClassrooms(
        input.classroomCount,
        input.rowsPerClassroom,
        input.benchesPerRow
      );

      const res = await runAndSaveSeatingPlan({
        examMeta: {
          name: input.examName,
          examType: input.examType || 'Semester Final',
          academicYear: input.academicYear || `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(-2)}`,
          examDate: input.examDate || new Date().toISOString().slice(0, 10),
          rollRangeStart: input.rollStart.trim(),
          rollRangeEnd: input.rollEnd.trim()
        },
        students: generatedStudents,
        classrooms: generatedClassrooms,
        seatingMode: input.seatingMode,
        strategy: input.strategy ?? 'sequential',
        sortOrder: input.sortOrder ?? 'original'
      });

      return {
        examId: res.examId,
        allocation: res.allocation,
        auditReport: res.auditReport
      };
    },
    [runAndSaveSeatingPlan]
  );

  const duplicateExam = useCallback(
    async (examId: string) => {
      if (!firebaseUser || !institution) throw new Error('Not authenticated');
      const newId = await duplicateExamRecord(institution.id, examId, firebaseUser.uid);
      await refreshExams();
      await selectExam(newId);
      return newId;
    },
    [firebaseUser, institution, refreshExams, selectExam]
  );

  const setExamStatus = useCallback(
    async (examId: string, status: ExamRecord['status']) => {
      if (!firebaseUser || !institution) throw new Error('Not authenticated');
      await updateExamStatus(institution.id, examId, firebaseUser.uid, status);
      await refreshExams();
      if (activeExam?.id === examId) {
        await selectExam(examId);
      }
    },
    [firebaseUser, institution, activeExam, refreshExams, selectExam]
  );

  const deleteExam = useCallback(
    async (examId: string, examName: string) => {
      if (!firebaseUser || !institution) throw new Error('Not authenticated');
      await deleteExamRecord(institution.id, examId, firebaseUser.uid, examName);
      if (activeExam?.id === examId) {
        setActiveExam(null);
        setStudents([]);
        setClassrooms([]);
        setPlans([]);
        setActivePlan(null);
        setRoomAllocations([]);
        setCurrentAllocation(null);
        setCurrentAuditReport(null);
      }
      await refreshExams();
    },
    [firebaseUser, institution, activeExam, refreshExams]
  );

  return (
    <WorkspaceContext.Provider
      value={{
        exams,
        activeExam,
        students,
        classrooms,
        plans,
        activePlan,
        roomAllocations,
        currentAllocation,
        currentAuditReport,
        auditLogs,
        loadingWorkspace,
        savingWorkspace,
        aiAssistantEnabled,
        setAiAssistantEnabled,
        refreshExams,
        selectExam,
        selectPlanVersion: (p) => selectPlanVersion(p),
        setLocalStudents: setStudents,
        setLocalClassrooms: setClassrooms,
        saveCurrentExamData,
        runAndSaveSeatingPlan,
        quickGenerateExamAndPlan,
        duplicateExam,
        setExamStatus,
        deleteExam
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used inside ExamWorkspaceProvider');
  }
  return ctx;
}
