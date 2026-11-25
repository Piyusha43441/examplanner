import { benchKey, calculateClassroomCapacity, getBenchesInRow } from './classroomEngine';
import { findDuplicateRollNumbers, naturalRollCompare, normalizeRollNumber } from './rollNumberEngine';
import {
  AllocationResult,
  AllocationStrategy,
  BenchAllocation,
  ClassroomAllocation,
  ClassroomConfig,
  CustomAllocationRule,
  RowAllocation,
  SeatAssignment,
  SeatingMode,
  SortOrder,
  StudentRecord,
  StudentSeatLookup
} from './types';

export interface AllocateSeatingParams {
  students: StudentRecord[];
  classrooms: ClassroomConfig[];
  seatingMode: SeatingMode;
  strategy?: AllocationStrategy;
  sortOrder?: SortOrder;
  customRule?: CustomAllocationRule;
}

function orderStudents(students: StudentRecord[], sortOrder: SortOrder): StudentRecord[] {
  const copy = [...students];
  if (sortOrder === 'ascending') {
    return copy.sort((a, b) => naturalRollCompare(a.rollNumber, b.rollNumber));
  }
  if (sortOrder === 'original') {
    return copy.sort((a, b) => a.originalIndex - b.originalIndex);
  }
  return copy;
}

function applyAllocationStrategy(
  orderedStudents: StudentRecord[],
  strategy: AllocationStrategy,
  customRule?: CustomAllocationRule
): StudentRecord[] {
  if (orderedStudents.length <= 1 || strategy === 'sequential') {
    return orderedStudents;
  }

  if (strategy === 'alternate') {
    // Interleave first half and second half so consecutive roll numbers are separated
    const mid = Math.ceil(orderedStudents.length / 2);
    const firstHalf = orderedStudents.slice(0, mid);
    const secondHalf = orderedStudents.slice(mid);
    const result: StudentRecord[] = [];
    for (let i = 0; i < mid; i++) {
      result.push(firstHalf[i]);
      if (i < secondHalf.length) {
        result.push(secondHalf[i]);
      }
    }
    return result;
  }

  if (strategy === 'section_separation') {
    const field = customRule?.groupByField ?? 'section';
    const buckets = new Map<string, StudentRecord[]>();
    for (const s of orderedStudents) {
      const keyRaw =
        (field === 'course' ? s.course : field === 'subject' ? s.subject : s.section) ||
        s.course ||
        s.className ||
        'DEFAULT';
      const key = String(keyRaw).trim() || 'DEFAULT';
      const list = buckets.get(key) ?? [];
      list.push(s);
      buckets.set(key, list);
    }
    // Round-robin across largest buckets first to maximize neighbor separation
    const groups = Array.from(buckets.values()).sort((a, b) => b.length - a.length);
    const result: StudentRecord[] = [];
    let remaining = orderedStudents.length;
    const indices = new Array(groups.length).fill(0);
    while (remaining > 0) {
      let progressed = false;
      for (let g = 0; g < groups.length; g++) {
        if (indices[g] < groups[g].length) {
          result.push(groups[g][indices[g]]);
          indices[g]++;
          remaining--;
          progressed = true;
        }
      }
      if (!progressed) break;
    }
    return result;
  }

  if (strategy === 'custom') {
    const step = Math.max(2, Math.min(10, customRule?.staggerStep ?? 3));
    const buckets: StudentRecord[][] = Array.from({ length: step }, () => []);
    orderedStudents.forEach((student, idx) => {
      buckets[idx % step].push(student);
    });
    return buckets.flat();
  }

  return orderedStudents;
}

/**
 * Deterministic Seating Allocation Engine.
 * AI models must NEVER invoke or replace this deterministic logic.
 */
