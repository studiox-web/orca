import type { HandlerGroup } from './handler-group-manifest'

export const XOS_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'xos-goals',
    keys: [
      'goals import',
      'goals list',
      'goals show',
      'goals run',
      'goals pause',
      'goals resume',
      'goals create',
      'goals edit',
      'goals archive',
      'goals delete',
      'goals message',
      'goals reply',
      'goals history',
      'goals stop',
      'goals runs',
      'goals status',
      'goals briefing',
      'goals messages',
      'goals notify',
      'goals notifications',
      'goals schedule',
      'goals authorize',
      'goals release',
      'goals triggers',
      'goals github-sync',
      'goals migrate plan',
      'goals migrate replace'
    ],
    load: async () => (await import('./handlers/xos-goals.js')).XOS_GOALS_HANDLERS
  },
  {
    name: 'xos-items',
    keys: [
      'items list',
      'items show',
      'items create',
      'items move',
      'items edit',
      'usage summary',
      'usage limits',
      'models list'
    ],
    load: async () => (await import('./handlers/xos-items.js')).XOS_ITEMS_HANDLERS
  }
]
