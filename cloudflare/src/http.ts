import { Env } from './types';

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, message: string, code = 'REQUEST_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function parseAllowedOrigins(env: Env): string[] {
  const raw = env.ALLOWED_ORIGINS || '';
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export function buildCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = (request.headers.get('Origin') || '').trim().replace(/\/+$/, '');
  const allowed = parseAllowedOrigins(env);

  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Idempotency-Key',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };

  if (origin && (allowed.length === 0 || allowed.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
  } else if (allowed.length > 0 && origin) {
    // Disallow unknown cross-origin browser requests while still letting server-side/same-origin work
    headers['Access-Control-Allow-Origin'] = allowed[0];
  }

  return headers;
}

export function jsonResponse(
  data: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders,
      ...(extraHeaders || {})
    }
  });
}

export function errorResponse(
  err: unknown,
  corsHeaders: Record<string, string>
): Response {
  if (err instanceof HttpError) {
    return jsonResponse(
      {
        error: err.message,
        code: err.code
      },
      err.status,
      corsHeaders
    );
  }
  const message = err instanceof Error ? err.message : 'Internal server error.';
  return jsonResponse(
    {
      error: message,
      code: 'INTERNAL_ERROR'
    },
    500,
    corsHeaders
  );
}

export async function parseJsonBody<T>(request: Request): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.', 'INVALID_JSON');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new HttpError(400, 'Request body must be a JSON object.', 'INVALID_BODY');
  }
  return raw as T;
}
