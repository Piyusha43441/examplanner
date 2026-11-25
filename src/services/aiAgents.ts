import { AuditReport, CapacitySummary, ExamRecord } from '../core/types';

export interface AiDataScanFinding {
  severity: string;
  title: string;
  recommendation: string;
}

export interface AiDataScanResponse {
  detectedRollColumn?: string;
  detectedNameColumn?: string;
  findings?: AiDataScanFinding[];
  summary?: string;
}

export interface AiOrchestratorResponse {
  orchestratorSummary: string;
  dataValidationNote: string;
  capacityAdvice: string;
  seatingAuditNote: string;
  pdfQualityCheck: string;
  recommendedActions: string[];
}

export async function runAiDataScanner(params: {
  headers: string[];
  sampleRows: Record<string, string>[];
  totalRows: number;
  emptyRowCount: number;
}): Promise<AiDataScanResponse> {
  const res = await fetch('/api/ai/scan-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'AI Data Scanner failed.');
  }
  return data as AiDataScanResponse;
}

export async function runAiOrchestratedAudit(params: {
  examMeta: Pick<ExamRecord, 'name' | 'examDate' | 'seatingMode' | 'strategy'>;
  capacitySummary: CapacitySummary;
  auditReport: AuditReport;
  pdfPreviewMeta: {
    maxRollLength: number;
    missingNamesCount: number;
    classroomCount: number;
  };
  rollSample: string[];
}): Promise<AiOrchestratorResponse> {
  const res = await fetch('/api/ai/orchestrate-audit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'AI Orchestrator failed.');
  }
  return data as AiOrchestratorResponse;
}
