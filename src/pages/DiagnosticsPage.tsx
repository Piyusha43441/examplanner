import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { PublicFooter } from '../components/PublicFooter';
import { FullDiagnosticReport, runFullSystemDiagnostics } from '../services/diagnostics';

export function DiagnosticsPage() {
  const [report, setReport] = useState<FullDiagnosticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const runDiagnostics = async () => {
    setLoading(true);
    setCopied(false);
    try {
      const res = await runFullSystemDiagnostics();
      setReport(res);
    } catch (err) {
      console.error('Failed to run diagnostics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runDiagnostics();
  }, []);

  const handleCopyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <BrandLogo size={32} variant="dark" />
            <div>
              <div className="font-display font-bold text-sm text-slate-900">
                EXAM PLANNER · Production Diagnostics
              </div>
              <div className="text-xs text-slate-500">Live backend, Firebase, and Netlify checks</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to App</span>
            </Link>
            <button
              type="button"
              disabled={loading}
              onClick={runDiagnostics}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'Running Checks...' : 'Rerun Checks'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Status Banner */}
        {report && (
          <div
            className={`p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
              report.hasErrors
                ? 'bg-red-50 border-red-200 text-red-950'
                : report.hasWarnings
                ? 'bg-amber-50 border-amber-200 text-amber-950'
                : 'bg-emerald-50 border-emerald-200 text-emerald-950'
            }`}
          >
            <div className="flex items-start gap-3">
              {report.hasErrors ? (
                <AlertCircle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
              ) : report.hasWarnings ? (
                <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
              )}
              <div>
                <h1 className="font-display font-bold text-base">
                  {report.hasErrors
                    ? 'Production Attention Required'
                    : report.hasWarnings
                    ? 'Operational with Advisories'
                    : 'All Production Systems Operational'}
                </h1>
                <p className="text-xs mt-1 opacity-90 leading-relaxed">
                  {report.hasErrors
                    ? 'One or more essential backend services cannot connect. Review the failed checks below and update your Netlify environment variables.'
                    : report.hasWarnings
                    ? 'Core seating and Firebase features are online. Review recommendations below for optimal setup.'
                    : 'Frontend, Firebase Auth, Firestore database, Storage, and Netlify Functions are connected and verified.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyReport}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 shadow-sm transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copied ? 'Copied JSON!' : 'Copy JSON Report'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Environment Details Card */}
        {report && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <Server className="w-4 h-4 text-blue-600" />
              <span>Deployment Runtime Environment</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500">Hostname</span>
                <p className="font-mono font-semibold text-slate-900 mt-0.5 truncate">
                  {report.environment.hostname}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500">Hosting Target</span>
                <p className="font-semibold text-slate-900 mt-0.5">
                  {report.environment.isNetlify ? 'Netlify Production' : 'AI Studio Preview / Dev'}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500">Vite Build Mode</span>
                <p className="font-mono font-semibold text-slate-900 mt-0.5">
                  {report.environment.mode}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-slate-500">Report Timestamp</span>
                <p className="font-mono text-slate-900 mt-0.5 truncate">
                  {new Date(report.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Diagnostic Checks List */}
        <div className="space-y-3">
          <h2 className="font-display text-sm font-bold text-slate-900">
            System Component Diagnostics ({report?.checks.length || 0})
          </h2>

          {loading && !report ? (
            <div className="p-12 text-center bg-white border border-slate-200 rounded-xl space-y-3">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600 mx-auto" />
              <p className="text-xs text-slate-600 font-medium">
                Testing Firebase Authentication, Firestore, Storage, and Netlify Functions...
              </p>
            </div>
          ) : (
            report?.checks.map((check) => {
              const isPass = check.status === 'pass';
              const isFail = check.status === 'fail';
              const isWarn = check.status === 'warn';

              return (
                <div
                  key={check.id}
                  className={`p-4 rounded-xl border bg-white shadow-sm transition-all ${
                    isFail
                      ? 'border-red-300 ring-1 ring-red-100'
                      : isWarn
                      ? 'border-amber-300 ring-1 ring-amber-100'
                      : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="mt-0.5 shrink-0">
                        {isPass ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        ) : isFail ? (
                          <AlertCircle className="w-5 h-5 text-red-600" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 text-amber-600" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-display font-bold text-sm text-slate-900">
                            {check.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded ${
                              isPass
                                ? 'bg-emerald-100 text-emerald-800'
                                : isFail
                                ? 'bg-red-100 text-red-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {check.status}
                          </span>
                          {typeof check.latencyMs === 'number' && (
                            <span className="text-[11px] font-mono text-slate-400">
                              {check.latencyMs} ms
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-700 mt-1 leading-relaxed">{check.message}</p>

                        {/* Additional Key-Value Details */}
                        {check.details && (
                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                            {Object.entries(check.details).map(([k, v]) => (
                              <span
                                key={k}
                                className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded text-[11px] font-mono text-slate-700"
                              >
                                <span className="text-slate-400 font-sans">{k}:</span>
                                <span className="font-semibold">{String(v)}</span>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Recommended Action */}
                        {check.recommendation && (
                          <div
                            className={`mt-3 p-3 rounded-lg text-xs leading-relaxed ${
                              isFail
                                ? 'bg-red-50/70 border border-red-200 text-red-900'
                                : 'bg-amber-50/70 border border-amber-200 text-amber-900'
                            }`}
                          >
                            <span className="font-semibold">Recommended Fix: </span>
                            {check.recommendation}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Netlify Production Deployment Checklist */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            <h2 className="font-display font-bold text-base text-slate-900">
              Netlify Production Environment Setup Checklist
            </h2>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Ensure these exact environment variables are configured under Netlify Site Configuration &gt; Environment variables:
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-3 font-semibold">Variable Name</th>
                  <th className="py-2.5 px-3 font-semibold">Scope</th>
                  <th className="py-2.5 px-3 font-semibold">Purpose</th>
                  <th className="py-2.5 px-3 font-semibold">Required</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                <tr>
                  <td className="py-2 px-3 font-bold text-blue-700">VITE_FIREBASE_API_KEY</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Frontend &amp; Netlify Build</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Firebase project Web API key</td>
                  <td className="py-2 px-3 font-sans text-red-700 font-semibold">Mandatory</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-bold text-blue-700">VITE_FIREBASE_PROJECT_ID</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Frontend &amp; Netlify Build</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Firebase project identifier</td>
                  <td className="py-2 px-3 font-sans text-red-700 font-semibold">Mandatory</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-bold text-blue-700">VITE_FIREBASE_AUTH_DOMAIN</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Frontend &amp; Netlify Build</td>
                  <td className="py-2 px-3 font-sans text-slate-600">&lt;project-id&gt;.firebaseapp.com</td>
                  <td className="py-2 px-3 font-sans text-slate-700 font-semibold">Recommended</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-bold text-blue-700">VITE_R2_WORKER_URL</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Frontend &amp; Netlify Build</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Deployed Cloudflare R2 Worker HTTPS URL for payment proofs</td>
                  <td className="py-2 px-3 font-sans text-red-700 font-semibold">Mandatory for Uploads</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-bold text-purple-700">R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Cloudflare Worker Secrets (Server-Only)</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Signs private R2 upload &amp; preview URLs (never use VITE_)</td>
                  <td className="py-2 px-3 font-sans text-red-700 font-semibold">Mandatory on Worker</td>
                </tr>
                <tr>
                  <td className="py-2 px-3 font-bold text-purple-700">GEMINI_API_KEY</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Netlify Functions (Server-Only)</td>
                  <td className="py-2 px-3 font-sans text-slate-600">Agentic student data scan &amp; audit orchestrator</td>
                  <td className="py-2 px-3 font-sans text-amber-700 font-semibold">Optional (Deterministic engine works without it)</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900 leading-relaxed space-y-1">
            <div className="font-semibold">Critical Netlify Deployment Note:</div>
            <div>
              Because Vite embeds <code>VITE_*</code> variables during <code>npm run build</code>, anytime you add or update an environment variable in Netlify, you must trigger a new deploy (<strong>Deploys &gt; Trigger deploy &gt; Deploy site</strong>) for changes to take effect in the browser.
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
