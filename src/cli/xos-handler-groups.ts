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
      'goals history'
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
      'models list'
    ],
    load: async () => (await import('./handlers/xos-items.js')).XOS_ITEMS_HANDLERS
  }
]
