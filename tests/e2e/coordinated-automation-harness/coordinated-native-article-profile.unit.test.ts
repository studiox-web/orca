import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  closeTestStores,
  createStore,
  testState
} from '../../../src/main/persistence/persistence-test-harness'
import { prepareNativeArticleProfile } from './coordinated-native-article-profile'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
let root: string

afterEach(async () => {
  await closeTestStores()
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
})

function setup() {
  root = mkdtempSync(join(tmpdir(), 'article-profile-'))
  testState.dir = join(root, 'profiles', 'local')
  const workspacePath = join(root, 'article')
  mkdirSync(workspacePath)
  const store = createStore()
  return {
    store,
    userDataDirectory: root,
    workspacePath,
    promptAuthority: 'fixture:inputs',
    idempotencyKey: 'manual-one'
  }
}

it('reopens a real persisted Store with the same workspace, descriptor bytes and retained lane owner', async () => {
  const input = setup()
  const original = await prepareNativeArticleProfile(input)
  const descriptor = readFileSync(join(root, 'article-pilot.json'), 'utf8')
  const lock = join(original.lockRoot, 'retained-lane')
  writeFileSync(lock, 'prior-owner-do-not-replay', { flag: 'wx' })
  await closeTestStores()
  const store = createStore()
  expect(await prepareNativeArticleProfile({ ...input, store })).toEqual(original)
  expect(store.getRepos()).toHaveLength(1)
  expect(readFileSync(join(root, 'article-pilot.json'), 'utf8')).toBe(descriptor)
  expect(readFileSync(lock, 'utf8')).toBe('prior-owner-do-not-replay')
})

it.each(['prompt', 'workspace', 'key', 'profile', 'descriptor'])(
  'refuses changed %s identity without creating a replacement workspace',
  async (change) => {
    const input = setup()
    await prepareNativeArticleProfile(input)
    const descriptorPath = join(root, 'article-pilot.json')
    if (change === 'prompt') {
      input.promptAuthority = 'different'
    }
    if (change === 'key') {
      input.idempotencyKey = 'different'
    }
    if (change === 'workspace') {
      input.workspacePath = join(root, 'other')
      mkdirSync(input.workspacePath)
    }
    if (change === 'profile') {
      const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
      descriptor.profileDirectory = join(root, 'wrong-profile')
      writeFileSync(descriptorPath, JSON.stringify(descriptor))
    }
    if (change === 'descriptor') {
      rmSync(descriptorPath)
    }
    await expect(prepareNativeArticleProfile(input)).rejects.toThrow(/native_article_/)
    expect(input.store.getRepos()).toHaveLength(1)
  }
)
