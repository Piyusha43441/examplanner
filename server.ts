import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { GoogleGenAI, Type } from '@google/genai';

const PORT = 3000;
const MAX_UPLOAD_BODY_BYTES = 6 * 1024 * 1024;

type LocalWorkerRuntime = {
  handler: (request: Request, env: Record<string, unknown>) => Promise<Response>;
  env: Record<string, unknown>;
};

let localWorkerPromise: Promise<LocalWorkerRuntime> | null = null;

function createLocalD1Adapter(sqlite: DatabaseSync) {
  const wrapStmt = (sql: string, boundArgs: unknown[] = []) => {
    const execRun = () => {
      const stmt = sqlite.prepare(sql);
      const info = stmt.run(...(boundArgs as (string | number | Uint8Array | null)[]));
      return {
        success: true,
        meta: {
          duration: 1,
          size_after: 0,
          rows_read: 0,
          rows_written: Number(info.changes || 0),
          last_row_id: Number(info.lastInsertRowid || 0),
          changed_db: Number(info.changes || 0) > 0,
          changes: Number(info.changes || 0)
        },
        results: []
      };
    };

    return {
      bind: (...args: unknown[]) => wrapStmt(sql, args),
      first: async <T = Record<string, unknown>>(colName?: string): Promise<T | null> => {
        const stmt = sqlite.prepare(sql);
        const row = stmt.get(...(boundArgs as (string | number | Uint8Array | null)[])) as
          | Record<string, unknown>
          | undefined;
        if (!row) return null;
        if (colName) return (row[colName] as T) ?? null;
        return row as T;
      },
      all: async <T = Record<string, unknown>>() => {
        const stmt = sqlite.prepare(sql);
        const rows = stmt.all(...(boundArgs as (string | number | Uint8Array | null)[])) as T[];
        return {
          success: true,
          meta: {
            duration: 1,
            size_after: 0,
            rows_read: rows.length,
            rows_written: 0,
            last_row_id: 0,
            changed_db: false,
            changes: 0
          },
          results: rows
        };
      },
      run: async () => execRun(),
      raw: async () => [],
      _execSync: execRun
    };
  };

  return {
    prepare: (sql: string) => wrapStmt(sql),
    batch: async (statements: Array<{ _execSync: () => unknown }>) => {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((s) => s._execSync());
        sqlite.exec('COMMIT');
        return results;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    exec: async (sql: string) => {
      sqlite.exec(sql);
      return { count: 1, duration: 1 };
    }
  };
}

function createLocalR2Adapter(proofRootDir: string) {
  fs.mkdirSync(proofRootDir, { recursive: true });

  const resolveSafePaths = (key: string) => {
    if (!key || key.includes('\0') || key.includes('..') || path.isAbsolute(key)) {
      throw new Error('Invalid storage key.');
    }
    const dataPath = path.resolve(proofRootDir, key);
    if (!dataPath.startsWith(proofRootDir + path.sep)) {
      throw new Error('Storage key escapes local bucket directory.');
    }
    const metaPath = `${dataPath}.meta.json`;
    return { dataPath, metaPath };
  };

  return {
    put: async (
      key: string,
      value: ArrayBuffer | ArrayBufferView | Blob | string,
      opts?: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> }
    ) => {
      const { dataPath, metaPath } = resolveSafePaths(key);
      fs.mkdirSync(path.dirname(dataPath), { recursive: true });

      let bytes: Uint8Array;
      if (value instanceof Uint8Array) {
        bytes = value;
      } else if (ArrayBuffer.isView(value)) {
        bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      } else if (value instanceof ArrayBuffer) {
        bytes = new Uint8Array(value);
      } else if (typeof value === 'string') {
        bytes = new TextEncoder().encode(value);
      } else {
        bytes = new Uint8Array(await value.arrayBuffer());
      }

      fs.writeFileSync(dataPath, bytes);
      fs.writeFileSync(
        metaPath,
        JSON.stringify({
          size: bytes.byteLength,
          httpMetadata: opts?.httpMetadata ?? {},
          customMetadata: opts?.customMetadata ?? {}
        })
      );
      return { key, size: bytes.byteLength };
    },
    head: async (key: string) => {
      const { dataPath, metaPath } = resolveSafePaths(key);
      if (!fs.existsSync(dataPath)) return null;
      const stat = fs.statSync(dataPath);
      let meta: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> } = {};
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
      return {
        key,
        size: stat.size,
        httpMetadata: meta.httpMetadata,
        customMetadata: meta.customMetadata
      };
    },
    get: async (key: string) => {
      const { dataPath, metaPath } = resolveSafePaths(key);
      if (!fs.existsSync(dataPath)) return null;
      const bytes = new Uint8Array(fs.readFileSync(dataPath));
      let meta: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> } = {};
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
      return {
        key,
        size: bytes.byteLength,
        httpMetadata: meta.httpMetadata,
        customMetadata: meta.customMetadata,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          }
        })
      };
    }
  };
}

