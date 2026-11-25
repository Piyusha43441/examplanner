import { HttpError } from './http';

export async function enforceRateLimit(
  db: D1Database,
  rateKey: string,
  maxRequests: number,
  windowMs: number,
  nowMs: number
): Promise<void> {
  const existing = await db
    .prepare('SELECT window_start_ms, request_count FROM rate_limits WHERE rate_key = ?')
    .bind(rateKey)
    .first<{ window_start_ms: number; request_count: number }>();

  if (!existing || nowMs - existing.window_start_ms >= windowMs) {
    await db
      .prepare(
        `INSERT INTO rate_limits (rate_key, window_start_ms, request_count)
         VALUES (?, ?, 1)
         ON CONFLICT(rate_key) DO UPDATE SET
           window_start_ms = excluded.window_start_ms,
           request_count = 1`
      )
      .bind(rateKey, nowMs)
      .run();
    return;
  }

  if (existing.request_count >= maxRequests) {
    throw new HttpError(
      429,
      'Too many requests. Please wait a moment before trying again.',
      'RATE_LIMITED'
    );
  }

  await db
    .prepare('UPDATE rate_limits SET request_count = request_count + 1 WHERE rate_key = ?')
    .bind(rateKey)
    .run();
}
