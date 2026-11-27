import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import healthHandler from '../../../netlify/functions/health';
import serverTimeHandler from '../../../netlify/functions/server-time';
import { runFullSystemDiagnostics } from '../../services/diagnostics';

describe('Production Deployment, Cloudflare R2 Worker & Netlify Configuration', () => {
  it('netlify.toml exists and specifies build, publish, functions, CSP for Cloudflare R2, and zero Supabase origins', () => {
    const tomlPath = path.resolve(process.cwd(), 'netlify.toml');
    expect(fs.existsSync(tomlPath)).toBe(true);

    const tomlContent = fs.readFileSync(tomlPath, 'utf8');
    expect(tomlContent).toContain('command = "npm run build"');
    expect(tomlContent).toContain('publish = "dist"');
    expect(tomlContent).toContain('functions = "netlify/functions"');
    expect(tomlContent).toContain('/api/health');
    expect(tomlContent).toContain('/api/server-time');
    expect(tomlContent).toContain('/api/ai/scan-data');
    expect(tomlContent).toContain('/api/ai/orchestrate-audit');
    expect(tomlContent).toContain('/api/payment-proof/upload-url');
    expect(tomlContent).toContain('/api/payment-proof/verify');
    expect(tomlContent).toContain('/api/payment-proof/cleanup');
    expect(tomlContent).toContain('/api/payment-proof/preview-url');
    expect(tomlContent).toContain('/api/payment-proof/institution-preview-url');
    expect(tomlContent).toContain('https://*.r2.cloudflarestorage.com');
    expect(tomlContent).toContain('https://*.workers.dev');
    expect(tomlContent.toLowerCase()).not.toContain('supabase');
    expect(tomlContent).toContain('from = "/*"');
    expect(tomlContent).toContain('to = "/index.html"');
    expect(tomlContent).toContain('X-Frame-Options');
    expect(tomlContent).toContain('Content-Security-Policy');
  });

  it('public/_redirects explicitly routes /api/* to Netlify functions before SPA fallback', () => {
    const redirectsPath = path.resolve(process.cwd(), 'public/_redirects');
    expect(fs.existsSync(redirectsPath)).toBe(true);

    const content = fs.readFileSync(redirectsPath, 'utf8');
    const lines = content.trim().split('\n').map((l) => l.trim()).filter(Boolean);

    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBe('/* /index.html 200');

    expect(content).toContain('/api/health /.netlify/functions/health 200');
    expect(content).toContain('/api/server-time /.netlify/functions/server-time 200');
    expect(content).toContain('/api/ai/scan-data /.netlify/functions/scan-data 200');
    expect(content).toContain('/api/ai/orchestrate-audit /.netlify/functions/orchestrate-audit 200');
    expect(content).toContain('/api/payment-proof/upload-url /.netlify/functions/payment-proof-upload-url 200');
    expect(content).toContain('/api/payment-proof/verify /.netlify/functions/payment-proof-verify 200');
    expect(content).toContain('/api/payment-proof/cleanup /.netlify/functions/payment-proof-cleanup 200');
    expect(content).toContain('/api/payment-proof/preview-url /.netlify/functions/payment-proof-preview-url 200');
    expect(content).toContain('/api/payment-proof/institution-preview-url /.netlify/functions/payment-proof-institution-preview-url 200');
  });

  it('Netlify /api/health function returns Cloudflare R2 storage status JSON contract', async () => {
    const req = new Request('https://test.netlify.app/api/health', { method: 'GET' });
    const res = await healthHandler(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.service).toBe('exam-planner-api');
    expect(json.storageProvider).toBe('cloudflare-r2');
    expect(typeof json.r2StorageConfigured).toBe('boolean');
    expect(Array.isArray(json.r2MissingConfig)).toBe(true);
    expect(typeof json.r2WorkerConfigured).toBe('boolean');
    expect(json.supabaseStorageConfigured).toBeUndefined();
    expect(typeof json.serverTimeMs).toBe('number');
    expect(typeof json.iso).toBe('string');
  });

  it('Netlify /api/server-time function returns trusted timestamp with no-store cache header', async () => {
    const req = new Request('https://test.netlify.app/api/server-time', { method: 'GET' });
    const res = await serverTimeHandler(req);

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Cache-Control')).toContain('no-store');

    const json = await res.json();
    expect(typeof json.nowMs).toBe('number');
    expect(typeof json.iso).toBe('string');
    expect(Date.parse(json.iso)).toBeGreaterThan(0);
  });

  it('Full system diagnostics engine executes safely and returns structured Cloudflare R2 check', async () => {
    const report = await runFullSystemDiagnostics();

    expect(report).toBeDefined();
    expect(typeof report.timestamp).toBe('string');
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(5);

    const checkIds = report.checks.map((c) => c.id);
    expect(checkIds).toContain('frontend_bundle');
    expect(checkIds).toContain('firebase_config');
    expect(checkIds).toContain('firebase_auth');
    expect(checkIds).toContain('firestore_db');
    expect(checkIds).toContain('payment_proof_storage');

    const storageCheck = report.checks.find((c) => c.id === 'payment_proof_storage');
    expect(storageCheck?.name).toContain('Cloudflare R2');
  });

  it('Never exposes server-only secrets (GEMINI_API_KEY, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY) through VITE_ variables', () => {
    const envExample = fs.readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');
    expect(envExample).not.toContain('VITE_GEMINI_API_KEY');
    expect(envExample).not.toContain('VITE_R2_ACCOUNT_ID');
    expect(envExample).not.toContain('VITE_R2_ACCESS_KEY_ID');
    expect(envExample).not.toContain('VITE_R2_SECRET_ACCESS_KEY');
    expect(envExample.toLowerCase()).not.toContain('supabase');
    expect(envExample).toContain('VITE_R2_WORKER_URL');
    expect(envExample).toContain('GEMINI_API_KEY');
    expect(envExample).toContain('R2_ACCOUNT_ID');
    expect(envExample).toContain('R2_ACCESS_KEY_ID');
    expect(envExample).toContain('R2_SECRET_ACCESS_KEY');
    expect(envExample).toContain('R2_BUCKET_NAME');
  });

  it('Cloudflare R2 Worker source files and setup guide exist', () => {
    const requiredFiles = [
      'cloudflare/r2-worker/package.json',
      'cloudflare/r2-worker/tsconfig.json',
      'cloudflare/r2-worker/wrangler.toml',
      'cloudflare/r2-worker/.dev.vars.example',
      'cloudflare/r2-worker/src/index.ts',
      'cloudflare/r2-worker/src/firebaseAuth.ts',
      'cloudflare/r2-worker/src/r2Storage.ts',
      'cloudflare/CLOUDFLARE_R2_SETUP.md'
    ];
    for (const relPath of requiredFiles) {
      expect(fs.existsSync(path.resolve(process.cwd(), relPath))).toBe(true);
    }
  });
});
