import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, FileSpreadsheet, Lock, XCircle } from 'lucide-react';
import { ProtectedFeatureGate } from '../components/ProtectedFeatureGate';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { useSubscription } from '../context/SubscriptionContext';
import { SUBSCRIPTION_PLAN } from '../core/subscriptionConstants';

export function GeneratedPlansPage() {
  const { exams, activeExam, plans, activePlan, roomAllocations, selectPlanVersion } =
    useWorkspace();
  const { hasActiveAccess, requireActiveSubscription } = useSubscription();
  const navigate = useNavigate();

  if (!hasActiveAccess && exams.length === 0) {
    return (
      <ProtectedFeatureGate featureName="Generated Seating Plans">
        <div />
      </ProtectedFeatureGate>
    );
  }

  if (!activeExam) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <h2 className="font-display text-lg font-bold text-slate-900">No Examination Selected</h2>
        <p className="text-sm text-slate-500 mt-1 mb-5">
          Select an examination from the top bar or Examination History to inspect its versioned seating plans.
        </p>
        <button
          type="button"
          onClick={() => navigate('/history')}
          className="px-4 py-2 text-sm font-medium text-white bg-[#0F172A] rounded-lg"
        >
          View Examination History
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!hasActiveAccess && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
          <div className="flex items-start gap-2.5">
            <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              <strong>Read-Only Historical Plans:</strong> Your saved seating plans are preserved.
              Purchase a new ₹{SUBSCRIPTION_PLAN.amount} subscription to regenerate plans or export new PDFs.
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

      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold text-slate-900">
            Generated Seating Plan Versions — {activeExam.name}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Previous seating plan versions are preserved in history whenever you regenerate with new settings.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!requireActiveSubscription('Seating Planner')) return;
            navigate('/planner');
          }}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shrink-0"
        >
          Open Seating Planner
        </button>
      </div>

      {plans.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <FileSpreadsheet className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm font-medium text-slate-800">No seating plans generated yet</p>
          <p className="text-xs text-slate-500 mt-1 mb-4">
            Generate your first seating plan in the Seating Planner.
          </p>
          <button
            type="button"
            onClick={() => {
              if (!requireActiveSubscription('Seating Planner')) return;
              navigate('/planner');
            }}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg"
          >
            Generate Seating Plan
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-3 px-4 font-medium">Version</th>
                  <th className="py-3 px-4 font-medium">Mode &amp; Strategy</th>
                  <th className="py-3 px-4 font-medium text-right">Seated</th>
                  <th className="py-3 px-4 font-medium text-right">Capacity</th>
                  <th className="py-3 px-4 font-medium">Audit Status</th>
                  <th className="py-3 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => {
                  const isCurrent = activePlan?.id === plan.id;
                  return (
                    <tr
                      key={plan.id}
                      className={`border-b border-slate-100 last:border-0 ${
                        isCurrent ? 'bg-blue-50/40' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-slate-900">
                        v{plan.version} {isCurrent && <span className="text-blue-600 text-xs">(Active)</span>}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">
                        <div>{plan.seatingMode === 2 ? '2 Students / Bench' : '1 Student / Bench'}</div>
                        <div className="text-slate-500">
                          {plan.strategy} · {plan.sortOrder} order
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                        {plan.allocatedStudents} / {plan.totalStudents}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                        {plan.totalCapacity} ({plan.unusedSeats} unused)
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold">
                        {plan.auditStatus === 'VERIFIED' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            VERIFIED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <XCircle className="w-3.5 h-3.5" />
                            FAILED
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            await selectPlanVersion(plan);
                            if (hasActiveAccess) {
                              navigate('/planner');
                            }
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {hasActiveAccess ? 'Load & Preview' : 'Load Read-Only Preview'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Read-only classroom summary for expired users inspecting preserved plans */}
      {!hasActiveAccess && activePlan && roomAllocations.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200">
            <h3 className="font-display text-sm font-bold text-slate-900">
              Read-Only Summary — Plan v{activePlan.version} ({roomAllocations.length} classrooms)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-4 font-medium">Classroom</th>
                  <th className="py-2.5 px-4 font-medium">Room No.</th>
                  <th className="py-2.5 px-4 font-medium text-right">Active Benches</th>
                  <th className="py-2.5 px-4 font-medium text-right">Allocated</th>
                  <th className="py-2.5 px-4 font-medium text-right">Unused</th>
                </tr>
              </thead>
              <tbody>
                {roomAllocations.map((r) => (
                  <tr key={r.classroomId} className="border-b border-slate-100 last:border-0">
                    <td className="py-2.5 px-4 font-medium text-slate-900">{r.classroomName}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{r.roomNumber}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{r.activeBenches}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
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
      )}
    </div>
  );
}