async function getLocalWorkerRuntime(): Promise<LocalWorkerRuntime> {
  if (!localWorkerPromise) {
    localWorkerPromise = (async () => {
      const rootDir = import.meta.dirname;
      const dataDir = path.resolve(rootDir, '.local-data');
      fs.mkdirSync(dataDir, { recursive: true });

      const sqlite = new DatabaseSync(path.join(dataDir, 'exam_planner_preview.db'));
      const migrationPath = path.resolve(rootDir, 'cloudflare', 'migrations', '0001_init.sql');
      sqlite.exec(fs.readFileSync(migrationPath, 'utf8'));

      const firebaseConfigPath = path.resolve(rootDir, 'firebase-applet-config.json');
      const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8')) as {
        projectId?: string;
        firestoreDatabaseId?: string;
      };

      const workerModuleUrl = pathToFileURL(
        path.resolve(rootDir, 'cloudflare', 'src', 'index.ts')
      ).href;
      const workerMod = (await import(workerModuleUrl)) as {
        createWorkerHandler: () => (request: Request, env: Record<string, unknown>) => Promise<Response>;
      };

      return {
        handler: workerMod.createWorkerHandler(),
        env: {
          DB: createLocalD1Adapter(sqlite),
          PROOF_BUCKET: createLocalR2Adapter(path.join(dataDir, 'r2-proofs')),
          FIREBASE_PROJECT_ID: firebaseConfig.projectId || 'abstract-freehold-6cf5x',
          FIREBASE_DATABASE_ID:
            firebaseConfig.firestoreDatabaseId || 'ai-studio-57bf1b23-c825-4dd4-8d38-a183f4ad98fb',
          ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'agarwalpiyush263@gmail.com',
          ALLOWED_ORIGINS: ''
        }
      };
    })();
  }
  return localWorkerPromise;
}

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build'
      }
    }
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      aiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY')
    });
  });

  // Authoritative server clock for subscription validity calculations
  app.get('/api/server-time', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const nowMs = Date.now();
    res.json({
      nowMs,
      iso: new Date(nowMs).toISOString()
    });
  });

  // Proxy to deployed Cloudflare Worker when CLOUDFLARE_WORKER_URL is configured;
  // otherwise run the Worker logic against local SQLite + private disk storage for preview continuity.
  const cloudflarePrefixes = [
    '/api/subscription',
    '/api/payment',
    '/api/notifications',
    '/api/admin',
    '/api/examinations'
  ];
  app.use(cloudflarePrefixes, async (req, res) => {
    const targetBase = (process.env.CLOUDFLARE_WORKER_URL || '').trim().replace(/\/+$/, '');
    const forwardHeaders = new Headers();
    const authHeader = req.header('authorization');
    const contentTypeHeader = req.header('content-type');
    const originHeader = req.header('origin');
    if (authHeader) forwardHeaders.set('Authorization', authHeader);
    if (contentTypeHeader) forwardHeaders.set('Content-Type', contentTypeHeader);
    if (originHeader) forwardHeaders.set('Origin', originHeader);

    let rawBody: Buffer | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (contentTypeHeader && contentTypeHeader.toLowerCase().includes('application/json')) {
        rawBody = Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
      } else {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        for await (const chunk of req) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.byteLength;
          if (totalBytes > MAX_UPLOAD_BODY_BYTES) {
            res.status(413).json({
              error: 'Uploaded file exceeds the 5 MB limit.',
              code: 'FILE_TOO_LARGE'
            });
            return;
          }
          chunks.push(buf);
        }
        rawBody = Buffer.concat(chunks);
      }
    }

    if (targetBase) {
      try {
        const upstream = await fetch(`${targetBase}${req.originalUrl}`, {
          method: req.method,
          headers: forwardHeaders,
          body: rawBody ? new Uint8Array(rawBody) : undefined
        });
        res.status(upstream.status);
        upstream.headers.forEach((value, key) => {
          if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-encoding') {
            res.setHeader(key, value);
          }
        });
        res.send(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        res.status(502).json({
          error: err instanceof Error ? err.message : 'Failed to proxy request to Cloudflare Worker.',
          code: 'CLOUDFLARE_PROXY_ERROR'
        });
      }
      return;
    }

    try {
      const runtime = await getLocalWorkerRuntime();
      const protocol = req.protocol || 'http';
      const host = req.get('host') || `localhost:${PORT}`;
      const webReq = new Request(`${protocol}://${host}${req.originalUrl}`, {
        method: req.method,
        headers: forwardHeaders,
        body: rawBody ? new Uint8Array(rawBody) : undefined
      });
      const workerRes = await runtime.handler(webReq, runtime.env);
      res.status(workerRes.status);
      workerRes.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'transfer-encoding' && key.toLowerCase() !== 'content-encoding') {
          res.setHeader(key, value);
        }
      });
      res.send(Buffer.from(await workerRes.arrayBuffer()));
    } catch (err) {
      res.status(503).json({
        error:
          err instanceof Error
            ? err.message
            : 'Cloudflare Worker API is not configured. Deploy /cloudflare and set VITE_CLOUDFLARE_API_URL.',
        code: 'CLOUDFLARE_NOT_CONFIGURED'
      });
    }
  });

  // Agent 1: AI Data Scanner
  app.post('/api/ai/scan-data', async (req, res) => {
    try {
      const ai = getAiClient();
      if (!ai) {
        res.status(503).json({
          error: 'Gemini AI analysis is not configured. Deterministic validation remains active.'
        });
        return;
      }

      const { headers, sampleRows, totalRows, emptyRowCount } = req.body ?? {};
      if (!Array.isArray(headers) || !Array.isArray(sampleRows)) {
        res.status(400).json({ error: 'Invalid payload: headers and sampleRows arrays required.' });
        return;
      }

      // Cap sample rows and strip excessive values for privacy & payload safety
      const safeHeaders = headers.slice(0, 30).map((h: unknown) => String(h).slice(0, 80));
      const safeSample = sampleRows.slice(0, 15).map((row: Record<string, unknown>) => {
        const out: Record<string, string> = {};
        for (const h of safeHeaders) {
          out[h] = String(row?.[h] ?? '').slice(0, 100);
        }
        return out;
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: JSON.stringify({
          task: 'Scan uploaded student spreadsheet columns and sample rows for roll-number formatting, missing names, unexpected characters, or structural issues.',
          headers: safeHeaders,
          sampleRows: safeSample,
          totalRows: Number(totalRows) || safeSample.length,
          emptyRowCount: Number(emptyRowCount) || 0
        }),
        config: {
          systemInstruction:
            'You are Agent 1 (Data Scanner) for EXAM PLANNER. Analyze uploaded tabular student data headers and sample rows. Identify the roll number column, optional name/class/section/subject columns, formatting anomalies (leading zeros, inconsistent prefixes, suspicious characters), and missing name policy reminders. Remember: missing student names are a warning, never a critical error, and roll numbers must never be modified or rounded.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedRollColumn: { type: Type.STRING },
              detectedNameColumn: { type: Type.STRING },
              findings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    severity: { type: Type.STRING },
                    title: { type: Type.STRING },
                    recommendation: { type: Type.STRING }
                  }
                }
              },
              summary: { type: Type.STRING }
            }
          }
        }
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      console.error('AI scan-data error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI Data Scanner encountered an error.'
      });
    }
  });

  // Agents 2-6: Validation, Capacity, Seating Audit, PDF Quality Check & Orchestrator
  app.post('/api/ai/orchestrate-audit', async (req, res) => {
    try {
      const ai = getAiClient();
      if (!ai) {
        res.status(503).json({
          error: 'Gemini AI orchestrator is not configured. Deterministic audit results are authoritative.'
        });
        return;
      }

      const { examMeta, capacitySummary, auditReport, pdfPreviewMeta, rollSample } = req.body ?? {};
      if (!auditReport || typeof auditReport !== 'object') {
        res.status(400).json({ error: 'auditReport object is required.' });
        return;
      }

      const payload = {
        examMeta: {
          name: String(examMeta?.name ?? '').slice(0, 160),
          examDate: String(examMeta?.examDate ?? '').slice(0, 40),
          seatingMode: examMeta?.seatingMode === 2 ? 'Two students per bench' : 'One student per bench',
          strategy: String(examMeta?.strategy ?? 'sequential').slice(0, 40)
        },
        capacitySummary: {
          totalStudents: Number(auditReport.totalStudents ?? 0),
          totalBenches: Number(auditReport.totalBenches ?? 0),
          activeBenches: Number(auditReport.activeBenches ?? 0),
          totalCapacity: Number(auditReport.totalCapacity ?? 0),
          unusedSeats: Number(auditReport.unusedSeats ?? 0),
          capacitySufficient: Boolean(auditReport.capacitySufficient),
          classroomCount: Number(capacitySummary?.totalClassrooms ?? 0)
        },
        deterministicAudit: {
          status: auditReport.status,
          allocatedStudents: auditReport.allocatedStudents,
          unallocatedStudents: auditReport.unallocatedStudents,
          duplicateAssignments: auditReport.duplicateAssignments,
          missingStudents: auditReport.missingStudents,
          issues: Array.isArray(auditReport.issues) ? auditReport.issues.slice(0, 20) : []
        },
        pdfPreviewMeta: {
          maxRollLength: Number(pdfPreviewMeta?.maxRollLength ?? 0),
          missingNamesCount: Number(pdfPreviewMeta?.missingNamesCount ?? 0),
          classroomCount: Number(pdfPreviewMeta?.classroomCount ?? 0)
        },
        rollSample: Array.isArray(rollSample) ? rollSample.slice(0, 10).map((r) => String(r).slice(0, 64)) : []
      };

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: JSON.stringify(payload),
        config: {
          systemInstruction:
            'You are Agent 6 (Orchestrator) coordinating Agents 2 (Data Validation), 3 (Classroom Capacity), 4 (Seating Audit), and 5 (PDF Quality Check) for EXAM PLANNER. Never override or alter the deterministic audit status or roll numbers. Explain any detected issues in plain, practical language for an examination coordinator, recommend concrete fixes if capacity is short or duplicates exist, and provide PDF layout/readability guidance (e.g., landscape orientation for 2-student mode or long roll numbers).',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              orchestratorSummary: { type: Type.STRING },
              dataValidationNote: { type: Type.STRING },
              capacityAdvice: { type: Type.STRING },
              seatingAuditNote: { type: Type.STRING },
              pdfQualityCheck: { type: Type.STRING },
              recommendedActions: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            }
          }
        }
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      console.error('AI orchestrate-audit error:', err);
      res.status(500).json({
        error: err instanceof Error ? err.message : 'AI Orchestrator encountered an error.'
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EXAM PLANNER server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
