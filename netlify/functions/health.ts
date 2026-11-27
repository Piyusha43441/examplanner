const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const aiConfigured = Boolean(apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.length > 10);

  const missing: string[] = [];
  if (!(process.env.R2_ACCOUNT_ID || '').trim()) missing.push('R2_ACCOUNT_ID');
  if (!(process.env.R2_ACCESS_KEY_ID || '').trim()) missing.push('R2_ACCESS_KEY_ID');
  if (!(process.env.R2_SECRET_ACCESS_KEY || '').trim()) missing.push('R2_SECRET_ACCESS_KEY');
  const r2BucketName = (process.env.R2_BUCKET_NAME || '').trim() || null;
  if (!r2BucketName) missing.push('R2_BUCKET_NAME');

  const r2WorkerUrl = (process.env.VITE_R2_WORKER_URL || '').trim();
  const r2WorkerConfigured = Boolean(r2WorkerUrl && r2WorkerUrl.startsWith('https://'));

  const nowMs = Date.now();

  return new Response(
    JSON.stringify({
      ok: true,
      service: 'exam-planner-api',
      environment: 'production',
      storageProvider: 'cloudflare-r2',
      aiConfigured,
      r2StorageConfigured: missing.length === 0,
      r2MissingConfig: missing,
      r2BucketName,
      r2WorkerConfigured,
      serverTimeMs: nowMs,
      iso: new Date(nowMs).toISOString()
    }),
    {
      status: 200,
      headers: {
        ...corsHeaders,
        'Cache-Control': 'no-store'
      }
    }
  );
};
