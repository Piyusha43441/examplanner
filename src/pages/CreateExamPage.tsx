import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Info,
  Loader2,
  Lock,
  Save
} from 'lucide-react';
import { ClassroomConfiguratorPanel } from '../components/ClassroomConfiguratorPanel';
import { StudentManagerPanel } from '../components/StudentManagerPanel';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { useSubscription } from '../context/SubscriptionContext';
import {
  ALLOWED_EXAMINATION_TYPES,
  getLockedTypeMessage
} from '../core/subscriptionConstants';
import { calculateTotalCapacity } from '../core/classroomEngine';
import {
  AllocationStrategy,
  ClassroomConfig,
  SeatingMode,
  SortOrder,
  StudentRecord
} from '../core/types';

const STEPS = [
  { id: 1, title: 'Exam Details' },
  { id: 2, title: 'Student Information' },
  { id: 3, title: 'Classroom Setup' },
  { id: 4, title: 'Seating Mode & Generate' }
];

export function CreateExamPage() {
  const { refreshProfile } = useAuth();
  const { saveCurrentExamData, runAndSaveSeatingPlan, savingWorkspace } = useWorkspace();
  const { lockedExaminationType, refreshSubscription } = useSubscription();
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step 1: Exam Details
  const [name, setName] = useState('');
  const [examType, setExamType] = useState<string>(
    lockedExaminationType || ALLOWED_EXAMINATION_TYPES[0]
  );
  const [academicYear, setAcademicYear] = useState('2026-27');
  const [examDate, setExamDate] = useState(new Date().toISOString().slice(0, 10));
  const [examTime, setExamTime] = useState('09:30 AM');
  const [subject, setSubject] = useState('');
  const [classCourse, setClassCourse] = useState('');
  const [semester, setSemester] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (lockedExaminationType) {
      setExamType(lockedExaminationType);
    }
  }, [lockedExaminationType]);

  // Step 2: Students (fresh empty state — never reuse stale range or previous exam data)
  const [rollRangeStart, setRollRangeStart] = useState('');
  const [rollRangeEnd, setRollRangeEnd] = useState('');
  const [students, setStudents] = useState<StudentRecord[]>([]);

  // Step 3: Classrooms (fresh configuration per examination)
  const [seatingMode, setSeatingMode] = useState<SeatingMode>(1);
  const [classrooms, setClassrooms] = useState<ClassroomConfig[]>([]);

  // Step 4: Strategy & Ordering
  const [strategy, setStrategy] = useState<AllocationStrategy>('sequential');
  const [sortOrder, setSortOrder] = useState<SortOrder>('original');
  const [staggerStep, setStaggerStep] = useState(3);
  const [groupByField, setGroupByField] = useState<'section' | 'course' | 'subject'>('section');

  const capacitySummary = useMemo(
    () => calculateTotalCapacity(classrooms, seatingMode),
    [classrooms, seatingMode]
  );

  const sufficientCapacity = students.length > 0 && students.length <= capacitySummary.totalCapacity;
  const effectiveExamType = lockedExaminationType || examType;

  const validateStep = (targetStep: number): boolean => {
    setErrorMsg(null);
    if (step === 1 && targetStep > 1) {
      if (!name.trim() || !effectiveExamType.trim() || !academicYear.trim() || !examDate) {
        setErrorMsg('Please fill Examination Name, Type, Academic Year, and Exam Date.');
        return false;
      }
      if (lockedExaminationType && effectiveExamType !== lockedExaminationType) {
        setErrorMsg(getLockedTypeMessage(lockedExaminationType));
        return false;
      }
    }
    if (step === 2 && targetStep > 2) {
      if (students.length === 0) {
        setErrorMsg('Please add or generate at least one student record before continuing.');
        return false;
      }
    }
    if (step === 3 && targetStep > 3) {
      if (classrooms.length === 0) {
        setErrorMsg('Please configure at least one classroom before continuing.');
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateStep(step + 1)) {
      setStep((s) => Math.min(4, s + 1));
    }
  };

  const handleSaveDraft = async () => {
    setErrorMsg(null);
    if (!name.trim()) {
      setErrorMsg('Examination Name is required to save a draft.');
      return;
    }
    try {
      await saveCurrentExamData({
        examMeta: {
          name: name.trim(),
          examType: effectiveExamType,
          academicYear,
          examDate,
          examTime,
          subject,
          classCourse,
          semester,
          notes,
          status: 'draft',
          seatingMode,
          strategy,
          sortOrder,
          rollRangeStart: rollRangeStart.trim() || undefined,
          rollRangeEnd: rollRangeEnd.trim() || undefined
        },
        students,
        classrooms,
        isNew: true
      });
      await refreshProfile();
      await refreshSubscription();
      navigate('/history');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save draft.');
    }
  };

  const handleGenerateAndAudit = async () => {
    setErrorMsg(null);
    if (!name.trim()) {
      setErrorMsg('Examination Name is required.');
      return;
    }
    if (students.length === 0) {
      setErrorMsg('Student list is empty.');
      return;
    }
    if (!sufficientCapacity) {
      setErrorMsg(
        `Insufficient seating capacity. You have ${students.length} students but only ${capacitySummary.totalCapacity} available seats. Increase classrooms, rows, benches, or switch to Two Students Per Bench.`
      );
      return;
    }

    try {
      await runAndSaveSeatingPlan({
        examMeta: {
          name: name.trim(),
          examType: effectiveExamType,
          academicYear,
          examDate,
          examTime,
          subject,
          classCourse,
          semester,
          notes,
          rollRangeStart: rollRangeStart.trim() || undefined,
          rollRangeEnd: rollRangeEnd.trim() || undefined
        },
        students,
        classrooms,
        seatingMode,
        strategy,
        sortOrder,
        customRule: { staggerStep, groupByField }
      });
      await refreshProfile();
      await refreshSubscription();
      navigate('/planner');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate seating plan.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Stepper Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STEPS.map((s) => {
            const active = s.id === step;
            const completed = s.id < step;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  if (s.id < step || validateStep(s.id)) {
                    setStep(s.id);
                  }
                }}
                className={`flex items-center gap-3 p-2.5 rounded-lg border text-left transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-50/70'
                    : completed
                    ? 'border-emerald-200 bg-emerald-50/40'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                    active
                      ? 'bg-blue-600 text-white'
                      : completed
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {completed ? <Check className="w-4 h-4" /> : s.id}
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500">Step {s.id}</div>
                  <div className="text-xs font-semibold text-slate-900 truncate">{s.title}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {errorMsg && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Step Content */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        {step === 1 && (
          <div className="space-y-5">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Step 1: Examination Details
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Enter general examination metadata printed on PDF seating sheets and reports.
              </p>
            </div>

            {/* Examination Type Selector with Single-Type Lock Enforcement */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <label className="block text-xs font-semibold text-slate-800">
                  Examination Type * (One Examination Type per Subscription)
                </label>
                {!lockedExaminationType && (
                  <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 text-blue-600" />
                    Locks permanently only after your first examination is created
                  </span>
                )}
              </div>

              {lockedExaminationType && (
                <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-2.5">
                  <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                  <span>{getLockedTypeMessage(lockedExaminationType)}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {ALLOWED_EXAMINATION_TYPES.map((typeOption) => {
                  const isSelected = effectiveExamType === typeOption;
                  const isLockedOut = Boolean(
                    lockedExaminationType && lockedExaminationType !== typeOption
                  );
                  return (
                    <button
                      key={typeOption}
                      type="button"
                      disabled={isLockedOut}
                      aria-disabled={isLockedOut}
                      onClick={() => {
                        if (!isLockedOut) setExamType(typeOption);
                      }}
                      className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg border text-left text-xs font-medium transition-colors ${
                        isLockedOut
                          ? 'border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                          : isSelected
                          ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate">{typeOption}</span>
                      {isLockedOut ? (
                        <Lock
                          className="w-3.5 h-3.5 text-slate-400 shrink-0"
                          aria-label={`${typeOption} locked`}
                        />
                      ) : isSelected ? (
                        <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Examination Name *
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. End Semester Theory Examination"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Selected Examination Type
                </label>
                <input
                  type="text"
                  readOnly
                  value={effectiveExamType}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-800 font-medium"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Academic Year *
                </label>
                <input
                  type="text"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  placeholder="2026-27"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Exam Date *
                </label>
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Examination Time (Optional)
                </label>
                <input
                  type="text"
                  value={examTime}
                  onChange={(e) => setExamTime(e.target.value)}
                  placeholder="09:30 AM – 12:30 PM"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Subject (Optional)
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Computer Networks"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Class / Course (Optional)
                </label>
                <input
                  type="text"
                  value={classCourse}
                  onChange={(e) => setClassCourse(e.target.value)}
                  placeholder="e.g. BCA / Class 12"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Semester / Term (Optional)
                </label>
                <input
                  type="text"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  placeholder="e.g. Semester IV"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Coordinator Notes (Optional)
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Instructions for room invigilators or seating notices..."
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Step 2: Student Information
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Generate roll numbers by range, upload a CSV/Excel spreadsheet, paste from Excel, or enter students manually.
              </p>
            </div>
            <StudentManagerPanel
              students={students}
              onChange={setStudents}
              rollRangeStart={rollRangeStart}
              rollRangeEnd={rollRangeEnd}
              onRangeMetaChange={(s, e) => {
                setRollRangeStart(s);
                setRollRangeEnd(e);
              }}
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Step 3: Classroom Configuration
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Configure uniform classrooms or customize individual room capacities and disabled benches.
              </p>
            </div>
            <ClassroomConfiguratorPanel
              classrooms={classrooms}
              seatingMode={seatingMode}
              studentCount={students.length}
              onChange={setClassrooms}
            />
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                Step 4: Seating Mode, Strategy & Verification
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Confirm seating mode and allocation order before running the deterministic seating engine and 15-point audit.
              </p>
            </div>

            {/* Seating Mode Selection */}
            <div className="grid sm:grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setSeatingMode(1)}
                className={`p-4 rounded-xl border text-left transition-colors ${
                  seatingMode === 1
                    ? 'border-blue-600 bg-blue-50/60'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="text-sm font-semibold text-slate-900">
                  Mode 1: One Student Per Bench
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  Seat 1 holds one candidate. Seat 2 remains unoccupied. Ideal for high-security board & university exams.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setSeatingMode(2)}
                className={`p-4 rounded-xl border text-left transition-colors ${
                  seatingMode === 2
                    ? 'border-blue-600 bg-blue-50/60'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="text-sm font-semibold text-slate-900">
                  Mode 2: Two Students Per Bench
                </div>
                <div className="text-xs text-slate-600 mt-1">
                  Seat 1 and Seat 2 each hold one candidate per bench, doubling available capacity.
                </div>
              </button>
            </div>

            {/* Strategy & Sort Order */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Allocation Strategy
                </label>
                <select
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as AllocationStrategy)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="sequential">Sequential Allocation (Default)</option>
                  <option value="alternate">Alternate Roll Number Allocation</option>
                  <option value="section_separation">Course / Section Separation</option>
                  <option value="custom">Custom Staggered Rules</option>
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  {strategy === 'sequential' &&
                    'Allocates students sequentially from Classroom 1 Row 1 Bench 1 onwards.'}
                  {strategy === 'alternate' &&
                    'Interleaves first and second halves of the roster so consecutive roll numbers do not sit side-by-side.'}
                  {strategy === 'section_separation' &&
                    'Alternates students from different sections/courses across adjacent seats.'}
                  {strategy === 'custom' &&
                    'Distributes candidates using a deterministic stride across benches.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Roll Number Ordering
                </label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="original">Original Input / Import Order (Default)</option>
                  <option value="ascending">Ascending Natural Roll Number</option>
                  <option value="custom">Custom Order</option>
                </select>
              </div>
            </div>

            {strategy === 'custom' && (
              <div className="max-w-xs">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Stagger Stride (2–10)
                </label>
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={staggerStep}
                  onChange={(e) => setStaggerStep(Math.max(2, Math.min(10, Number(e.target.value))))}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg"
                />
              </div>
            )}

            {strategy === 'section_separation' && (
              <div className="max-w-xs">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Separate By Field
                </label>
                <select
                  value={groupByField}
                  onChange={(e) => setGroupByField(e.target.value as 'section' | 'course' | 'subject')}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                >
                  <option value="section">Section</option>
                  <option value="course">Course</option>
                  <option value="subject">Subject</option>
                </select>
              </div>
            )}

            {/* Capacity Formula Verification Table */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
              <div className="text-xs font-semibold text-slate-900 mb-3">
                Capacity &amp; Readiness Summary
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
                <div>
                  <div className="text-slate-500">Total Students</div>
                  <div className="font-mono text-base font-bold text-slate-900 tabular-nums mt-0.5">
                    {students.length}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Total Benches</div>
                  <div className="font-mono text-base font-bold text-slate-900 tabular-nums mt-0.5">
                    {capacitySummary.activeBenches}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Available Seats</div>
                  <div className="font-mono text-base font-bold text-slate-900 tabular-nums mt-0.5">
                    {capacitySummary.totalCapacity}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Required Capacity</div>
                  <div className="font-mono text-base font-bold text-slate-900 tabular-nums mt-0.5">
                    {students.length}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Unused Seats</div>
                  <div className="font-mono text-base font-bold text-slate-900 tabular-nums mt-0.5">
                    {Math.max(0, capacitySummary.totalCapacity - students.length)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Capacity Status</div>
                  <div
                    className={`font-semibold text-sm mt-0.5 inline-flex items-center gap-1 ${
                      sufficientCapacity ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {sufficientCapacity ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Sufficient
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4" />
                        Insufficient
                      </>
                    )}
                  </div>
                </div>
              </div>

              {!sufficientCapacity && (
                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span>
                    Insufficient seating capacity. You have {students.length} students but only{' '}
                    {capacitySummary.totalCapacity} available seats.
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    {seatingMode === 1 && students.length <= capacitySummary.activeBenches * 2 && (
                      <button
                        type="button"
                        onClick={() => setSeatingMode(2)}
                        className="px-2.5 py-1 bg-white border border-red-300 rounded font-medium text-red-800 hover:bg-red-100"
                      >
                        Switch to 2 Students/Bench
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="px-2.5 py-1 bg-white border border-red-300 rounded font-medium text-red-800 hover:bg-red-100"
                    >
                      Add Classrooms / Benches
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer Controls */}
        <div className="mt-8 pt-5 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <ArrowLeft className="w-4 h-4" />
                Previous
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={savingWorkspace}
              onClick={handleSaveDraft}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              Save Draft
            </button>

            {step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={savingWorkspace || !sufficientCapacity}
                onClick={handleGenerateAndAudit}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
              >
                {savingWorkspace && <Loader2 className="w-4 h-4 animate-spin" />}
                Generate &amp; Audit Seating Plan
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
