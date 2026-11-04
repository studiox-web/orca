// XOS fork: goal board data shared by main and renderer. Shapes follow the Cascade/DJVibe
// Command Centre (`types/command-centre.ts`) so the ported card UI needs few changes.
import type { XosGoalQueues, XosItemsApi } from './xos-items-types'
import type { XosRuntimeApi } from './xos-runtime-types'

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
  /** Stage D native receipts: how the run was started (manual_takeover marks "operator at the helm"). */
  trigger?: string | null
}

/** Live (or most recent native) run of a goal, polled by the Goal Viewer and card badges. */
export type XosLiveRunTail = {
  runId: string
  goal: string
  status: 'running' | 'success' | 'failed' | 'limited' | 'takeover'
  startedAt: string
  finishedAt: string | null
  elapsedSeconds: number | null
  /** Last screen lines of the run, newest last. */
  lines: string[]
  logPath: string
  /** Work item this run claimed (§3g.5), with the stage folder it came from. */
  item: { path: string; title: string; stage: string } | null
  worktreePath: string | null
  branch: string | null
  exitCode: number | null
  failureReason: string | null
  trigger: string | null
  parentRunId: string | null
}

/** One eligible input-queue item for a goal, as the "Build now" dialog offers it. */
export type XosNextGoalItem = {
  path: string
  title: string
  stage: string
  /** Code items build in a fresh worktree; ops/data items stay in the project workspace (§3f). */
  workspace: 'new-worktree' | 'existing'
} | null

/** Take over / drill-in launch (§3e, §3h.2). `takeover` opens an interactive agent session;
 *  `build` starts an autonomous native run on one item, in a new worktree. */
export type XosContinueOnRequest = {
  projectKey: string
  goal: string
  agent: string
  model: string | null
  effort: string | null
  mode: 'takeover' | 'build'
  itemPath?: string
  message?: string
  /** When set, the assembled prompt includes this run's log tail as "you are taking over" context. */
  fromStartedAt?: string | null
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
    memoryPath?: string | null
    soulPath?: string | null
    lessonsPath?: string | null
    decisionsPath?: string | null
    sidecars?: string[]
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
  /** Work queues this goal reads (in) and feeds (out), §3g. Read-only in stage 0. */
  queues: XosGoalQueues
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
  | { kind: 'import-project'; projectKey: string }

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

export type XosGoalRunMode = 'normal' | 'reply' | 'sidecar'

export type XosRunNowRequest =
  | {
      kind: 'goal'
      projectKey: string
      goal: string
      mode?: XosGoalRunMode
      sidecar?: string
      message?: string
      runner?: string
    }
  | { kind: 'job'; jobId: string }

export type XosActionResult =
  | { ok: true; message: string; changedLines?: number; openPath?: string }
  | { ok: false; error: string }

export type XosGoalFileKind = 'goal' | 'status' | 'log'

export type XosGoalsApi = XosItemsApi &
  XosRuntimeApi & {
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
    /** Live tail of the goal's current (or latest native) run; null when only legacy runs exist. */
    liveTail: (args: { projectKey: string; goal: string }) => Promise<XosLiveRunTail | null>
    /** §3e / §3h.2 drill-in: interactive takeover session or autonomous build on an item. */
    continueOn: (args: XosContinueOnRequest) => Promise<XosActionResult>
    /** First eligible unclaimed input item for "Build now", or null when the queue gate is dry. */
    nextItem: (args: { projectKey: string; goal: string }) => Promise<XosNextGoalItem>
  }
