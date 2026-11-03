// XOS fork: goal board data shared by main and renderer. Shapes follow the Cascade/DJVibe
// Command Centre (`types/command-centre.ts`) so the ported card UI needs few changes.

export type XosGoalRun = {
  goal: string
  runner: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  duration_seconds: number | null
  exit_code?: number | null
  log_path: string
  model?: string | null
  reasoning_effort?: string | null
  failure_reason?: string | null
}

export type XosGoalUsage = {
  ts: string | null
  feature: string
  actual_tokens: number
  estimated_cost_usd: number
  model: string
}

export type XosGoalArea = {
  id: string
  title: string
  description: string
  manager: string
}

export type XosGoalLog = {
  goal: string
  filename: string
  path: string
  first_line: string
}

/** One legacy crontab line, as the board shows and controls it. */
export type XosCronJob = {
  id: string
  schedule: string
  command: string
  name: string
  workdir: string | null
  logPath: string | null
  goal: string | null
  runner: string | null
  paused: boolean
  nextRunAt: string | null
}

export type XosRunningJob = {
  goal: string | null
  pid: number
  startedAt: string
  elapsedSeconds: number
  runner: string | null
  command: string
}

export type XosGoal = {
  goal: string
  title: string
  area: XosGoalArea
  status: Record<string, string>
  lastRun: string | null
  nextRun: string | null
  result: string
  detail: string
  adminSummary: string | null
  /** Every cron line for this goal is paused (and at least one exists). */
  paused: boolean
  running: XosRunningJob | null
  viewer: {
    slug: string
    goalPath: string
    statusPath: string
    logDirectory: string
    configuredModel: string | null
    configuredReasoning: string | null
    agents: string[]
    lockLane: string | null
    estimatedRuntime: string | null
    contractStatus: string
    statusUpdatedAt: string | null
    latestRun: XosGoalRun | null
    recentRuns: XosGoalRun[]
    latestUsage: XosGoalUsage | null
    usage7d: {
      runs: number
      tokens: number
      maxRunTokens: number
      maxRunCost: number
      maxRunModel: string | null
    }
    usage30d: { runs: number; tokens: number; cost: number; models: string[] }
    subagents: {
      configured: boolean
      heavy: boolean
      mode: string | null
      names: string[]
      expectedCount: number
      tokens7d: number
      maxRunTokens7d: number
    }
    cron: { configured: boolean; schedules: string[]; jobs: XosCronJob[] }
    statusFields: { key: string; label: string; value: string }[]
  }
  logs: XosGoalLog[]
  messages: { inboxOpen: number }
}

export type XosArchivedGoal = {
  /** Folder name under goals/_archive (usually the goal name). */
  goal: string
  title: string
  path: string
  archivedAt: string | null
}

export type XosProject = {
  /** Stable id: the project root path. */
  key: string
  name: string
  root: string
  goalsDir: string
  /** Orca worktree selector for terminals, or null when the folder is not an Orca project. */
  worktreeSelector: string | null
  orgSource: 'org.json' | 'default'
  /** Every business area in org order, including ones with no goals yet. */
  areas: XosGoalArea[]
  goals: XosGoal[]
  archived: XosArchivedGoal[]
  /** Crontab lines in this project that are not goal runs (backups, syncs, deploys). */
  scripts: XosCronJob[]
}

export type XosGoalBoard = {
  generatedAt: string
  /** sha256 of the crontab text the board was built from; mutations must echo it back. */
  crontabHash: string
  projects: XosProject[]
  /** Crontab lines whose working directory is not a goal project. */
  otherJobs: XosCronJob[]
  warnings: string[]
}

export type XosCronMutation =
  | {
      kind: 'pause-goal'
      projectKey: string
      goal: string
      crontabHash: string
    }
  | {
      kind: 'resume-goal'
      projectKey: string
      goal: string
      crontabHash: string
    }
  | { kind: 'pause-job'; jobId: string; crontabHash: string }
  | { kind: 'resume-job'; jobId: string; crontabHash: string }
  | { kind: 'pause-area' | 'resume-area'; projectKey: string; areaId: string; crontabHash: string }
  | { kind: 'pause-project' | 'resume-project'; projectKey: string; crontabHash: string }
  | { kind: 'edit-job'; jobId: string; schedule: string; command: string; crontabHash: string }
  | { kind: 'remove-job'; jobId: string; crontabHash: string }
  | {
      kind: 'add-goal-schedule'
      projectKey: string
      goal: string
      schedule: string
      runner: string
      crontabHash: string
    }

export type XosGoalMutation =
  | {
      kind: 'create'
      projectKey: string
      goal: string
      title: string
      agent: string
      areaId: string | null
    }
  | { kind: 'archive'; projectKey: string; goal: string; crontabHash: string }
  | { kind: 'restore'; projectKey: string; archived: string }
  /** `confirm` must equal the archived folder name. Also removes the goal's crontab lines. */
  | { kind: 'delete'; projectKey: string; archived: string; confirm: string; crontabHash: string }
  | { kind: 'set-area'; projectKey: string; goal: string; areaId: string | null }

export type XosAreaMutation =
  | { kind: 'upsert'; projectKey: string; area: XosGoalArea }
  | { kind: 'remove'; projectKey: string; areaId: string }

export type XosAuditEvent = {
  at: string
  action: string
  reason?: string
  project?: string
  goal?: string
  lines?: string[]
  backup?: string | null
  [key: string]: unknown
}

export type XosRunNowRequest =
  | { kind: 'goal'; projectKey: string; goal: string }
  | { kind: 'job'; jobId: string }

export type XosActionResult =
  | { ok: true; message: string; changedLines?: number; openPath?: string }
  | { ok: false; error: string }

export type XosGoalFileKind = 'goal' | 'status' | 'log'

export type XosGoalsApi = {
  getBoard: () => Promise<XosGoalBoard>
  mutateCron: (mutation: XosCronMutation) => Promise<XosActionResult>
  runNow: (request: XosRunNowRequest) => Promise<XosActionResult>
  /** Returns a data: URL for a card image under the project's ops-cards folder, or null. */
  cardArt: (args: { projectKey: string; relativePath: string }) => Promise<string | null>
  openFile: (args: { path: string }) => Promise<XosActionResult>
  mutateGoal: (mutation: XosGoalMutation) => Promise<XosActionResult>
  mutateArea: (mutation: XosAreaMutation) => Promise<XosActionResult>
  /** Newest first. */
  getAudit: (args: { limit: number }) => Promise<XosAuditEvent[]>
}
