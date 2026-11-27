import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Download,
  KeyRound,
  Loader2,
  Shield,
  Upload
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/ExamWorkspaceContext';
import { isFirebaseConfigured, firebaseProjectHost } from '../firebase/config';
import {
  exportInstitutionWorkspaceBackup,
  importLegacyWorkspaceBackup,
  LegacyWorkspaceExport,
  sendPasswordReset
} from '../firebase/service';

export function SettingsPage() {
  const { userProfile, institution, dbReachable } = useAuth();
  const { aiAssistantEnabled, setAiAssistantEnabled, exams, refreshExams } = useWorkspace();
  const [resetSent, setResetSent] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupErr, setBackupErr] = useState<string | null>(null);

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

  const handleExportBackup = async () => {
    if (!institution) return;
    setBackupBusy(true);
    setBackupMsg(null);
    setBackupErr(null);
    try {
      const payload = await exportInstitutionWorkspaceBackup(institution, exams);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exam_planner_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setBackupMsg(`Exported ${payload.examinations.length} examination(s) to JSON backup.`);
    } catch (err) {
      setBackupErr(err instanceof Error ? err.message : 'Failed exporting workspace backup.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !institution) return;
    setBackupBusy(true);
    setBackupMsg(null);
    setBackupErr(null);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as LegacyWorkspaceExport;
      const result = await importLegacyWorkspaceBackup(institution.id, parsed);
      await refreshExams();
      setBackupMsg(`Imported ${result.importedCount} examination(s) into Firebase workspace.`);
    } catch (err) {
      setBackupErr(err instanceof Error ? err.message : 'Failed importing workspace backup.');
    } finally {
      setBackupBusy(false);
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
          Trigger a Firebase Authentication password reset email for <strong>{userProfile?.email}</strong>.
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

      {/* Data Portability & Backup */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="font-display text-base font-bold text-slate-900">
            Workspace Backup &amp; Legacy Migration Import
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Export all institution examinations, students, classrooms, and seating plans as JSON, or import a previously exported backup.
          </p>
        </div>

        {backupMsg && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{backupMsg}</span>
          </div>
        )}
        {backupErr && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{backupErr}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={backupBusy}
            onClick={handleExportBackup}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg disabled:opacity-50"
          >
            {backupBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Export Workspace JSON
          </button>

          <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Import JSON Backup</span>
            <input
              type="file"
              accept=".json,application/json"
              disabled={backupBusy}
              onChange={handleImportBackup}
              className="sr-only"
            />
          </label>
        </div>
      </section>

      {/* Tenant Isolation & Firebase Status */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-emerald-600" />
          <h3 className="font-display text-base font-bold text-slate-900">
            Firebase Tenant Isolation &amp; Connectivity
          </h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 text-xs pt-1">
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Firebase Project Host</div>
            <div className="font-mono font-semibold text-slate-900 mt-0.5 truncate">
              {firebaseProjectHost}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Institution Tenant ID</div>
            <div className="font-mono font-semibold text-slate-900 mt-0.5 truncate">
              {institution?.id}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Configuration Status</div>
            <div className="font-semibold text-slate-900 mt-0.5">
              {isFirebaseConfigured ? 'Configured' : 'Not Configured'}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="text-slate-500">Firebase Connection Status</div>
            <div className={`font-semibold mt-0.5 ${dbReachable ? 'text-emerald-700' : 'text-red-700'}`}>
              {dbReachable ? 'Connected' : 'Unreachable'}
            </div>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <Link
            to="/diagnostics"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Open Live System Diagnostics</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
