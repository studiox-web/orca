// XOS fork: the legacy Cascade/DJVibe queue wiring as declared data (§3g.1). Today these rules live
// in GOAL.md prose; stage B moves them into GOAL.md `queues:` frontmatter and this map becomes the
// import default. Paths are relative to the repo root; a stage shows only when one folder exists,
// and a goal is wired only when it exists in that project.

export type LegacyStage = {
  id: string
  label: string
  /** Folders merged into this stage. With several, each folder's name is the item's bucket. */
  paths: string[]
  kind?: 'active' | 'done' | 'rejected'
  readers?: string[]
  writers?: string[]
  /** Dotted frontmatter key whose truthy value marks an item ready, e.g. builder.ready. */
  readyKey?: string
  floor?: number
  ceiling?: number
}

export type LegacyItemType = { id: string; label: string; stages: LegacyStage[] }

const DREAMER_INBOX = 'automations/goals/feature-dreamer/inbox'
const FEATURE_REJECT_BUCKETS = [
  'not-now',
  'too-big',
  'off-brand',
  'wrong-direction',
  'duplicate',
  'not-interested',
  'other'
]
const IDEA_REJECT_BUCKETS = FEATURE_REJECT_BUCKETS.map(
  (bucket) => `docs/features/rejected/${bucket}`
)

export const LEGACY_ITEM_TYPES: LegacyItemType[] = [
  {
    id: 'feature',
    label: 'Features',
    stages: [
      {
        id: 'pitch',
        label: 'Pitches',
        paths: [DREAMER_INBOX],
        writers: ['feature-dreamer'],
        readers: ['feature-backlog-groomer'],
        ceiling: 30
      },
      {
        id: 'accepted',
        label: 'Accepted',
        paths: [`${DREAMER_INBOX}/accepted`],
        readers: ['feature-backlog-groomer'],
        kind: 'done'
      },
      {
        id: 'planned',
        label: 'Planned',
        paths: ['docs/features/planned'],
        writers: ['feature-backlog-groomer'],
        readers: ['implement-planned-feature-backlog'],
        readyKey: 'builder.ready',
        floor: 5,
        ceiling: 8
      },
      {
        id: 'in-progress',
        label: 'In progress',
        paths: ['docs/features/in-progress'],
        writers: ['implement-planned-feature-backlog']
      },
      {
        id: 'completed',
        label: 'Completed',
        paths: ['docs/features/completed'],
        writers: ['implement-planned-feature-backlog'],
        kind: 'done'
      },
      {
        id: 'rejected',
        label: 'Rejected',
        paths: FEATURE_REJECT_BUCKETS.map((bucket) => `${DREAMER_INBOX}/${bucket}`),
        writers: ['feature-backlog-groomer'],
        kind: 'rejected'
      }
    ]
  },
  {
    id: 'feature-ideas',
    label: 'Feature ideas',
    stages: [
      {
        id: 'backlog',
        label: 'Idea backlog',
        paths: ['docs/features/backlog'],
        writers: ['feature-dreamer'],
        readers: ['feature-spec-writer']
      },
      {
        id: 'specs',
        label: 'Specs',
        paths: ['docs/features/specs'],
        writers: ['feature-spec-writer'],
        readers: ['implement-planned-feature-backlog'],
        readyKey: 'builder.ready'
      },
      {
        id: 'rejected',
        label: 'Rejected ideas',
        paths: IDEA_REJECT_BUCKETS,
        writers: ['feature-spec-writer'],
        kind: 'rejected'
      }
    ]
  },
  {
    id: 'bug',
    label: 'Bugs',
    stages: [
      {
        id: 'qa-inbox',
        label: 'QA inbox',
        paths: ['automations/bugs/inbox'],
        writers: ['staging-qa', 'staging-log-review'],
        readers: ['fix-qa-bugs']
      },
      {
        id: 'incoming',
        label: 'Incoming',
        paths: ['docs/bugs/incoming'],
        readers: ['fix-qa-bugs']
      },
      {
        id: 'in-progress',
        label: 'In progress',
        paths: ['docs/bugs/in-progress'],
        writers: ['fix-qa-bugs']
      },
      {
        id: 'fixed',
        label: 'Fixed',
        paths: ['docs/bugs/fixed', 'docs/bugs/resolved', 'automations/bugs/resolved'],
        writers: ['fix-qa-bugs'],
        kind: 'done'
      },
      {
        id: 'archived',
        label: 'Archived',
        paths: ['docs/bugs/archived', 'automations/bugs/processed'],
        kind: 'rejected'
      }
    ]
  },
  {
    id: 'feedback',
    label: 'Feedback',
    stages: [
      { id: 'incoming', label: 'Incoming', paths: ['docs/feedback/incoming'] },
      { id: 'routed', label: 'Routed', paths: ['docs/feedback/routed'], kind: 'done' },
      { id: 'archived', label: 'Archived', paths: ['docs/feedback/archived'], kind: 'rejected' }
    ]
  },
  {
    id: 'content',
    label: 'Content',
    stages: [
      {
        id: 'idea',
        label: 'Ideas',
        paths: ['content/ideas/inbox'],
        writers: ['content-trend-researcher', 'content-deep-researcher'],
        readers: ['content-editor', 'content-backlog-groomer']
      },
      {
        id: 'accepted',
        label: 'Accepted ideas',
        paths: ['content/ideas/accepted'],
        writers: ['content-editor', 'content-backlog-groomer'],
        kind: 'done'
      },
      {
        id: 'brief-ready',
        label: 'Ready briefs',
        paths: ['content/briefs/ready'],
        writers: ['content-editor', 'content-backlog-groomer'],
        readers: ['content-writer', 'content-writers-room']
      },
      {
        id: 'brief-assigned',
        label: 'Assigned briefs',
        paths: ['content/briefs/assigned'],
        writers: ['content-writer', 'content-writers-room'],
        kind: 'done'
      },
      {
        id: 'draft',
        label: 'Drafts',
        paths: ['content/drafts'],
        writers: ['content-writer', 'content-writers-room'],
        readers: ['content-editor', 'content-line-editor', 'content-media', 'content-publisher']
      },
      {
        id: 'staged',
        label: 'Staged',
        paths: ['content/staged'],
        writers: ['content-publisher'],
        kind: 'done'
      },
      {
        id: 'published',
        label: 'Published',
        paths: ['content/published'],
        writers: ['content-publisher'],
        kind: 'done'
      },
      {
        id: 'rejected',
        label: 'Rejected / deferred',
        paths: ['content/ideas/rejected', 'content/ideas/deferred'],
        writers: ['content-editor', 'content-backlog-groomer'],
        kind: 'rejected'
      }
    ]
  },
  {
    id: 'content-feedback',
    label: 'Content feedback',
    stages: [
      {
        id: 'incoming',
        label: 'Incoming',
        paths: ['content/feedback/incoming'],
        readers: ['content-loop-retrospective']
      },
      {
        id: 'routed',
        label: 'Routed',
        paths: ['content/feedback/routed'],
        writers: ['content-loop-retrospective'],
        kind: 'done'
      },
      {
        id: 'archived',
        label: 'Archived',
        paths: ['content/feedback/archived'],
        writers: ['content-loop-retrospective'],
        kind: 'rejected'
      }
    ]
  }
]
