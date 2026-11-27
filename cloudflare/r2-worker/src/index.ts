import { WorkerApiError } from './firebaseAuth';
import {
  getR2ConfigurationStatus,
  handleWorkerAdminPreviewUrl,
  handleWorkerCleanupOrphanProof,
  handleWorkerCreateUploadUrl,
  handleWorkerInstitutionPreviewUrl,
  handleWorkerVerifyUploadedProof,
  type R2WorkerEnv
} from './r2Storage';

function matchesAllowedOrigin(origin: string, allowedPattern: string): boolean {
  const cleanOrigin = origin.trim();
  const cleanPattern = allowedPattern.trim();
  if (!cleanOrigin || !cleanPattern) return false;
  if (cleanPattern === '*') return true;
  if (cleanOrigin === cleanPattern) return true;

  if (cleanPattern.includes('*')) {
    const escaped = cleanPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+');
    return new RegExp(`^${escaped}$`).test(cleanOrigin);
  }
  return false;
}

export function resolveCorsOrigin(request: Request, env: R2WorkerEnv): {
  allowed: boolean;
  allowOriginHeader: string | null;
} {
  const origin = request.headers.get('origin');
  if (!origin) {
    return { allowed: true, allowOriginHeader: null };
  }

  const configured = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (configured.length === 0) {
    return { allowed: false, allowOriginHeader: null };
  }

  const matched = configured.some((pattern) => matchesAllowedOrigin(origin, pattern));
  return matched
    ? { allowed: true, allowOriginHeader: origin }
    : { allowed: false, allowOriginHeader: null };
}

function buildCorsHeaders(allowOriginHeader: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin'
  };
  if (allowOriginHeader) {
    headers['Access-Control-Allow-Origin'] = allowOriginHeader;
  }
  return headers;
}

function jsonResponse(
  data: unknown,
  status: number,
  allowOriginHeader: string | null
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: buildCorsHeaders(allowOriginHeader)
  });
}

export default {
  async fetch(request: Request, env: R2WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    const cors = resolveCorsOrigin(request, env);

    if (request.method === 'OPTIONS') {
      if (!cors.allowed) {
        return jsonResponse(
          { error: 'Origin is not allowed by Worker CORS policy.', code: 'ORIGIN_NOT_ALLOWED' },
          403,
          null
        );
      }
      return new Response(null, {
        status: 204,
        headers: buildCorsHeaders(cors.allowOriginHeader)
      });
    }

    if (!cors.allowed) {
      return jsonResponse(
        { error: 'Origin is not allowed by Worker CORS policy.', code: 'ORIGIN_NOT_ALLOWED' },
        403,
        null
      );
    }

    if (url.pathname === '/api/health' || url.pathname === '/health') {
      const r2 = getR2ConfigurationStatus(env);
      return jsonResponse(
        {
          ok: true,
          service: 'exam-planner-r2-worker',
          storageProvider: 'cloudflare-r2',
          r2Configured: r2.configured,
          missingConfig: r2.missing,
          r2BucketName: r2.bucketName,
          firebaseProjectId: env.FIREBASE_PROJECT_ID || null,
          serverTimeMs: Date.now()
        },
        200,
        cors.allowOriginHeader
      );
    }

    if (request.method !== 'POST') {
      return jsonResponse(
        { error: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' },
        405,
        cors.allowOriginHeader
      );
    }

    let body: Record<string, unknown> = {};
    try {
      body = ((await request.json()) ?? {}) as Record<string, unknown>;
    } catch {
      return jsonResponse(
        { error: 'Invalid JSON request payload.', code: 'INVALID_JSON' },
        400,
        cors.allowOriginHeader
      );
    }

    const authHeader = request.headers.get('authorization');

    try {
      if (url.pathname === '/api/payment-proof/upload-url') {
        const res = await handleWorkerCreateUploadUrl({ env, authHeader, body });
        return jsonResponse(res, 200, cors.allowOriginHeader);
      }
      if (url.pathname === '/api/payment-proof/verify') {
        const res = await handleWorkerVerifyUploadedProof({ env, authHeader, body });
        return jsonResponse(res, 200, cors.allowOriginHeader);
      }
      if (url.pathname === '/api/payment-proof/cleanup') {
        const res = await handleWorkerCleanupOrphanProof({ env, authHeader, body });
        return jsonResponse(res, 200, cors.allowOriginHeader);
      }
      if (url.pathname === '/api/payment-proof/preview-url') {
        const res = await handleWorkerAdminPreviewUrl({ env, authHeader, body });
        return jsonResponse(res, 200, cors.allowOriginHeader);
      }
      if (url.pathname === '/api/payment-proof/institution-preview-url') {
        const res = await handleWorkerInstitutionPreviewUrl({ env, authHeader, body });
        return jsonResponse(res, 200, cors.allowOriginHeader);
      }

      return jsonResponse(
        { error: `Unknown Worker endpoint: ${url.pathname}`, code: 'NOT_FOUND' },
        404,
        cors.allowOriginHeader
      );
    } catch (err) {
      const status = err instanceof WorkerApiError ? err.status : 500;
      const code = err instanceof WorkerApiError ? err.code : 'INTERNAL_ERROR';
      const message = err instanceof Error ? err.message : 'Unexpected Cloudflare Worker error.';
      return jsonResponse({ error: message, code }, status, cors.allowOriginHeader);
    }
  }
};
