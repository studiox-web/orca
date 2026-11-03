// XOS fork: stage A runtime types shared by main and renderer (model picker, later fallbacks,
// lane locks and run timeouts).

export type XosCatalogModel = {
  id: string
  label: string
  description?: string
  isDefault: boolean
  defaultEffort?: string
  efforts: { value: string; label: string }[]
}

export type XosModelList =
  | { status: 'ok'; models: XosCatalogModel[]; fetchedAt: number | null }
  /** No catalog for this agent on this host (no chat runtime, not signed in, or still listing). */
  | { status: 'unavailable'; message: string }

/** One entry of an automation's model chain: the primary (from its arguments) or a fallback. */
export type XosModelChoice = { agent: string; model: string | null; effort: string | null }

export type XosAutomationRunConfig = {
  /** Tried in order after the primary model when a run hits a usage limit (RT5). */
  fallbacks: XosModelChoice[]
  /** Scheduled runs always fall back; manual "Run now" runs only when this is on (plan §3.4). */
  fallbackOnManualRuns: boolean
}

export type XosRunLimitKind = 'usage-limit' | 'overloaded' | 'auth' | 'missing-binary'

/** One run of an automation as the fork recorded it: which model ran, and why (RT6, GD2). */
export type XosRunAttempt = {
  runId: string
  automationId: string
  at: string
  /** 0 = the primary model; 1+ = position in the fallback chain. */
  attempt: number
  /** The first run of the chain this attempt belongs to. */
  rootRunId: string
  parentRunId: string | null
  agent: string
  model: string | null
  effort: string | null
  /** Why this attempt exists (the previous attempt's limit), null for the first. */
  reason: string | null
  outcome: {
    kind: XosRunLimitKind | 'ok' | 'failed'
    detail: string | null
    at: string
  } | null
}

export type XosRuntimeApi = {
  listModels: (args: { agent: string }) => Promise<XosModelList>
  getRunConfig: (args: { automationId: string }) => Promise<XosAutomationRunConfig>
  setRunConfig: (args: {
    automationId: string
    config: XosAutomationRunConfig
  }) => Promise<{ ok: true } | { ok: false; error: string }>
  /** Newest first. */
  getRunAttempts: (args: { automationId: string; limit: number }) => Promise<XosRunAttempt[]>
}
