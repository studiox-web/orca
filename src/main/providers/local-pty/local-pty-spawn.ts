import {
  assertNativeStubProviderSpawn,
  nativeStubSpawnEnvironment
} from '../../runtime/native-stub-launch-options'
import { assertNativeProviderPhysicalSpawn } from '../../runtime/native-provider-launch-options'
import { markNativeProviderDispatched } from '../../runtime/native-provider-execution-admission'
import { assertCoordinatedNativeSandboxPhysicalSpawn } from '../../runtime/coordinated-native-sandbox/coordinated-native-sandbox-launch'
import { prepareCoordinatedNativeSandboxSpawn } from '../../runtime/coordinated-native-sandbox/coordinated-native-sandbox-attempt'
import { randomUUID } from 'node:crypto'
import { win32 as pathWin32 } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { JCODE_RUNTIME_DIR_ENV_KEY } from '../../../shared/jcode-runtime-dir'
import { SessionNotFoundError } from '../../daemon/daemon-errors'
import { prepareMacosTccLoginShell } from '../macos-tcc-login-shell'
import { finalizeLocalPtySpawnEnvironment } from './local-pty-finalize-environment'
import { normalizeLocalCallerSessionId } from './local-pty-launch-context'
import { createLocalPtyLaunchPlan, DeferredLocalPtyLaunchPlan } from './local-pty-launch-plan'
import { holdPassiveRestoreOfStoppedWslDistro } from '../../daemon/daemon-wsl-passive-restore-hold'
import type { LocalPtyProviderOptions } from './local-pty-provider-types'
import {
  validateWorkingDirectory,
  WorkingDirectoryValidationAbortedError
} from '../working-directory-validation'
import { allocatePtyId, ptyShutdownOperations } from './local-pty-provider-state'
import {
  activateLocalPtySession,
  recordLocalPtySpawnIdentity
} from './local-pty-session-activation'
import {
  buildLocalPtySpawnEnvironment,
  enforceLocalPtySpawnEnvironmentOverrides
} from './local-pty-spawn-environment'
import {
  runCancelableLocalPtySpawn,
  reattachLocalPty,
  reserveLocalPtySpawn
} from './local-pty-spawn-state'
import { loadLocalPtyRuntimeSpawn, loadNativeStubRuntimeSpawn } from './local-pty-runtime-spawn'
import { destroyPtyProcess } from './local-pty-termination'
import { updateHistoryEnvForFallback } from '../../terminal-history'
import type { PtySpawnOptions } from '../pty-provider-contract'
import type { PtySpawnResult } from '../pty-spawn-result'

