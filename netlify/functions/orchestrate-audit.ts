import { GoogleGenAI, Type } from '@google/genai';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.length < 10) {
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

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const ai = getAiClient();
    if (!ai) {
      return new Response(
        JSON.stringify({
          error: 'Gemini AI orchestrator is not configured. Deterministic audit results are authoritative.'
        }),
        { status: 503, headers: corsHeaders }
      );
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON request payload.' }), {
        status: 400,
        headers: corsHeaders
      });
    }

    const { examMeta, capacitySummary, auditReport, pdfPreviewMeta, rollSample } = body ?? {};
    if (!auditReport || typeof auditReport !== 'object') {
      return new Response(
        JSON.stringify({ error: 'auditReport object is required.' }),
        { status: 400, headers: corsHeaders }
      );
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
      rollSample: Array.isArray(rollSample) ? rollSample.slice(0, 10).map((r: unknown) => String(r).slice(0, 64)) : []
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
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    console.error('Netlify orchestrate-audit function error:', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'AI Orchestrator encountered an error.'
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
