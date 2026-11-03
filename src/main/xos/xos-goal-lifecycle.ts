// XOS fork: §3d goal lifecycle over legacy goal folders: create from the project's template,
// archive (pause schedule, move to goals/_archive), restore, and hard delete from the archive.
// Goal folders sit in the product repo during stage 0, so git still holds deleted history.
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { XosArchivedGoal } from '../../shared/xos-goals-types'
import { audit } from './xos-crontab'
import {
  isDirectory,
  markdownTitle,
  parseFrontmatter,
  readHead,
  safeReaddir
} from './xos-goal-files'

export const ARCHIVE_DIR = '_archive'
export const GOAL_SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/

export function listArchivedGoals(goalsDir: string): XosArchivedGoal[] {
  const dir = join(goalsDir, ARCHIVE_DIR)
  return safeReaddir(dir)
    .filter((name) => !name.startsWith('.') && isDirectory(join(dir, name)))
    .map((name) => {
      const goalText = readHead(join(dir, name, 'GOAL.md'), 4096)
      let archivedAt: string | null = null
      try {
        archivedAt = statSync(join(dir, name)).ctime.toISOString()
      } catch {
        // Keep null.
      }
      return {
        goal: name,
        title: markdownTitle(goalText) ?? name,
        path: join(dir, name),
        archivedAt
      }
    })
    .sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
}

/** GOAL.md for a new goal: the fenced template inside `automations/_template/goal.md`, if any. */
export function newGoalContract(args: {
  root: string
  goal: string
  title: string
  agent: string
}): string {
  const templateText = readHead(join(args.root, 'automations', '_template', 'goal.md'), 64 * 1024)
  const fenced = templateText
    ? /## GOAL\.md Template\s*\n+```markdown\n([\s\S]*?)\n```/.exec(templateText)?.[1]
    : undefined
  const fallback = [
    '---',
    `id: ${args.goal}`,
    'type: goal',
    `agents: [${args.agent}]`,
    'lock_lane: repo-mutating',
    'estimated_runtime: 20m per iteration',
    '---',
    '',
    `# Goal: ${args.title}`,
    '',
    '## Definition of Done',
    '',
    'Describe the exact completed state. When complete, update `STATUS.md` with the literal string `Definition of Done met`.',
    '',
    '## Scope',
    '',
    '## Each iteration',
    ''
  ].join('\n')
  const body = (fenced ?? fallback)
    .replace(/^id: .*$/m, `id: ${args.goal}`)
    .replace(/^agents: .*$/m, `agents: [${args.agent}]`)
    .replace(/^# Goal: .*$/m, `# Goal: ${args.title}`)
  // Only keep the frontmatter of the fallback-safe parse when the template's YAML is valid.
  return Object.keys(parseFrontmatter(body)).length > 0 ? `${body.trimEnd()}\n` : `${fallback}\n`
}

export function createGoalFolder(args: {
  root: string
  goalsDir: string
  goal: string
  title: string
  agent: string
}): string {
  if (!GOAL_SLUG.test(args.goal)) {
    throw new Error('Goal names use lowercase letters, digits and dashes (2–63 characters).')
  }
  const dir = join(args.goalsDir, args.goal)
  if (existsSync(dir) || existsSync(join(args.goalsDir, ARCHIVE_DIR, args.goal))) {
    throw new Error(`A goal named ${args.goal} already exists (or is archived).`)
  }
  mkdirSync(join(dir, 'log'), { recursive: true })
  writeFileSync(join(dir, 'log', '.gitkeep'), '')
  writeFileSync(join(dir, 'GOAL.md'), newGoalContract(args))
  writeFileSync(
    join(dir, 'STATUS.md'),
    `# Status: ${args.title}\n\n- result: pending\n- next_action: first iteration\n`
  )
  audit({ action: 'goal.create', root: args.root, goal: args.goal })
  return join(dir, 'GOAL.md')
}

export function archiveGoalFolder(goalsDir: string, goal: string): string {
  const from = join(goalsDir, goal)
  if (!GOAL_SLUG.test(goal) || !isDirectory(from)) {
    throw new Error(`Goal ${goal} was not found.`)
  }
  mkdirSync(join(goalsDir, ARCHIVE_DIR), { recursive: true })
  let to = join(goalsDir, ARCHIVE_DIR, goal)
  if (existsSync(to)) {
    to = `${to}-${new Date().toISOString().slice(0, 10)}-${Date.now() % 100_000}`
  }
  renameSync(from, to)
  audit({ action: 'goal.archive', goalsDir, goal, to })
  return to
}

export function restoreGoalFolder(goalsDir: string, archivedName: string): string {
  const from = join(goalsDir, ARCHIVE_DIR, archivedName)
  if (archivedName.includes('/') || archivedName.startsWith('.') || !isDirectory(from)) {
    throw new Error(`Archived goal ${archivedName} was not found.`)
  }
  const goal = archivedName.replace(/-\d{4}-\d{2}-\d{2}-\d+$/, '')
  const to = join(goalsDir, goal)
  if (existsSync(to)) {
    throw new Error(`A live goal named ${goal} already exists; archive or rename it first.`)
  }
  renameSync(from, to)
  audit({ action: 'goal.restore', goalsDir, goal })
  return goal
}

export function deleteArchivedFolder(goalsDir: string, archivedName: string): void {
  const dir = join(goalsDir, ARCHIVE_DIR, archivedName)
  if (archivedName.includes('/') || archivedName.startsWith('.') || !isDirectory(dir)) {
    throw new Error(`Archived goal ${archivedName} was not found.`)
  }
  rmSync(dir, { recursive: true, force: true })
  audit({ action: 'goal.delete', goalsDir, goal: archivedName })
}
