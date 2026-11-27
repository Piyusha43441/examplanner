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
          error: 'Gemini AI analysis is not configured. Deterministic validation remains active.'
        }),
        {
          status: 503,
          headers: corsHeaders
        }
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

    const { headers, sampleRows, totalRows, emptyRowCount } = body ?? {};
    if (!Array.isArray(headers) || !Array.isArray(sampleRows)) {
      return new Response(
        JSON.stringify({ error: 'Invalid payload: headers and sampleRows arrays required.' }),
        { status: 400, headers: corsHeaders }
      );
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
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: corsHeaders
    });
  } catch (err) {
    console.error('Netlify scan-data function error:', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'AI Data Scanner encountered an error.'
      }),
      { status: 500, headers: corsHeaders }
    );
  }
};
