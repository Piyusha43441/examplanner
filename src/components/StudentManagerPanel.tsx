import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  Hash,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserPlus
} from 'lucide-react';
import {
  autoDetectColumnMapping,
  ColumnMapping,
  downloadStudentTemplate,
  mapRowsToStudents,
  ParsedTabularData,
  parsePastedText,
  parseSpreadsheetFile
} from '../core/dataImport';
import {
  findDuplicateRollNumbers,
  generateRollNumberRange,
  normalizeRollNumber
} from '../core/rollNumberEngine';
import { StudentRecord } from '../core/types';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { uploadFileToFirebaseStorage } from '../firebase/service';
import { AiDataScanResponse, runAiDataScanner } from '../services/aiAgents';

interface Props {
  students: StudentRecord[];
  onChange: (students: StudentRecord[]) => void;
  rollRangeStart?: string;
  rollRangeEnd?: string;
  onRangeMetaChange?: (start: string, end: string) => void;
}

export function StudentManagerPanel({
  students,
  onChange,
  rollRangeStart = '',
  rollRangeEnd = '',
  onRangeMetaChange
}: Props) {
  const { institution } = useAuth();
  const { aiAssistantEnabled } = useWorkspace();

  const [tab, setTab] = useState<'range' | 'upload' | 'manual' | 'paste'>('range');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Option A: Roll Range
  const [startRoll, setStartRoll] = useState(rollRangeStart);
  const [endRoll, setEndRoll] = useState(rollRangeEnd);

  useEffect(() => {
    setStartRoll(rollRangeStart);
    setEndRoll(rollRangeEnd);
  }, [rollRangeStart, rollRangeEnd]);

  // Option B: Upload CSV/XLSX
  const [parsedUpload, setParsedUpload] = useState<ParsedTabularData | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({ rollNumber: '' });
  const [aiScanResult, setAiScanResult] = useState<AiDataScanResponse | null>(null);
  const [aiScanning, setAiScanning] = useState(false);

  // Option C: Manual Entry
  const [manualRoll, setManualRoll] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualClass, setManualClass] = useState('');
  const [manualSection, setManualSection] = useState('');

  // Option D: Paste Data
  const [pasteText, setPasteText] = useState('');
  const [parsedPaste, setParsedPaste] = useState<ParsedTabularData | null>(null);
  const [pasteMapping, setPasteMapping] = useState<ColumnMapping>({ rollNumber: '' });

  // Preview search
  const [searchQuery, setSearchQuery] = useState('');

  const duplicates = useMemo(() => findDuplicateRollNumbers(students), [students]);
  const uniqueRollCount = useMemo(
    () => new Set(students.map((s) => normalizeRollNumber(s.rollNumber)).filter(Boolean)).size,
    [students]
  );
  const invalidRollsCount = useMemo(
    () => students.filter((s) => !normalizeRollNumber(s.rollNumber)).length,
    [students]
  );
  const missingNamesCount = useMemo(
    () => students.filter((s) => !s.name || s.name.trim().length === 0).length,
    [students]
  );

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.rollNumber.toLowerCase().includes(q) ||
        (s.name ?? '').toLowerCase().includes(q) ||
        (s.className ?? '').toLowerCase().includes(q) ||
        (s.section ?? '').toLowerCase().includes(q)
    );
  }, [students, searchQuery]);

  const handleGenerateRange = (mode: 'replace' | 'append') => {
    setErrorMsg(null);
    setInfoMsg(null);
    const res = generateRollNumberRange(startRoll, endRoll);
    if (res.error) {
      setErrorMsg(res.error);
      return;
    }
    if (mode === 'replace') {
      onRangeMetaChange?.(startRoll.trim(), endRoll.trim());
      onChange(res.students);
      setInfoMsg(`Generated ${res.students.length} roll numbers (${res.students[0]?.rollNumber} to ${res.students[res.students.length - 1]?.rollNumber}).`);
    } else {
      onRangeMetaChange?.('', '');
      const offset = students.length;
      const appended = res.students.map((s, i) => ({
        ...s,
        id: `stu_${Date.now()}_${i}`,
        originalIndex: offset + i
      }));
      onChange([...students, ...appended]);
      setInfoMsg(`Appended ${appended.length} roll numbers to the student list.`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setAiScanResult(null);

    try {
      const parsed = await parseSpreadsheetFile(file);
      if (parsed.headers.length === 0 || parsed.rows.length === 0) {
        setErrorMsg('No data rows were found in the uploaded file.');
        return;
      }
      setParsedUpload(parsed);
      setMapping(autoDetectColumnMapping(parsed.headers));

      if (institution) {
        uploadFileToFirebaseStorage(institution.id, 'imports', file.name, file);
      }

      if (aiAssistantEnabled) {
        setAiScanning(true);
        runAiDataScanner({
          headers: parsed.headers,
          sampleRows: parsed.rows.slice(0, 12),
          totalRows: parsed.rows.length,
          emptyRowCount: parsed.emptyRowCount
        })
          .then((scan) => setAiScanResult(scan))
          .catch(() => {})
          .finally(() => setAiScanning(false));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed parsing spreadsheet.');
    }
  };

  const handleAcceptUpload = (mode: 'replace' | 'append') => {
    if (!parsedUpload || !mapping.rollNumber) {
      setErrorMsg('Select the Roll Number column before importing.');
      return;
    }
    const baseIdx = mode === 'append' ? students.length : 0;
    const mapped = mapRowsToStudents(parsedUpload.rows, mapping, baseIdx);
    if (mapped.students.length === 0) {
      setErrorMsg('No valid rows with a non-empty Roll Number were found.');
      return;
    }
    // Clear any stale expected range constraint when student records come from uploaded CSV/Excel
    if (onRangeMetaChange) {
      onRangeMetaChange('', '');
    }
    const nextList = mode === 'replace' ? mapped.students : [...students, ...mapped.students];
    onChange(nextList);
    setInfoMsg(
      `Imported ${mapped.students.length} student(s) (${nextList.length} total in roster)${
        mapped.skippedEmptyRollRows > 0 ? ` · ${mapped.skippedEmptyRollRows} empty roll rows skipped` : ''
      }. Using imported student list as source of truth.`
    );
    setParsedUpload(null);
  };

  const handleParsePaste = () => {
    setErrorMsg(null);
    setInfoMsg(null);
    const parsed = parsePastedText(pasteText);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setErrorMsg('Paste a table with a header row and at least one student row (tab or comma separated).');
      return;
    }
    setParsedPaste(parsed);
    setPasteMapping(autoDetectColumnMapping(parsed.headers));
  };

  const handleAcceptPaste = (mode: 'replace' | 'append') => {
    if (!parsedPaste || !pasteMapping.rollNumber) {
      setErrorMsg('Select the Roll Number column.');
      return;
    }
    const baseIdx = mode === 'append' ? students.length : 0;
    const mapped = mapRowsToStudents(parsedPaste.rows, pasteMapping, baseIdx);
    if (mapped.students.length === 0) {
      setErrorMsg('No valid student rows found.');
      return;
    }
    if (onRangeMetaChange) {
      onRangeMetaChange('', '');
    }
    onChange(mode === 'replace' ? mapped.students : [...students, ...mapped.students]);
    setInfoMsg(`Imported ${mapped.students.length} pasted student record(s). Using student list as source of truth.`);
    setParsedPaste(null);
    setPasteText('');
  };

  const handleAddManual = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const roll = normalizeRollNumber(manualRoll);
    if (!roll) {
      setErrorMsg('Roll Number is required.');
      return;
    }
    if (onRangeMetaChange) {
      onRangeMetaChange('', '');
    }
    const newRecord: StudentRecord = {
      id: `stu_m_${Date.now()}_${students.length + 1}`,
      rollNumber: roll,
      ...(manualName.trim() ? { name: manualName.trim() } : {}),
      ...(manualClass.trim() ? { className: manualClass.trim() } : {}),
      ...(manualSection.trim() ? { section: manualSection.trim() } : {}),
      originalIndex: students.length
    };
    onChange([...students, newRecord]);
    setManualRoll('');
    setManualName('');
    setInfoMsg(`Added student Roll No. ${roll}.`);
  };

  return (
    <div className="space-y-6">
      {/* Input Method Selector */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
        <button
          type="button"
          onClick={() => setTab('range')}
          className={`inline-flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'range' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Hash className="w-4 h-4" />
          Roll Number Range
        </button>
        <button
          type="button"
          onClick={() => setTab('upload')}
          className={`inline-flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'upload' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Upload CSV / Excel
        </button>
        <button
          type="button"
          onClick={() => setTab('manual')}
          className={`inline-flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'manual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <UserPlus className="w-4 h-4" />
          Manual Entry
        </button>
        <button
          type="button"
          onClick={() => setTab('paste')}
          className={`inline-flex items-center gap-2 px-3 py-2 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
            tab === 'paste' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ClipboardPaste className="w-4 h-4" />
          Paste Excel Data
        </button>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {infoMsg && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
          <span>{infoMsg}</span>
        </div>
      )}

      {/* Option A: Roll Number Range */}
      {tab === 'range' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Generate Sequential Roll Numbers</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Supports numeric (1 to 50), zero-padded (001 to 050), and alphanumeric prefixes (BCA2026001 to BCA2026050). Leading zeros are strictly preserved.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Starting Roll Number *
              </label>
              <input
                type="text"
                value={startRoll}
                onChange={(e) => setStartRoll(e.target.value)}
                placeholder="e.g. 1, 001, BCA2026001"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Ending Roll Number *
              </label>
              <input
                type="text"
                value={endRoll}
                onChange={(e) => setEndRoll(e.target.value)}
                placeholder="e.g. 50, 050, BCA2026050"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleGenerateRange('replace')}
              className="px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Generate & Set Roll List
            </button>
            {students.length > 0 && (
              <button
                type="button"
                onClick={() => handleGenerateRange('append')}
                className="px-4 py-2 text-xs sm:text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Append to Existing List
              </button>
            )}
          </div>
        </div>
      )}

      {/* Option B: Upload CSV/XLSX */}
      {tab === 'upload' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Upload Student Spreadsheet</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Accepts .csv, .xlsx, and .xls files. Student names are optional — missing names are processed cleanly as "Name Not Provided".
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => downloadStudentTemplate('xlsx')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
              >
                <Download className="w-3.5 h-3.5" />
                Excel Template
              </button>
              <button
                type="button"
                onClick={() => downloadStudentTemplate('csv')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
              >
                <Download className="w-3.5 h-3.5" />
                CSV Template
              </button>
            </div>
          </div>

          <label className="block border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-white hover:border-blue-500 transition-colors cursor-pointer">
            <FileSpreadsheet className="w-7 h-7 text-slate-400 mx-auto mb-2" />
            <div className="text-sm font-medium text-slate-800">
              Choose CSV or Excel file to upload
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Max 10 MB · Preserves leading zeros and alphanumeric roll numbers
            </div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {aiScanning && (
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              Agent 1 (AI Data Scanner) is inspecting column headers and roll number formats...
            </div>
          )}

          {aiScanResult && (
            <div className="p-4 rounded-lg bg-white border border-blue-200 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-blue-900">
                <Bot className="w-4 h-4 text-blue-600" />
                Agent 1: AI Data Scanner Report
              </div>
              {aiScanResult.summary && (
                <p className="text-xs text-slate-700 leading-relaxed">{aiScanResult.summary}</p>
              )}
              {aiScanResult.findings && aiScanResult.findings.length > 0 && (
                <ul className="space-y-1 text-xs text-slate-600 list-disc pl-4">
                  {aiScanResult.findings.map((f, i) => (
                    <li key={i}>
                      <span className="font-medium text-slate-800">{f.title}:</span> {f.recommendation}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {parsedUpload && (
            <ColumnMapperPreview
              parsed={parsedUpload}
              mapping={mapping}
              onMappingChange={setMapping}
              onReplace={() => handleAcceptUpload('replace')}
              onAppend={() => handleAcceptUpload('append')}
              hasExisting={students.length > 0}
            />
          )}
        </div>
      )}

      {/* Option C: Manual Entry */}
      {tab === 'manual' && (
        <form onSubmit={handleAddManual} className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Add Individual Student</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Only Roll Number is mandatory. Student Name, Class, and Section are optional.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Roll Number *</label>
              <input
                type="text"
                required
                value={manualRoll}
                onChange={(e) => setManualRoll(e.target.value)}
                placeholder="e.g. 00015"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Student Name (Optional)</label>
              <input
                type="text"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                placeholder="Leave blank if unavailable"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Class / Course (Optional)</label>
              <input
                type="text"
                value={manualClass}
                onChange={(e) => setManualClass(e.target.value)}
                placeholder="e.g. BCA Sem 4"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Section (Optional)</label>
              <input
                type="text"
                value={manualSection}
                onChange={(e) => setManualSection(e.target.value)}
                placeholder="e.g. A"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <button
            type="submit"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Student
          </button>
        </form>
      )}

      {/* Option D: Paste Data */}
      {tab === 'paste' && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Paste from Excel or Table</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Copy rows (including header row) directly from Excel, Google Sheets, or a CSV table and paste below.
            </p>
          </div>
          <textarea
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'Roll Number\tStudent Name\tSection\n001\tAarav Sharma\tA\n002\t\tB'}
            className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
          <button
            type="button"
            onClick={handleParsePaste}
            className="px-4 py-2 text-xs sm:text-sm font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg"
          >
            Parse & Preview Pasted Data
          </button>

          {parsedPaste && (
            <ColumnMapperPreview
              parsed={parsedPaste}
              mapping={pasteMapping}
              onMappingChange={setPasteMapping}
              onReplace={() => handleAcceptPaste('replace')}
              onAppend={() => handleAcceptPaste('append')}
              hasExisting={students.length > 0}
            />
          )}
        </div>
      )}

      {/* Active Student Roster & Validation Warnings */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <span className="text-sm font-semibold text-slate-900 font-display">
                Registered Students ({students.length.toLocaleString()})
              </span>
              <span className="font-mono text-slate-600 tabular-nums">
                · Unique: {uniqueRollCount.toLocaleString()}
              </span>
              <span
                className={`font-mono tabular-nums ${
                  duplicates.length > 0 ? 'text-red-700 font-semibold' : 'text-slate-600'
                }`}
              >
                · Duplicates: {duplicates.length}
              </span>
              <span
                className={`font-mono tabular-nums ${
                  invalidRollsCount > 0 ? 'text-red-700 font-semibold' : 'text-slate-600'
                }`}
              >
                · Invalid: {invalidRollsCount}
              </span>
              {missingNamesCount > 0 && (
                <span className="text-amber-700 font-medium tabular-nums">
                  · {missingNamesCount} without name (allowed — shown as "Name Not Provided")
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-2">
              {rollRangeStart.trim() && rollRangeEnd.trim() ? (
                <>
                  <span>
                    Expected count locked to explicit roll range{' '}
                    <strong className="font-mono text-slate-700">
                      {rollRangeStart.trim()}–{rollRangeEnd.trim()}
                    </strong>
                  </span>
                  {onRangeMetaChange && (
                    <button
                      type="button"
                      onClick={() => onRangeMetaChange('', '')}
                      className="text-blue-600 hover:underline font-medium"
                    >
                      Clear Range Validation
                    </button>
                  )}
                </>
              ) : (
                <span>
                  Expected student count:{' '}
                  <strong className="font-mono text-slate-700">{students.length.toLocaleString()}</strong>{' '}
                  (student list used as source of truth)
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search roll or name..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            {students.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  onRangeMetaChange?.('', '');
                  onChange([]);
                }}
                className="px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 border border-red-200 rounded-lg"
              >
                Clear All
              </button>
            )}
          </div>
        </div>

        {duplicates.length > 0 && (
          <div className="px-5 py-2.5 bg-red-50 border-b border-red-200 text-xs text-red-800">
            <strong>Critical Data Error:</strong> Duplicate roll numbers found ({duplicates.slice(0, 8).join(', ')}). Remove duplicates before generating a verified seating plan.
          </div>
        )}

        {students.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            No students added yet. Use Roll Number Range, CSV/Excel Upload, Manual Entry, or Paste Data above.
          </div>
        ) : (
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2 px-4 font-medium w-14">#</th>
                  <th className="py-2 px-4 font-medium">Roll Number</th>
                  <th className="py-2 px-4 font-medium">Student Name</th>
                  <th className="py-2 px-4 font-medium">Class / Course</th>
                  <th className="py-2 px-4 font-medium">Section</th>
                  <th className="py-2 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredStudents.slice(0, 250).map((stu, idx) => {
                  const isDup = duplicates.includes(stu.rollNumber);
                  return (
                    <tr
                      key={stu.id}
                      className={`border-b border-slate-100 last:border-0 ${
                        isDup ? 'bg-red-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-2 px-4 font-mono tabular-nums text-slate-400">{idx + 1}</td>
                      <td className="py-2 px-4 font-mono font-semibold text-slate-900">
                        {stu.rollNumber}
                      </td>
                      <td className="py-2 px-4 text-slate-700">
                        {stu.name && stu.name.trim().length > 0 ? (
                          stu.name
                        ) : (
                          <span className="text-slate-400 italic">Name Not Provided</span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-slate-600">
                        {[stu.className, stu.course].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="py-2 px-4 text-slate-600">{stu.section || '—'}</td>
                      <td className="py-2 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            onRangeMetaChange?.('', '');
                            onChange(
                              students
                                .filter((s) => s.id !== stu.id)
                                .map((s, i) => ({ ...s, originalIndex: i }))
                            );
                          }}
                          className="p-1 text-slate-400 hover:text-red-600 rounded"
                          aria-label={`Remove ${stu.rollNumber}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredStudents.length > 250 && (
              <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-xs text-slate-500">
                Showing first 250 of {filteredStudents.length.toLocaleString()} records. Search above to locate specific roll numbers.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnMapperPreview({
  parsed,
  mapping,
  onMappingChange,
  onReplace,
  onAppend,
  hasExisting
}: {
  parsed: ParsedTabularData;
  mapping: ColumnMapping;
  onMappingChange: (m: ColumnMapping) => void;
  onReplace: () => void;
  onAppend: () => void;
  hasExisting: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-slate-900">
          Column Mapping & Preview ({parsed.rows.length} rows detected)
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div>
          <label className="block text-[11px] font-medium text-slate-700 mb-1">Roll Number *</label>
          <select
            value={mapping.rollNumber}
            onChange={(e) => onMappingChange({ ...mapping, rollNumber: e.target.value })}
            className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-white"
          >
            {parsed.headers.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </div>

        {[
          { key: 'name', label: 'Student Name' },
          { key: 'className', label: 'Class' },
          { key: 'course', label: 'Course' },
          { key: 'section', label: 'Section' },
          { key: 'subject', label: 'Subject' }
        ].map((field) => (
          <div key={field.key}>
            <label className="block text-[11px] font-medium text-slate-600 mb-1">{field.label}</label>
            <select
              value={(mapping as unknown as Record<string, string | undefined>)[field.key] ?? ''}
              onChange={(e) =>
                onMappingChange({
                  ...mapping,
                  [field.key]: e.target.value || undefined
                })
              }
              className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-white"
            >
              <option value="">(Not mapped)</option>
              {parsed.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {parsed.headers.slice(0, 6).map((h) => (
                <th key={h} className="py-1.5 px-3 font-medium text-slate-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {parsed.rows.slice(0, 5).map((r, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                {parsed.headers.slice(0, 6).map((h) => (
                  <td key={h} className="py-1.5 px-3 font-mono text-slate-800">
                    {r[h] || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onReplace}
          className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
        >
          Accept & Import {parsed.rows.length} Rows
        </button>
        {hasExisting && (
          <button
            type="button"
            onClick={onAppend}
            className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
          >
            Append to Current List
          </button>
        )}
      </div>
    </div>
  );
}
