import { describe, expect, it } from 'vitest';
import { runSeatingAudit } from '../auditEngine';
import { generateSimpleClassrooms } from '../classroomEngine';
import { autoDetectColumnMapping, mapRowsToStudents, parseCsvText } from '../dataImport';
import { buildSeatingPlanPdf } from '../pdfGenerator';
import { generateRollNumberRange } from '../rollNumberEngine';
import { allocateSeating } from '../seatingEngine';
import { ExamRecord, InstitutionProfile, StudentRecord } from '../types';

const mockInstitution: InstitutionProfile = {
  id: 'inst_test',
  ownerId: 'user_test',
  name: 'National Institute of Examination Studies',
  type: 'College',
  address: '12 Academic Boulevard',
  city: 'Bengaluru',
  state: 'Karnataka',
  pinCode: '560001',
  mobile: '9876543210'
};

const mockExam: ExamRecord = {
  id: 'exam_test',
  institutionId: 'inst_test',
  ownerId: 'user_test',
  name: 'Mid-Semester Computer Science Exam',
  examType: 'Mid-Term',
  academicYear: '2026-27',
  examDate: '2026-11-24',
  status: 'verified',
  studentCount: 50,
  classroomCount: 5,
  totalBenches: 150,
  totalCapacity: 150,
  seatingMode: 1,
  strategy: 'sequential',
  sortOrder: 'original'
};

