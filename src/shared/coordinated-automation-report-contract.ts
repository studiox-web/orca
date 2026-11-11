import { z } from 'zod'

/**
 * What a coordinated worker must echo back in its worker_done `structuredResult`. The host
 * writes it into the Task brief so the worker — a real agent or the pinned stub — never has to
 * guess identities the coordinator will validate exactly.
 */
export const COORDINATED_REPORT_CONTRACT_MARKER = 'orca:coordinated-report-contract'

const ReportContract = z
  .object({
    schemaVersion: z.literal(1),
    automationRunId: z.string().min(1),
    orchestrationRunId: z.string().min(1),
    childDefinitionId: z.string().min(1),
    taskId: z.string().min(1),
    dispatchId: z.string().min(1),
    definitionRevision: z.number().int().positive(),
    resolvedConfigDigest: z.string().min(1),
    /** Check ids the report must carry as passed for the stage and outcome to be accepted. */
    requiredCheckIds: z.array(z.string().min(1))
  })
  .strict()

export type CoordinatedReportContract = z.infer<typeof ReportContract>

/** Appended to the Task spec; one line of JSON so it survives a terminal paste intact. */
export function formatCoordinatedReportContract(contract: CoordinatedReportContract): string {
  return [
    '=== COORDINATED REPORT CONTRACT ===',
    'Finish with worker_done whose --payload JSON carries "taskId", "dispatchId", "outcome" and a',
    '"structuredResult" object: copy every identity field below exactly, then add outcome,',
    'summary, reportMarkdown, artifacts, checks (one passed entry with evidence per required',
    'check id), effects and blockers. A report that changes any identity field is rejected.',
    `<!-- ${COORDINATED_REPORT_CONTRACT_MARKER} ${JSON.stringify(ReportContract.parse(contract))} -->`
  ].join('\n')
}

/** Reads the contract back out of a brief; null when it is absent or was altered. */
export function parseCoordinatedReportContract(brief: string): CoordinatedReportContract | null {
  const start = brief.lastIndexOf(COORDINATED_REPORT_CONTRACT_MARKER)
  if (start === -1) {
    return null
  }
  const open = brief.indexOf('{', start)
  const close = brief.indexOf(' -->', start)
  if (open === -1 || close === -1 || close < open) {
    return null
  }
  let raw: unknown
  try {
    raw = JSON.parse(brief.slice(open, close))
  } catch {
    return null
  }
  const parsed = ReportContract.safeParse(raw)
  return parsed.success ? parsed.data : null
}
