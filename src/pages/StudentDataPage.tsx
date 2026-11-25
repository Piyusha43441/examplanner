import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { StudentManagerPanel } from '../components/StudentManagerPanel';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { StudentRecord } from '../core/types';

export function StudentDataPage() {
  const { activeExam, students, classrooms, saveCurrentExamData, savingWorkspace } = useWorkspace();
  const navigate = useNavigate();

  const [draftStudents, setDraftStudents] = useState<StudentRecord[]>(students);
  const [rollStart, setRollStart] = useState(activeExam?.rollRangeStart ?? '');
  const [rollEnd, setRollEnd] = useState(activeExam?.rollRangeEnd ?? '');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraftStudents(students);
    setRollStart(activeExam?.rollRangeStart ?? '');
    setRollEnd(activeExam?.rollRangeEnd ?? '');
  }, [students, activeExam?.id, activeExam?.rollRangeStart, activeExam?.rollRangeEnd]);

  if (!activeExam) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <h2 className="font-display text-lg font-bold text-slate-900">No Examination Selected</h2>
        <p className="text-sm text-slate-500 mt-1 mb-5">
          Create an examination first to upload or manage student roll numbers.
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

  const handleSave = async () => {
    setErrorMsg(null);
    setSaveMessage(null);
    try {
      await saveCurrentExamData({
        examMeta: {
          ...activeExam,
          rollRangeStart: rollStart.trim() || undefined,
          rollRangeEnd: rollEnd.trim() || undefined
        },
        students: draftStudents,
        classrooms,
        isNew: false
      });
      setSaveMessage(`Saved ${draftStudents.length} student records to "${activeExam.name}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed saving student records.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Student Data — {activeExam.name}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Update roll numbers, import CSV/Excel spreadsheets, or edit entries. Save changes before regenerating seating plans.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={savingWorkspace}
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
          >
            {savingWorkspace ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Student Roster
          </button>
          <button
            type="button"
            onClick={() => navigate('/planner')}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            Go to Seating Planner
          </button>
        </div>
      </div>

      {saveMessage && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{saveMessage}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <StudentManagerPanel
          students={draftStudents}
          onChange={setDraftStudents}
          rollRangeStart={rollStart}
          rollRangeEnd={rollEnd}
          onRangeMetaChange={(s, e) => {
            setRollStart(s);
            setRollEnd(e);
          }}
        />
      </div>
    </div>
  );
}
