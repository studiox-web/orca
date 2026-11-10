import { isDeepStrictEqual } from 'node:util'
import {
  consumeNativeStubLaunch,
  requireNativeStubLaunch,
  type PreparedNativeStubLaunch
} from '../../runtime/native-stub-session-test-host'
import { nativeStubSpawnEnvironment } from '../../runtime/native-stub-launch-options'
import { assertWslDistroAllowed } from '@orca/process-host/wsl-distro-allowlist'
import {
  spawnShellWithFallback,
  spawnPtyExecutable,
  type ShellSpawnParams,
  type ShellSpawnResult
} from './local-pty-executable-spawn'
import { reportNodePtyLoadFailure } from '../node-pty-load-failure'

type LocalPtySpawn = (
  params: Omit<ShellSpawnParams, 'ptySpawn'> & { signal?: AbortSignal }
) => ShellSpawnResult | Promise<ShellSpawnResult>

/** Degraded daemon routing loads node-pty lazily, as the daemon does. */
export async function loadLocalPtyRuntimeSpawn(): Promise<LocalPtySpawn> {
  const pty = await import('node-pty').catch((error: unknown) => {
    reportNodePtyLoadFailure(error)
    throw error
  })
  const ptySpawn: typeof pty.spawn = (file, args, options) => {
    assertWslDistroAllowed(file, args)
    return pty.spawn(file, args, options)
  }
  return (params) => spawnShellWithFallback({ ...params, ptySpawn })
}

export async function loadNativeStubRuntimeSpawn(
  permit: PreparedNativeStubLaunch
): Promise<LocalPtySpawn> {
  requireNativeStubLaunch(permit)
  const pty = await import('node-pty').catch((error: unknown) => {
    reportNodePtyLoadFailure(error)
    throw error
  })
  return (params) => {
    const record = requireNativeStubLaunch(permit)
    if (
      params.signal?.aborted ||
      params.shellPath !== record.composition.file ||
      !isDeepStrictEqual(params.shellArgs, [record.composition.fixture]) ||
      params.cwd !== record.workspace.path ||
      !isDeepStrictEqual(params.env, nativeStubSpawnEnvironment(permit))
    ) {
      throw new Error('native_stub_physical_dispatch_override')
    }
    consumeNativeStubLaunch(permit)
    const proc = spawnPtyExecutable({
      file: params.shellPath,
      args: params.shellArgs,
      cwd: params.cwd,
      env: params.env,
      cols: params.cols,
      rows: params.rows,
      termName: params.termName,
      ptySpawn: pty.spawn
    })
    return { process: proc, shellPath: params.shellPath, startupCommandDeliveredInShellArgs: true }
  }
}
