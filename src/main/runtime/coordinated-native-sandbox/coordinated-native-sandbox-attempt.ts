import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { getPublishedHostDescriptor } from '../host-descriptor'
import {
  requireNativeProviderLaunch,
  type PreparedNativeProviderLaunch
} from '../native-provider-execution-admission'
import { readCoordinatedNativeBinding } from '../../automations/coordinated-automation-native-attempt'
import { createCoordinatedNativeReportEndpoint } from './coordinated-native-report-endpoint'
import { coordinatedNativeCodexConfig } from './coordinated-native-codex-config'
import { canonicalSandboxPath, sandboxFileDigest } from './coordinated-native-sandbox-files'
import { requireCoordinatedNativeSandbox } from './coordinated-native-sandbox-launch'
import {
  readCoordinatedNativeSandboxLaunch,
  registerCoordinatedNativeSandboxAttempt,
  type CoordinatedNativeSandboxPhysicalSpawn
} from './coordinated-native-sandbox-policy'

export async function prepareCoordinatedNativeSandboxSpawn(
  candidate: PreparedNativeProviderLaunch,
  inherited: Readonly<Record<string, string>>
): Promise<CoordinatedNativeSandboxPhysicalSpawn | undefined> {
  const policy = requireCoordinatedNativeSandbox(candidate)
  if (!policy) {
    return undefined
  }
  const permit = requireNativeProviderLaunch(candidate)
  const { scope, launch } = readCoordinatedNativeSandboxLaunch(policy)
  const binding = readCoordinatedNativeBinding(
    permit.runtime.getOrchestrationDb(),
    permit.dispatchId
  )
  const terminalHandle = inherited.ORCA_TERMINAL_HANDLE
  const paneKey = inherited.ORCA_PANE_KEY
  const launchToken = inherited.ORCA_AGENT_LAUNCH_TOKEN
  const sourceId = getPublishedHostDescriptor(permit.runtime.getRuntimeId())?.installationId
  if (
    !binding ||
    !terminalHandle ||
    !paneKey ||
    !launchToken ||
    !sourceId ||
    !permit.selection.model ||
    !permit.selection.effort ||
    permit.phase !== 'creating'
  ) {
    throw new Error('coordinated_native_sandbox_launch_identity_missing')
  }
  const assignedFiles = launch.outputFiles[binding.childDefinitionId]
  if (!assignedFiles?.length) {
    throw new Error('coordinated_native_sandbox_child_not_admitted')
  }
  const revisionDirectory = launch.revisionDirectories?.[binding.childDefinitionId]
  const writableFiles = [
    ...assignedFiles,
    ...(revisionDirectory ? [join(revisionDirectory, `${permit.dispatchId}.md`)] : [])
  ]
  const declaredFiles = Object.values(launch.outputFiles).flat()
  for (const path of [...declaredFiles, ...writableFiles]) {
    canonicalSandboxPath(dirname(path))
    if (!existsSync(path)) {
      writeFileSync(path, '', { mode: 0o600, flag: 'wx' })
    }
    canonicalSandboxPath(path)
    sandboxFileDigest(path)
  }
  const readOnlyPaths = declaredFiles.filter((path) => !writableFiles.includes(path))
  for (const path of Object.values(launch.revisionDirectories ?? {})) {
    if (path !== revisionDirectory) {
      readOnlyPaths.push(path)
    } else {
      for (const name of readdirSync(path)) {
        const file = join(path, name)
        if (!writableFiles.includes(file)) {
          readOnlyPaths.push(file)
        }
      }
    }
  }
  const directory = mkdtempSync(join(scope.userDataDirectory, 'p-'))
  chmodSync(directory, 0o700)
  const home = join(directory, 'home')
  const codexHome = join(directory, 'codex')
  mkdirSync(home, { mode: 0o700 })
  mkdirSync(codexHome, { mode: 0o700 })
  let endpoint: Awaited<ReturnType<typeof createCoordinatedNativeReportEndpoint>> | undefined
  const cleanup = async () => {
    await endpoint?.stop()
    rmSync(directory, { recursive: true, force: true })
  }
  try {
    endpoint = await createCoordinatedNativeReportEndpoint({
      runtime: permit.runtime,
      directory,
      pendingLaunch: candidate,
      identity: {
        runtimeId: permit.runtime.getRuntimeId(),
        sourceId,
        runId: permit.runId,
        taskId: permit.taskId,
        dispatchId: permit.dispatchId,
        terminalHandle,
        paneKey,
        launchToken,
        consumerGeneration: 1
      }
    })
    const configFile = join(codexHome, 'config.toml')
    writeFileSync(
      configFile,
      coordinatedNativeCodexConfig({
        inputRoot: launch.inputRoot,
        outputRoot: launch.outputRoot,
        writableFiles,
        readOnlyPaths,
        workspacePath: scope.workspacePath,
        runtimeDirectory: dirname(launch.codexBinary),
        reportTool: {
          nodeBinary: launch.nodeBinary,
          helperFile: launch.helperFile,
          ticket: endpoint.ticket
        },
        toolEnvironment: {
          PATH: '/usr/bin:/bin',
          HOME: home,
          TERM: 'xterm-256color',
          LANG: 'C.UTF-8'
        }
      }),
      { mode: 0o600, flag: 'wx' }
    )
    copyFileSync(launch.authFile, join(codexHome, 'auth.json'))
    chmodSync(join(codexHome, 'auth.json'), 0o600)
    const pinnedFiles = new Map(
      [configFile, endpoint.ticket].map((path) => [path, sandboxFileDigest(path)])
    )
    const spawn: CoordinatedNativeSandboxPhysicalSpawn = {
      shellPath: launch.codexBinary,
      shellArgs: [
        '--strict-config',
        '--no-daemon',
        '--no-alt-screen',
        '-a',
        'never',
        '-C',
        scope.workspacePath,
        '-m',
        permit.selection.model,
        '-c',
        `model_reasoning_effort=${JSON.stringify(permit.selection.effort)}`
      ],
      cwd: scope.workspacePath,
      env: {
        PATH: '/usr/bin:/bin',
        HOME: home,
        CODEX_HOME: codexHome,
        XDG_CONFIG_HOME: join(home, '.config'),
        XDG_CACHE_HOME: join(home, '.cache'),
        TERM: 'xterm-256color',
        LANG: 'C.UTF-8',
        ORCA_TERMINAL_HANDLE: terminalHandle,
        ORCA_PANE_KEY: paneKey,
        ORCA_AGENT_LAUNCH_TOKEN: launchToken
      },
      hasFallback: false
    }
    registerCoordinatedNativeSandboxAttempt(policy, candidate, {
      spawn,
      cleanup,
      assertCurrent() {
        requireNativeProviderLaunch(candidate)
        for (const [path, digest] of pinnedFiles) {
          if (sandboxFileDigest(path) !== digest) {
            throw new Error('coordinated_native_sandbox_config_changed')
          }
        }
        for (const path of writableFiles) {
          canonicalSandboxPath(path)
          sandboxFileDigest(path)
        }
      }
    })
    return spawn
  } catch (error) {
    await cleanup()
    throw error
  }
}
