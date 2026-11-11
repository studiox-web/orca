import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

const SCOPE = [...LOCAL_COMMAND_FLAGS, 'project']

export const XOS_GOALS_OPS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['goals', 'stop'],
    summary: 'Stop the running run of a goal',
    usage: 'orca goals stop <goal> [--project <project>] [--json]',
    allowedFlags: [...SCOPE, 'goal'],
    positionalArgs: ['goal'],
    examples: ['orca goals stop seo-blog-post --json']
  },
  {
    path: ['goals', 'runs'],
    summary: 'List recent native run receipts of a goal',
    usage: 'orca goals runs <goal> [--project <project>] [--limit <n>] [--json]',
    allowedFlags: [...SCOPE, 'goal', 'limit'],
    positionalArgs: ['goal'],
    examples: ['orca goals runs seo-blog-post --limit 20 --json']
  },
  {
    path: ['goals', 'status'],
    summary: 'Counts for every project: running, attention, open inbox, held by an operator',
    usage: 'orca goals status [--project <project>] [--json]',
    allowedFlags: SCOPE,
    examples: ['orca goals status --json']
  },
  {
    path: ['goals', 'briefing'],
    summary: 'What needs attention: failures, open messages, cutover state',
    usage: 'orca goals briefing [--project <project>] [--json]',
    allowedFlags: SCOPE,
    examples: ['orca goals briefing --json']
  },
  {
    path: ['goals', 'messages'],
    summary: 'List the inbox messages of a goal, newest first',
    usage: 'orca goals messages <goal> [--project <project>] [--json]',
    allowedFlags: [...SCOPE, 'goal'],
    positionalArgs: ['goal'],
    examples: ['orca goals messages seo-blog-post --json']
  },
  {
    path: ['goals', 'notify'],
    summary: 'Queue a message from a goal for the operator bot to relay',
    usage: 'orca goals notify --goal <goal> --text <text> [--image <path>] [--json]',
    allowedFlags: [...SCOPE, 'goal', 'text', 'image'],
    examples: ['orca goals notify --goal seo-blog-post --text "Draft ready for review"']
  },
  {
    path: ['goals', 'notifications'],
    summary: 'Read the outbound notification queue (the bot polls this)',
    usage: 'orca goals notifications [--since <iso-time>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'since'],
    examples: ['orca goals notifications --since 2026-11-04T00:00:00Z --json']
  },
  {
    path: ['goals', 'schedule'],
    summary: 'Create the disabled Orca automation that runs a goal on a schedule',
    usage:
      'orca goals schedule <goal> --schedule <cron-or-rrule> [--agent <agent>] [--timezone <tz>] [--project <project>] [--json]',
    allowedFlags: [...SCOPE, 'goal', 'schedule', 'agent', 'timezone'],
    positionalArgs: ['goal'],
    examples: ['orca goals schedule seo-blog-post --schedule "25 10 * * *" --json']
  },
  {
    path: ['goals', 'authorize'],
    summary: 'Confirm what a goal may do; needed before it bypasses the sandbox or runs elevated',
    usage: 'orca goals authorize <goal> --confirm <goal> [--project <project>] [--json]',
    allowedFlags: [...SCOPE, 'goal', 'confirm'],
    positionalArgs: ['goal'],
    examples: ['orca goals authorize production-deploy --confirm production-deploy']
  },
  {
    path: ['goals', 'release'],
    summary: 'End a takeover: leave a handoff note and give the goal back to automation',
    usage: 'orca goals release <goal> [--note <text>] [--done] [--project <project>] [--json]',
    allowedFlags: [...SCOPE, 'goal', 'note', 'done'],
    positionalArgs: ['goal'],
    examples: ['orca goals release content-writer --note "Stopped at section 3" --json']
  },
  {
    path: ['goals', 'triggers'],
    summary: 'Turn queue and inbox event triggers on or off for a project (off by default)',
    usage: 'orca goals triggers [--enable | --disable] [--project <project>] [--json]',
    allowedFlags: [...SCOPE, 'enable', 'disable'],
    examples: ['orca goals triggers --project djvibe.com --enable']
  },
  {
    path: ['goals', 'github-sync'],
    summary: 'Pull open GitHub issues into local work items; --close closes completed ones',
    usage: 'orca goals github-sync [--close] [--project <project>] [--json]',
    allowedFlags: [...SCOPE, 'close'],
    examples: ['orca goals github-sync --project djvibe.com --json']
  },
  {
    path: ['goals', 'migrate', 'plan'],
    summary: 'Show every crontab job, what replaces it, and whether it is running anywhere',
    usage: 'orca goals migrate plan [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS],
    examples: ['orca goals migrate plan --json']
  },
  {
    path: ['goals', 'migrate', 'replace'],
    summary: 'Create the disabled Orca automation replacing one crontab job',
    usage: 'orca goals migrate replace --job <id> [--timezone <tz>] [--json]',
    allowedFlags: [...LOCAL_COMMAND_FLAGS, 'job', 'timezone'],
    examples: ['orca goals migrate replace --job abc123 --json']
  }
]
