import { CapacitySummary, ClassroomConfig, SeatingMode, ValidationIssue } from './types';

export function benchKey(rowNumber: number, benchNumber: number): string {
  return `R${rowNumber}-B${benchNumber}`;
}

export function generateSimpleClassrooms(
  count: number,
  rowsPerClassroom: number,
  benchesPerRow: number
): ClassroomConfig[] {
  const safeCount = Math.max(0, Math.floor(count));
  const safeRows = Math.max(0, Math.floor(rowsPerClassroom));
  const safeBenches = Math.max(0, Math.floor(benchesPerRow));

  const rooms: ClassroomConfig[] = [];
  for (let i = 1; i <= safeCount; i++) {
    rooms.push({
      id: `room_${i}`,
      name: `Classroom ${i}`,
      roomNumber: `${i}`,
      rows: safeRows,
      benchesPerRow: safeBenches,
      disabledBenches: [],
      disabled: false,
      orderIndex: i - 1
    });
  }
  return rooms;
}

export function getBenchesInRow(classroom: ClassroomConfig, rowIndexZeroBased: number): number {
  if (
    Array.isArray(classroom.rowBenchCounts) &&
    typeof classroom.rowBenchCounts[rowIndexZeroBased] === 'number'
  ) {
    return Math.max(0, Math.floor(classroom.rowBenchCounts[rowIndexZeroBased]));
  }
  return Math.max(0, Math.floor(classroom.benchesPerRow));
}

export function calculateClassroomCapacity(
  classroom: ClassroomConfig,
  seatingMode: SeatingMode
): {
  totalBenches: number;
  activeBenches: number;
  disabledBenches: number;
  capacity: number;
} {
  if (classroom.disabled) {
    let totalBenches = 0;
    for (let r = 0; r < classroom.rows; r++) {
      totalBenches += getBenchesInRow(classroom, r);
    }
    return {
      totalBenches,
      activeBenches: 0,
      disabledBenches: totalBenches,
      capacity: 0
    };
  }

  const disabledSet = new Set(classroom.disabledBenches ?? []);
  let totalBenches = 0;
  let activeBenches = 0;
  let disabledBenches = 0;

  for (let r = 1; r <= classroom.rows; r++) {
    const benchesInRow = getBenchesInRow(classroom, r - 1);
    for (let b = 1; b <= benchesInRow; b++) {
      totalBenches++;
      if (disabledSet.has(benchKey(r, b))) {
        disabledBenches++;
      } else {
        activeBenches++;
      }
    }
  }

  return {
    totalBenches,
    activeBenches,
    disabledBenches,
    capacity: activeBenches * seatingMode
  };
}

export function calculateTotalCapacity(
  classrooms: ClassroomConfig[],
  seatingMode: SeatingMode
): CapacitySummary {
  const issues: ValidationIssue[] = [];
  let totalBenches = 0;
  let activeBenches = 0;
  let disabledBenches = 0;
  let totalCapacity = 0;
  let activeClassrooms = 0;

  if (classrooms.length === 0) {
    issues.push({
      id: 'cap_no_rooms',
      severity: 'critical',
      agent: 'Classroom Capacity',
      code: 'NO_CLASSROOMS',
      message: 'No classrooms are configured.',
      details: 'Add at least one active classroom with rows and benches.'
    });
  }

  const ordered = [...classrooms].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const room of ordered) {
    if (room.rows <= 0 || room.benchesPerRow <= 0) {
      issues.push({
        id: `cap_invalid_${room.id}`,
        severity: 'critical',
        agent: 'Classroom Capacity',
        code: 'INVALID_ROOM_DIMENSIONS',
        message: `${room.name} has invalid dimensions (${room.rows} rows × ${room.benchesPerRow} benches/row).`
      });
    }

    const stats = calculateClassroomCapacity(room, seatingMode);
    totalBenches += stats.totalBenches;
    activeBenches += stats.activeBenches;
    disabledBenches += stats.disabledBenches;
    totalCapacity += stats.capacity;
    if (!room.disabled && stats.activeBenches > 0) {
      activeClassrooms++;
    } else if (!room.disabled && stats.activeBenches === 0) {
      issues.push({
        id: `cap_zero_active_${room.id}`,
        severity: 'warning',
        agent: 'Classroom Capacity',
        code: 'ZERO_ACTIVE_BENCHES',
        message: `${room.name} has 0 active benches available.`
      });
    }
  }

  if (classrooms.length > 0 && activeClassrooms === 0) {
    issues.push({
      id: 'cap_all_disabled',
      severity: 'critical',
      agent: 'Classroom Capacity',
      code: 'ALL_ROOMS_DISABLED',
      message: 'All configured classrooms are disabled or have zero active benches.'
    });
  }

  return {
    totalClassrooms: classrooms.length,
    activeClassrooms,
    totalBenches,
    activeBenches,
    disabledBenches,
    totalCapacity,
    issues
  };
}
