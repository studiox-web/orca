// XOS fork: Stage B Goal prompt assembly (RT2, RT3, RT9, RT10, RT12, RT14, RT17).
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { XosGoalRunMode } from '../../shared/xos-goals-types'
import {
  frontmatterList,
  frontmatterString,
  listGoalLogs,
  parseFrontmatter,
  readHead
} from './xos-goal-files'
import { equivalentModel, modelFitsAgent, replyModelFor } from './xos-agent-command'
import {
  collectGoalInbox,
  expandSharedIncludes,
  markGoalInboxRead,
  writeGoalOperatorMessage
} from './xos-goal-inbox'
import { resolveAgentsMdPath, resolveGoalDir } from './xos-project-home'
import { evaluateGoalQueueGate, type XosQueueGateResult } from './xos-queue-gate'

export { collectGoalInbox, expandSharedIncludes, markGoalInboxRead, writeGoalOperatorMessage }

const DOD_LINE_RE = /^Definition of Done met\r?$/m
const MAX_DOC_BYTES = 32 * 1024
const MAX_LOG_BYTES = 16 * 1024

export type XosAssembledGoalPrompt =
  | {
      status: 'ready'
      goal: string
      goalDir: string
      mode: XosGoalRunMode
      agent: string
      model: string | null
      effort: string | null
      lockLane: string
      lockWaitSeconds: number
      disableFallback: boolean
      disableAutoCommit: boolean
      prompt: string
      reopenedFromDod: boolean
      openInboxCount: number
      /** Mark these read with markGoalInboxRead only after the run really started (H4). */
      inboxPaths: string[]
      hasExternalInbox: boolean
      frontmatter: Record<string, unknown>
      queueGate: XosQueueGateResult | null
    }
  | {
      status: 'skipped_dod' | 'skipped_precheck'
      goal: string
      goalDir: string
      mode: XosGoalRunMode
      reason: string
      queueGate: XosQueueGateResult | null
    }

export function resolveAllowedGoalAgent(
  requestedAgent: string | undefined,
  fm: Record<string, unknown>
): string {
  const allowed = frontmatterList(fm, 'agents')
  const fallback = allowed[0] ?? 'codex'
  if (!requestedAgent) {
    return fallback
  }
  return allowed.length > 0 && !allowed.includes(requestedAgent) ? allowed[0] : requestedAgent
}

/** The frontmatter model on the agent actually running: same tier if it belongs to another one. */
function modelForAgent(agent: string, fm: Record<string, unknown>): string | null {
  const model = frontmatterString(fm, 'model')
  return modelFitsAgent(agent, model) ? model : equivalentModel(model, agent)
}

function readOptionalGoalSection(goalDir: string, filename: string, heading: string): string {
  const text = readHead(join(goalDir, filename), MAX_DOC_BYTES)?.trim()
  return text ? `\n## ${heading} (${filename})\n\n${text}\n` : ''
}

