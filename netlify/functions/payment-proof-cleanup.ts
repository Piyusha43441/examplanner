import {
  handleCleanupOrphanProof,
  PaymentStorageApiError
} from '../../server/paymentProofService';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store'
};

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: corsHeaders
    });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON request payload.', code: 'INVALID_JSON' }),
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const result = await handleCleanupOrphanProof({
      authHeader: req.headers.get('authorization'),
      body
    });
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    const status = err instanceof PaymentStorageApiError ? err.status : 500;
    const code = err instanceof PaymentStorageApiError ? err.code : 'INTERNAL_ERROR';
    const message = err instanceof Error ? err.message : 'Unable to clean up orphaned payment proof.';
    return new Response(JSON.stringify({ error: message, code }), {
      status,
      headers: corsHeaders
    });
  }
};