export function allocateSeating(params: AllocateSeatingParams): AllocationResult {
  const {
    students,
    classrooms,
    seatingMode,
    strategy = 'sequential',
    sortOrder = 'original',
    customRule
  } = params;

  const normalizedStudents: StudentRecord[] = students.map((s, idx) => ({
    ...s,
    rollNumber: normalizeRollNumber(s.rollNumber),
    originalIndex: typeof s.originalIndex === 'number' ? s.originalIndex : idx
  }));

  const sortedRooms = [...classrooms]
    .filter((c) => !c.disabled)
    .sort((a, b) => a.orderIndex - b.orderIndex);

  let totalBenches = 0;
  let activeBenches = 0;
  let totalCapacity = 0;

  for (const room of classrooms) {
    const stats = calculateClassroomCapacity(room, seatingMode);
    totalBenches += stats.totalBenches;
    activeBenches += stats.activeBenches;
    totalCapacity += stats.capacity;
  }

  const totalStudents = normalizedStudents.length;
  const capacitySufficient = totalStudents <= totalCapacity;
  const duplicates = findDuplicateRollNumbers(normalizedStudents);
  const emptyRolls = normalizedStudents.filter((s) => !s.rollNumber);

  let errorMessage: string | undefined;
  if (!capacitySufficient) {
    errorMessage = `Insufficient seating capacity. You have ${totalStudents} students but only ${totalCapacity} available seats.`;
  } else if (duplicates.length > 0) {
    errorMessage = `Duplicate roll numbers detected: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? ` (+${duplicates.length - 5} more)` : ''}.`;
  } else if (emptyRolls.length > 0) {
    errorMessage = `${emptyRolls.length} student record(s) are missing a roll number.`;
  }

  const ordered = orderStudents(normalizedStudents, sortOrder);
  const queue = applyAllocationStrategy(ordered, strategy, customRule);

  let studentCursor = 0;
  const roomAllocations: ClassroomAllocation[] = [];
  const lookupIndex: StudentSeatLookup[] = [];

  for (const room of sortedRooms) {
    const disabledSet = new Set(room.disabledBenches ?? []);
    const roomStats = calculateClassroomCapacity(room, seatingMode);
    const rows: RowAllocation[] = [];
    let roomAllocatedCount = 0;

    for (let r = 1; r <= room.rows; r++) {
      const benchesInRow = getBenchesInRow(room, r - 1);
      const benches: BenchAllocation[] = [];

      for (let b = 1; b <= benchesInRow; b++) {
        const key = benchKey(r, b);
        const isDisabled = disabledSet.has(key);
        const seats: SeatAssignment[] = [];

        if (isDisabled) {
          for (let sNum = 1 as 1 | 2; sNum <= seatingMode; sNum = (sNum + 1) as 1 | 2) {
            seats.push({ seatNumber: sNum, status: 'DISABLED' });
          }
        } else {
          for (let sNum = 1 as 1 | 2; sNum <= seatingMode; sNum = (sNum + 1) as 1 | 2) {
            if (studentCursor < queue.length) {
              const student = queue[studentCursor];
              studentCursor++;
              roomAllocatedCount++;

              const displayName =
                student.name && student.name.trim().length > 0
                  ? student.name.trim()
                  : 'Name Not Provided';

              seats.push({
                seatNumber: sNum,
                status: 'OCCUPIED',
                studentId: student.id,
                rollNumber: student.rollNumber,
                studentName: displayName,
                className: student.className,
                course: student.course,
                section: student.section,
                subject: student.subject
              });

              lookupIndex.push({
                studentId: student.id,
                rollNumber: student.rollNumber,
                studentName: displayName,
                classroomId: room.id,
                classroomName: room.name,
                roomNumber: room.roomNumber,
                rowNumber: r,
                rowLabel: `Row ${r}`,
                benchNumber: b,
                benchLabel: `Bench ${b}`,
                seatNumber: sNum,
                className: student.className,
                course: student.course,
                section: student.section,
                subject: student.subject
              });
            } else {
              seats.push({
                seatNumber: sNum,
                status: 'EMPTY'
              });
            }
          }
        }

        benches.push({
          benchNumber: b,
          benchLabel: `Bench ${b}`,
          isDisabled,
          seats
        });
      }

      rows.push({
        rowNumber: r,
        rowLabel: `Row ${r}`,
        benches
      });
    }

    roomAllocations.push({
      id: `alloc_${room.id}`,
      classroomId: room.id,
      classroomName: room.name,
      roomNumber: room.roomNumber,
      ...(room.building ? { building: room.building } : {}),
      ...(room.floor ? { floor: room.floor } : {}),
      orderIndex: room.orderIndex,
      totalBenches: roomStats.totalBenches,
      activeBenches: roomStats.activeBenches,
      capacity: roomStats.capacity,
      allocatedCount: roomAllocatedCount,
      unusedSeats: Math.max(0, roomStats.capacity - roomAllocatedCount),
      rows
    });
  }

  const unallocatedStudents = queue.slice(studentCursor);
  const allocatedStudents = studentCursor;
  const unusedSeats = Math.max(0, totalCapacity - allocatedStudents);

  return {
    roomAllocations,
    lookupIndex,
    unallocatedStudents,
    totalStudents,
    allocatedStudents,
    totalBenches,
    activeBenches,
    totalCapacity,
    unusedSeats,
    capacitySufficient,
    errorMessage
  };
}