export function assembleGoalPrompt(args: {
  repoRoot: string
  goal: string
  mode?: XosGoalRunMode
  sidecar?: string
  operatorMessage?: string
  requestedAgent?: string
  /** An explicit model for this run; beats the contract's (Continue on…, fallback retries). */
  requestedModel?: string | null
  requestedEffort?: string | null
  runsToday?: number
  bypassQueueGate?: boolean
  nowMs?: number
}): XosAssembledGoalPrompt {
  const nowMs = args.nowMs ?? Date.now()
  const mode: XosGoalRunMode = args.mode ?? 'normal'
  const goalDir = resolveGoalDir(args.repoRoot, args.goal)
  const goalPath = join(goalDir, 'GOAL.md')
  if (!existsSync(goalPath)) {
    throw new Error(`Goal contract not found: ${goalPath}`)
  }
  if (args.operatorMessage?.trim()) {
    writeGoalOperatorMessage(goalDir, args.goal, args.operatorMessage, nowMs)
  }

  const rawGoalText = readFileSync(goalPath, 'utf8')
  const fm = parseFrontmatter(rawGoalText)
  const expandedGoal = expandSharedIncludes(rawGoalText, args.repoRoot)
  const statusRaw = readHead(join(goalDir, 'STATUS.md'), MAX_DOC_BYTES) ?? '_No STATUS.md yet._'
  const memoryRaw = readHead(join(goalDir, 'MEMORY.md'), MAX_DOC_BYTES) ?? '_No MEMORY.md yet._'
  const agent = resolveAllowedGoalAgent(args.requestedAgent, fm)
  const queueGate =
    mode === 'reply'
      ? null
      : evaluateGoalQueueGate({
          repoRoot: args.repoRoot,
          goal: args.goal,
          fm,
          runsToday: args.runsToday,
          nowMs
        })

  let reopenedFromDod = false
  let injectedStatus = statusRaw
  if (DOD_LINE_RE.test(statusRaw) && mode === 'normal' && !args.operatorMessage?.trim()) {
    if (!queueGate?.hasInputWork) {
      return {
        status: 'skipped_dod',
        goal: args.goal,
        goalDir,
        mode,
        reason: `Goal '${args.goal}' is marked 'Definition of Done met' in STATUS.md.`,
        queueGate
      }
    }
    reopenedFromDod = true
    injectedStatus = [
      statusRaw.replace(/^Definition of Done met\r?\n?/gm, '').trimEnd(),
      '- Runner reopen note: new input queue items exist while STATUS.md carried Definition of Done met; remove or replace that literal line when you update STATUS.md.'
    ].join('\n')
  }

  if (
    mode === 'normal' &&
    !args.bypassQueueGate &&
    !args.operatorMessage?.trim() &&
    queueGate &&
    !queueGate.allowed &&
    queueGate.skippedPrecheck
  ) {
    return {
      status: 'skipped_precheck',
      goal: args.goal,
      goalDir,
      mode,
      reason: queueGate.skippedPrecheck,
      queueGate
    }
  }

  const inbox = collectGoalInbox(goalDir, args.goal)
  if (mode === 'reply') {
    if (inbox.openCount === 0 && !args.operatorMessage?.trim()) {
      return {
        status: 'skipped_precheck',
        goal: args.goal,
        goalDir,
        mode,
        reason: 'skipped_precheck: no open inbox messages for reply run',
        queueGate: null
      }
    }
    const replyPrompt = [
      `You are running an inbox-only message response turn for the '${args.goal}' goal in ${basename(args.repoRoot)}.`,
      '## Goal Contract (GOAL.md)',
      expandedGoal.trimEnd(),
      '## Current Status (STATUS.md)',
      injectedStatus.trimEnd(),
      '## Long-Term Memory (MEMORY.md)',
      memoryRaw.trimEnd(),
      '## Goal Inbox (`inbox/*.md`)\n- Mode: **Inbox-only response run**.\n- Scope: Read open messages in `inbox/*.md`, reply directly, and update message status (`replied`, `resolved`, or `archived`).\n- Do **not** run a full goal iteration, start subagents, or edit product code in this run.',
      '### Inbox Messages',
      inbox.formattedMessages || '_No inbox messages._'
    ].join('\n\n')
    return {
      status: 'ready',
      goal: args.goal,
      goalDir,
      mode: 'reply',
      agent,
      model: replyModelFor(agent),
      effort: 'low',
      lockLane: 'dm',
      lockWaitSeconds: 0,
      disableFallback: true,
      disableAutoCommit: true,
      prompt: replyPrompt,
      reopenedFromDod: false,
      openInboxCount: inbox.openCount,
      inboxPaths: inbox.messagePaths,
      hasExternalInbox: inbox.hasExternalMessages,
      frontmatter: fm,
      queueGate: null
    }
  }

  let sidecarSection = ''
  if (mode === 'sidecar') {
    const sidecarName = (args.sidecar ?? '').replace(/\.md$/, '').trim()
    if (!sidecarName || sidecarName.includes('/') || sidecarName.includes('..')) {
      throw new Error(`Invalid sidecar name: ${args.sidecar ?? ''}`)
    }
    const sidecarPath = join(goalDir, 'sidecars', `${sidecarName}.md`)
    if (!existsSync(sidecarPath)) {
      throw new Error(`Sidecar contract not found: ${sidecarPath}`)
    }
    const expandedSidecar = expandSharedIncludes(readFileSync(sidecarPath, 'utf8'), args.repoRoot)
    sidecarSection = `\n## Sidecar Contract (sidecars/${sidecarName}.md)\n\n${expandedSidecar.trimEnd()}\n`
  }

  const agentsMdPath = resolveAgentsMdPath(args.repoRoot)
  const agentsMdText = agentsMdPath ? (readHead(agentsMdPath, MAX_DOC_BYTES) ?? '') : ''
  const { logs, latestText } = listGoalLogs(args.goal, join(goalDir, 'log'))
  const cappedLatestLog = latestText ? latestText.slice(0, MAX_LOG_BYTES) : '_No previous log._'
  const queueSection = queueGate?.queueContext
    ? `\n## Queue Snapshot (RT17)\n\n${queueGate.queueContext}\n`
    : ''
  const operatorSection = args.operatorMessage?.trim()
    ? `\n## Operator Instruction (Immediate Priority)\n\n${args.operatorMessage.trim()}\n`
    : ''

  const fullPrompt = [
    `You are running an autonomous iteration of the '${args.goal}' goal in ${basename(args.repoRoot)}.`,
    ...(agentsMdText ? ['## Operating Principles (AGENTS.md)', agentsMdText.trimEnd()] : []),
    '## Goal Contract (GOAL.md)',
    expandedGoal.trimEnd(),
    sidecarSection,
    readOptionalGoalSection(goalDir, 'SOUL.md', 'Persona & Voice'),
    readOptionalGoalSection(goalDir, 'LESSONS.md', 'Lessons Learned'),
    readOptionalGoalSection(goalDir, 'DECISIONS.md', 'Architectural & Operating Decisions'),
    '## Current Status (STATUS.md)',
    injectedStatus.trimEnd(),
    '## Long-Term Memory (MEMORY.md)',
    memoryRaw.trimEnd(),
    queueSection,
    operatorSection,
    '## Goal Inbox (`inbox/*.md`)',
    inbox.formattedMessages || '_No inbox messages._',
    `## Latest Log Entry (${logs[0]?.filename ?? 'none'})`,
    cappedLatestLog.trimEnd(),
    '## Iteration Task\n1. Handle open `inbox/*.md` messages first.\n2. Execute one focused iteration of the Goal Contract.\n3. Write a concise log entry in `log/` and update `STATUS.md` before finishing.'
  ]
    .filter(Boolean)
    .join('\n\n')

  return {
    status: 'ready',
    goal: args.goal,
    goalDir,
    mode,
    agent,
    model: args.requestedModel ?? modelForAgent(agent, fm),
    effort: args.requestedEffort ?? frontmatterString(fm, 'model_reasoning_effort'),
    lockLane: frontmatterString(fm, 'lock_lane') ?? 'repo-mutating',
    lockWaitSeconds: Number(fm.lock_wait_seconds ?? 0) || 0,
    disableFallback: false,
    disableAutoCommit: false,
    prompt: fullPrompt,
    reopenedFromDod,
    openInboxCount: inbox.openCount,
    inboxPaths: inbox.messagePaths,
    hasExternalInbox: inbox.hasExternalMessages,
    frontmatter: fm,
    queueGate
  }
}
