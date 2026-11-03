import type { CommandSpec } from '../args'
import { LOCAL_COMMAND_FLAGS } from '../args'

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
  }
]
