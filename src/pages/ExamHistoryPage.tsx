import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Copy,
  Edit3,
  Eye,
  Loader2,
  Lock,
  Search,
  Trash2
} from 'lucide-react';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { useSubscription } from '../context/SubscriptionContext';
import { SUBSCRIPTION_PLAN } from '../core/subscriptionConstants';
import { ExamRecord } from '../core/types';

export function ExamHistoryPage() {
  const {
    exams,
    auditLogs,
    selectExam,
    duplicateExam,
    setExamStatus,
    deleteExam,
    saveCurrentExamData,
    students,
    classrooms
  } = useWorkspace();
  const { hasActiveAccess, requireActiveSubscription } = useSubscription();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<'all' | ExamRecord['status']>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDeleteExam, setConfirmDeleteExam] = useState<ExamRecord | null>(null);
  const [editingExam, setEditingExam] = useState<ExamRecord | null>(null);
  const [editName, setEditName] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editSubject, setEditSubject] = useState('');

  const filteredExams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exams.filter((e) => {
      if (filter !== 'all' && e.status !== filter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.examType.toLowerCase().includes(q) ||
        (e.subject ?? '').toLowerCase().includes(q)
      );
    });
  }, [exams, filter, search]);

  const handleOpen = async (id: string) => {
    setBusyId(id);
    try {
      await selectExam(id);
      navigate(hasActiveAccess ? '/planner' : '/plans');
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicate = async (id: string) => {
    if (!requireActiveSubscription('Duplicate Examination')) return;
    setActionError(null);
    setBusyId(id);
    try {
      await duplicateExam(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not duplicate examination.');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteExam) return;
    if (!requireActiveSubscription('Delete Examination')) return;
    setActionError(null);
    setBusyId(confirmDeleteExam.id);
    try {
      await deleteExam(confirmDeleteExam.id, confirmDeleteExam.name);
      setConfirmDeleteExam(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete examination.');
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = async (exam: ExamRecord) => {
    if (!requireActiveSubscription('Edit Examination Details')) return;
    await selectExam(exam.id);
    setEditingExam(exam);
    setEditName(exam.name);
    setEditDate(exam.examDate);
    setEditSubject(exam.subject ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editingExam || !editName.trim()) return;
    setActionError(null);
    setBusyId(editingExam.id);
    try {
      await saveCurrentExamData({
        examMeta: {
          ...editingExam,
          name: editName.trim(),
          examDate: editDate,
          subject: editSubject.trim() || undefined
        },
        students,
        classrooms,
        isNew: false
      });
      setEditingExam(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update examination.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {!hasActiveAccess && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              <strong>Read-Only History Mode:</strong> Your saved examinations and audit records are
              preserved. Subscribe for ₹{SUBSCRIPTION_PLAN.amount} to unlock creating, editing, duplicating, or deleting
              examinations.
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/subscribe')}
            className="px-3.5 py-1.5 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shrink-0"
          >
            Subscribe for ₹{SUBSCRIPTION_PLAN.amount}
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          {(['all', 'verified', 'generated', 'draft', 'archived'] as const).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                filter === status ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {status}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search examinations..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {/* Examinations Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-base font-bold text-slate-900">
            Examinations ({filteredExams.length})
          </h2>
          <button
            type="button"
            onClick={() => {
              if (!requireActiveSubscription('New Examination')) return;
              navigate('/create-exam');
            }}
            className="px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
          >
            New Examination
          </button>
        </div>

        {filteredExams.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No examinations match the selected filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-3 px-4 font-medium">Examination</th>
                  <th className="py-3 px-4 font-medium">Date</th>
                  <th className="py-3 px-4 font-medium text-right">Students</th>
                  <th className="py-3 px-4 font-medium text-right">Rooms</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredExams.map((exam) => (
                  <tr key={exam.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 text-sm">{exam.name}</div>
                      <div className="text-slate-500 mt-0.5">
                        {exam.examType} · {exam.academicYear}
                        {exam.subject ? ` · ${exam.subject}` : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {exam.examDate}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                      {exam.studentCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                      {exam.classroomCount}
                    </td>
                    <td className="py-3 px-4 font-medium capitalize">
                      <span
                        className={
                          exam.status === 'verified'
                            ? 'text-emerald-700'
                            : exam.status === 'archived'
                            ? 'text-slate-400'
                            : 'text-blue-700'
                        }
                      >
                        {exam.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyId === exam.id}
                          onClick={() => handleOpen(exam.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-md"
                        >
                          {busyId === exam.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                          {hasActiveAccess ? 'Open' : 'Inspect Plans'}
                        </button>
                        {exam.status !== 'archived' && (
                          <button
                            type="button"
                            onClick={() => startEdit(exam)}
                            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
                            title="Edit Details"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busyId === exam.id}
                          onClick={() => handleDuplicate(exam.id)}
                          className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
                          title="Duplicate Examination"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={busyId === exam.id}
                          onClick={() => {
                            if (!requireActiveSubscription('Archive / Unarchive Examination')) return;
                            setExamStatus(
                              exam.id,
                              exam.status === 'archived' ? 'draft' : 'archived'
                            );
                          }}
                          className="p-1.5 text-slate-500 hover:text-slate-900 rounded-md hover:bg-slate-100"
                          title={exam.status === 'archived' ? 'Unarchive' : 'Archive'}
                        >
                          {exam.status === 'archived' ? (
                            <ArchiveRestore className="w-3.5 h-3.5" />
                          ) : (
                            <Archive className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === exam.id}
                          onClick={() => {
                            if (!requireActiveSubscription('Delete Examination')) return;
                            setConfirmDeleteExam(exam);
                          }}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded-md hover:bg-red-50"
                          title="Delete Examination"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Audit Trail */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="font-display text-base font-bold text-slate-900">
            Institution Audit Trail
          </h3>
        </div>
        {auditLogs.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">No audit entries recorded yet.</div>
        ) : (
          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="px-5 py-3 flex items-start justify-between gap-4 text-xs">
                <div>
                  <span className="font-mono font-semibold text-slate-800">{log.action}</span>
                  <span className="text-slate-600 ml-2">{log.summary}</span>
                </div>
                <span className="font-mono text-slate-400 shrink-0">{log.entityType}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit Exam Details Modal */}
      {editingExam && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">
              Edit Examination Details
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Examination Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Exam Date</label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Subject</label>
                <input
                  type="text"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingExam(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteExam && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-display text-base font-bold text-slate-900">
              Delete Examination?
            </h3>
            <p className="text-sm text-slate-600">
              This will permanently delete <strong>{confirmDeleteExam.name}</strong> along with all its student records, classroom layouts, and seating plan versions.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteExam(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
