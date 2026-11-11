// XOS fork: RT8 post-run auto-commit, the Orca side of the legacy commit-automation-changes.sh.
// After a finished run it commits only the changes under the automation's owned paths, under the
// repo's global git-commit.lock (shared with crontab runs), and optionally pushes to the upstream.
// Changes outside the owned paths, and anything the person staged elsewhere, are left alone.
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runProcess } from '@orca/process-host'
import type {
  XosAutoCommitConfig,
  XosLegacyCommitPolicy,
  XosRunCommit
} from '../../shared/xos-runtime-types'
import { commitLockFile, tryLock } from './xos-lane-lock'

const COMMIT_LOCK_WAIT_SECONDS = 10 * 60
const GIT_TIMEOUT_MS = 5 * 60_000
const PUSH_TIMEOUT_MS = 2 * 60_000

type GitResult = { code: number; stdout: string; stderr: string }

async function git(
  cwd: string,
  args: string[],
  options: { input?: string; literal?: boolean; timeout?: number } = {}
): Promise<GitResult> {
  try {
    const result = await runProcess({
      program: 'git',
      args,
      cwd,
      timeoutMs: options.timeout ?? GIT_TIMEOUT_MS,
      input: options.input,
      maxOutputBytes: 32 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...(options.literal ? { GIT_LITERAL_PATHSPECS: '1' } : {})
      }
    })
    return { code: result.code ?? 1, stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    return { code: 1, stdout: '', stderr: String(error) }
  }
}

function tail(text: string): string {
  const lines = text.trim().split('\n').filter(Boolean)
  return lines.slice(-4).join(' · ').slice(0, 400)
}

/** Files changed under the pathspecs, from `git status -z` (staged, unstaged and untracked). */
export function parseStatusFiles(output: string): string[] {
  const files = new Set<string>()
  for (const entry of output.split('\0')) {
    if (entry.length > 3) {
      files.add(entry.slice(3))
    }
  }
  return Array.from(files)
}

async function inProgressOperation(cwd: string): Promise<string | null> {
  for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) {
    const result = await git(cwd, ['rev-parse', '--git-path', marker])
    if (result.code === 0 && existsSync(resolve(cwd, result.stdout.trim()))) {
      return marker === 'MERGE_HEAD'
        ? 'a merge'
        : marker === 'CHERRY_PICK_HEAD'
          ? 'a cherry-pick'
          : 'a rebase'
    }
  }
  return null
}

async function push(
  cwd: string,
  branch: string
): Promise<{ pushed: boolean | null; detail: string | null }> {
  const upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (upstream.code !== 0) {
    return { pushed: null, detail: 'not pushed: the branch has no upstream' }
  }
  const remote = (await git(cwd, ['config', `branch.${branch}.remote`])).stdout.trim() || 'origin'
  const result = await git(cwd, ['push', remote, branch], { timeout: PUSH_TIMEOUT_MS })
  return result.code === 0
    ? { pushed: true, detail: null }
    : { pushed: false, detail: `push failed: ${tail(result.stderr)}` }
}

export type XosCommitRequest = {
  cwd: string
  repoRoot: string
  automationName: string
  config: XosAutoCommitConfig
}

export async function xosAutoCommit(request: XosCommitRequest): Promise<XosRunCommit> {
  const at = (): string => new Date().toISOString()
  const result = (
    status: XosRunCommit['status'],
    fields: Partial<XosRunCommit> = {}
  ): XosRunCommit => ({
    status,
    sha: null,
    files: 0,
    pushed: null,
    detail: null,
    ...fields,
    at: at()
  })
  const { cwd, config } = request
  const branch = await git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'])
  if (branch.code !== 0) {
    return result('skipped', { detail: 'not committed: the workspace is not on a branch' })
  }
  const busy = await inProgressOperation(cwd)
  if (busy) {
    return result('skipped', { detail: `not committed: ${busy} is in progress` })
  }
  let lock
  try {
    lock = await tryLock(commitLockFile(request.repoRoot), COMMIT_LOCK_WAIT_SECONDS)
  } catch (error) {
    return result('failed', { detail: `could not take the commit lock: ${String(error)}` })
  }
  if (!lock) {
    return result('failed', { detail: 'the git commit lock stayed busy for 10 minutes' })
  }
  try {
    const status = await git(cwd, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
      '--no-renames',
      '--',
      ...config.paths
    ])
    if (status.code !== 0) {
      return result('failed', { detail: tail(status.stderr) })
    }
    const files = parseStatusFiles(status.stdout)
    if (files.length === 0) {
      return result('nothing')
    }
    const list = `${files.join('\0')}\0`
    const pathspec = ['--pathspec-from-file=-', '--pathspec-file-nul']
    const add = await git(cwd, ['add', '-A', ...pathspec], { input: list, literal: true })
    if (add.code !== 0) {
      return result('failed', { files: files.length, detail: `git add: ${tail(add.stderr)}` })
    }
    const message = config.message ?? `chore(automation): ${request.automationName}`
    const commit = await git(cwd, ['commit', '-m', message, ...pathspec], {
      input: list,
      literal: true
    })
    if (commit.code !== 0) {
      return result('failed', {
        files: files.length,
        detail: `git commit: ${tail(commit.stderr || commit.stdout)}`
      })
    }
    const sha = (await git(cwd, ['rev-parse', '--short', 'HEAD'])).stdout.trim() || null
    const pushed = config.push
      ? await push(cwd, branch.stdout.trim())
      : { pushed: null, detail: null }
    return result('committed', { sha, files: files.length, ...pushed })
  } finally {
    lock.release()
  }
}

/** Reads the per-goal `stage_if_exists` lists of the legacy commit script, for importing. */
export function readLegacyCommitPolicies(repoRoot: string): XosLegacyCommitPolicy[] {
  let script: string
  try {
    script = readFileSync(
      join(repoRoot, 'automations', 'bin', 'commit-automation-changes.sh'),
      'utf8'
    )
  } catch {
    return []
  }
  const policies: XosLegacyCommitPolicy[] = []
  const block = script.split(/case "\$GOAL_NAME" in/)[1]?.split(/\n\s*esac/)[0] ?? ''
  for (const match of block.matchAll(/^\s*([a-z0-9][a-z0-9-]*)\)\s*\n([\s\S]*?);;/gm)) {
    const paths = Array.from(match[2].matchAll(/stage_if_exists\s+("?)([^\s"]+)\1/g), (m) => m[2])
    if (/stage_goal_inbox/.test(match[2])) {
      paths.push('automations/goals/*/inbox')
    }
    if (paths.length > 0) {
      policies.push({ goal: match[1], paths })
    }
  }
  return policies
}
