// XOS fork: script automations (§7). A scheduled shell command run by Orca instead of crontab, with
// the same run row, lane lock and timeout as an agent run. Like native runs it writes its own log
// and exit file, so a run started before an Orca restart still gets its result recorded.
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { join } from 'node:path'
import { spawnProcess } from '@orca/process-host'
import type { AutomationDispatchResult, AutomationRun } from '../../shared/automations-types'
import type { XosScriptBinding } from '../../shared/xos-runtime-types'
import { shellQuote } from './xos-agent-command'
import { parseCrontabWithPaused, readCrontabText, xosHome } from './xos-crontab'
import { readRunExitCode } from './xos-native-finalize'
import {
  isProcessAlive,
  leasePathFor,
  listRunJournal,
  removeRunJournal,
  writeRunJournal
} from './xos-run-journal'

const ADOPT_POLL_MS = 5_000
const STOP_GRACE_MS = 10_000

type ReportResult = (result: AutomationDispatchResult) => Promise<unknown>

const running = new Map<string, number>()

function scriptLogsDir(): string {
  return join(xosHome(), 'runs', 'scripts')
}

function report(
  runId: string,
  logPath: string,
  code: number | null,
  reportResult: ReportResult
): void {
  running.delete(runId)
  removeRunJournal(runId)
  void reportResult({
    runId,
    status: code === 0 ? 'completed' : 'dispatch_failed',
    error: code === 0 ? null : `The script exited with ${code ?? 'no status'}. Log: ${logPath}`
  })
}

/** PF7: the crontab line this script replaces must be gone or paused before Orca runs it. */
export async function cronLineStillActive(script: XosScriptBinding): Promise<boolean> {
  const replaced = script.replacesCronCommand
  if (!replaced) {
    return false
  }
  const lines = parseCrontabWithPaused(await readCrontabText())
  return lines.some((line) => !line.paused && line.command === replaced)
}

export function startScriptRun(args: {
  automationId: string
  run: AutomationRun
  script: XosScriptBinding
  deadlineAtMs: number | null
  reportResult: ReportResult
}): void {
  const { run, script } = args
  mkdirSync(scriptLogsDir(), { recursive: true })
  const logPath = join(scriptLogsDir(), `${run.id}.log`)
  const exitPath = join(scriptLogsDir(), `${run.id}.exit`)
  const logFd = openSync(logPath, 'a')
  let child: ReturnType<typeof spawnProcess>
  try {
    child = spawnProcess({
      program: '/bin/bash',
      args: [
        '-lc',
        `( ${script.command}\n)\ncode=$?\nprintf '%s' "$code" > ${shellQuote(exitPath)}\nexit "$code"`
      ],
      cwd: script.cwd,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    })
  } finally {
    closeSync(logFd)
  }
  const pid = child.pid ?? null
  if (pid) {
    running.set(run.id, pid)
  }
  writeRunJournal({
    kind: 'script',
    runId: run.id,
    automationId: args.automationId,
    startedAt: new Date().toISOString(),
    deadlineAtMs: args.deadlineAtMs,
    locks: [],
    leasePath: leasePathFor(run.id),
    pid,
    logPath,
    exitPath
  })
  let reported = false
  const finish = (code: number | null): void => {
    if (!reported) {
      reported = true
      report(run.id, logPath, code, args.reportResult)
    }
  }
  child.on('error', () => finish(null))
  child.on('close', (code) => finish(code))
  child.unref()
}

export function stopScriptRun(runId: string): void {
  const pid = running.get(runId)
  if (!pid) {
    return
  }
  const signal = (name: NodeJS.Signals): void => {
    try {
      process.kill(-pid, name)
    } catch {
      // Already gone.
    }
  }
  signal('SIGTERM')
  setTimeout(() => signal('SIGKILL'), STOP_GRACE_MS).unref()
}

/** Script runs an earlier Orca started: report the finished, keep watching the live. */
export function adoptScriptRuns(reportResult: ReportResult): void {
  for (const entry of listRunJournal()) {
    if (entry.kind !== 'script' || running.has(entry.runId)) {
      continue
    }
    if (!isProcessAlive(entry.pid)) {
      report(entry.runId, entry.logPath, readRunExitCode(entry.exitPath), reportResult)
      continue
    }
    if (entry.pid) {
      running.set(entry.runId, entry.pid)
    }
    const poll = setInterval(() => {
      if (!isProcessAlive(entry.pid)) {
        clearInterval(poll)
        report(entry.runId, entry.logPath, readRunExitCode(entry.exitPath), reportResult)
      }
    }, ADOPT_POLL_MS)
    poll.unref()
  }
}
