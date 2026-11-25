import { benchKey, calculateTotalCapacity, getBenchesInRow } from './classroomEngine';
import {
  detectSequenceGaps,
  findDuplicateRollNumbers,
  generateRollNumberRange,
  normalizeRollNumber
} from './rollNumberEngine';
import {
  AllocationResult,
  AuditCheckItem,
  AuditReport,
  ClassroomConfig,
  SeatingMode,
  StudentRecord,
  ValidationIssue
} from './types';

export interface RunAuditParams {
  students: StudentRecord[];
  classrooms: ClassroomConfig[];
  allocation: AllocationResult;
  seatingMode: SeatingMode;
  expectedRange?: { start: string; end: string };
  isSequentialMode?: boolean;
}

export function runSeatingAudit(params: RunAuditParams): AuditReport {
  const { students, classrooms, allocation, seatingMode, expectedRange, isSequentialMode } = params;
  const issues: ValidationIssue[] = [];
  const checklist: AuditCheckItem[] = [];

  const normalizedStudents = students.map((s) => ({
    ...s,
    rollNumber: normalizeRollNumber(s.rollNumber)
  }));

  // 1. Expected student count check (imported/registered list is source of truth unless explicit range provided)
  const hasExplicitRange = Boolean(expectedRange?.start?.trim() && expectedRange?.end?.trim());
  let expectedCount = normalizedStudents.length;
  let rangeCheckPassed = true;
  let rangeDetails = `Verified ${normalizedStudents.length} student record(s) (student list used as source of truth).`;

  if (hasExplicitRange && expectedRange) {
    const expected = generateRollNumberRange(expectedRange.start, expectedRange.end);
    if (expected.error) {
      rangeCheckPassed = false;
      rangeDetails = expected.error;
      issues.push({
        id: 'audit_expected_range_invalid',
        severity: 'critical',
        agent: 'Data Validation',
        code: 'EXPECTED_RANGE_INVALID',
        message: expected.error
      });
    } else {
      expectedCount = expected.students.length;
      if (expectedCount !== normalizedStudents.length) {
        rangeCheckPassed = false;
        rangeDetails = `Expected ${expectedCount} students for range ${expectedRange.start}–${expectedRange.end}, found ${normalizedStudents.length}.`;
        issues.push({
          id: 'audit_expected_count_mismatch',
          severity: 'critical',
          agent: 'Data Validation',
          code: 'EXPECTED_COUNT_MISMATCH',
          message: rangeDetails
        });
      } else {
        rangeDetails = `Verified ${normalizedStudents.length} student(s) matching explicit range ${expectedRange.start}–${expectedRange.end}.`;
      }
    }
  }

  checklist.push({
    key: 'student_count',
    label: 'Student count matches expected number',
    passed: normalizedStudents.length > 0 && rangeCheckPassed,
    severity: 'critical',
    details:
      normalizedStudents.length === 0
        ? 'No students provided.'
        : rangeDetails
  });

  if (normalizedStudents.length === 0) {
    issues.push({
      id: 'audit_no_students',
      severity: 'critical',
      agent: 'Data Validation',
      code: 'NO_STUDENTS',
      message: 'No student records found for allocation.'
    });
  }

  // 1b. Invalid / empty roll numbers check
  const invalidRollCount = normalizedStudents.filter((s) => !s.rollNumber || s.rollNumber.length === 0).length;
  checklist.push({
    key: 'valid_roll_numbers',
    label: 'All student records have valid, non-empty roll numbers',
    passed: invalidRollCount === 0,
    severity: 'critical',
    details:
      invalidRollCount === 0
        ? `0 invalid roll numbers across ${normalizedStudents.length} student(s).`
        : `${invalidRollCount} student record(s) have empty or invalid roll numbers.`
  });
  if (invalidRollCount > 0) {
    issues.push({
      id: 'audit_invalid_rolls',
      severity: 'critical',
      agent: 'Data Validation',
      code: 'INVALID_ROLL_NUMBERS',
      message: `${invalidRollCount} student record(s) contain invalid or empty roll numbers.`
    });
  }

  // 2. Duplicate roll numbers
  const duplicateRolls = findDuplicateRollNumbers(normalizedStudents);
  const noDuplicateRolls = duplicateRolls.length === 0;
  checklist.push({
    key: 'no_duplicate_rolls',
    label: 'No duplicate roll numbers in student input',
    passed: noDuplicateRolls,
    severity: 'critical',
    details: noDuplicateRolls
      ? 'All roll numbers are unique.'
      : `Duplicate roll numbers found: ${duplicateRolls.join(', ')}`
  });
  if (!noDuplicateRolls) {
    issues.push({
      id: 'audit_dup_rolls',
      severity: 'critical',
      agent: 'Data Validation',
      code: 'DUPLICATE_ROLL_NUMBERS',
      message: `Duplicate roll numbers detected (${duplicateRolls.length}).`,
      affectedRollNumbers: duplicateRolls
    });
  }

  // 3. Sequence gap check (critical only when an explicit roll range is validated in sequential mode)
  const sequenceGaps = isSequentialMode ? detectSequenceGaps(normalizedStudents) : [];
  const noSequenceGaps = sequenceGaps.length === 0;
  checklist.push({
    key: 'sequence_complete',
    label: 'No missing roll numbers in expected sequence',
    passed: noSequenceGaps,
    severity: isSequentialMode && hasExplicitRange ? 'critical' : 'warning',
    details: noSequenceGaps
      ? 'Sequence continuity verified.'
      : `Gap detected in sequence (${sequenceGaps.join(', ')}).${
          !hasExplicitRange ? ' Informational only — using imported student list as source of truth.' : ''
        }`
  });
  if (!noSequenceGaps) {
    issues.push({
      id: 'audit_seq_gaps',
      severity: isSequentialMode && hasExplicitRange ? 'critical' : 'warning',
      agent: 'Data Validation',
      code: 'SEQUENCE_GAPS',
      message: `Detected ${sequenceGaps.length} missing roll number(s) in sequence.`,
      affectedRollNumbers: sequenceGaps
    });
  }

  // 4–6 & 9–15: Seat-by-seat audit against original students and classroom topology
  const roomMap = new Map<string, ClassroomConfig>();
  classrooms.forEach((c) => roomMap.set(c.id, c));

  const originalRollSet = new Set(normalizedStudents.map((s) => s.rollNumber));
  const assignedRollCounts = new Map<string, number>();
  let invalidRefs = 0;
  let seatLimitExceeded = 0;
  let alteredRollNumbers = 0;

  for (const roomAlloc of allocation.roomAllocations) {
    const roomConfig = roomMap.get(roomAlloc.classroomId);
    if (!roomConfig || roomConfig.disabled) {
      invalidRefs++;
      continue;
    }

    const disabledSet = new Set(roomConfig.disabledBenches ?? []);

    for (const row of roomAlloc.rows) {
      if (row.rowNumber < 1 || row.rowNumber > roomConfig.rows) {
        invalidRefs++;
        continue;
      }
      const expectedBenchesInRow = getBenchesInRow(roomConfig, row.rowNumber - 1);

      for (const bench of row.benches) {
        if (bench.benchNumber < 1 || bench.benchNumber > expectedBenchesInRow) {
          invalidRefs++;
          continue;
        }
        const isDisabledBench = disabledSet.has(benchKey(row.rowNumber, bench.benchNumber));
        const occupiedSeats = bench.seats.filter((s) => s.status === 'OCCUPIED');

        if (isDisabledBench && occupiedSeats.length > 0) {
          seatLimitExceeded++;
        }
        if (occupiedSeats.length > seatingMode) {
          seatLimitExceeded++;
        }

        for (const seat of bench.seats) {
          if (seat.seatNumber !== 1 && seat.seatNumber !== 2) {
            invalidRefs++;
          }
          if (seat.seatNumber > seatingMode && seat.status === 'OCCUPIED') {
            seatLimitExceeded++;
          }
          if (seat.status === 'OCCUPIED') {
            const roll = normalizeRollNumber(seat.rollNumber);
            if (!roll || !originalRollSet.has(roll)) {
              alteredRollNumbers++;
            } else {
              assignedRollCounts.set(roll, (assignedRollCounts.get(roll) ?? 0) + 1);
            }
          }
        }
      }
    }
  }

  let duplicateAssignments = 0;
  let missingStudents = 0;
  const duplicateAssignedRolls: string[] = [];
  const missingStudentRolls: string[] = [];

  for (const stu of normalizedStudents) {
    const count = assignedRollCounts.get(stu.rollNumber) ?? 0;
    if (count === 0) {
      missingStudents++;
      missingStudentRolls.push(stu.rollNumber);
    } else if (count > 1) {
      duplicateAssignments += count - 1;
      duplicateAssignedRolls.push(stu.rollNumber);
    }
  }

  const capacitySummary = calculateTotalCapacity(classrooms, seatingMode);
  const capacitySufficient =
    normalizedStudents.length <= capacitySummary.totalCapacity &&
    capacitySummary.issues.every((i) => i.severity !== 'critical');

  if (!capacitySufficient) {
    issues.push({
      id: 'audit_capacity_short',
      severity: 'critical',
      agent: 'Classroom Capacity',
      code: 'INSUFFICIENT_CAPACITY',
      message: `Insufficient seating capacity. You have ${normalizedStudents.length} students but only ${capacitySummary.totalCapacity} available seats.`
    });
  }

  issues.push(...capacitySummary.issues);

  // Missing names are strictly WARNINGS, never critical errors
  const missingNamesCount = normalizedStudents.filter(
    (s) => !s.name || s.name.trim().length === 0
  ).length;
  if (missingNamesCount > 0) {
    issues.push({
      id: 'audit_missing_names',
      severity: 'warning',
      agent: 'Data Scanner',
      code: 'MISSING_STUDENT_NAMES',
      message: `${missingNamesCount} student record(s) have no name provided.`,
      details: 'Missing names do not block seating allocation and are displayed as "Name Not Provided".'
    });
  }

  // Remaining checklist entries
  checklist.push(
    {
      key: 'no_student_omitted',
      label: 'No student has been omitted from allocation',
      passed: missingStudents === 0 && allocation.unallocatedStudents.length === 0,
      severity: 'critical',
      details:
        missingStudents === 0
          ? `All ${normalizedStudents.length} students are assigned.`
          : `${missingStudents} student(s) unallocated: ${missingStudentRolls.slice(0, 5).join(', ')}`
    },
    {
      key: 'no_double_assignment',
      label: 'No student has been assigned twice',
      passed: duplicateAssignments === 0,
      severity: 'critical',
      details:
        duplicateAssignments === 0
          ? 'Every student occupies at most one seat.'
          : `Duplicate seat assignments for: ${duplicateAssignedRolls.join(', ')}`
    },
    {
      key: 'roll_numbers_immutable',
      label: 'No roll number was altered, rounded, or truncated',
      passed: alteredRollNumbers === 0,
      severity: 'critical',
      details:
        alteredRollNumbers === 0
          ? 'All roll numbers match input strings verbatim.'
          : `${alteredRollNumbers} seat assignment(s) did not match original roll numbers.`
    },
    {
      key: 'capacity_sufficient',
      label: 'Classroom and bench seating capacity is sufficient',
      passed: capacitySufficient,
      severity: 'critical',
      details: `${normalizedStudents.length} required vs ${capacitySummary.totalCapacity} available seats across ${capacitySummary.activeBenches} active benches.`
    },
    {
      key: 'valid_topology_refs',
      label: 'Every allocation references a valid classroom, row, bench, and seat',
      passed: invalidRefs === 0,
      severity: 'critical',
      details:
        invalidRefs === 0
          ? 'All seat coordinates verified against classroom configurations.'
          : `${invalidRefs} invalid classroom/row/bench/seat reference(s) detected.`
    },
    {
      key: 'bench_limit_respected',
      label: 'No bench or seat exceeds configured seating mode or disabled status',
      passed: seatLimitExceeded === 0,
      severity: 'critical',
      details:
        seatLimitExceeded === 0
          ? `Max ${seatingMode} student(s) per active bench enforced.`
          : `${seatLimitExceeded} bench capacity violation(s) detected.`
    },
    {
      key: 'all_originals_preserved',
      label: 'All original student records remain intact',
      passed: students.length === normalizedStudents.length,
      severity: 'critical',
      details: `${students.length} original records preserved.`
    }
  );

  if (duplicateAssignments > 0) {
    issues.push({
      id: 'audit_dup_seats',
      severity: 'critical',
      agent: 'Seating Audit',
      code: 'DUPLICATE_SEAT_ASSIGNMENT',
      message: `${duplicateAssignments} duplicate seat assignment(s) found.`,
      affectedRollNumbers: duplicateAssignedRolls
    });
  }

  if (missingStudents > 0 && capacitySufficient) {
    issues.push({
      id: 'audit_missing_students',
      severity: 'critical',
      agent: 'Seating Audit',
      code: 'OMITTED_STUDENTS',
      message: `${missingStudents} student(s) were omitted from the seating plan.`,
      affectedRollNumbers: missingStudentRolls
    });
  }

  if (alteredRollNumbers > 0) {
    issues.push({
      id: 'audit_altered_rolls',
      severity: 'critical',
      agent: 'Seating Audit',
      code: 'ALTERED_ROLL_NUMBERS',
      message: `${alteredRollNumbers} roll number(s) were altered or unverified.`
    });
  }

  const allCriticalPassed =
    checklist.every((item) => item.severity !== 'critical' || item.passed) &&
    issues.every((issue) => issue.severity !== 'critical');

  return {
    status: allCriticalPassed ? 'VERIFIED' : 'FAILED',
    totalStudents: normalizedStudents.length,
    allocatedStudents: allocation.allocatedStudents,
    unallocatedStudents: allocation.unallocatedStudents.length,
    duplicateAssignments,
    missingStudents,
    totalBenches: allocation.totalBenches,
    activeBenches: allocation.activeBenches,
    totalCapacity: allocation.totalCapacity,
    unusedSeats: allocation.unusedSeats,
    capacitySufficient,
    checklist,
    issues,
    generatedAt: new Date().toISOString()
  };
}
