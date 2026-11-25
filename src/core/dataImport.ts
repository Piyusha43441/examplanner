import * as XLSX from 'xlsx';
import { normalizeRollNumber } from './rollNumberEngine';
import { StudentRecord } from './types';

export interface ParsedTabularData {
  headers: string[];
  rows: Record<string, string>[];
  fileName?: string;
  emptyRowCount: number;
}

export interface ColumnMapping {
  rollNumber: string;
  name?: string;
  className?: string;
  course?: string;
  section?: string;
  subject?: string;
}

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

export function validateUploadFile(file: File): { valid: boolean; error?: string } {
  const allowedExtensions = ['.csv', '.xlsx', '.xls'];
  const lower = file.name.toLowerCase();
  const hasValidExt = allowedExtensions.some((ext) => lower.endsWith(ext));

  if (!hasValidExt) {
    return {
      valid: false,
      error: 'Unsupported file type. Please upload a .csv, .xlsx, or .xls spreadsheet.'
    };
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return {
      valid: false,
      error: 'File size exceeds the 10 MB security limit.'
    };
  }
  return { valid: true };
}

/**
 * Parses CSV, XLSX, or XLS while preserving leading zeros and exact string formatting.
 */
export async function parseSpreadsheetFile(file: File): Promise<ParsedTabularData> {
  const check = validateUploadFile(file);
  if (!check.valid) {
    throw new Error(check.error);
  }

  const lower = file.name.toLowerCase();
  if (lower.endsWith('.csv')) {
    const rawText = await file.text();
    return parseCsvText(rawText, file.name);
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: 'array',
    raw: false,
    cellText: true,
    cellNF: false
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('The uploaded workbook contains no sheets.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  // Use raw: false so formatted strings (including leading zeros stored as text) stay intact
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: ''
  });

  return matrixToParsedData(matrix, file.name);
}

function detectDelimiter(headerLine: string): string {
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const semiCount = (headerLine.match(/;/g) ?? []).length;
  if (tabCount > commaCount && tabCount >= semiCount) return '\t';
  if (semiCount > commaCount && semiCount > tabCount) return ';';
  return ',';
}

export function parseCsvText(rawText: string, fileName?: string): ParsedTabularData {
  const cleaned = rawText.replace(/^\uFEFF/, '');
  const firstBreak = cleaned.search(/\r?\n|\r/);
  const firstLine = firstBreak === -1 ? cleaned : cleaned.slice(0, firstBreak);
  const delimiter = detectDelimiter(firstLine);

  const matrix: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(current.trim());
      current = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && cleaned[i + 1] === '\n') {
        i++;
      }
      row.push(current.trim());
      matrix.push(row);
      row = [];
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim());
    matrix.push(row);
  }

  return matrixToParsedData(matrix, fileName);
}

export function parsePastedText(text: string): ParsedTabularData {
  const cleaned = text.replace(/^\uFEFF/, '').trim();
  if (!cleaned) {
    return { headers: [], rows: [], emptyRowCount: 0 };
  }
  return parseCsvText(cleaned, 'Pasted Data');
}

function matrixToParsedData(matrix: unknown[][], fileName?: string): ParsedTabularData {
  if (matrix.length === 0) {
    return { headers: [], rows: [], fileName, emptyRowCount: 0 };
  }

  const rawHeaders = (matrix[0] ?? []).map((h, i) => {
    const clean = String(h ?? '').trim();
    return clean || `Column ${i + 1}`;
  });

  const rows: Record<string, string>[] = [];
  let emptyRowCount = 0;

  for (let r = 1; r < matrix.length; r++) {
    const rowArr = matrix[r] ?? [];
    const obj: Record<string, string> = {};
    let hasAnyValue = false;

    for (let c = 0; c < rawHeaders.length; c++) {
      const val = String(rowArr[c] ?? '').trim();
      if (val.length > 0) hasAnyValue = true;
      obj[rawHeaders[c]] = val;
    }

    if (!hasAnyValue) {
      emptyRowCount++;
    } else {
      rows.push(obj);
    }
  }

  return { headers: rawHeaders, rows, fileName, emptyRowCount };
}