export async function spawnLocalPty(
  args: PtySpawnOptions,
  getOptions: () => LocalPtyProviderOptions
): Promise<PtySpawnResult> {
  if (args.preparedNativeProvider !== undefined) {
    assertNativeProviderPhysicalSpawn(args)
  }
  if (args.preparedNativeStub !== undefined) {
    assertNativeStubProviderSpawn(args)
  }
  const reattachId = normalizeLocalCallerSessionId(args.sessionId, args.attachOnly === true)
  if (reattachId) {
    const pendingShutdown = ptyShutdownOperations.get(reattachId)
    if (pendingShutdown) {
      await pendingShutdown.promise
    }
    const existing = reattachLocalPty(reattachId, args.cols, args.rows)
    if (existing) {
      return existing
    }
  }
  if (args.attachOnly) {
    throw new SessionNotFoundError(args.sessionId ?? '')
  }
  const jcodeRuntimeDir = args.env?.[JCODE_RUNTIME_DIR_ENV_KEY]
  if (jcodeRuntimeDir) {
    try {
      await mkdir(jcodeRuntimeDir, { recursive: true })
    } catch {
      // Runtime-dir failure must not block ordinary shells; let jcode choose its own default.
      delete args.env?.[JCODE_RUNTIME_DIR_ENV_KEY]
    }
  }
  const id = allocatePtyId(reattachId ?? undefined)
  return runCancelableLocalPtySpawn(id, async (throwIfCanceled, cancellation) => {
    const incarnationId = randomUUID()
    let plan = createLocalPtyLaunchPlan(args, getOptions)
    if (plan instanceof DeferredLocalPtyLaunchPlan) {
      const available = await plan.availability
      throwIfCanceled()
      plan = plan.finish(available)
    }
    throwIfCanceled()
    // Daemon-off (the daemon failed to start) a restore spawns here: same E9 hold as the daemon's.
    await holdPassiveRestoreOfStoppedWslDistro(args, plan.launchWslDistro ?? undefined)
    throwIfCanceled()
    if (args.prevalidatedCwd !== plan.validationCwd) {
      try {
        await validateWorkingDirectory(plan.validationCwd, cancellation)
      } catch (error) {
        // Shared validation may continue for other waiters; surface this spawn cancellation independently.
        if (error instanceof WorkingDirectoryValidationAbortedError) {
          throwIfCanceled()
        }
        throw error
      }
      throwIfCanceled()
    }
    if (args.preparedNativeProvider) {
      assertNativeProviderPhysicalSpawn(args)
    }
    const envResult = args.preparedNativeStub
      ? { ...nativeStubSpawnEnvironment(args.preparedNativeStub) }
      : buildLocalPtySpawnEnvironment({
          id,
          spawn: args,
          getOptions,
          plan
        })
    let finalEnv = envResult instanceof Promise ? await envResult : envResult
    throwIfCanceled()
    if (!args.preparedNativeStub) {
      enforceLocalPtySpawnEnvironmentOverrides(args, finalEnv)
    }
    const historyResult = args.preparedNativeStub
      ? undefined
      : finalizeLocalPtySpawnEnvironment({
          spawn: args,
          getOptions,
          plan,
          env: finalEnv
        })

    const nativeSandbox = args.preparedNativeProvider
      ? await prepareCoordinatedNativeSandboxSpawn(args.preparedNativeProvider, finalEnv)
      : undefined
    if (nativeSandbox) {
      plan.shellPath = nativeSandbox.shellPath
      plan.shellArgs = [...nativeSandbox.shellArgs]
      plan.effectiveCwd = nativeSandbox.cwd
      plan.startupCommandDeliveredInShellArgs = true
      plan.windowsFallbackAttempts = []
      plan.getFallbackShellReadyConfig = undefined
      plan.primaryPreLaunchEnv = {}
      plan.shellReadyLaunch = null
      finalEnv = { ...nativeSandbox.env }
    }
    const fallbackHistory = !nativeSandbox && historyResult?.historyDir ? historyResult : undefined
    const [spawn] = args.preparedNativeStub
      ? [await loadNativeStubRuntimeSpawn(args.preparedNativeStub)]
      : await Promise.all([loadLocalPtyRuntimeSpawn(), prepareMacosTccLoginShell()])
    return reserveLocalPtySpawn(id, async () => {
      const checkCanceled = (): void => {
        throwIfCanceled()
        if (args.signal?.aborted) {
          throw new Error('client_disconnected')
        }
      }
      checkCanceled()
      // Preflight can yield to a same-id winner; attach before creating another shell.
      const concurrentWinner = reattachId ? reattachLocalPty(id, args.cols, args.rows) : null
      if (concurrentWinner) {
        return concurrentWinner
      }
      if (args.preparedNativeProvider) {
        assertNativeProviderPhysicalSpawn(args)
        assertCoordinatedNativeSandboxPhysicalSpawn(args.preparedNativeProvider, {
          shellPath: plan.shellPath,
          shellArgs: plan.shellArgs,
          cwd: plan.effectiveCwd,
          env: finalEnv,
          hasFallback:
            plan.windowsFallbackAttempts.length > 0 ||
            plan.getFallbackShellReadyConfig !== undefined ||
            Object.keys(plan.primaryPreLaunchEnv).length > 0 ||
            plan.shellReadyLaunch !== null ||
            !plan.startupCommandDeliveredInShellArgs
        })
      }
      const pendingSpawn = spawn({
        shellPath: plan.shellPath,
        shellArgs: plan.shellArgs,
        cols: args.cols,
        rows: args.rows,
        cwd: plan.effectiveCwd,
        env: finalEnv,
        termName: finalEnv.TERM,
        signal: args.signal ? AbortSignal.any([args.signal, cancellation]) : cancellation,
        getShellReadyConfig: plan.getFallbackShellReadyConfig,
        preLaunchEnv: plan.primaryPreLaunchEnv,
        // Correct fallback HISTFILE before spawn; zsh_history cannot serve a bash fallback.
        onBeforeFallbackSpawn: fallbackHistory
          ? (env, fallbackShell) => updateHistoryEnvForFallback(env, fallbackShell, fallbackHistory)
          : undefined,
        windowsFallbackAttempts: plan.windowsFallbackAttempts
      })
      const spawnResult = pendingSpawn instanceof Promise ? await pendingSpawn : pendingSpawn
      try {
        if (args.preparedNativeStub || args.preparedNativeProvider) {
          if (args.preparedNativeProvider) {
            markNativeProviderDispatched(args.preparedNativeProvider)
          }
          recordLocalPtySpawnIdentity({
            id,
            incarnationId,
            spawn: args,
            getOptions,
            plan,
            env: finalEnv,
            proc: spawnResult.process,
            reportsChildExitStatus: spawnResult.reportsChildExitStatus !== false,
            spawnedWslDistro: process.platform === 'win32' ? null : undefined
          })
        } else {
          try {
            checkCanceled()
          } catch (error) {
            try {
              spawnResult.process.kill('SIGKILL')
            } finally {
              destroyPtyProcess(spawnResult.process)
            }
            throw error
          }
        }
        if (!args.preparedNativeStub) {
          args.onPtySpawnCommitted?.({ ptyId: id, incarnationId })
        }
        plan.shellPath = spawnResult.shellPath
        // The winning Windows fallback may embed startup in argv; its flag prevents duplicate stdin delivery.
        if (spawnResult.startupCommandDeliveredInShellArgs !== undefined) {
          plan.startupCommandDeliveredInShellArgs = spawnResult.startupCommandDeliveredInShellArgs
        }
        if (args.command && plan.getFallbackShellReadyConfig) {
          plan.shellReadyLaunch = plan.getFallbackShellReadyConfig(plan.shellPath)
        }

        if (!args.preparedNativeStub && process.platform !== 'win32') {
          finalEnv.SHELL = plan.shellPath
        }

        const proc = spawnResult.process
        const spawnedShellIsWsl =
          process.platform === 'win32' &&
          pathWin32.basename(plan.shellPath).toLowerCase() === 'wsl.exe'
        const spawnedWslDistro = spawnedShellIsWsl
          ? (plan.launchWslDistro ?? undefined)
          : process.platform === 'win32'
            ? null
            : undefined
        const result = activateLocalPtySession({
          id,
          incarnationId,
          spawn: args,
          getOptions,
          plan,
          env: finalEnv,
          proc,
          reportsChildExitStatus: spawnResult.reportsChildExitStatus !== false,
          spawnedWslDistro
        })
        if (args.preparedNativeStub) {
          checkCanceled()
          args.onPtySpawnCommitted?.({ ptyId: id, incarnationId })
        }
        return result
      } catch (cause) {
        if (!args.preparedNativeStub && !args.preparedNativeProvider) {
          throw cause
        }
        // Physical spawn is proven; failed activation or acknowledgement does not prove exit.
        throw Object.assign(
          new Error(
            args.preparedNativeStub
              ? 'native_stub_post_spawn_outcome_unknown'
              : 'native_provider_post_spawn_outcome_unknown',
            { cause }
          ),
          {
            code: 'operation_unknown',
            ptyId: id,
            incarnationId
          }
        )
      }
    })
  })
}
