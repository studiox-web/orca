// XOS fork: RT7 lane locks shared with the legacy crontab runner. run-goal-cron.sh takes `flock` on
// <repo>/storage/framework/cache/automations/{repo-mutating.lock, lanes/<lane>.lock}; Orca takes the
// same locks, so an Orca run and a crontab run in one lane never overlap during the migration.
// Node has no flock, so each held lock is a small `flock … sh` helper in its own process group.
// The helper also exits by itself when Orca's process is gone, so a crash never strands a lane.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runProcess, spawnProcess } from '@orca/process-host'
import { xosHome } from './xos-crontab'

/** flock's exit code when the lock is taken (`-E`), distinct from real errors. */
const BUSY_EXIT = 75
const ACQUIRE_TIMEOUT_MS = 5_000

function lockDir(repoRoot: string): string {
  const legacy = join(repoRoot, 'storage', 'framework', 'cache', 'automations')
  if (existsSync(legacy)) {
    return legacy
  }
  const slug = createHash('sha1').update(repoRoot).digest('hex').slice(0, 12)
  return join(xosHome(), 'locks', slug)
}

/** Same file layout as run-goal-cron.sh. */
export function laneLockFile(repoRoot: string, lane: string): string {
  const dir = lockDir(repoRoot)
  return lane === 'repo-mutating'
    ? join(dir, 'repo-mutating.lock')
    : join(dir, 'lanes', `${lane}.lock`)
}

/** Keeps two runs of one Orca automation from overlapping (the legacy per-goal lock). */
export function automationLockFile(repoRoot: string, automationId: string): string {
  return join(lockDir(repoRoot), `orca-automation-${automationId.replace(/[^\w-]/g, '_')}.lock`)
}

/** RT8: the legacy global commit lock (one git commit at a time per repo). */
export function commitLockFile(repoRoot: string): string {
  return join(lockDir(repoRoot), 'git-commit.lock')
}

export type HeldLock = { file: string; release: () => void }

/** Takes the lock, waiting up to `waitSeconds` (0 = not at all); null when someone else holds it. */
export function tryLock(file: string, waitSeconds = 0): Promise<HeldLock | null> {
  mkdirSync(dirname(file), { recursive: true })
  const watch = `echo locked; while kill -0 ${process.pid} 2>/dev/null; do sleep 5; done`
  const mode = waitSeconds > 0 ? ['-w', String(waitSeconds)] : ['-n']
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawnProcess>
    try {
      child = spawnProcess({
        program: 'flock',
        args: [...mode, '-E', String(BUSY_EXIT), file, 'sh', '-c', watch],
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore']
      })
    } catch (error) {
      reject(error)
      return
    }
    const release = (): void => {
      try {
        // The whole group: flock and the shell that inherited the lock descriptor.
        process.kill(-child.pid!, 'SIGTERM')
      } catch {
        // Already gone.
      }
    }
    let settled = false
    let timer: NodeJS.Timeout | null = null
    const finish = (settle: () => void): void => {
      if (!settled) {
        settled = true
        if (timer) {
          clearTimeout(timer)
        }
        settle()
      }
    }
    timer = setTimeout(
      () => {
        release()
        finish(() => reject(new Error(`Timed out locking ${file}`)))
      },
      ACQUIRE_TIMEOUT_MS + waitSeconds * 1000
    )
    child.stdout?.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('locked')) {
        child.unref()
        child.stdout?.destroy()
        finish(() => resolve({ file, release }))
      }
    })
    child.on('error', (error) => finish(() => reject(error)))
    child.on('exit', (code) =>
      finish(() =>
        code === BUSY_EXIT ? resolve(null) : reject(new Error(`flock exited ${code} for ${file}`))
      )
    )
  })
}

/** Whether nobody holds the lock right now (a probe; it does not take the lock). */
export async function isLockFree(file: string): Promise<boolean> {
  if (!existsSync(file)) {
    return true
  }
  try {
    const result = await runProcess({
      program: 'flock',
      args: ['-n', '-E', String(BUSY_EXIT), file, 'true'],
      stdio: 'ignore'
    })
    return result.code === 0
  } catch {
    return false
  }
}
