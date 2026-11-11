// XOS fork: Stage E GitHub Issues intake sync & completion closure (§3h.4).
// Classifies external GitHub issues into local project-home items with `source: github#<number>`
// and closes linked GitHub issues when their item reaches `completed/` (or `fixed/`).
import { runProcess } from '@orca/process-host'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseFrontmatter } from './xos-goal-files'
import { projectItemsDir } from './xos-project-home'

export type XosGitHubIssueClassificationKind =
  | 'feature'
  | 'bug'
  | 'feedback'
  | 'support'
  | 'invalid'
export type XosGitHubIssuePriority = 'high' | 'medium' | 'low'

export type XosGitHubIssueInput = {
  number: number
  title: string
  body?: string | null
  url?: string | null
  author?: string | null
  labels?: readonly string[]
  createdAt?: string | null
  updatedAt?: string | null
}

const CLASSIFICATION_KINDS = ['invalid', 'bug', 'feature', 'feedback', 'support'] as const

const SIGNAL_SPECS: Record<XosGitHubIssueClassificationKind, string> = {
  invalid: 'ignore this:4|test issue:4|spam:4|duplicate of:3|created by mistake:4',
  bug: 'bug:2|crash:3|freeze:3|hang:2.5|error:2|exception:2.5|broken:2.5|fails:2.5|not working:3|expected behavior:2|actual behavior:2|steps to reproduce:2.5|regression:2.5',
  feature:
    'feature request:3|enhancement:2.5|please add:2.5|can you add:2.5|would be nice:2|allow users to:2.5|support for:2|option to:2|proposal:2',
  feedback:
    'feedback:2.5|confusing:2|hard to:1.8|ux:1.8|ui:1.5|workflow:1.5|awkward:2|annoying:1.8',
  support: 'how do i:2.5|how to:2|help:1.5|question:2|where can i:2'
}

const QUICK_FIX_TERMS =
  "typo|misspell|alignment|misaligned|overflow|truncated|cut off|overlapping|wrong color|contrast|cramped|doesn't fit".split(
    '|'
  )

const AREA_SPECS: Record<string, string> = {
  sync: 'sync|cloudkit|icloud|github',
  ui: 'ui|ux|button|screen|layout|modal|theme',
  performance: 'slow|lag|performance|memory|battery|cpu',
  notifications: 'notification|reminder|alert',
  onboarding: 'onboarding|sign in|login|setup',
  data: 'export|import|backup|restore|database'
}

const FORCE_MAP: Record<string, XosGitHubIssueClassificationKind> = {
  'force:feature': 'feature',
  'force:bug': 'bug',
  'force:feedback': 'feedback',
  'force:support': 'support',
  'force:ignore': 'invalid',
  'force:invalid': 'invalid'
}

const KIND_ROUTES: Record<
  XosGitHubIssueClassificationKind,
  { typeId: string; stageId: string } | null
> = {
  feature: { typeId: 'feature', stageId: 'pitch' },
  bug: { typeId: 'bug', stageId: 'incoming' },
  feedback: { typeId: 'feedback', stageId: 'incoming' },
  support: { typeId: 'feedback', stageId: 'incoming' },
  invalid: null
}

