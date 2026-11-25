import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, Download, FileSpreadsheet, FileText, Printer, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import {
  downloadSeatingPlanPdf,
  exportAllocationsToCsv,
  PdfOrientation
} from '../core/pdfGenerator';

export function PdfReportsPage() {
  const { institution } = useAuth();
  const { activeExam, activePlan, roomAllocations, currentAllocation, currentAuditReport } =
    useWorkspace();
  const navigate = useNavigate();

  const [orientation, setOrientation] = useState<PdfOrientation>(
    activeExam?.seatingMode === 2 ? 'landscape' : 'portrait'
  );
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');

  if (!activeExam || !activePlan || !currentAuditReport || !currentAllocation) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <h2 className="font-display text-lg font-bold text-slate-900">
          No Seating Plan Available for Export
        </h2>
        <p className="text-sm text-slate-500 mt-1 mb-5">
          Generate a verified seating plan first to download Classroom-Wise PDFs, Print Sheets, and CSV Reports.
        </p>
        <button
          type="button"
          onClick={() => navigate('/planner')}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          Open Seating Planner
        </button>
      </div>
    );
  }

  const isVerified = currentAuditReport.status === 'VERIFIED';

  const triggerPdf = (format: 'classroom_wise' | 'print_sheet', roomOnly?: string) => {
    if (!institution || currentAuditReport.status !== 'VERIFIED') return;
    downloadSeatingPlanPdf({
      institution,
      exam: activeExam,
      roomAllocations,
      auditReport: currentAuditReport,
      seatingMode: activePlan.seatingMode,
      format,
      orientation,
      classroomIdFilter: roomOnly || undefined
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            PDF Reports & Institutional Exports
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {activeExam.name} · Plan v{activePlan.version} · Audit Status:{' '}
            <strong className={isVerified ? 'text-emerald-700' : 'text-red-700'}>
              {currentAuditReport.status}
            </strong>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            aria-label="PDF Page Orientation"
            value={orientation}
            onChange={(e) => setOrientation(e.target.value as PdfOrientation)}
            className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white"
          >
            <option value="portrait">A4 Portrait</option>
            <option value="landscape">A4 Landscape</option>
          </select>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <Printer className="w-4 h-4" />
            Print Current View
          </button>
        </div>
      </div>

      {!isVerified && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <div>
            <strong>PDF Exports Blocked:</strong> Seating Allocation Audit is <code>FAILED</code>. Fix the detected errors in the Seating Planner before generating official PDF reports.
          </div>
        </div>
      )}

      {/* Report Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Format A: Classroom-Wise Seating Plan PDF
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Multi-page master examination seating plan containing institution details, exam metadata, every classroom, row, bench, roll number, audit verification summary, and coordinator signature blocks.
            </p>
          </div>
          <button
            type="button"
            disabled={!isVerified}
            onClick={() => triggerPdf('classroom_wise')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg disabled:opacity-45"
          >
            <Download className="w-4 h-4" />
            Download All Classrooms PDF
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Format B: Individual Classroom Print Sheets
            </h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Generates one dedicated printable sheet per classroom for notice boards and room invigilators, with clean black-and-white table contrast and invigilator signature lines.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!isVerified}
              onClick={() => triggerPdf('print_sheet')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-45"
            >
              <Download className="w-4 h-4" />
              Download All Room Sheets
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Individual Classroom PDF
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Export a single classroom's printable sheet by selecting the room below.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedRoomId || roomAllocations[0]?.classroomId || ''}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white"
            >
              {roomAllocations.map((r) => (
                <option key={r.classroomId} value={r.classroomId}>
                  {r.classroomName} (Room {r.roomNumber})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!isVerified}
              onClick={() =>
                triggerPdf('print_sheet', selectedRoomId || roomAllocations[0]?.classroomId)
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg disabled:opacity-45"
            >
              <Download className="w-3.5 h-3.5" />
              Download Room PDF
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">
              Student Allocation & Capacity CSV
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Exports the complete roll-number-wise allocation list alongside the classroom capacity breakdown for Excel or institutional archives.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              exportAllocationsToCsv(activeExam, currentAllocation.lookupIndex, roomAllocations)
            }
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Full CSV Report
          </button>
        </div>
      </div>

      {/* Classroom Capacity Report Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-display text-sm font-bold text-slate-900">
            Classroom Capacity & Allocation Summary
          </h3>
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
            <ShieldCheck className="w-4 h-4" />
            {currentAuditReport.status}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <th className="py-2.5 px-4 font-medium">Classroom</th>
                <th className="py-2.5 px-4 font-medium">Room No.</th>
                <th className="py-2.5 px-4 font-medium text-right">Rows</th>
                <th className="py-2.5 px-4 font-medium text-right">Active Benches</th>
                <th className="py-2.5 px-4 font-medium text-right">Total Seats</th>
                <th className="py-2.5 px-4 font-medium text-right">Allocated</th>
                <th className="py-2.5 px-4 font-medium text-right">Unused</th>
              </tr>
            </thead>
            <tbody>
              {roomAllocations.map((r) => (
                <tr key={r.classroomId} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 px-4 font-medium text-slate-900">{r.classroomName}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-600">{r.roomNumber}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{r.rows.length}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{r.activeBenches}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums">{r.capacity}</td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {r.allocatedCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                    {r.unusedSeats}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
