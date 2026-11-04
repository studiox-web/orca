// XOS fork: PL4 through the `gh` CLI. It only ever runs when the operator (or a script automation
// they enabled) asks: intake reads issues into local items, closing is a separate `--close` step.
import { runProcess } from '@orca/process-host'
import {
  closeCompletedGitHubIssues,
  syncGitHubIssuesIntake,
  type XosGitHubIssueInput
} from './xos-github-intake'
import { commitProjectHome } from './xos-project-home'

const ISSUE_FIELDS = 'number,title,body,url,author,labels,createdAt,updatedAt'

type GhIssue = {
  number: number
  title: string
  body?: string | null
  url?: string | null
  author?: { login?: string } | null
  labels?: { name: string }[]
  createdAt?: string | null
  updatedAt?: string | null
}

export type XosGhRunner = (repoRoot: string, args: string[]) => Promise<string>

const runGh: XosGhRunner = async (repoRoot, args) => {
  const result = await runProcess({ program: 'gh', args, cwd: repoRoot, timeoutMs: 60_000 })
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `gh exited with ${result.code}`)
  }
  return result.stdout
}

export function parseGhIssues(json: string): XosGitHubIssueInput[] {
  const rows: GhIssue[] = JSON.parse(json)
  return rows.map((row) => ({
    number: row.number,
    title: row.title,
    body: row.body,
    url: row.url,
    author: row.author?.login ?? null,
    labels: (row.labels ?? []).map((label) => label.name),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }))
}

export async function syncGitHubForProject(args: {
  repoRoot: string
  close?: boolean
  gh?: XosGhRunner
}) {
  const gh = args.gh ?? runGh
  const issues = parseGhIssues(
    await gh(args.repoRoot, [
      'issue',
      'list',
      '--state',
      'open',
      '--limit',
      '200',
      '--json',
      ISSUE_FIELDS
    ])
  )
  const intake = syncGitHubIssuesIntake({ repoRoot: args.repoRoot, issues })
  const openIssueNumbers = new Set(issues.map((issue) => issue.number))
  const closing = closeCompletedGitHubIssues({
    repoRoot: args.repoRoot,
    openIssueNumbers,
    dryRun: args.close !== true,
    closeIssue: (issueNumber, itemPath) =>
      void gh(args.repoRoot, [
        'issue',
        'close',
        String(issueNumber),
        '--comment',
        `Completed in ${itemPath}.`
      ])
  })
  void commitProjectHome(args.repoRoot, 'xos: github intake')
  return { ...intake, closed: closing.closed, closeSkipped: closing.skipped, dryRun: !args.close }
}
