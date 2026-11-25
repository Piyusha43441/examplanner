import { StudentRecord } from './types';

export function normalizeRollNumber(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  // Never convert to Number or parseInt; preserve exact leading zeros and formatting
  return String(raw).trim();
}

export interface RollRangeParseResult {
  students: StudentRecord[];
  error?: string;
}

/**
 * Generates inclusive sequential roll numbers while strictly preserving
 * leading zeros and alphanumeric prefixes (e.g., 1..50, 001..050, BCA2026001..BCA2026050).
 */
export function generateRollNumberRange(
  rawStart: string,
  rawEnd: string,
  maxCount = 50000
): RollRangeParseResult {
  const start = normalizeRollNumber(rawStart);
  const end = normalizeRollNumber(rawEnd);

  if (!start || !end) {
    return { students: [], error: 'Both starting and ending roll numbers are required.' };
  }

  // Split into optional non-digit prefix and trailing digits
  const startMatch = start.match(/^(.*?)(\d+)$/);
  const endMatch = end.match(/^(.*?)(\d+)$/);

  if (!startMatch || !endMatch) {
    return {
      students: [],
      error:
        'Roll number range must end with digits (e.g., 1 to 50, 001 to 050, or BCA2026001 to BCA2026050).'
    };
  }

  const [, startPrefix, startDigits] = startMatch;
  const [, endPrefix, endDigits] = endMatch;

  if (startPrefix !== endPrefix) {
    return {
      students: [],
      error: `Roll number prefixes must match ("${startPrefix || '(none)'}" vs "${endPrefix || '(none)'}").`
    };
  }

  const startNum = BigInt(startDigits);
  const endNum = BigInt(endDigits);

  if (endNum < startNum) {
    return {
      students: [],
      error: 'Ending roll number must be greater than or equal to starting roll number.'
    };
  }

  const count = Number(endNum - startNum + 1n);
  if (count > maxCount) {
    return {
      students: [],
      error: `Range generates ${count.toLocaleString()} students, which exceeds the ${maxCount.toLocaleString()} student limit per exam.`
    };
  }

  // Determine padding: if start or end has leading zeros (or alphanumeric prefix with fixed width), preserve pad width
  const hasLeadingZero =
    (startDigits.length > 1 && startDigits.startsWith('0')) ||
    (endDigits.length > 1 && endDigits.startsWith('0'));
  const padWidth = hasLeadingZero ? Math.max(startDigits.length, endDigits.length) : 0;

  const students: StudentRecord[] = [];
  for (let i = 0; i < count; i++) {
    const current = startNum + BigInt(i);
    const numStr = padWidth > 0 ? current.toString().padStart(padWidth, '0') : current.toString();
    const rollNumber = `${startPrefix}${numStr}`;
    students.push({
      id: `stu_${i + 1}`,
      rollNumber,
      originalIndex: i
    });
  }

  return { students };
}

/**
 * Natural alphanumeric comparator that handles numeric substrings accurately
 * without mutating original roll number strings.
 */
export function naturalRollCompare(a: string, b: string): number {
  const tokenRegex = /(\d+|\D+)/g;
  const tokensA = a.match(tokenRegex) ?? [a];
  const tokensB = b.match(tokenRegex) ?? [b];
  const maxLen = Math.max(tokensA.length, tokensB.length);

  for (let i = 0; i < maxLen; i++) {
    const ta = tokensA[i];
    const tb = tokensB[i];
    if (ta === undefined) return -1;
    if (tb === undefined) return 1;

    const isNumA = /^\d+$/.test(ta);
    const isNumB = /^\d+$/.test(tb);

    if (isNumA && isNumB) {
      const na = BigInt(ta);
      const nb = BigInt(tb);
      if (na !== nb) return na < nb ? -1 : 1;
      if (ta.length !== tb.length) return ta.length - tb.length;
    } else {
      const cmp = ta.localeCompare(tb, undefined, { sensitivity: 'base' });
      if (cmp !== 0) return cmp;
    }
  }
  return a.localeCompare(b);
}

/**
 * Finds duplicate roll numbers using exact string matching (after trim).
 */
export function findDuplicateRollNumbers(students: StudentRecord[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const s of students) {
    const roll = normalizeRollNumber(s.rollNumber);
    if (!roll) continue;
    if (seen.has(roll)) {
      duplicates.add(roll);
    } else {
      seen.add(roll);
    }
  }
  return Array.from(duplicates);
}

/**
 * Detects gaps in a numeric/alphanumeric sequence when roll numbers share a prefix.
 */
export function detectSequenceGaps(students: StudentRecord[]): string[] {
  if (students.length < 2) return [];
  const parsed: { prefix: string; num: bigint; pad: number }[] = [];
  for (const s of students) {
    const m = s.rollNumber.match(/^(.*?)(\d+)$/);
    if (!m) return [];
    const hasLeadingZero = m[2].length > 1 && m[2].startsWith('0');
    parsed.push({
      prefix: m[1],
      num: BigInt(m[2]),
      pad: hasLeadingZero ? m[2].length : 0
    });
  }

  const firstPrefix = parsed[0].prefix;
  if (!parsed.every((p) => p.prefix === firstPrefix)) return [];

  const sortedNums = [...parsed].sort((a, b) => (a.num < b.num ? -1 : a.num > b.num ? 1 : 0));
  const maxPad = Math.max(...parsed.map((p) => p.pad));
  const existingSet = new Set(parsed.map((p) => p.num.toString()));
  const missing: string[] = [];

  const min = sortedNums[0].num;
  const max = sortedNums[sortedNums.length - 1].num;
  const span = max - min + 1n;
  if (span > 10000n) return [];

  for (let cur = min; cur <= max; cur += 1n) {
    if (!existingSet.has(cur.toString())) {
      const numStr = maxPad > 0 ? cur.toString().padStart(maxPad, '0') : cur.toString();
      missing.push(`${firstPrefix}${numStr}`);
      if (missing.length >= 25) break;
    }
  }
  return missing;
}
