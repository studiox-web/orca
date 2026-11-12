import { app } from 'electron'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startMainProcess } from '../../../src/main/main-process-bootstrap'
import { createIsolatedNativeCoordinatedAppComposition } from '../../../src/main/startup/main-process-native-pilot-composition'
import { createCoordinatedNativeSandboxPolicy } from '../../../src/main/runtime/coordinated-native-sandbox/coordinated-native-sandbox-policy'
import { prepareNativeArticleProfile } from './coordinated-native-article-profile'
import { loadArticlePilotInputs } from './coordinated-article-pilot-package'

const userDataDirectory = process.env.ORCA_E2E_USER_DATA_DIR
const homeDirectory = process.env.ORCA_E2E_HOME_DIR
if (
  !userDataDirectory ||
  !homeDirectory ||
  app.isPackaged ||
  process.platform !== 'linux' ||
  process.env.ORCA_BACKGROUND_LAUNCH !== '1'
) {
  throw new Error('native_article_pilot_requires_isolated_hidden_linux_entry')
}
const workspacePath = realpathSync(join(userDataDirectory, 'article'))
const inputRoot = join(workspacePath, 'inputs')
const outputRoot = join(workspacePath, 'outputs')
const inputs = loadArticlePilotInputs(inputRoot)
const promptAuthority = `pilot:${inputs.inputManifestDigest}`
const idempotencyKey = 'article-native-manual-001'
const codexBinary = process.env.ORCA_PILOT_CODEX_BINARY
const authFile = process.env.ORCA_PILOT_AUTH_FILE
const nodeBinary = process.env.ORCA_PILOT_NODE_BINARY
const helperFile = process.env.ORCA_PILOT_REPORT_HELPER
if (!codexBinary || !authFile || !nodeBinary || !helperFile) {
  throw new Error('native_article_pilot_launch_files_required')
}

startMainProcess(async (context) => {
  const { workspaceId, lockRoot } = await prepareNativeArticleProfile({
    store: context.store,
    userDataDirectory,
    workspacePath,
    promptAuthority,
    idempotencyKey
  })
  const sandboxPolicy = createCoordinatedNativeSandboxPolicy({
    scope: { userDataDirectory, homeDirectory, workspacePath, workspaceId },
    launch: {
      inputRoot,
      outputRoot,
      codexBinary,
      authFile,
      nodeBinary,
      helperFile,
      outputFiles: {
        'brief-review': [join(outputRoot, 'brief-review.json')],
        'media-context': [join(outputRoot, 'media-context-review.json')],
        'write-draft': [join(outputRoot, 'draft.md')],
        'editor-review': [join(outputRoot, 'editor-review.json')]
      },
      revisionDirectories: { 'write-draft': join(outputRoot, 'revisions') }
    }
  })
  app.once('will-quit', () => {
    void sandboxPolicy.dispose()
  })
  return createIsolatedNativeCoordinatedAppComposition({
    userDataDirectory,
    pilotScope: {
      homeDirectory,
      workspaceId,
      workspacePath,
      inputRoot,
      promptAuthority,
      idempotencyKey,
      sandboxPolicy
    },
    estimateCostUsd: () => 1,
    laneLocks: {
      tryAcquire(lane, owner) {
        const path = join(lockRoot, createHash('sha256').update(lane).digest('hex'))
        try {
          writeFileSync(path, owner, { flag: 'wx', mode: 0o600 })
        } catch {
          return { acquired: false, holder: 'existing isolated article lock' }
        }
        return {
          acquired: true,
          release() {
            if (readFileSync(path, 'utf8') === owner) {
              unlinkSync(path)
            }
          }
        }
      }
    }
  })(context)
})