export function autoDetectColumnMapping(headers: string[]): ColumnMapping {
  const findMatch = (patterns: RegExp[]): string | undefined =>
    headers.find((h) => patterns.some((p) => p.test(h.toLowerCase())));

  const rollNumber =
    findMatch([/roll/, /reg(istration)?[\s_-]*no/, /seat[\s_-]*no/, /student[\s_-]*id/, /^id$/]) ??
    headers[0] ??
    '';

  const name = findMatch([/student[\s_-]*name/, /^name$/, /full[\s_-]*name/, /candidate/]);
  const className = findMatch([/^class$/, /grade/, /std/]);
  const course = findMatch([/course/, /program/, /branch/, /dept/, /department/]);
  const section = findMatch([/section/, /sec$/, /batch/, /division/]);
  const subject = findMatch([/subject/, /paper/, /exam/]);

  return { rollNumber, name, className, course, section, subject };
}

export function mapRowsToStudents(
  rows: Record<string, string>[],
  mapping: ColumnMapping,
  startingIndex = 0
): { students: StudentRecord[]; skippedEmptyRollRows: number } {
  const students: StudentRecord[] = [];
  let skippedEmptyRollRows = 0;

  rows.forEach((row, idx) => {
    const roll = normalizeRollNumber(row[mapping.rollNumber]);
    if (!roll) {
      skippedEmptyRollRows++;
      return;
    }

    const nameVal = mapping.name ? row[mapping.name]?.trim() : undefined;
    const classVal = mapping.className ? row[mapping.className]?.trim() : undefined;
    const courseVal = mapping.course ? row[mapping.course]?.trim() : undefined;
    const sectionVal = mapping.section ? row[mapping.section]?.trim() : undefined;
    const subjectVal = mapping.subject ? row[mapping.subject]?.trim() : undefined;

    students.push({
      id: `imp_${startingIndex + idx + 1}`,
      rollNumber: roll,
      ...(nameVal ? { name: nameVal } : {}),
      ...(classVal ? { className: classVal } : {}),
      ...(courseVal ? { course: courseVal } : {}),
      ...(sectionVal ? { section: sectionVal } : {}),
      ...(subjectVal ? { subject: subjectVal } : {}),
      originalIndex: startingIndex + students.length
    });
  });

  return { students, skippedEmptyRollRows };
}

export function downloadStudentTemplate(format: 'csv' | 'xlsx' = 'xlsx'): void {
  const sampleRows = [
    {
      'Roll Number': '001',
      'Student Name': 'Aarav Sharma',
      Class: 'B.Sc Computer Science',
      Course: 'B.Sc CS',
      Section: 'A',
      Subject: 'Data Structures'
    },
    {
      'Roll Number': '002',
      'Student Name': 'Priya Nair',
      Class: 'B.Sc Computer Science',
      Course: 'B.Sc CS',
      Section: 'A',
      Subject: 'Data Structures'
    },
    {
      'Roll Number': '003',
      'Student Name': '',
      Class: 'B.Sc Computer Science',
      Course: 'B.Sc CS',
      Section: 'B',
      Subject: 'Data Structures'
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(sampleRows);
  // Format Roll Number column cells explicitly as text '@' so Excel keeps leading zeros
  ['A2', 'A3', 'A4'].forEach((ref) => {
    if (worksheet[ref]) {
      worksheet[ref].t = 's';
      worksheet[ref].z = '@';
    }
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');

  if (format === 'csv') {
    XLSX.writeFile(workbook, 'exam_planner_student_template.csv', { bookType: 'csv' });
  } else {
    XLSX.writeFile(workbook, 'exam_planner_student_template.xlsx');
  }
}