export function classifyGitHubIssue(
  issue: XosGitHubIssueInput,
  options?: { internalUsers?: readonly string[] }
) {
  const [title, body] = [(issue.title || '').trim(), (issue.body || '').trim()]
  const text = `${title}\n${body}`.toLowerCase()
  const labelsLower = (issue.labels ?? []).map((l) => l.toLowerCase())
  const internalSet = new Set((options?.internalUsers ?? []).map((u) => u.toLowerCase()))
  const sourceKind: 'internal' | 'external' =
    issue.author && internalSet.has(issue.author.toLowerCase()) ? 'internal' : 'external'

  const forcedEntry = Object.entries(FORCE_MAP).find(
    ([token]) => labelsLower.includes(token) || text.includes(token)
  )
  const forced = forcedEntry ? forcedEntry[1] : null

  const scores = { invalid: 0, bug: 0, feature: 0, feedback: 0, support: 0 }
  const reasons: string[] = []
  for (const kind of CLASSIFICATION_KINDS) {
    const spec = SIGNAL_SPECS[kind]
    for (const pair of spec.split('|')) {
      const [phrase, weightStr] = pair.split(':')
      if (phrase && text.includes(phrase)) {
        scores[kind] += Number(weightStr)
        reasons.push(`${kind}:${phrase}`)
      }
    }
  }
  if (title.replace(/[^a-z0-9]/gi, '').length < 4 && body.length < 12) {
    scores.invalid += 3
  }

  let kind: XosGitHubIssueClassificationKind = 'feedback'
  if (forced) {
    kind = forced
    reasons.unshift(`override:${forced}`)
  } else if (scores.invalid >= 4) {
    kind = 'invalid'
  } else {
    const ranked = (['bug', 'feature', 'feedback', 'support'] as const)
      .map((k) => [k, scores[k]] as const)
      .sort((a, b) => b[1] - a[1])
    if (ranked[0][1] >= 1.5) {
      kind = ranked[0][0]
    } else if (sourceKind === 'internal') {
      kind = 'feature'
    }
    if (
      sourceKind === 'internal' &&
      kind !== 'bug' &&
      QUICK_FIX_TERMS.some((t) => text.includes(t))
    ) {
      kind = 'bug'
      reasons.push('internal-quick-fix:bug')
    }
  }

  let priority: XosGitHubIssuePriority = kind === 'bug' ? 'medium' : 'low'
  const highSignal = 'crash|data loss|lost data|cannot open|security|urgent|blocker'.split('|')
  if (highSignal.some((t) => text.includes(t))) {
    priority = 'high'
  } else if (kind === 'feature' && sourceKind === 'internal') {
    priority = 'medium'
  }

  const areas = Object.entries(AREA_SPECS)
    .filter(([, spec]) => spec.split('|').some((t) => text.includes(t)))
    .map(([area]) => area)
    .slice(0, 2)
  const topScore = Math.max(...Object.values(scores), forced ? 6 : 1)
  const confidence = Math.round(Math.min(0.96, Math.max(0.45, 0.45 + topScore * 0.08)) * 100) / 100
  const labels = [`triage:pending`, `type:${kind}`, `priority:${priority}`, `source:${sourceKind}`]
  labels.push(...areas.map((a) => `area:${a}`))
  const base = { kind, priority, confidence, sourceKind }
  return { ...base, areas, labels, reasons, route: KIND_ROUTES[kind] }
}

export type XosGitHubIssueClassification = ReturnType<typeof classifyGitHubIssue>

