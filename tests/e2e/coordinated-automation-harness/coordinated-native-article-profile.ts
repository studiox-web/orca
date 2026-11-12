import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { RuntimeStore } from '../../../src/main/runtime/runtime-store-contract'
import { hostWorktreeTarget } from '../../../src/shared/worktree/host-qualified-identity'
import { worktreeWorkspaceKey } from '../../../src/shared/workspace-scope'

const Descriptor = z.strictObject({
  version: z.literal(1),
  profileDirectory: z.string(),
  repoId: z.string().uuid(),
  workspaceId: z.string(),
  workspacePath: z.string(),
  promptAuthority: z.string(),
  idempotencyKey: z.string()
})

export async function prepareNativeArticleProfile(input: {
  store: RuntimeStore
  userDataDirectory: string
  workspacePath: string
  promptAuthority: string
  idempotencyKey: string
}) {
  const { store, promptAuthority, idempotencyKey } = input
  const root = realpathSync(input.userDataDirectory)
  const workspacePath = realpathSync(input.workspacePath)
  const profileDirectory = realpathSync(store.getProfileStorageDirectory!())
  const descriptorPath = join(root, 'article-pilot.json')
  const existing = lstatSync(descriptorPath, { throwIfNoEntry: false })
  let descriptor: z.infer<typeof Descriptor>
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error('native_article_descriptor_not_regular')
    }
    descriptor = Descriptor.parse(JSON.parse(readFileSync(descriptorPath, 'utf8')))
    const repo = store.getRepo(descriptor.repoId)
    if (
      descriptor.profileDirectory !== profileDirectory ||
      descriptor.workspacePath !== workspacePath ||
      descriptor.promptAuthority !== promptAuthority ||
      descriptor.idempotencyKey !== idempotencyKey ||
      descriptor.workspaceId !== worktreeWorkspaceKey(`${descriptor.repoId}::${workspacePath}`) ||
      !repo ||
      repo.path !== workspacePath ||
      repo.kind !== 'folder' ||
      repo.executionHostId !== 'local' ||
      store.getRepos().filter((candidate) => candidate.path === workspacePath).length !== 1
    ) {
      throw new Error('native_article_profile_identity_changed')
    }
  } else {
    if (store.getRepos().some((repo) => repo.path === workspacePath)) {
      throw new Error('native_article_descriptor_missing_reconciliation_required')
    }
    const repo = {
      id: randomUUID(),
      path: workspacePath,
      displayName: 'Isolated article test',
      badgeColor: 'blue',
      addedAt: Date.now(),
      kind: 'folder' as const,
      executionHostId: 'local' as const
    }
    const worktreeId = `${repo.id}::${workspacePath}`
    descriptor = {
      version: 1,
      profileDirectory,
      repoId: repo.id,
      workspaceId: worktreeWorkspaceKey(worktreeId),
      workspacePath,
      promptAuthority,
      idempotencyKey
    }
    store.addRepo(repo)
    store.setWorktreeMeta(hostWorktreeTarget({ id: worktreeId, hostId: 'local' }), {
      displayName: 'Isolated article test'
    })
    await store.flushPendingOrThrowAsync!()
    writeFileSync(descriptorPath, JSON.stringify(descriptor), { mode: 0o600, flag: 'wx' })
  }
  const lockRoot = join(root, 'article-locks')
  mkdirSync(lockRoot, { mode: 0o700, recursive: true })
  if (lstatSync(lockRoot).isSymbolicLink() || realpathSync(lockRoot) !== lockRoot) {
    throw new Error('native_article_lock_directory_changed')
  }
  return { workspaceId: descriptor.workspaceId, lockRoot }
}
