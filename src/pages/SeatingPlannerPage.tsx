import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { calculateTotalCapacity } from '../core/classroomEngine';
import {
  downloadSeatingPlanPdf,
  exportAllocationsToCsv,
  PdfOrientation
} from '../core/pdfGenerator';
import {
  AllocationStrategy,
  SeatingMode,
  SortOrder,
  StudentSeatLookup
} from '../core/types';
import { AiOrchestratorResponse, runAiOrchestratedAudit } from '../services/aiAgents';

export function SeatingPlannerPage() {
  const { institution } = useAuth();
  const {
    activeExam,
    students,
    classrooms,
    activePlan,
    roomAllocations,
    currentAllocation,
    currentAuditReport,
    savingWorkspace,
    aiAssistantEnabled,
    runAndSaveSeatingPlan
  } = useWorkspace();
  const navigate = useNavigate();

  const [seatingMode, setSeatingMode] = useState<SeatingMode>(activeExam?.seatingMode ?? 1);
  const [strategy, setStrategy] = useState<AllocationStrategy>(activeExam?.strategy ?? 'sequential');
  const [sortOrder, setSortOrder] = useState<SortOrder>(activeExam?.sortOrder ?? 'original');
  const [selectedRoomId, setSelectedRoomId] = useState<string>('ALL');
  const [viewLayout, setViewLayout] = useState<'classroom' | 'row'>('classroom');
  const [searchQuery, setSearchQuery] = useState('');
  const [pdfOrientation, setPdfOrientation] = useState<PdfOrientation>('portrait');
  const [actionError, setActionError] = useState<string | null>(null);

  // AI Agentic Orchestrator state
  const [aiInsights, setAiInsights] = useState<AiOrchestratorResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);

  useEffect(() => {
    if (activeExam) {
      setSeatingMode(activeExam.seatingMode);
      setStrategy(activeExam.strategy);
      setSortOrder(activeExam.sortOrder);
      setPdfOrientation(activeExam.seatingMode === 2 ? 'landscape' : 'portrait');
    }
  }, [activeExam?.id]);

  useEffect(() => {
    if (roomAllocations.length > 0 && selectedRoomId !== 'ALL') {
      const exists = roomAllocations.some((r) => r.classroomId === selectedRoomId);
      if (!exists) setSelectedRoomId('ALL');
    }
  }, [roomAllocations, selectedRoomId]);

  const capacitySummary = useMemo(
    () => calculateTotalCapacity(classrooms, seatingMode),
    [classrooms, seatingMode]
  );

  const lookupMatches = useMemo<StudentSeatLookup[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !currentAllocation) return [];
    return currentAllocation.lookupIndex.filter(
      (item) =>
        item.rollNumber.toLowerCase().includes(q) ||
        item.studentName.toLowerCase().includes(q) ||
        item.classroomName.toLowerCase().includes(q) ||
        item.roomNumber.toLowerCase().includes(q) ||
        item.rowLabel.toLowerCase().includes(q) ||
        item.benchLabel.toLowerCase().includes(q)
    );
  }, [searchQuery, currentAllocation]);

  const visibleRooms = useMemo(() => {
    if (selectedRoomId === 'ALL') return roomAllocations;
    return roomAllocations.filter((r) => r.classroomId === selectedRoomId);
  }, [roomAllocations, selectedRoomId]);

  if (!activeExam) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <h2 className="font-display text-lg font-bold text-slate-900">No Examination Selected</h2>
        <p className="text-sm text-slate-500 mt-1 mb-5">
          Create an examination or open one from History to generate and preview its seating plan.
        </p>
        <button
          type="button"
          onClick={() => navigate('/create-exam')}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          Create Examination
        </button>
      </div>
    );
  }

  const handleRegenerate = async () => {
    setActionError(null);
    setAiInsights(null);
    setAiError(null);

    if (students.length === 0) {
      setActionError('Cannot generate plan: no students are registered for this examination.');
      return;
    }
    if (classrooms.length === 0) {
      setActionError('Cannot generate plan: no classrooms are configured.');
      return;
    }

    try {
      const res = await runAndSaveSeatingPlan({
        examId: activeExam.id,
        students,
        classrooms,
        seatingMode,
        strategy,
        sortOrder
      });

      if (aiAssistantEnabled) {
        triggerAiOrchestrator(res.auditReport);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to generate seating plan.');
    }
  };

  const triggerAiOrchestrator = async (auditToAnalyze = currentAuditReport) => {
    if (!auditToAnalyze || !activeExam) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const maxRollLength = students.reduce((m, s) => Math.max(m, s.rollNumber.length), 0);
      const missingNamesCount = students.filter((s) => !s.name || !s.name.trim()).length;
      const result = await runAiOrchestratedAudit({
        examMeta: {
          name: activeExam.name,
          examDate: activeExam.examDate,
          seatingMode,
          strategy
        },
        capacitySummary,
        auditReport: auditToAnalyze,
        pdfPreviewMeta: {
          maxRollLength,
          missingNamesCount,
          classroomCount: classrooms.length
        },
        rollSample: students.slice(0, 8).map((s) => s.rollNumber)
      });
      setAiInsights(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI Orchestrator unavailable.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleDownloadPdf = (format: 'classroom_wise' | 'print_sheet', roomOnlyId?: string) => {
    if (
      !institution ||
      !currentAuditReport ||
      currentAuditReport.status !== 'VERIFIED' ||
      roomAllocations.length === 0
    ) {
      return;
    }
    downloadSeatingPlanPdf({
      institution,
      exam: activeExam,
      roomAllocations,
      auditReport: currentAuditReport,
      seatingMode,
      format,
      orientation: pdfOrientation,
      classroomIdFilter: roomOnlyId
    });
  };

  const handleExportCsv = () => {
    if (!currentAllocation) return;
    exportAllocationsToCsv(activeExam, currentAllocation.lookupIndex, roomAllocations);
  };

  const sufficientCapacity = students.length <= capacitySummary.totalCapacity;
  const isVerified = currentAuditReport?.status === 'VERIFIED';

  return (
    <div className="space-y-6">
      {/* Configuration & Generation Bar */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 no-print">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="text-xs text-slate-500">
              {activeExam.examType} · {activeExam.examDate} · {activeExam.academicYear}
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900 mt-0.5">
              {activeExam.name}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              aria-label="Seating Mode"
              value={seatingMode}
              onChange={(e) => setSeatingMode(Number(e.target.value) as SeatingMode)}
              className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white"
            >
              <option value={1}>1 Student / Bench</option>
              <option value={2}>2 Students / Bench</option>
            </select>

            <select
              aria-label="Allocation Strategy"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as AllocationStrategy)}
              className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white"
            >
              <option value="sequential">Sequential Allocation</option>
              <option value="alternate">Alternate Roll Numbers</option>
              <option value="section_separation">Course / Section Separation</option>
              <option value="custom">Custom Staggered</option>
            </select>

            <select
              aria-label="Sort Order"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white"
            >
              <option value="original">Original Input Order</option>
              <option value="ascending">Ascending Roll Number</option>
              <option value="custom">Custom Order</option>
            </select>

            <button
              type="button"
              disabled={savingWorkspace}
              onClick={handleRegenerate}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs sm:text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 whitespace-nowrap"
            >
              {savingWorkspace ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {activePlan ? 'Regenerate & Save New Version' : 'Generate Seating Plan'}
            </button>
          </div>
        </div>

        {!sufficientCapacity && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
              <span>
                Insufficient seating capacity. You have {students.length} students but only{' '}
                {capacitySummary.totalCapacity} available seats.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {seatingMode === 1 && students.length <= capacitySummary.activeBenches * 2 && (
                <button
                  type="button"
                  onClick={() => setSeatingMode(2)}
                  className="px-2.5 py-1.5 bg-white border border-red-300 rounded font-medium text-red-800 hover:bg-red-100"
                >
                  Use 2 Students/Bench
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate('/classrooms')}
                className="px-2.5 py-1.5 bg-white border border-red-300 rounded font-medium text-red-800 hover:bg-red-100"
              >
                Increase Classrooms
              </button>
            </div>
          </div>
        )}

        {actionError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
            {actionError}
          </div>
        )}
      </section>

      {/* Audit & Verification Summary */}
      {currentAuditReport ? (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 no-print">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              {isVerified ? (
                <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
              ) : (
                <XCircle className="w-6 h-6 text-red-600 shrink-0" />
              )}
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-base font-bold text-slate-900">
                    Seating Allocation Audit:
                  </h3>
                  <span
                    className={`font-mono text-sm font-bold ${
                      isVerified ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {currentAuditReport.status}
                  </span>
                  {activePlan && (
                    <span className="text-xs text-slate-500 font-mono">
                      · Plan Version v{activePlan.version}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verified deterministically across all {currentAuditReport.checklist.length} safety & roll-number integrity checks.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowChecklist((v) => !v)}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                {showChecklist ? 'Hide 15-Point Checklist' : 'Inspect Audit Checklist'}
              </button>
              {aiAssistantEnabled && (
                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={() => triggerAiOrchestrator()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-60"
                >
                  {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
                  Run AI Agent Review
                </button>
              )}
            </div>
          </div>

          {/* Audit Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
            <StatMini label="Total Students" value={currentAuditReport.totalStudents} />
            <StatMini label="Allocated" value={currentAuditReport.allocatedStudents} />
            <StatMini
              label="Unallocated"
              value={currentAuditReport.unallocatedStudents}
              alert={currentAuditReport.unallocatedStudents > 0}
            />
            <StatMini
              label="Duplicates"
              value={currentAuditReport.duplicateAssignments}
              alert={currentAuditReport.duplicateAssignments > 0}
            />
            <StatMini
              label="Missing"
              value={currentAuditReport.missingStudents}
              alert={currentAuditReport.missingStudents > 0}
            />
            <StatMini label="Total Capacity" value={currentAuditReport.totalCapacity} />
            <StatMini label="Unused Seats" value={currentAuditReport.unusedSeats} />
          </div>

          {/* Warnings / Critical Issues */}
          {currentAuditReport.issues.length > 0 && (
            <div className="space-y-2">
              {currentAuditReport.issues.map((issue) => (
                <div
                  key={issue.id}
                  className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${
                    issue.severity === 'critical'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : 'bg-amber-50 border-amber-200 text-amber-900'
                  }`}
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">
                      [{issue.severity.toUpperCase()} · {issue.agent}]
                    </span>{' '}
                    {issue.message}
                    {issue.details && <div className="opacity-85 mt-0.5">{issue.details}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Expandable Checklist */}
          {showChecklist && (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {currentAuditReport.checklist.map((item) => (
                <div key={item.key} className="px-4 py-2.5 flex items-start justify-between gap-4 text-xs">
                  <div className="flex items-start gap-2">
                    {item.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <div className="font-medium text-slate-900">{item.label}</div>
                      <div className="text-slate-500 mt-0.5">{item.details}</div>
                    </div>
                  </div>
                  <span
                    className={`font-mono font-semibold shrink-0 ${
                      item.passed ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {item.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* AI Multi-Agent Insights */}
          {aiError && (
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
              AI Orchestrator note: {aiError}
            </div>
          )}
          {aiInsights && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                <Bot className="w-4 h-4 text-blue-600" />
                AI Multi-Agent Orchestrator Analysis (Agents 2–6 Advisory)
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">{aiInsights.orchestratorSummary}</p>
              <div className="grid sm:grid-cols-2 gap-3 text-xs pt-1">
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <div className="font-semibold text-slate-800">Agent 2 & 3 · Validation & Capacity</div>
                  <div className="text-slate-600 mt-1">{aiInsights.dataValidationNote} {aiInsights.capacityAdvice}</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-lg p-3">
                  <div className="font-semibold text-slate-800">Agent 4 & 5 · Audit & PDF Quality</div>
                  <div className="text-slate-600 mt-1">{aiInsights.seatingAuditNote} {aiInsights.pdfQualityCheck}</div>
                </div>
              </div>
              {aiInsights.recommendedActions?.length > 0 && (
                <ul className="text-xs text-slate-700 list-disc pl-5 space-y-0.5">
                  {aiInsights.recommendedActions.map((act, idx) => (
                    <li key={idx}>{act}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl p-8 text-center no-print">
          <p className="text-sm font-semibold text-slate-900">
            No seating plan generated for this examination yet
          </p>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            Click "Generate Seating Plan" above to allocate {students.length} students across {classrooms.length} classroom(s).
          </p>
        </section>
      )}

      {/* Export, Print & Search Toolbar */}
      {roomAllocations.length > 0 && currentAuditReport && (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 no-print">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Search Student Lookup */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Roll No., Name, Classroom, Row, or Bench..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            {/* PDF / CSV / Print Action Group */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="PDF Orientation"
                value={pdfOrientation}
                onChange={(e) => setPdfOrientation(e.target.value as PdfOrientation)}
                className="px-2.5 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white"
              >
                <option value="portrait">Portrait PDF</option>
                <option value="landscape">Landscape PDF</option>
              </select>

              <button
                type="button"
                disabled={!isVerified}
                onClick={() => handleDownloadPdf('classroom_wise')}
                title={!isVerified ? 'Resolve critical audit errors before exporting verified PDF' : ''}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg disabled:opacity-45"
              >
                <Download className="w-3.5 h-3.5" />
                Download All Classrooms PDF
              </button>

              <button
                type="button"
                disabled={!isVerified}
                onClick={() => handleDownloadPdf('print_sheet')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-45"
              >
                <Download className="w-3.5 h-3.5" />
                Classroom Print Sheets PDF
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Export CSV
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </button>
            </div>
          </div>

          {!isVerified && (
            <div className="text-xs text-red-700">
              Verified PDF exports are locked until all critical audit checks pass (Audit Status must be VERIFIED).
            </div>
          )}

          {/* Student Lookup Results */}
          {searchQuery.trim().length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                Search Results ({lookupMatches.length})
              </div>
              {lookupMatches.length === 0 ? (
                <div className="text-xs text-slate-500">
                  No allocated seat matched "{searchQuery}".
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto">
                  {lookupMatches.slice(0, 30).map((m) => (
                    <div
                      key={`${m.rollNumber}_${m.seatNumber}`}
                      className="bg-white border border-slate-200 rounded-lg p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-slate-900">
                          Roll No. {m.rollNumber}
                        </span>
                        <span className="font-mono text-blue-700 font-semibold">
                          Seat {m.seatNumber}
                        </span>
                      </div>
                      <div className="text-slate-700">Name: {m.studentName}</div>
                      <div className="text-slate-500 font-mono">
                        {m.classroomName} · {m.rowLabel} · {m.benchLabel}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Interactive Seating Plan Preview */}
      {roomAllocations.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-base font-bold text-slate-900">
                Interactive Seating Layout Preview
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter Classroom"
                value={selectedRoomId}
                onChange={(e) => setSelectedRoomId(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white"
              >
                <option value="ALL">All Classrooms ({roomAllocations.length})</option>
                {roomAllocations.map((r) => (
                  <option key={r.classroomId} value={r.classroomId}>
                    {r.classroomName} ({r.allocatedCount}/{r.capacity})
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                <button
                  type="button"
                  onClick={() => setViewLayout('classroom')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                    viewLayout === 'classroom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Classroom Grid
                </button>
                <button
                  type="button"
                  onClick={() => setViewLayout('row')}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md ${
                    viewLayout === 'row' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Row Table
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            {visibleRooms.map((room) => (
              <div
                key={room.classroomId}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden print-page-break"
              >
                <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-display text-sm font-bold text-slate-900 uppercase tracking-wide">
                      {room.classroomName} (Room {room.roomNumber})
                    </div>
                    <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                      Allocated: {room.allocatedCount} / {room.capacity} seats · Unused: {room.unusedSeats}
                      {room.building ? ` · ${room.building}` : ''}
                    </div>
                  </div>
                  {isVerified && (
                    <button
                      type="button"
                      onClick={() => handleDownloadPdf('print_sheet', room.classroomId)}
                      className="no-print inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg self-start sm:self-auto"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Room PDF
                    </button>
                  )}
                </div>

                {viewLayout === 'classroom' ? (
                  <div className="p-5 space-y-5">
                    {room.rows.map((row) => (
                      <div key={row.rowNumber} className="space-y-2.5">
                        <div className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b border-slate-100 pb-1">
                          {row.rowLabel}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5">
                          {row.benches.map((bench) => (
                            <div
                              key={bench.benchNumber}
                              className={`rounded-lg border p-2.5 text-xs ${
                                bench.isDisabled
                                  ? 'bg-slate-100 border-slate-200 text-slate-400'
                                  : bench.seats.some((s) => s.status === 'OCCUPIED')
                                  ? 'bg-white border-slate-200'
                                  : 'bg-slate-50/60 border-slate-200/80'
                              }`}
                            >
                              <div className="text-[11px] font-semibold text-slate-500 mb-1.5">
                                {bench.benchLabel}
                              </div>
                              {bench.isDisabled ? (
                                <div className="font-mono text-[11px] text-slate-400">DISABLED</div>
                              ) : (
                                <div className="space-y-1.5">
                                  {bench.seats.map((seat) => (
                                    <div
                                      key={seat.seatNumber}
                                      className={`${
                                        bench.seats.length > 1 && seat.seatNumber === 1
                                          ? 'pb-1.5 border-b border-slate-100'
                                          : ''
                                      }`}
                                    >
                                      <div className="text-[10px] text-slate-400">
                                        Seat {seat.seatNumber}
                                      </div>
                                      {seat.status === 'OCCUPIED' ? (
                                        <div>
                                          <div className="font-mono font-bold text-slate-900 break-all">
                                            Roll No. {seat.rollNumber}
                                          </div>
                                          <div className="text-[11px] text-slate-600 truncate">
                                            {seat.studentName || 'Name Not Provided'}
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="font-mono text-[11px] text-slate-400">
                                          EMPTY
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                          <th className="py-2 px-4 font-medium">Row</th>
                          <th className="py-2 px-4 font-medium">Bench</th>
                          <th className="py-2 px-4 font-medium">Seat 1 Roll No.</th>
                          <th className="py-2 px-4 font-medium">Seat 1 Name</th>
                          {seatingMode === 2 && (
                            <>
                              <th className="py-2 px-4 font-medium">Seat 2 Roll No.</th>
                              <th className="py-2 px-4 font-medium">Seat 2 Name</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {room.rows.flatMap((row) =>
                          row.benches.map((bench) => {
                            const s1 = bench.seats[0];
                            const s2 = bench.seats[1];
                            return (
                              <tr
                                key={`${row.rowNumber}_${bench.benchNumber}`}
                                className="border-b border-slate-100 last:border-0 hover:bg-slate-50"
                              >
                                <td className="py-2 px-4 font-medium text-slate-700">{row.rowLabel}</td>
                                <td className="py-2 px-4 text-slate-600">{bench.benchLabel}</td>
                                <td className="py-2 px-4 font-mono font-semibold text-slate-900">
                                  {bench.isDisabled
                                    ? 'DISABLED'
                                    : s1?.status === 'OCCUPIED'
                                    ? s1.rollNumber
                                    : 'EMPTY'}
                                </td>
                                <td className="py-2 px-4 text-slate-600">
                                  {bench.isDisabled
                                    ? 'Bench Disabled'
                                    : s1?.status === 'OCCUPIED'
                                    ? s1.studentName || 'Name Not Provided'
                                    : 'EMPTY'}
                                </td>
                                {seatingMode === 2 && (
                                  <>
                                    <td className="py-2 px-4 font-mono font-semibold text-slate-900">
                                      {bench.isDisabled
                                        ? 'DISABLED'
                                        : s2?.status === 'OCCUPIED'
                                        ? s2.rollNumber
                                        : 'EMPTY'}
                                    </td>
                                    <td className="py-2 px-4 text-slate-600">
                                      {bench.isDisabled
                                        ? 'Bench Disabled'
                                        : s2?.status === 'OCCUPIED'
                                        ? s2.studentName || 'Name Not Provided'
                                        : 'EMPTY'}
                                    </td>
                                  </>
                                )}
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatMini({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div
        className={`font-mono text-base font-bold tabular-nums mt-0.5 ${
          alert ? 'text-red-700' : 'text-slate-900'
        }`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
