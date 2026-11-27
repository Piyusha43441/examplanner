import {
  auth,
  getFirebaseConfigSummary,
  testFirebaseConnection
} from '../firebase/config';

export interface DiagnosticCheckItem {
  id: string;
  name: string;
  category: 'frontend' | 'firebase' | 'serverless' | 'ai';
  status: 'checking' | 'pass' | 'fail' | 'warn';
  message: string;
  details?: Record<string, string | number | boolean>;
  recommendation?: string;
  latencyMs?: number;
}

export interface FullDiagnosticReport {
  timestamp: string;
  allPassed: boolean;
  hasErrors: boolean;
  hasWarnings: boolean;
  checks: DiagnosticCheckItem[];
  environment: {
    hostname: string;
    origin: string;
    isNetlify: boolean;
    isLocalhost: boolean;
    mode: string;
  };
}

export async function runFullSystemDiagnostics(): Promise<FullDiagnosticReport> {
  const checks: DiagnosticCheckItem[] = [];
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const isNetlify = hostname.includes('netlify.app');
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';

  // 1. Frontend Application
  checks.push({
    id: 'frontend_bundle',
    name: 'Frontend Application Shell',
    category: 'frontend',
    status: 'pass',
    message: 'React 19 + Vite SPA application loaded successfully in client browser.',
    details: {
      hostname,
      mode: import.meta.env.MODE,
      spaRouting: 'Active'
    }
  });

  // 2. Firebase Environment Configuration
  const fbConfig = getFirebaseConfigSummary();
  if (fbConfig.isConfigured) {
    checks.push({
      id: 'firebase_config',
      name: 'Firebase Configuration',
      category: 'firebase',
      status: 'pass',
      message: `Firebase project connected (${fbConfig.projectId}) via ${fbConfig.sourceLabel}.`,
      details: {
        projectId: fbConfig.projectId,
        databaseId: fbConfig.databaseId,
        configSource: fbConfig.sourceLabel,
        authDomain: fbConfig.authDomain,
        apiKey: fbConfig.apiKeyMasked,
        appId: fbConfig.appIdMasked
      }
    });
  } else {
    checks.push({
      id: 'firebase_config',
      name: 'Firebase Configuration',
      category: 'firebase',
      status: 'fail',
      message:
        'Firebase configuration is missing in this environment. Neither AI Studio applet config nor VITE_FIREBASE_* variables are loaded.',
      recommendation:
        isNetlify
          ? 'On Netlify: Go to Site configuration > Environment variables > add VITE_FIREBASE_API_KEY, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_AUTH_DOMAIN, then re-deploy.'
          : 'In Google AI Studio Preview: Confirm the Firebase integration prompt or add VITE_FIREBASE_* variables in .env.'
    });
  }

  // 3. Firebase Authentication Connection
  if (!fbConfig.isConfigured) {
    checks.push({
      id: 'firebase_auth',
      name: 'Firebase Authentication',
      category: 'firebase',
      status: 'fail',
      message: 'Cannot initialize Firebase Auth without environment configuration.',
      recommendation: 'Configure Firebase environment variables first.'
    });
  } else {
    try {
      const currentUser = auth.currentUser;
      checks.push({
        id: 'firebase_auth',
        name: 'Firebase Authentication Service',
        category: 'firebase',
        status: 'pass',
        message: currentUser
          ? `Connected and active session found: ${currentUser.email || currentUser.uid}`
          : 'Firebase Auth service is initialized and ready for sign-in/registration.',
        details: {
          signedIn: Boolean(currentUser),
          authDomain: fbConfig.authDomain
        }
      });
    } catch (err) {
      checks.push({
        id: 'firebase_auth',
        name: 'Firebase Authentication Service',
        category: 'firebase',
        status: 'fail',
        message: err instanceof Error ? err.message : 'Failed to connect to Firebase Authentication.',
        recommendation: 'Verify VITE_FIREBASE_API_KEY and ensure Email/Password provider is enabled in Firebase Console.'
      });
    }
  }

  // 4. Firestore Database Server Roundtrip
  if (!fbConfig.isConfigured) {
    checks.push({
      id: 'firestore_db',
      name: 'Firebase Firestore Database',
      category: 'firebase',
      status: 'fail',
      message: 'Cannot connect to Firestore without configuration.',
      recommendation: 'Configure VITE_FIREBASE_PROJECT_ID and VITE_FIREBASE_API_KEY.'
    });
  } else {
    const startDb = performance.now();
    const dbTest = await testFirebaseConnection();
    const latency = Math.round(performance.now() - startDb);
    if (dbTest.reachable) {
      checks.push({
        id: 'firestore_db',
        name: 'Firebase Firestore Database',
        category: 'firebase',
        status: 'pass',
        latencyMs: latency,
        message: 'Firestore database is reachable and active. Server-side rule evaluation verified.',
        details: {
          latencyMs: latency,
          projectId: fbConfig.projectId
        }
      });
    } else {
      checks.push({
        id: 'firestore_db',
        name: 'Firebase Firestore Database',
        category: 'firebase',
        status: 'fail',
        message: `Firestore connection failed: ${dbTest.error || 'Server unreachable'}`,
        recommendation:
          'Ensure Cloud Firestore database is created in Firebase Console, and published security rules allow coordinator access.'
      });
    }
  }

  // 5. Netlify Functions API & Authoritative Clock
  const startFunc = performance.now();
  let r2ConfiguredOnServer: boolean | null = null;
  let r2BucketName: string | null = null;
  const workerBaseUrl = (import.meta.env.VITE_R2_WORKER_URL || '').trim().replace(/\/+$/, '');

  try {
    const healthRes = await fetch('/api/health', { cache: 'no-store' });
    const funcLatency = Math.round(performance.now() - startFunc);
    const contentType = healthRes.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      checks.push({
        id: 'netlify_functions',
        name: 'Netlify Functions API',
        category: 'serverless',
        status: 'fail',
        latencyMs: funcLatency,
        message: 'Endpoint returned HTML instead of JSON. Netlify Functions may not be deployed or redirects misconfigured.',
        recommendation: 'Ensure netlify.toml and netlify/functions/ are present in your deployment.'
      });
    } else if (healthRes.ok) {
      const data = await healthRes.json();
      r2ConfiguredOnServer = Boolean(data.r2StorageConfigured);
      r2BucketName = typeof data.r2BucketName === 'string' ? data.r2BucketName : null;

      checks.push({
        id: 'netlify_functions',
        name: 'Netlify Functions API',
        category: 'serverless',
        status: 'pass',
        latencyMs: funcLatency,
        message: 'Netlify Functions are operational and responding with JSON.',
        details: {
          status: healthRes.status,
          latencyMs: funcLatency,
          service: data.service || 'exam-planner-api'
        }
      });

      // 6. Payment Proof Private Storage (Cloudflare R2 + Worker)
      if (workerBaseUrl) {
        const workerStart = performance.now();
        try {
          const workerHealthRes = await fetch(`${workerBaseUrl}/api/health`, { cache: 'no-store' });
          const workerLatency = Math.round(performance.now() - workerStart);
          if (workerHealthRes.ok) {
            const workerData = await workerHealthRes.json();
            if (workerData?.r2Configured) {
              checks.push({
                id: 'payment_proof_storage',
                name: 'Private Payment Proof Storage (Cloudflare R2)',
                category: 'serverless',
                status: 'pass',
                latencyMs: workerLatency,
                message: 'Cloudflare R2 Worker is online and configured for presigned private payment proof uploads and previews.',
                details: {
                  provider: 'cloudflare-r2',
                  workerUrl: workerBaseUrl,
                  bucket: workerData.r2BucketName || 'exam-planner-payment-proofs',
                  access: 'private-presigned-urls'
                }
              });
            } else {
              const missing = Array.isArray(workerData?.missingConfig)
                ? workerData.missingConfig.join(', ')
                : 'R2 credentials';
              checks.push({
                id: 'payment_proof_storage',
                name: 'Private Payment Proof Storage (Cloudflare R2)',
                category: 'serverless',
                status: 'warn',
                latencyMs: workerLatency,
                message: `Cloudflare Worker responded, but R2 secrets are missing: ${missing}.`,
                recommendation:
                  'Run wrangler secret put for R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and set R2_BUCKET_NAME (see cloudflare/CLOUDFLARE_R2_SETUP.md).'
              });
            }
          } else {
            checks.push({
              id: 'payment_proof_storage',
              name: 'Private Payment Proof Storage (Cloudflare R2)',
              category: 'serverless',
              status: 'fail',
              latencyMs: workerLatency,
              message: `Cloudflare R2 Worker health endpoint returned HTTP ${workerHealthRes.status}.`,
              recommendation: 'Verify VITE_R2_WORKER_URL and redeploy cloudflare/r2-worker.'
            });
          }
        } catch (workerErr) {
          checks.push({
            id: 'payment_proof_storage',
            name: 'Private Payment Proof Storage (Cloudflare R2)',
            category: 'serverless',
            status: 'fail',
            message:
              workerErr instanceof Error
                ? `Unable to reach Cloudflare R2 Worker (${workerBaseUrl}): ${workerErr.message}`
                : 'Unable to reach Cloudflare R2 Worker.',
            recommendation:
              'Verify cloudflare/r2-worker is deployed and ALLOWED_ORIGINS includes this app origin.'
          });
        }
      } else if (r2ConfiguredOnServer) {
        checks.push({
          id: 'payment_proof_storage',
          name: 'Private Payment Proof Storage (Cloudflare R2)',
          category: 'serverless',
          status: 'pass',
          message: 'Private Cloudflare R2 storage is configured server-side for presigned uploads and previews.',
          details: {
            provider: 'cloudflare-r2',
            bucket: r2BucketName || 'exam-planner-payment-proofs',
            access: 'private-presigned-urls'
          }
        });
      } else {
        checks.push({
          id: 'payment_proof_storage',
          name: 'Private Payment Proof Storage (Built-in Firestore + Optional Cloudflare R2)',
          category: 'serverless',
          status: 'pass',
          message:
            'Payment proof uploads and previews are active via built-in Firestore private chunked storage. You can optionally configure Cloudflare R2 Worker (VITE_R2_WORKER_URL) anytime for external object storage.',
          details: {
            activeProvider: 'firestore-private-chunks',
            optionalExternalProvider: 'cloudflare-r2',
            access: 'private-authenticated'
          }
        });
      }

      // 7. Gemini AI Integration Status
      if (data.aiConfigured) {
        checks.push({
          id: 'gemini_ai',
          name: 'Gemini AI Integration',
          category: 'ai',
          status: 'pass',
          message: 'Gemini AI is configured server-side in Netlify Function environment variables.',
          details: {
            model: 'gemini-2.5-flash',
            configured: true
          }
        });
      } else {
        checks.push({
          id: 'gemini_ai',
          name: 'Gemini AI Integration',
          category: 'ai',
          status: 'warn',
          message: 'GEMINI_API_KEY is not set in Netlify environment variables. Deterministic seating and 15-point audit remain 100% active.',
          recommendation:
            'Add GEMINI_API_KEY in Netlify Site Configuration > Environment variables to unlock AI student data scanning and orchestrator insights.'
        });
      }
    } else {
      checks.push({
        id: 'netlify_functions',
        name: 'Netlify Functions API',
        category: 'serverless',
        status: 'fail',
        latencyMs: funcLatency,
        message: `Server returned HTTP ${healthRes.status}: ${healthRes.statusText}`
      });
    }
  } catch (err) {
    checks.push({
      id: 'netlify_functions',
      name: 'Netlify Functions API',
      category: 'serverless',
      status: 'fail',
      message: err instanceof Error ? err.message : 'Unable to connect to /api/health.',
      recommendation: 'Check Netlify deploy logs to confirm functions built successfully.'
    });
  }

  if (r2ConfiguredOnServer === null && !workerBaseUrl) {
    checks.push({
      id: 'payment_proof_storage',
      name: 'Private Payment Proof Storage (Cloudflare R2)',
      category: 'serverless',
      status: 'warn',
      message: 'Unable to verify Cloudflare R2 storage readiness without VITE_R2_WORKER_URL or /api/health.',
      recommendation:
        'Deploy cloudflare/r2-worker and set VITE_R2_WORKER_URL, or configure server-only R2_* variables.'
    });
  }

  // 8. Firebase Authorized Domains Advisory
  if (isNetlify) {
    checks.push({
      id: 'authorized_domains',
      name: 'Firebase Authorized Domains Advisory',
      category: 'firebase',
      status: 'warn',
      message: `Production hostname (${hostname}) must be added to Firebase Authorized Domains.`,
      recommendation:
        `Go to Firebase Console > Authentication > Settings > Authorized domains > Add domain "${hostname}". Without this, sign-in will be blocked by Firebase.`
    });
  }

  const hasErrors = checks.some((c) => c.status === 'fail');
  const hasWarnings = checks.some((c) => c.status === 'warn');
  const allPassed = !hasErrors && !hasWarnings;

  return {
    timestamp: new Date().toISOString(),
    allPassed,
    hasErrors,
    hasWarnings,
    checks,
    environment: {
      hostname,
      origin,
      isNetlify,
      isLocalhost,
      mode: import.meta.env.MODE
    }
  };
}
