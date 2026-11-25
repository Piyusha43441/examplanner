import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Loader2, Save } from 'lucide-react';
import { ClassroomConfiguratorPanel } from '../components/ClassroomConfiguratorPanel';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { ClassroomConfig, SeatingMode } from '../core/types';

export function ClassroomSetupPage() {
  const { activeExam, students, classrooms, saveCurrentExamData, savingWorkspace } = useWorkspace();
  const navigate = useNavigate();

  const [draftRooms, setDraftRooms] = useState<ClassroomConfig[]>(classrooms);
  const [seatingMode, setSeatingMode] = useState<SeatingMode>(activeExam?.seatingMode ?? 1);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setDraftRooms(classrooms);
    setSeatingMode(activeExam?.seatingMode ?? 1);
  }, [classrooms, activeExam?.id]);

  if (!activeExam) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <h2 className="font-display text-lg font-bold text-slate-900">No Examination Selected</h2>
        <p className="text-sm text-slate-500 mt-1 mb-5">
          Create or select an examination to configure its classrooms and bench capacities.
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
          seatingMode
        },
        students,
        classrooms: draftRooms,
        isNew: false
      });
      setSaveMessage(`Saved ${draftRooms.length} classroom configuration(s) for "${activeExam.name}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed saving classroom configuration.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Classroom Setup — {activeExam.name}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure rooms, rows, benches, and disabled seats, then save and regenerate your seating plan.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            aria-label="Seating Mode"
            value={seatingMode}
            onChange={(e) => setSeatingMode(Number(e.target.value) as SeatingMode)}
            className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg bg-white"
          >
            <option value={1}>1 Student / Bench</option>
            <option value={2}>2 Students / Bench</option>
          </select>
          <button
            type="button"
            disabled={savingWorkspace}
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60"
          >
            {savingWorkspace ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save Classrooms
          </button>
          <button
            type="button"
            onClick={() => navigate('/planner')}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg"
          >
            Open Seating Planner
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
        <ClassroomConfiguratorPanel
          classrooms={draftRooms}
          seatingMode={seatingMode}
          studentCount={students.length}
          onChange={setDraftRooms}
        />
      </div>
    </div>
  );
}
