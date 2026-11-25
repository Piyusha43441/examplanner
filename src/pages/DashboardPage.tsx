import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  CreditCard,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  Grid2x2,
  Layers,
  Loader2,
  Lock,
  Upload,
  Zap
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { useSubscription } from '../context/SubscriptionContext';
import {
  ALLOWED_EXAMINATION_TYPES,
  getLockedTypeMessage,
  SUBSCRIPTION_PLAN
} from '../core/subscriptionConstants';
import { SeatingMode } from '../core/types';
import { generateRollNumberRange } from '../core/rollNumberEngine';
import { formatDateOnly, formatTimestamp } from '../firebase/subscriptionService';

export function DashboardPage() {
  const { userProfile, institution, refreshProfile } = useAuth();
  const { exams, auditLogs, loadingWorkspace, savingWorkspace, selectExam, quickGenerateExamAndPlan } =
    useWorkspace();
  const {
    hasActiveAccess,
    subscriptionStatus,
    activeSubscription,
    latestSubscription,
    pendingPaymentRequest,
    latestPaymentRequest,
    lockedExaminationType,
    remainingDays,
    requireActiveSubscription,
    refreshSubscription
  } = useSubscription();
  const navigate = useNavigate();

  // Quick Generation State
  const [quickExamName, setQuickExamName] = useState('');
  const [quickExamType, setQuickExamType] = useState<string>(
    lockedExaminationType || ALLOWED_EXAMINATION_TYPES[0]
  );
  const [quickExamDate, setQuickExamDate] = useState(new Date().toISOString().slice(0, 10));
  const [rollStart, setRollStart] = useState('1');
  const [rollEnd, setRollEnd] = useState('50');
  const [classroomCount, setClassroomCount] = useState(5);
  const [rowsPerClassroom, setRowsPerClassroom] = useState(3);
  const [benchesPerRow, setBenchesPerRow] = useState(10);
  const [seatingMode, setSeatingMode] = useState<SeatingMode>(1);
  const [quickError, setQuickError] = useState<string | null>(null);

  useEffect(() => {
    if (lockedExaminationType) {
      setQuickExamType(lockedExaminationType);
    }
  }, [lockedExaminationType]);

  const stats = useMemo(() => {
    const totalExams = exams.length;
    const totalStudents = exams.reduce((sum, e) => sum + (e.studentCount || 0), 0);
    const totalClassrooms = exams.reduce((sum, e) => sum + (e.classroomCount || 0), 0);
    const plansGenerated = exams.filter((e) => Boolean(e.latestPlanId)).length;
    return { totalExams, totalStudents, totalClassrooms, plansGenerated };
  }, [exams]);

  const liveQuickCapacity = useMemo(() => {
    const range = generateRollNumberRange(rollStart, rollEnd);
    const totalBenches =
      Math.max(0, classroomCount) * Math.max(0, rowsPerClassroom) * Math.max(0, benchesPerRow);
    const totalSeats = totalBenches * seatingMode;
    const studentCount = range.students.length;
    return {
      studentCount,
      rangeError: range.error,
      totalBenches,
      totalSeats,
      sufficient: !range.error && studentCount > 0 && studentCount <= totalSeats
    };
  }, [rollStart, rollEnd, classroomCount, rowsPerClassroom, benchesPerRow, seatingMode]);

  const handleProtectedNav = (path: string, featureLabel: string) => {
    if (!requireActiveSubscription(featureLabel)) return;
    navigate(path);
  };

  const handleQuickGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickError(null);

    if (!requireActiveSubscription('Quick Seating Plan Generation')) {
      return;
    }

    if (!quickExamName.trim()) {
      setQuickError('Please enter an examination name.');
      return;
    }
    if (lockedExaminationType && quickExamType !== lockedExaminationType) {
      setQuickError(getLockedTypeMessage(lockedExaminationType));
      return;
    }
    if (liveQuickCapacity.rangeError) {
      setQuickError(liveQuickCapacity.rangeError);
      return;
    }
    if (!liveQuickCapacity.sufficient) {
      setQuickError(
        `Insufficient seating capacity. You have ${liveQuickCapacity.studentCount} students but only ${liveQuickCapacity.totalSeats} available seats.`
      );
      return;
    }

    try {
      await quickGenerateExamAndPlan({
        examName: quickExamName.trim(),
        examDate: quickExamDate,
        academicYear: `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(-2)}`,
        examType: lockedExaminationType || quickExamType,
        rollStart,
        rollEnd,
        classroomCount,
        rowsPerClassroom,
        benchesPerRow,
        seatingMode
      });
      await refreshProfile();
      await refreshSubscription();
      navigate('/planner');
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : 'Could not generate seating plan.');
    }
  };

  return (
    <div className="space-y-8">
      {/* Institution Context Header */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          {institution?.logoDataUrl ? (
            <img
              src={institution.logoDataUrl}
              alt={institution.name}
              className="w-12 h-12 rounded-lg object-contain border border-slate-200 p-1 bg-white shrink-0"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-[#0F172A] text-white flex items-center justify-center shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="font-display text-xl font-bold text-slate-900 truncate">
              {institution?.name || 'Institution Workspace'}
            </h2>
            <p className="text-sm text-slate-500 flex flex-wrap items-center gap-2 mt-0.5">
              <span>Coordinator: {userProfile?.fullName || 'Administrator'}</span>
              <span aria-hidden="true">·</span>
              <span>{institution?.type}</span>
              <span aria-hidden="true">·</span>
              <span>
                {institution?.city}, {institution?.state}
              </span>
              <span aria-hidden="true">·</span>
              <Link
                to="/about"
                className="text-blue-600 hover:text-blue-700 hover:underline font-medium transition-colors"
              >
                Meet the Founder
              </Link>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleProtectedNav('/create-exam', 'Create Examination Wizard')}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0F172A] hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
          >
            Open Full Exam Wizard
          </button>
        </div>
      </section>

      {/* Subscription Status Section */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <CreditCard className="w-4 h-4 text-blue-600" />
              <span className="font-semibold text-slate-900">
                Subscription Status: {SUBSCRIPTION_PLAN.planName}
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="font-mono text-slate-600">
                ₹{SUBSCRIPTION_PLAN.amount} / {SUBSCRIPTION_PLAN.validityDays} days
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span
                className={`font-bold ${
                  subscriptionStatus === 'active'
                    ? 'text-emerald-700'
                    : subscriptionStatus === 'pending'
                    ? 'text-amber-700'
                    : 'text-red-700'
                }`}
              >
                {subscriptionStatus === 'active' && 'ACTIVE'}
                {subscriptionStatus === 'pending' && 'PENDING ADMIN APPROVAL'}
                {subscriptionStatus === 'expired' && 'EXPIRED'}
                {subscriptionStatus === 'revoked' && 'REVOKED'}
                {subscriptionStatus === 'rejected' && 'REJECTED'}
                {subscriptionStatus === 'none' && 'INACTIVE (FREE TIER)'}
              </span>
            </div>

            {subscriptionStatus === 'active' && activeSubscription && (
              <div className="text-xs text-slate-600 space-y-1">
                <div className="font-medium text-emerald-800">
                  Your subscription is active. You can now use Exam Planner.
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    Activated:{' '}
                    <strong className="font-mono text-slate-900">
                      {formatDateOnly(activeSubscription.activatedAt)}
                    </strong>
                  </span>
                  <span>
                    Expires:{' '}
                    <strong className="font-mono text-slate-900">
                      {formatTimestamp(activeSubscription.expiresAt)}
                    </strong>
                  </span>
                  <span>
                    Remaining:{' '}
                    <strong className="font-mono text-emerald-700 tabular-nums">
                      {remainingDays} day(s)
                    </strong>
                  </span>
                  <span>
                    Locked Type:{' '}
                    <strong className="text-slate-900">
                      {lockedExaminationType || 'Unlocked until first exam creation'}
                    </strong>
                  </span>
                </div>
                {lockedExaminationType && (
                  <p className="text-slate-700 flex items-start gap-1.5 pt-1">
                    <Lock className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span>{getLockedTypeMessage(lockedExaminationType)}</span>
                  </p>
                )}
              </div>
            )}

            {subscriptionStatus === 'pending' && pendingPaymentRequest && (
              <p className="text-xs text-amber-800 flex items-start gap-1.5">
                <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  Your payment is awaiting verification by the administrator. (Ref:{' '}
                  <span className="font-mono font-semibold">
                    {pendingPaymentRequest.transactionReferenceId?.trim() || 'Not Provided'}
                  </span>
                  )
                </span>
              </p>
            )}

            {subscriptionStatus === 'expired' && latestSubscription && (
              <p className="text-xs text-slate-600 flex items-start gap-1.5">
                <CalendarClock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                <span>
                  Your subscription has expired. Renew for ₹1 to continue creating examinations.
                  (Expired on{' '}
                  <span className="font-mono">{formatDateOnly(latestSubscription.expiresAt)}</span>
                  ; existing examinations remain preserved in history.)
                </span>
              </p>
            )}

            {subscriptionStatus === 'rejected' && latestPaymentRequest && (
              <p className="text-xs text-red-700">
                Last payment request was rejected: {latestPaymentRequest.rejectionReason}. You may
                submit a new ₹1 UPI payment request.
              </p>
            )}

            {subscriptionStatus === 'revoked' && latestSubscription && (
              <p className="text-xs text-red-700">
                Your previous subscription was revoked ({latestSubscription.revocationReason || 'Admin action'}).
                Purchase a new ₹1 subscription to restore access.
              </p>
            )}

            {subscriptionStatus === 'none' && (
              <p className="text-xs text-slate-600">
                Unlock Exam Planner for 15 days with a one-time ₹1 UPI payment (includes 1
                examination type per subscription, verified manually by the administrator).
              </p>
            )}
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => navigate('/subscribe')}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-colors whitespace-nowrap ${
                hasActiveAccess
                  ? 'text-slate-700 bg-slate-100 hover:bg-slate-200'
                  : 'text-white bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {subscriptionStatus === 'active'
                ? 'Subscription Details'
                : subscriptionStatus === 'pending'
                ? 'View Payment Status'
                : subscriptionStatus === 'expired'
                ? 'Renew for ₹1'
                : 'Subscribe for ₹1'}
            </button>
          </div>
        </div>
      </section>

      {/* Real KPI Summary Strip (Derived strictly from Firestore records) */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Examinations"
          value={stats.totalExams}
          sublabel="Saved in institution workspace"
        />
        <MetricCard
          label="Students Registered"
          value={stats.totalStudents}
          sublabel="Across configured examinations"
        />
        <MetricCard
          label="Classrooms Configured"
          value={stats.totalClassrooms}
          sublabel="Active & standby rooms"
        />
        <MetricCard
          label="Seating Plans Generated"
          value={stats.plansGenerated}
          sublabel="Audited & versioned plans"
        />
      </section>

      {/* Quick Actions Grid (6 Required Actions) */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-base font-semibold text-slate-900">Quick Actions</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <QuickActionButton
            icon={FilePlus2}
            title="Create New Examination"
            desc="Step-by-step wizard for exam details, students, and rooms"
            locked={!hasActiveAccess}
            onClick={() => handleProtectedNav('/create-exam', 'Create New Examination')}
          />
          <QuickActionButton
            icon={Layers}
            title="Generate Seating Plan"
            desc="Run deterministic seating allocation and 15-point audit"
            locked={!hasActiveAccess}
            onClick={() => handleProtectedNav('/planner', 'Generate Seating Plan')}
          />
          <QuickActionButton
            icon={Upload}
            title="Upload Student Data"
            desc="Import CSV or Excel spreadsheets with column mapping"
            locked={!hasActiveAccess}
            onClick={() => handleProtectedNav('/students', 'Upload Student Data')}
          />
          <QuickActionButton
            icon={Grid2x2}
            title="Manage Classrooms"
            desc="Configure rows, benches, and disabled seats"
            locked={!hasActiveAccess}
            onClick={() => handleProtectedNav('/classrooms', 'Manage Classrooms')}
          />
          <QuickActionButton
            icon={FileSpreadsheet}
            title="View Previous Seating Plans"
            desc="Inspect versioned plans and historical audit trails"
            locked={!hasActiveAccess && exams.length === 0}
            onClick={() => {
              if (!hasActiveAccess && exams.length === 0) {
                requireActiveSubscription('View Previous Seating Plans');
                return;
              }
              navigate('/plans');
            }}
          />
          <QuickActionButton
            icon={FileText}
            title="Download Reports"
            desc="Export Format A, Classroom Print Sheets, and CSV lists"
            locked={!hasActiveAccess}
            onClick={() => handleProtectedNav('/reports', 'Download Reports')}
          />
        </div>
      </section>

      {/* Quick Generation Mode */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-slate-200 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600" />
              <h3 className="font-display text-base font-semibold text-slate-900">
                Quick Seating Plan Generation
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Enter roll number range and room dimensions to automatically allocate, audit, and preview seats in one click.
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-slate-600">
            {liveQuickCapacity.studentCount} students · {liveQuickCapacity.totalBenches} benches ·{' '}
            {liveQuickCapacity.totalSeats} seats
          </div>
        </div>

        {lockedExaminationType && (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>{getLockedTypeMessage(lockedExaminationType)}</span>
          </div>
        )}

        {quickError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <span>{quickError}</span>
          </div>
        )}

        <form onSubmit={handleQuickGenerate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Examination Name *
              </label>
              <input
                type="text"
                required
                value={quickExamName}
                onChange={(e) => setQuickExamName(e.target.value)}
                placeholder="e.g. Semester 1 Final Examination"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Examination Type *
              </label>
              <select
                value={lockedExaminationType || quickExamType}
                onChange={(e) => setQuickExamType(e.target.value)}
                disabled={Boolean(lockedExaminationType)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-slate-50"
              >
                {ALLOWED_EXAMINATION_TYPES.map((type) => {
                  const lockedOther = Boolean(lockedExaminationType && lockedExaminationType !== type);
                  return (
                    <option key={type} value={type} disabled={lockedOther}>
                      {lockedOther ? `${type} (Locked)` : type}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Starting Roll Number *
              </label>
              <input
                type="text"
                required
                value={rollStart}
                onChange={(e) => setRollStart(e.target.value)}
                placeholder="1 or 001 or BCA001"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Ending Roll Number *
              </label>
              <input
                type="text"
                required
                value={rollEnd}
                onChange={(e) => setRollEnd(e.target.value)}
                placeholder="50 or 050 or BCA050"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Number of Classrooms
              </label>
              <input
                type="number"
                min={1}
                max={500}
                required
                value={classroomCount}
                onChange={(e) => setClassroomCount(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Rows per Classroom
              </label>
              <input
                type="number"
                min={1}
                max={50}
                required
                value={rowsPerClassroom}
                onChange={(e) => setRowsPerClassroom(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Benches per Row
              </label>
              <input
                type="number"
                min={1}
                max={50}
                required
                value={benchesPerRow}
                onChange={(e) => setBenchesPerRow(Math.max(1, Number(e.target.value)))}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Seating Mode
              </label>
              <select
                value={seatingMode}
                onChange={(e) => setSeatingMode(Number(e.target.value) as SeatingMode)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value={1}>1 Student per Bench</option>
                <option value={2}>2 Students per Bench</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Exam Date
              </label>
              <input
                type="date"
                value={quickExamDate}
                onChange={(e) => setQuickExamDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div className="text-xs">
              {liveQuickCapacity.rangeError ? (
                <span className="text-red-700 font-medium">{liveQuickCapacity.rangeError}</span>
              ) : liveQuickCapacity.sufficient ? (
                <span className="text-emerald-700 font-medium inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  Capacity OK — {liveQuickCapacity.totalSeats - liveQuickCapacity.studentCount} unused seats remaining
                </span>
              ) : (
                <span className="text-red-700 font-medium inline-flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  Insufficient seating capacity: {liveQuickCapacity.studentCount} students vs{' '}
                  {liveQuickCapacity.totalSeats} seats
                </span>
              )}
            </div>

            <button
              type="submit"
              disabled={savingWorkspace}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-60 whitespace-nowrap"
            >
              {savingWorkspace && <Loader2 className="w-4 h-4 animate-spin" />}
              GENERATE SEATING PLAN
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </form>
      </section>

      {/* Two-Column Tables: Recent Examinations + Recent Activity */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Recent Examinations
            </h3>
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              View All
            </button>
          </div>

          {loadingWorkspace ? (
            <div className="p-6 space-y-3">
              <div className="h-9 bg-slate-100 rounded animate-pulse" />
              <div className="h-9 bg-slate-100 rounded animate-pulse" />
              <div className="h-9 bg-slate-100 rounded animate-pulse" />
            </div>
          ) : exams.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm font-medium text-slate-800">No examinations created yet</p>
              <p className="text-xs text-slate-500 mt-1 mb-4">
                Use Quick Seating Plan Generation above or open the full Examination Wizard to begin.
              </p>
              <button
                type="button"
                onClick={() => handleProtectedNav('/create-exam', 'Create First Examination')}
                className="px-4 py-2 text-xs font-medium text-white bg-[#0F172A] rounded-lg hover:bg-slate-800"
              >
                Create First Examination
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500 bg-slate-50/70">
                    <th className="py-2.5 px-4 font-medium">Examination</th>
                    <th className="py-2.5 px-4 font-medium">Date</th>
                    <th className="py-2.5 px-4 font-medium text-right">Students</th>
                    <th className="py-2.5 px-4 font-medium text-right">Seats</th>
                    <th className="py-2.5 px-4 font-medium">Audit</th>
                  </tr>
                </thead>
                <tbody>
                  {exams.slice(0, 6).map((exam) => (
                    <tr
                      key={exam.id}
                      onClick={() => {
                        selectExam(exam.id).then(() =>
                          navigate(hasActiveAccess ? '/planner' : '/plans')
                        );
                      }}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-medium text-slate-900">
                        <div>{exam.name}</div>
                        <div className="text-xs text-slate-500">
                          {exam.examType} · {exam.seatingMode === 2 ? '2/Bench' : '1/Bench'}
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                        {exam.examDate}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                        {exam.studentCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                        {exam.totalCapacity}
                      </td>
                      <td className="py-3 px-4 text-xs font-medium">
                        {exam.latestAuditStatus === 'VERIFIED' ? (
                          <span className="text-emerald-700">VERIFIED</span>
                        ) : exam.latestAuditStatus === 'FAILED' ? (
                          <span className="text-red-700">FAILED</span>
                        ) : (
                          <span className="text-slate-500">DRAFT</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Recent Seating Plan Activity
            </h3>
            <button
              type="button"
              onClick={() => navigate('/history')}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Audit Log
            </button>
          </div>
          {auditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Activity logs will appear here as examinations and seating plans are created.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {auditLogs.slice(0, 6).map((log) => (
                <div key={log.id} className="px-5 py-3">
                  <div className="text-xs font-semibold text-slate-800">{log.action.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-slate-600 mt-0.5 leading-relaxed">{log.summary}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, sublabel }: { label: string; value: number; sublabel: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="font-display text-3xl font-bold text-slate-900 tabular-nums mt-2">
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-slate-400 mt-1">{sublabel}</div>
    </div>
  );
}

function QuickActionButton({
  icon: Icon,
  title,
  desc,
  locked = false,
  onClick
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left bg-white border border-slate-200 hover:border-blue-500 rounded-xl p-4 transition-colors flex items-start gap-3.5 group"
    >
      <div className="w-9 h-9 rounded-lg bg-slate-100 group-hover:bg-blue-50 text-slate-700 group-hover:text-blue-600 flex items-center justify-center shrink-0 transition-colors">
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          {locked && <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{desc}</div>
      </div>
    </button>
  );
}
