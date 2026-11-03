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
  /** RT7: runs in one lane of a repo never overlap, also with legacy crontab runs (same flock
   *  files). Setting a lane also stops two runs of this automation from overlapping. */
  lockLane: string | null
  /** With a busy lane: 0 skips the run; otherwise it is queued and starts when the lane frees,
   *  if that happens within this many minutes. */
  lockWaitMinutes: number
  /** RT15: stop a terminal run that is still going after this many minutes. */
  timeoutMinutes: number | null
  /** RT8: after a finished run, commit the changes under these paths (and optionally push). */
  autoCommit: XosAutoCommitConfig | null
  /** Plan §3.3: pick the model at dispatch from a tier, by remaining quota. */
  auto: XosAutoModeConfig | null
}

export type XosAutoCommitConfig = {
  /** Repo-relative paths or git pathspecs (the legacy goal's owned paths). */
  paths: string[]
  /** Null: "chore(automation): <name>". */
  message: string | null
  /** Push to the branch's upstream after committing. */
  push: boolean
}

export type XosModelTier = 'high' | 'standard' | 'light'

export type XosAutoModeConfig = {
  tier: XosModelTier
  /** Allowed agents, in preference order (breaks ties). */
  providers: string[]
  /** Never use the last N% of a weekly window (kept for interactive work). */
  reservePercent: number
  /** Applied when the picked model supports it; otherwise the agent's default. */
  effort: string | null
}

/** One model as Auto mode sees it: its tier (default or edited) and its provider's quota. */
export type XosTierModel = {
  agent: string
  model: string
  label: string
  tier: XosModelTier | null
  /** True when the tier comes from the editable map rather than the name. */
  edited: boolean
}

export type XosAutoCandidate = {
  choice: XosModelChoice
  /** Short quota note, e.g. "weekly 40% used, resets in 2d". */
  quota: string
  available: boolean
}

export type XosAutoPreview = {
  candidates: XosAutoCandidate[]
  /** Why Auto would pick the first candidate now. */
  reason: string
}

export type XosLegacyCommitPolicy = { goal: string; paths: string[] }

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
  /** RT8: what the post-run commit did. */
  commit: XosRunCommit | null
}

export type XosRunCommit = {
  status: 'committed' | 'nothing' | 'skipped' | 'failed'
  sha: string | null
  files: number
  /** Null when not asked to push or the branch has no upstream. */
  pushed: boolean | null
  detail: string | null
  at: string
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
  /** Commit policies parsed from the project's legacy commit-automation-changes.sh. */
  getLegacyCommitPolicies: (args: { repoPath: string }) => Promise<XosLegacyCommitPolicy[]>
  /** Catalog models of the given agents with their tier. */
  getTierModels: (args: { agents: string[] }) => Promise<XosTierModel[]>
  setModelTier: (args: { agent: string; model: string; tier: XosModelTier | null }) => Promise<void>
  /** What Auto would pick right now for this config. */
  previewAuto: (args: { auto: XosAutoModeConfig }) => Promise<XosAutoPreview>
}
