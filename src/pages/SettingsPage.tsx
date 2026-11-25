import { useState } from 'react';
import { CheckCircle2, KeyRound, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { firebaseProjectId, isFirebaseConfigured } from '../firebase/config';
import { sendPasswordReset } from '../firebase/service';

export function SettingsPage() {
  const { userProfile, institution, dbReachable } = useAuth();
  const { aiAssistantEnabled, setAiAssistantEnabled } = useWorkspace();
  const [resetSent, setResetSent] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleResetPassword = async () => {
    if (!userProfile?.email) return;
    setResetSent(null);
    setResetError(null);
    try {
      await sendPasswordReset(userProfile.email);
      setResetSent(`Password reset link sent to ${userProfile.email}.`);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Could not send reset email.');
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* AI Validation Privacy Toggle */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-display text-base font-bold text-slate-900">
            AI Agentic Validation & Privacy Controls
          </h2>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Deterministic application code always performs roll-number generation, seating allocation, and the 15-point audit. Gemini AI agents only analyze anonymized roll patterns and structural audit summaries when enabled below.
          </p>
        </div>

        <label className="flex items-start gap-3 p-4 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={aiAssistantEnabled}
            onChange={(e) => setAiAssistantEnabled(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
          />
          <div className="text-xs">
            <div className="font-semibold text-slate-900">
              Enable Gemini Multi-Agent Data Scanner & Audit Explanations
            </div>
            <div className="text-slate-500 mt-0.5">
              Provides plain-language explanations for capacity shortfalls, spreadsheet formatting anomalies, and PDF layout recommendations. Student passwords and tokens are never transmitted.
            </div>
          </div>
        </label>
      </section>

      {/* Account Security & Password Reset */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-blue-600" />
          <h3 className="font-display text-base font-bold text-slate-900">
            Account Security & Password Reset
          </h3>
        </div>
        <p className="text-xs text-slate-500">
          Trigger a Firebase password reset email for <strong>{userProfile?.email}</strong>.
        </p>
        {resetSent && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{resetSent}</span>
          </div>
        )}
        {resetError && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
            {resetError}
          </div>
        )}
        <button
          type="button"
          onClick={handleResetPassword}
          className="px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg"
        >
          Send Password Reset Email
        </button>
      </section>

      {/* Tenant Isolation & Firebase Status */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-600" />
          <h3 className="font-display text-base font-bold text-slate-900">
            Firebase Tenant Isolation & Connectivity
          </h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-xs pt-1">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Firebase Project ID</div>
            <div className="font-mono font-semibold text-slate-900 mt-0.5">{firebaseProjectId}</div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Institution Tenant ID</div>
            <div className="font-mono font-semibold text-slate-900 mt-0.5">{institution?.id}</div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Configuration Status</div>
            <div className="font-semibold text-slate-900 mt-0.5">
              {isFirebaseConfigured ? 'Configured' : 'Not Configured'}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Cloud Firestore Reachability</div>
            <div className={`font-semibold mt-0.5 ${dbReachable ? 'text-emerald-700' : 'text-red-700'}`}>
              {dbReachable ? 'Connected' : 'Unreachable'}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