describe('EXAM PLANNER Deterministic Seating Allocation & Audit Engine', () => {
  it('TEST 1 (Section 21 Exact Scenario): Roll 1-50, 5 classrooms, 3 rows, 10 benches, 1 student/bench', () => {
    const { students, error } = generateRollNumberRange('1', '50');
    expect(error).toBeUndefined();
    expect(students).toHaveLength(50);

    const classrooms = generateSimpleClassrooms(5, 3, 10);
    const result = allocateSeating({
      students,
      classrooms,
      seatingMode: 1,
      strategy: 'sequential',
      sortOrder: 'original'
    });

    expect(result.totalStudents).toBe(50);
    expect(result.totalBenches).toBe(150);
    expect(result.totalCapacity).toBe(150);
    expect(result.allocatedStudents).toBe(50);
    expect(result.unusedSeats).toBe(100);
    expect(result.capacitySufficient).toBe(true);

    const findSeat = (roll: string) => result.lookupIndex.find((x) => x.rollNumber === roll);

    expect(findSeat('1')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 1, benchNumber: 1, seatNumber: 1 });
    expect(findSeat('10')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 1, benchNumber: 10, seatNumber: 1 });
    expect(findSeat('11')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 2, benchNumber: 1, seatNumber: 1 });
    expect(findSeat('20')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 2, benchNumber: 10, seatNumber: 1 });
    expect(findSeat('21')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 3, benchNumber: 1, seatNumber: 1 });
    expect(findSeat('30')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 3, benchNumber: 10, seatNumber: 1 });
    expect(findSeat('31')).toMatchObject({ classroomName: 'Classroom 2', rowNumber: 1, benchNumber: 1, seatNumber: 1 });
    expect(findSeat('50')).toMatchObject({ classroomName: 'Classroom 2', rowNumber: 2, benchNumber: 10, seatNumber: 1 });

    // Classroom 2 Row 3 must be all EMPTY
    const c2Row3 = result.roomAllocations[1].rows[2];
    expect(c2Row3.benches.every((b) => b.seats[0].status === 'EMPTY')).toBe(true);

    // Classrooms 3, 4, 5 must be all EMPTY
    [2, 3, 4].forEach((idx) => {
      expect(result.roomAllocations[idx].allocatedCount).toBe(0);
    });

    const audit = runSeatingAudit({
      students,
      classrooms,
      allocation: result,
      seatingMode: 1,
      expectedRange: { start: '1', end: '50' },
      isSequentialMode: true
    });
    expect(audit.status).toBe('VERIFIED');
  });

  it('TEST 2: Roll 1-50, 5 classrooms, 3 rows, 10 benches, 2 students/bench', () => {
    const { students } = generateRollNumberRange('1', '50');
    const classrooms = generateSimpleClassrooms(5, 3, 10);

    const result = allocateSeating({
      students,
      classrooms,
      seatingMode: 2,
      strategy: 'sequential'
    });

    expect(result.totalCapacity).toBe(300);
    expect(result.allocatedStudents).toBe(50);
    expect(result.unusedSeats).toBe(250);

    const findSeat = (roll: string) => result.lookupIndex.find((x) => x.rollNumber === roll);
    expect(findSeat('1')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 1, benchNumber: 1, seatNumber: 1 });
    expect(findSeat('2')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 1, benchNumber: 1, seatNumber: 2 });
    expect(findSeat('3')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 1, benchNumber: 2, seatNumber: 1 });
    expect(findSeat('4')).toMatchObject({ classroomName: 'Classroom 1', rowNumber: 1, benchNumber: 2, seatNumber: 2 });
  });

  it('TEST 3: Missing student names do not fail allocation and display "Name Not Provided"', () => {
    const students: StudentRecord[] = [
      { id: '1', rollNumber: '101', originalIndex: 0 },
      { id: '2', rollNumber: '102', name: '', originalIndex: 1 },
      { id: '3', rollNumber: '103', name: 'Rohan Mehta', originalIndex: 2 }
    ];
    const classrooms = generateSimpleClassrooms(1, 1, 5);
    const result = allocateSeating({ students, classrooms, seatingMode: 1 });
    const audit = runSeatingAudit({ students, classrooms, allocation: result, seatingMode: 1 });

    expect(audit.status).toBe('VERIFIED');
    expect(result.lookupIndex[0].studentName).toBe('Name Not Provided');
    expect(result.lookupIndex[1].studentName).toBe('Name Not Provided');
    expect(result.lookupIndex[2].studentName).toBe('Rohan Mehta');
    expect(audit.issues.some((i) => i.severity === 'warning' && i.code === 'MISSING_STUDENT_NAMES')).toBe(true);
  });

  it('TEST 4: Duplicate roll numbers fail validation and do not produce VERIFIED status', () => {
    const students: StudentRecord[] = [
      { id: '1', rollNumber: '001', originalIndex: 0 },
      { id: '2', rollNumber: '001', originalIndex: 1 },
      { id: '3', rollNumber: '002', originalIndex: 2 }
    ];
    const classrooms = generateSimpleClassrooms(1, 1, 5);
    const result = allocateSeating({ students, classrooms, seatingMode: 1 });
    const audit = runSeatingAudit({ students, classrooms, allocation: result, seatingMode: 1 });

    expect(audit.status).toBe('FAILED');
    expect(audit.issues.some((i) => i.severity === 'critical' && i.code === 'DUPLICATE_ROLL_NUMBERS')).toBe(true);
  });

  it('TEST 5: Insufficient capacity produces clear error and does not silently drop students', () => {
    const { students } = generateRollNumberRange('1', '25');
    const classrooms = generateSimpleClassrooms(1, 2, 10); // 20 seats < 25 students

    const result = allocateSeating({ students, classrooms, seatingMode: 1 });
    const audit = runSeatingAudit({ students, classrooms, allocation: result, seatingMode: 1 });

    expect(result.capacitySufficient).toBe(false);
    expect(result.errorMessage).toContain('Insufficient seating capacity. You have 25 students but only 20 available seats.');
    expect(result.unallocatedStudents).toHaveLength(5);
    expect(audit.status).toBe('FAILED');
  });

  it('TEST 6: Leading zero roll numbers are preserved verbatim (001, 002, 003, 004)', () => {
    const { students } = generateRollNumberRange('001', '004');
    expect(students.map((s) => s.rollNumber)).toEqual(['001', '002', '003', '004']);

    const classrooms = generateSimpleClassrooms(1, 1, 4);
    const result = allocateSeating({ students, classrooms, seatingMode: 1 });
    expect(result.lookupIndex.map((s) => s.rollNumber)).toEqual(['001', '002', '003', '004']);
  });

  it('TEST 7: Alphanumeric roll numbers (BCA001..BCA003) preserve original values', () => {
    const { students } = generateRollNumberRange('BCA001', 'BCA003');
    expect(students.map((s) => s.rollNumber)).toEqual(['BCA001', 'BCA002', 'BCA003']);

    const classrooms = generateSimpleClassrooms(1, 1, 3);
    const result = allocateSeating({ students, classrooms, seatingMode: 1 });
    expect(result.lookupIndex.map((s) => s.rollNumber)).toEqual(['BCA001', 'BCA002', 'BCA003']);
  });

  it('TEST 8: Long roll numbers are never truncated or altered', () => {
    const longRoll = 'UNIV-2026-ENG-CS-0000192837465';
    const students: StudentRecord[] = [{ id: '1', rollNumber: longRoll, name: 'Ananya Verma', originalIndex: 0 }];
    const classrooms = generateSimpleClassrooms(1, 1, 2);
    const result = allocateSeating({ students, classrooms, seatingMode: 1 });
    const audit = runSeatingAudit({ students, classrooms, allocation: result, seatingMode: 1 });

    expect(result.lookupIndex[0].rollNumber).toBe(longRoll);
    expect(audit.status).toBe('VERIFIED');
  });

  it('TEST 9: Student search lookup returns exact classroom, row, bench, and seat', () => {
    const { students } = generateRollNumberRange('1', '50');
    const classrooms = generateSimpleClassrooms(5, 3, 10);
    const result = allocateSeating({ students, classrooms, seatingMode: 1 });

    const roll25 = result.lookupIndex.find((x) => x.rollNumber === '25');
    expect(roll25).toBeDefined();
    expect(roll25?.classroomName).toBe('Classroom 1');
    expect(roll25?.rowLabel).toBe('Row 3');
    expect(roll25?.benchLabel).toBe('Bench 5');
    expect(roll25?.seatNumber).toBe(1);
  });

  it('TEST 10: PDF generation produces valid multi-page PDF documents for Format A and Format B', () => {
    const { students } = generateRollNumberRange('001', '050');
    const classrooms = generateSimpleClassrooms(5, 3, 10);
    const result = allocateSeating({ students, classrooms, seatingMode: 1 });
    const audit = runSeatingAudit({ students, classrooms, allocation: result, seatingMode: 1 });

    const pdfA = buildSeatingPlanPdf({
      institution: mockInstitution,
      exam: mockExam,
      roomAllocations: result.roomAllocations,
      auditReport: audit,
      seatingMode: 1,
      format: 'classroom_wise'
    });
    expect(pdfA.getNumberOfPages()).toBeGreaterThanOrEqual(2);
    const outA = pdfA.output('arraybuffer');
    expect(outA.byteLength).toBeGreaterThan(2000);

    const pdfB = buildSeatingPlanPdf({
      institution: mockInstitution,
      exam: mockExam,
      roomAllocations: result.roomAllocations,
      auditReport: audit,
      seatingMode: 1,
      format: 'print_sheet'
    });
    expect(pdfB.getNumberOfPages()).toBe(5); // 5 individual classroom print sheets
    const outB = pdfB.output('arraybuffer');
    expect(outB.byteLength).toBeGreaterThan(2000);
  });

  it('TEST 11: Imported CSV of 599 students (with missing names & 600-seat capacity) verifies cleanly without stale range', () => {
    // Build a 599-student CSV (rolls 0001..0600 skipping 0350) with some blank student names
    const csvLines = ['Roll Number,Student Name,Section'];
    for (let i = 1; i <= 600; i++) {
      if (i === 350) continue; // 599 records total
      const roll = String(i).padStart(4, '0');
      const name = i % 10 === 0 ? '' : `Student ${i}`;
      csvLines.push(`${roll},${name},A`);
    }
    const parsed = parseCsvText(csvLines.join('\n'), 'students_599.csv');
    expect(parsed.rows).toHaveLength(599);

    const mapping = autoDetectColumnMapping(parsed.headers);
    const { students, skippedEmptyRollRows } = mapRowsToStudents(parsed.rows, mapping);
    expect(skippedEmptyRollRows).toBe(0);
    expect(students).toHaveLength(599);
    expect(students[0].rollNumber).toBe('0001'); // Leading zeros preserved verbatim

    const classrooms = generateSimpleClassrooms(20, 3, 10); // 600 benches = 600 seats
    const allocation = allocateSeating({
      students,
      classrooms,
      seatingMode: 1,
      strategy: 'sequential',
      sortOrder: 'original'
    });

    expect(allocation.totalStudents).toBe(599);
    expect(allocation.allocatedStudents).toBe(599);
    expect(allocation.unallocatedStudents).toHaveLength(0);
    expect(allocation.totalCapacity).toBe(600);
    expect(allocation.unusedSeats).toBe(1);
    expect(allocation.capacitySufficient).toBe(true);

    // No explicit rollRange passed: imported student list (599) is source of truth
    const audit = runSeatingAudit({
      students,
      classrooms,
      allocation,
      seatingMode: 1,
      expectedRange: undefined,
      isSequentialMode: true
    });

    expect(audit.status).toBe('VERIFIED');
    expect(audit.totalStudents).toBe(599);
    expect(audit.allocatedStudents).toBe(599);
    expect(audit.duplicateAssignments).toBe(0);
    expect(audit.missingStudents).toBe(0);
    expect(audit.unusedSeats).toBe(1);
    expect(audit.issues.filter((i) => i.severity === 'critical')).toHaveLength(0);
    expect(audit.issues.some((i) => i.code === 'MISSING_STUDENT_NAMES' && i.severity === 'warning')).toBe(true);
  });

  it('TEST 12: Explicit roll-number range still enforces strict count matching when specified', () => {
    const { students } = generateRollNumberRange('1', '599');
    const classrooms = generateSimpleClassrooms(20, 3, 10);
    const allocation = allocateSeating({ students, classrooms, seatingMode: 1, strategy: 'sequential' });

    const audit = runSeatingAudit({
      students,
      classrooms,
      allocation,
      seatingMode: 1,
      expectedRange: { start: '1', end: '600' },
      isSequentialMode: true
    });

    expect(audit.status).toBe('FAILED');
    expect(audit.issues.some((i) => i.code === 'EXPECTED_COUNT_MISMATCH' && i.severity === 'critical')).toBe(true);
  });
});