export function extractLinkedGitHubIssueNumbers(markdown: string): number[] {
  const found = new Set<number>()
  const fm = parseFrontmatter(markdown)
  const sourceVal = typeof fm.source === 'string' ? fm.source : ''
  const srcMatch = /^github#(\d+)$/i.exec(sourceVal.trim())
  if (srcMatch) {
    found.add(Number.parseInt(srcMatch[1], 10))
  }
  const numVal = fm.github_issue_number
  if (typeof numVal === 'number' && Number.isInteger(numVal) && numVal > 0) {
    found.add(numVal)
  } else if (typeof numVal === 'string' && /^\d+$/.test(numVal.trim())) {
    found.add(Number.parseInt(numVal.trim(), 10))
  }
  for (const m of markdown.matchAll(/(?:source:\s*github#|GitHub Issue:\s*#)(\d+)\b/gi)) {
    found.add(Number.parseInt(m[1], 10))
  }
  return [...found].filter((n) => Number.isFinite(n) && n > 0)
}

function collectMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) {
      continue
    }
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectMarkdownFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

function slugifyTitle(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (s || 'issue').slice(0, 60)
}

export function syncGitHubIssuesIntake(args: {
  repoRoot: string
  issues: readonly XosGitHubIssueInput[]
  internalUsers?: readonly string[]
  nowIso?: string
  skipInvalid?: boolean
}) {
  const nowIso = args.nowIso ?? new Date().toISOString()
  const itemsRoot = projectItemsDir(args.repoRoot)
  const existingIssues = new Set<number>()
  for (const root of [itemsRoot, join(args.repoRoot, 'docs')]) {
    for (const file of collectMarkdownFiles(root)) {
      try {
        for (const num of extractLinkedGitHubIssueNumbers(readFileSync(file, 'utf8'))) {
          existingIssues.add(num)
        }
      } catch {
        // ignore unreadable files
      }
    }
  }
  const synced: {
    issueNumber: number
    itemId: string
    path: string
    typeId: string
    stageId: string
    classification: XosGitHubIssueClassification
  }[] = []
  const [skippedExisting, skippedInvalid]: [number[], number[]] = [[], []]

  for (const issue of args.issues) {
    if (existingIssues.has(issue.number)) {
      skippedExisting.push(issue.number)
      continue
    }
    const classification = classifyGitHubIssue(issue, { internalUsers: args.internalUsers })
    if (
      !classification.route ||
      (args.skipInvalid !== false && classification.kind === 'invalid')
    ) {
      skippedInvalid.push(issue.number)
      continue
    }
    const { typeId, stageId } = classification.route
    const datePrefix = (issue.createdAt || nowIso).slice(0, 10)
    const itemId = `${datePrefix}-gh-${issue.number}-${slugifyTitle(issue.title)}`
    const dir = join(itemsRoot, typeId, stageId)
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, `${itemId}.md`)
    const bodyText = (issue.body || '_No description provided._').trim()
    const md = `---\ntitle: ${JSON.stringify(issue.title)}\nsource: github#${issue.number}\ngithub_issue_number: ${issue.number}\ngithub_issue_url: ${issue.url || ''}\ngithub_author: ${issue.author || 'unknown'}\nclassification: ${classification.kind}\npriority: ${classification.priority}\nconfidence: ${classification.confidence}\nstatus: synced\ncreated_at: ${issue.createdAt || nowIso}\nupdated_at: ${issue.updatedAt || nowIso}\n---\n\n# ${issue.title}\n\n## Original Issue\n${bodyText}\n\n## Automation Classification\n- Type: \`${classification.kind}\`\n- Priority: \`${classification.priority}\`\n- Confidence: \`${classification.confidence}\`\n- Source: \`github#${issue.number}\` (${classification.sourceKind})\n\n## GitHub Tracking\n- GitHub Issue: #${issue.number}\n<!-- cascade-sync:processed -->\n`
    writeFileSync(filePath, md, 'utf8')
    existingIssues.add(issue.number)
    synced.push({
      issueNumber: issue.number,
      itemId,
      path: filePath,
      typeId,
      stageId,
      classification
    })
  }
  return { synced, skippedExisting, skippedInvalid }
}

export function closeCompletedGitHubIssues(args: {
  repoRoot: string
  openIssueNumbers?: ReadonlySet<number>
  dryRun?: boolean
  nowIso?: string
  closeIssue?: (issueNumber: number, itemPath: string) => void
}) {
  const nowIso = args.nowIso ?? new Date().toISOString()
  const itemsRoot = projectItemsDir(args.repoRoot)
  const completedDirs = ['feature/completed', 'bug/fixed'].flatMap((sub) => [
    join(itemsRoot, sub),
    join(args.repoRoot, 'docs', sub)
  ])
  const closed: { issueNumber: number; item: string; path: string }[] = []
  const skipped: { issueNumber: number; path: string; reason: string }[] = []
  const closedSet = new Set<number>()

  for (const dir of completedDirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      continue
    }
    for (const file of collectMarkdownFiles(dir)) {
      const raw = readFileSync(file, 'utf8')
      const fm = parseFrontmatter(raw)
      if (typeof fm.github_closed_at === 'string' && fm.github_closed_at.trim()) {
        continue
      }
      for (const issueNumber of extractLinkedGitHubIssueNumbers(raw)) {
        if (closedSet.has(issueNumber)) {
          continue
        }
        if (args.openIssueNumbers && !args.openIssueNumbers.has(issueNumber)) {
          skipped.push({ issueNumber, path: file, reason: 'not-open' })
          continue
        }
        if (!args.dryRun) {
          if (args.closeIssue) {
            args.closeIssue(issueNumber, file)
          } else {
            const msg = `Completed in ${basename(file, '.md')}.`
            void runProcess({
              program: 'gh',
              args: ['issue', 'close', String(issueNumber), '--comment', msg],
              cwd: args.repoRoot
            }).catch(() => {})
          }
          const updated = raw.replace(/^---\n/, `---\ngithub_closed_at: ${nowIso}\n`)
          if (updated !== raw) {
            writeFileSync(file, updated, 'utf8')
          }
        }
        closedSet.add(issueNumber)
        closed.push({ issueNumber, item: basename(file, '.md'), path: file })
      }
    }
  }
  return { closed, skipped }
}
