import 'dotenv/config';
import express from 'express';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import {
  getR2ConfigurationStatus,
  handleAdminPreviewUrl,
  handleCleanupOrphanProof,
  handleCreateUploadUrl,
  handleInstitutionPreviewUrl,
  handleVerifyUploadedProof,
  PaymentStorageApiError
} from './server/paymentProofService.ts';

const PORT = 3000;

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
    const r2Status = getR2ConfigurationStatus();
    const r2WorkerUrl = (process.env.VITE_R2_WORKER_URL || '').trim();
    res.json({
      ok: true,
      service: 'exam-planner-api',
      storageProvider: 'cloudflare-r2',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
      r2StorageConfigured: r2Status.configured,
      r2MissingConfig: r2Status.missing,
      r2BucketName: r2Status.bucketName,
      r2WorkerConfigured: Boolean(r2WorkerUrl && r2WorkerUrl.startsWith('https://'))
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

  // Cloudflare R2 private payment proof storage routes (fallback when VITE_R2_WORKER_URL is unset)
  const sendPaymentProofError = (res: express.Response, err: unknown, fallbackMessage: string) => {
    const status = err instanceof PaymentStorageApiError ? err.status : 500;
    const code = err instanceof PaymentStorageApiError ? err.code : 'INTERNAL_ERROR';
    const message = err instanceof Error ? err.message : fallbackMessage;
    res.status(status).setHeader('Cache-Control', 'no-store').json({ error: message, code });
  };

  app.post('/api/payment-proof/upload-url', async (req, res) => {
    try {
      const result = await handleCreateUploadUrl({
        authHeader: req.headers.authorization || null,
        body: req.body ?? {}
      });
      res.setHeader('Cache-Control', 'no-store').json(result);
    } catch (err) {
      sendPaymentProofError(res, err, 'Unable to create signed upload URL.');
    }
  });

  app.post('/api/payment-proof/verify', async (req, res) => {
    try {
      const result = await handleVerifyUploadedProof({
        authHeader: req.headers.authorization || null,
        body: req.body ?? {}
      });
      res.setHeader('Cache-Control', 'no-store').json(result);
    } catch (err) {
      sendPaymentProofError(res, err, 'Unable to verify uploaded payment proof.');
    }
  });

  app.post('/api/payment-proof/cleanup', async (req, res) => {
    try {
      const result = await handleCleanupOrphanProof({
        authHeader: req.headers.authorization || null,
        body: req.body ?? {}
      });
      res.setHeader('Cache-Control', 'no-store').json(result);
    } catch (err) {
      sendPaymentProofError(res, err, 'Unable to clean up orphaned payment proof.');
    }
  });

  app.post('/api/payment-proof/preview-url', async (req, res) => {
    try {
      const result = await handleAdminPreviewUrl({
        authHeader: req.headers.authorization || null,
        body: req.body ?? {}
      });
      res.setHeader('Cache-Control', 'no-store').json(result);
    } catch (err) {
      sendPaymentProofError(res, err, 'Unable to generate administrator preview URL.');
    }
  });

  app.post('/api/payment-proof/institution-preview-url', async (req, res) => {
    try {
      const result = await handleInstitutionPreviewUrl({
        authHeader: req.headers.authorization || null,
        body: req.body ?? {}
      });
      res.setHeader('Cache-Control', 'no-store').json(result);
    } catch (err) {
      sendPaymentProofError(res, err, 'Unable to generate institution preview URL.');
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
        model: 'gemini-2.5-flash',
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
        model: 'gemini-2.5-flash',
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
