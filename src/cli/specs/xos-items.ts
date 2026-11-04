import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

const ITEM_SCOPE_FLAGS = [...LOCAL_COMMAND_FLAGS, 'project', 'type', 'stage']

export const XOS_ITEMS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['items', 'list'],
    summary: 'List work items across project stage queues',
    usage: 'orca items list [--project <project>] [--type <type>] [--stage <stage>] [--json]',
    allowedFlags: ITEM_SCOPE_FLAGS,
    examples: [
      'orca items list --json',
      'orca items list --project djvibe.com --type feature-ideas --stage backlog --json'
    ]
  },
  {
    path: ['items', 'show'],
    summary: 'Show full markdown, frontmatter, and transition timeline for a work item',
    usage: 'orca items show <id> [--project <project>] [--type <type>] [--stage <stage>] [--json]',
    allowedFlags: [...ITEM_SCOPE_FLAGS, 'id'],
    positionalArgs: ['id'],
    examples: ['orca items show 2026-04-19-harmonic-filter --json']
  },
  {
    path: ['items', 'create'],
    summary: 'Create a new markdown work item in a project queue stage',
    usage:
      'orca items create --project <project> --title <title> [--type <type>] [--stage <stage>] [--id <id>] [--priority <p>] [--size <s>] [--risk <r>] [--ready] [--body <markdown>] [--json]',
    allowedFlags: [...ITEM_SCOPE_FLAGS, 'title', 'id', 'priority', 'size', 'risk', 'ready', 'body'],
    examples: [
      'orca items create --project djvibe.com --title "Harmonic filter" --stage backlog --priority high --ready --json'
    ]
  },
  {
    path: ['items', 'move'],
    summary:
      'Move a work item to another stage (or reject into a reason bucket) and log transition',
    usage:
      'orca items move <id> --to-stage <stage> [--reason <bucket>] [--goal <goal>] [--project <project>] [--type <type>] [--stage <stage>] [--json]',
    allowedFlags: [...ITEM_SCOPE_FLAGS, 'id', 'to-stage', 'reason', 'goal'],
    positionalArgs: ['id'],
    examples: [
      'orca items move 2026-04-19-harmonic-filter --to-stage specs --json',
      'orca items move 2026-04-19-harmonic-filter --to-stage rejected --reason not-now --json'
    ]
  },
  {
    path: ['items', 'edit'],
    summary: 'Edit frontmatter fields, ready state, or markdown body on a work item',
    usage:
      'orca items edit <id> [--set <key=value>...] [--ready] [--unready] [--title <title>] [--body <markdown>] [--project <project>] [--type <type>] [--stage <stage>] [--json]',
    allowedFlags: [...ITEM_SCOPE_FLAGS, 'id', 'set', 'ready', 'unready', 'title', 'body'],
    repeatableFlags: ['set'],
    positionalArgs: ['id'],
    examples: ['orca items edit 2026-04-19-harmonic-filter --set priority=high --ready --json']
  },
  {
    path: ['usage', 'summary'],
    summary: 'Summarize XOS goal run counts, token usage, and estimated cost by goal and model',
    usage: 'orca usage summary [--project <project>] [--goal <goal>] [--days <n>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'project', 'goal', 'days'],
    examples: [
      'orca usage summary --days 7 --json',
      'orca usage summary --project djvibe.com --goal seo-blog-post --days 30 --json'
    ]
  },
  {
    path: ['models', 'list'],
    summary: 'List available XOS agent models, reasoning efforts, and Auto-mode tier assignments',
    usage: 'orca models list [--agent <agent>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'agent'],
    examples: ['orca models list --json', 'orca models list --agent claude --json']
  }
]
