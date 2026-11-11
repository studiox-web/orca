import { describe, expect, it } from 'vitest'
import type {
  XosItemStage,
  XosItemsSnapshot,
  XosWorkItem
} from '../../../../shared/xos-items-types'
import {
  ALL_PROJECTS,
  buildColumns,
  selectedItems,
  selectedTypes,
  sortItems,
  stageTone
} from './xos-items-model'

function stage(id: string, count: number, extra: Partial<XosItemStage> = {}): XosItemStage {
  return {
    id,
    label: id,
    paths: [`/repo/${id}`],
    count,
    readyCount: null,
    floor: null,
    ceiling: null,
    kind: 'active',
    readers: [],
    writers: [],
    ...extra
  }
}

function item(path: string, stageId: string, extra: Partial<XosWorkItem> = {}): XosWorkItem {
  return {
    path,
    typeId: 'feature',
    stageId,
    bucket: null,
    title: path,
    updatedAt: '2026-11-01T00:00:00.000Z',
    created: null,
    ready: null,
    chips: [],
    ...extra
  }
}

const snapshot: XosItemsSnapshot = {
  generatedAt: '2026-11-03T00:00:00.000Z',
  projects: [
    {
      projectKey: '/a',
      projectName: 'A',
      perStageLimit: 60,
      types: [
        {
          id: 'feature',
          label: 'Features',
          stages: [stage('planned', 3, { readyCount: 1, floor: 5, ceiling: 8, writers: ['g1'] })]
        }
      ],
      items: [item('/a/1.md', 'planned'), item('/a/2.md', 'planned')]
    },
    {
      projectKey: '/b',
      projectName: 'B',
      perStageLimit: 60,
      types: [
        {
          id: 'feature',
          label: 'Features',
          stages: [
            stage('planned', 2, { readyCount: 2, floor: 5, ceiling: 8, writers: ['g2'] }),
            stage('completed', 9, { kind: 'done' })
          ]
        }
      ],
      items: [item('/b/1.md', 'planned', { updatedAt: '2026-11-02T00:00:00.000Z' })]
    }
  ]
}

describe('xos items model', () => {
  it('merges stages across projects for All projects', () => {
    const [type] = selectedTypes(snapshot, ALL_PROJECTS)
    expect(type.stages.map((entry) => entry.id)).toEqual(['planned', 'completed'])
    expect(type.stages[0]).toMatchObject({
      count: 5,
      readyCount: 3,
      floor: null,
      ceiling: null,
      writers: ['g1', 'g2']
    })
    expect(selectedTypes(snapshot, '/a')[0].stages).toHaveLength(1)
  })

  it('builds columns newest first and counts items beyond the cap', () => {
    const [type] = selectedTypes(snapshot, ALL_PROJECTS)
    const columns = buildColumns(type, selectedItems(snapshot, ALL_PROJECTS, 'feature'))
    expect(columns[0].items.map((entry) => entry.path)).toEqual(['/b/1.md', '/a/1.md', '/a/2.md'])
    expect(columns[0].hidden).toBe(2)
    expect(columns[0].items[0].projectName).toBe('B')
  })

  it('sorts by priority then rank', () => {
    const items = [
      item('low', 'planned', { chips: [{ key: 'priority', value: 'low' }] }),
      item('high-2', 'planned', {
        chips: [
          { key: 'priority', value: 'high' },
          { key: 'rank', value: '2' }
        ]
      }),
      item('none', 'planned'),
      item('high-1', 'planned', {
        chips: [
          { key: 'priority', value: 'P1' },
          { key: 'rank', value: '1' }
        ]
      })
    ].map((entry) => ({ ...entry, projectKey: '/a', projectName: 'A' }))
    expect(sortItems(items, 'priority').map((entry) => entry.path)).toEqual([
      'high-1',
      'high-2',
      'low',
      'none'
    ])
  })

  it('tones a stage against its floor and ceiling', () => {
    expect(stageTone(stage('x', 0))).toBe('idle')
    expect(stageTone(stage('x', 10, { readyCount: 3, floor: 5, ceiling: 8 }))).toBe('starved')
    expect(stageTone(stage('x', 10, { readyCount: 8, floor: 5, ceiling: 8 }))).toBe('backed-up')
  })
})
