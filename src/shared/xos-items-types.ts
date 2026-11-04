// XOS fork: work items (features, bugs, content…) and the queues goals move them through (§3g,
// §3h). Stage 0 is read-only over the legacy repo folders; the folder an item sits in is its stage.

/** How full a queue is against its declared floor/ceiling. */
export type XosQueueTone = 'idle' | 'ok' | 'starved' | 'backed-up'

/** One queue a goal reads (in) or writes (out), as shown on its card and in its viewer. */
export type XosQueueRef = {
  typeId: string
  stageId: string
  /** e.g. "Ideas", "Ready specs". */
  label: string
  count: number
  /** Items matching the stage's ready rule (e.g. builder.ready: true), or null without one. */
  readyCount: number | null
  floor: number | null
  ceiling: number | null
  /** mtime of the oldest item, a proxy for how long work has waited. */
  oldestAt: string | null
  tone: XosQueueTone
}

export type XosGoalQueues = { in: XosQueueRef[]; out: XosQueueRef[] }

export type XosItemStage = {
  id: string
  label: string
  /** Absolute folders that make up this stage (several for merged legacy folders). */
  paths: string[]
  count: number
  readyCount: number | null
  floor: number | null
  ceiling: number | null
  /** Done / rejected stages: shown last and collapsed by default. */
  kind: 'active' | 'done' | 'rejected'
  /** Goals that pick items up from this stage. */
  readers: string[]
  /** Goals that put items into this stage. */
  writers: string[]
}

export type XosItemType = {
  id: string
  label: string
  stages: XosItemStage[]
}

export type XosItemChip = { key: string; value: string }

export type XosWorkItem = {
  /** Absolute file path; also the id. */
  path: string
  typeId: string
  stageId: string
  /** Sub-folder inside a merged stage, e.g. a rejection bucket like "too-big". */
  bucket: string | null
  title: string
  updatedAt: string | null
  created: string | null
  ready: boolean | null
  chips: XosItemChip[]
}

export type XosProjectItems = {
  projectKey: string
  projectName: string
  types: XosItemType[]
  items: XosWorkItem[]
  /** Items per stage are capped (newest first); stage.count is the full total. */
  perStageLimit: number
}

export type XosItemsSnapshot = {
  generatedAt: string
  projects: XosProjectItems[]
}

export type XosItemTransition = {
  at: string
  item: string
  fromPath: string
  toPath: string
  fromStage: string
  toStage: string
  goal: string
  runId?: string
  branch?: string
  commit?: string
  outcome?: string
}

export type XosItemDetail = {
  path: string
  frontmatter: Record<string, unknown>
  body: string
  truncated: boolean
  transitions?: XosItemTransition[]
}

export type XosItemMutation =
  | {
      kind: 'create'
      projectKey: string
      typeId: string
      stageId?: string
      title: string
      body?: string
      priority?: string
      size?: string
      risk?: string
      ready?: boolean
    }
  | {
      kind: 'move'
      path: string
      toStageId: string
      bucket?: string | null
      goal?: string
    }
  | {
      kind: 'edit'
      path: string
      title?: string
      ready?: boolean | null
      updates?: Record<string, string | null>
      body?: string
    }

export type XosItemActionResult =
  | { ok: true; message: string; path: string; item?: XosWorkItem }
  | { ok: false; error: string }

export type XosItemsApi = {
  getItems: (args: { projectKey: string | null }) => Promise<XosItemsSnapshot>
  /** Only files inside a known stage folder are readable. */
  getItem: (args: { path: string }) => Promise<XosItemDetail | null>
  mutateItem: (mutation: XosItemMutation) => Promise<XosItemActionResult>
}
