import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'
import { XOS_GOALS_OPS_COMMAND_SPECS } from './xos-goals-ops'

const GOAL_SCOPE_FLAGS = [...LOCAL_COMMAND_FLAGS, 'project', 'area']

export const XOS_GOALS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['goals', 'import'],
    summary:
      'Import a product repo’s goals, shared includes, and item queues into ~/.orca-xos/projects/<project>',
    usage: 'orca goals import [<repo>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'repo'],
    positionalArgs: ['repo'],
    notes: [
      'Copies automations/goals/*, automations/shared/*, automations/AGENTS.md, and item queues into ~/.orca-xos/projects/<project>/.',
      'Initializes ~/.orca-xos/projects/<project>/ as a Git repository and commits the imported snapshot.',
      'Defaults <repo> to the current working directory when omitted.'
    ],
    examples: ['orca goals import /home/djvibe/projects/djvibe.com', 'orca goals import . --json']
  },
  {
    path: ['goals', 'list'],
    summary: 'List goals across projects with schedule, status, and area metadata',
    usage: 'orca goals list [--project <project>] [--area <area>] [--json]',
    allowedFlags: GOAL_SCOPE_FLAGS,
    examples: ['orca goals list --json', 'orca goals list --project djvibe.com --area Growth']
  },
  {
    path: ['goals', 'show'],
    summary: 'Show full details, schedules, declared queues, and recent runs for a goal',
    usage: 'orca goals show <goal> [--project <project>] [--area <area>] [--json]',
    allowedFlags: [...GOAL_SCOPE_FLAGS, 'goal'],
    positionalArgs: ['goal'],
    examples: ['orca goals show seo-blog-post --json']
  },
  {
    path: ['goals', 'run'],
    summary: 'Assemble and trigger a manual, reply, or sidecar run for a goal',
    usage:
      'orca goals run <goal> [--mode normal|reply|sidecar:<name>] [--sidecar <name>] [--message <text>] [--agent <agent>] [--project <project>] [--area <area>] [--json]',
    allowedFlags: [...GOAL_SCOPE_FLAGS, 'goal', 'mode', 'sidecar', 'message', 'agent', 'force'],
    positionalArgs: ['goal'],
    examples: [
      'orca goals run seo-blog-post --json',
      'orca goals run seo-blog-post --mode reply --json',
      'orca goals run seo-blog-post --mode sidecar:Audit --message "Check backlinks" --json'
    ]
  },
  {
    path: ['goals', 'pause'],
    summary: 'Pause all cron schedules for a goal (or an entire project with --project)',
    usage: 'orca goals pause [<goal>] [--project <project>] [--area <area>] [--json]',
    allowedFlags: [...GOAL_SCOPE_FLAGS, 'goal'],
    positionalArgs: ['goal'],
    examples: ['orca goals pause seo-blog-post --json', 'orca goals pause --project djvibe.com']
  },
  {
    path: ['goals', 'resume'],
    summary: 'Resume all cron schedules for a goal (or an entire project with --project)',
    usage: 'orca goals resume [<goal>] [--project <project>] [--area <area>] [--json]',
    allowedFlags: [...GOAL_SCOPE_FLAGS, 'goal'],
    positionalArgs: ['goal'],
    examples: ['orca goals resume seo-blog-post --json', 'orca goals resume --project djvibe.com']
  },
  {
    path: ['goals', 'create'],
    summary: 'Create a new goal in a project with optional area and cron schedule',
    usage:
      'orca goals create --project <project> --slug <slug> --title <title> [--area <area>] [--schedule <cron>] [--agents <list>] [--model <model>] [--effort <effort>] [--lock-lane <lane>] [--template <template>] [--json]',
    allowedFlags: [
      ...GOAL_SCOPE_FLAGS,
      'slug',
      'title',
      'schedule',
      'agents',
      'model',
      'effort',
      'lock-lane',
      'template'
    ],
    examples: [
      'orca goals create --project djvibe.com --slug daily-digest --title "Daily Digest" --schedule "0 9 * * *" --json'
    ]
  },
  {
    path: ['goals', 'edit'],
    summary: 'Edit a goal’s frontmatter, title, area, or cron schedule',
    usage:
      'orca goals edit <goal> [--project <project>] [--title <title>] [--area <area>] [--schedule <cron>] [--model <model>] [--effort <effort>] [--agents <list>] [--lock-lane <lane>] [--estimated-runtime <runtime>] [--max-runs-per-day <n>] [--json]',
    allowedFlags: [
      ...GOAL_SCOPE_FLAGS,
      'goal',
      'title',
      'schedule',
      'model',
      'effort',
      'agents',
      'lock-lane',
      'estimated-runtime',
      'max-runs-per-day'
    ],
    positionalArgs: ['goal'],
    examples: [
      'orca goals edit seo-blog-post --model claude-sonnet-4-6 --effort high --area Growth --json'
    ]
  },
  {
    path: ['goals', 'archive'],
    summary: 'Archive a goal into automations/goals/_archived/<goal> and remove its cron lines',
    usage: 'orca goals archive <goal> [--project <project>] [--area <area>] [--json]',
    allowedFlags: [...GOAL_SCOPE_FLAGS, 'goal'],
    positionalArgs: ['goal'],
    examples: ['orca goals archive seo-blog-post --json']
  },
  {
    path: ['goals', 'delete'],
    summary: 'Permanently delete a goal directory and its cron schedules',
    usage:
      'orca goals delete <goal> --confirm <slug> [--project <project>] [--area <area>] [--json]',
    allowedFlags: [...GOAL_SCOPE_FLAGS, 'goal', 'confirm'],
    positionalArgs: ['goal'],
    examples: ['orca goals delete seo-blog-post --confirm seo-blog-post --json']
  },
  {
    path: ['goals', 'message'],
    summary: 'Post an operator message into a goal’s inbox and optionally trigger a reply run',
    usage:
      'orca goals message <goal> --body <text> [--attach <path>...] [--run-now] [--project <project>] [--area <area>] [--json]',
    allowedFlags: [...GOAL_SCOPE_FLAGS, 'goal', 'body', 'attach', 'run-now', 'from'],
    repeatableFlags: ['attach'],
    positionalArgs: ['goal'],
    examples: [
      'orca goals message seo-blog-post --body "Focus on mixing tutorials this week" --run-now --json'
    ]
  },
  {
    path: ['goals', 'reply'],
    summary: 'Trigger a reply-mode run to answer open messages in a goal’s inbox',
    usage:
      'orca goals reply <goal> [--agent <agent>] [--project <project>] [--area <area>] [--json]',
    allowedFlags: [...GOAL_SCOPE_FLAGS, 'goal', 'agent'],
    positionalArgs: ['goal'],
    examples: ['orca goals reply seo-blog-post --json']
  },
  {
    path: ['goals', 'history'],
    summary: 'Show recent audit log events and run receipts for a goal or project',
    usage:
      'orca goals history [<goal>] [--project <project>] [--area <area>] [--limit <n>] [--json]',
    allowedFlags: [...GOAL_SCOPE_FLAGS, 'goal', 'limit'],
    positionalArgs: ['goal'],
    examples: ['orca goals history seo-blog-post --limit 20 --json', 'orca goals history --json']
  },
  ...XOS_GOALS_OPS_COMMAND_SPECS
]
