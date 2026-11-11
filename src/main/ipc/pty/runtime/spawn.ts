import {
  assertNativeStubRuntimeSpawn,
  assertNativeStubProviderSpawn
} from '../../../runtime/native-stub-launch-options'
import { getLocalPtyProvider } from '../provider/registry'
import {
  assertNativeProviderRuntimeSpawn,
  assertNativeProviderPhysicalSpawn
} from '../../../runtime/native-provider-launch-options'
import { runPtySpawn, normalizePtySpawnSessionId } from '../spawn-operation'
import { requireAcceptedSpawn } from '../spawn-outcome'
import type { PtyRuntimeControllerDeps } from './controller-deps'
import { prepareRuntimePtySpawn } from './spawn-preflight'
import { applyAgentLaunchPluginHook } from '../spawn-agent-launch-plugin-hook'
import { buildRuntimePtySpawnOptions } from './spawn-options'
import { commitRuntimePtySpawn } from './spawn-commit'
import { createRuntimePtySpawnState, type RuntimePtySpawnArgs } from './spawn-state'
import {
  commitRuntimeSpawnHiddenDelivery,
  markRuntimeSpawnHiddenBeforeSpawn,
  releaseRuntimeSpawnPreSpawnHiddenMark
} from './spawn-hidden-delivery'

/** Runtime projection stays inside the admitted start, so a rejected start withdraws its new pane. */
export async function spawnPtyFromRuntimeController(
  deps: PtyRuntimeControllerDeps,
  request: RuntimePtySpawnArgs
) {
  if (request.preparedNativeProvider !== undefined) {
    assertNativeProviderRuntimeSpawn(request, deps.runtime)
  }
  if (request.preparedNativeStub !== undefined) {
    assertNativeStubRuntimeSpawn(request, deps.runtime)
  }
  const args = { ...request, sessionId: normalizePtySpawnSessionId(request.sessionId) }
  const ctx = createRuntimePtySpawnState(deps, args)
  const outcome = await runPtySpawn({
    state: ctx,
    prepare: async () => {
      if (ctx.args.preparedNativeStub !== undefined) {
        assertNativeStubRuntimeSpawn(ctx.args, deps.runtime)
      } else {
        ctx.args = await applyAgentLaunchPluginHook(ctx.args, deps.runtime)
      }
      if (request.preparedNativeProvider !== undefined) {
        if (
          ctx.args.preparedNativeProvider !== request.preparedNativeProvider ||
          ctx.args.onPtySpawnCommitted !== request.onPtySpawnCommitted ||
          ctx.args.preAllocatedHandle !== request.preAllocatedHandle ||
          ctx.args.tabId !== request.tabId ||
          ctx.args.leafId !== request.leafId ||
          ctx.args.launchToken !== request.launchToken
        ) {
          throw new Error('native_provider_identity_changed')
        }
        assertNativeProviderRuntimeSpawn(ctx.args, deps.runtime)
      }
      await prepareRuntimePtySpawn(ctx)
      await buildRuntimePtySpawnOptions(ctx)
    },
    facts: () => ({
      sessionId: ctx.sessionId,
      savedResumePaneKey: ctx.spawnIdentityPaneKey,
      launchConfig: ctx.args.launchConfig,
      suppressRefusedLaunch: () => {
        ctx.launchCommand = undefined
        ctx.env = ctx.spawnOptions.env
      },
      paneKey: ctx.spawnIdentityPaneKey,
      preAllocatedHandle: args.preAllocatedHandle,
      validateDispatch: () => {
        if (request.preparedNativeProvider !== undefined) {
          assertNativeProviderRuntimeSpawn(ctx.args, deps.runtime)
          assertNativeProviderPhysicalSpawn(ctx.spawnOptions)
          if (ctx.provider !== getLocalPtyProvider()) {
            throw new Error('native_provider_changed')
          }
        }
        if (ctx.args.preparedNativeStub !== undefined) {
          assertNativeStubRuntimeSpawn(ctx.args, deps.runtime)
          assertNativeStubProviderSpawn(ctx.spawnOptions)
          if (ctx.provider !== getLocalPtyProvider()) {
            throw new Error('native_stub_provider_changed')
          }
        }
      },
      beforeProviderSpawn: () => markRuntimeSpawnHiddenBeforeSpawn(ctx),
      reportPtySpawnCommitted: () => ctx.reportPtySpawnCommitted()
    }),
    commit: () => {
      if (!ctx.result.isReattach) {
        Object.assign(ctx.result, {
          ...(ctx.agentResumeUnavailable ? { agentResumeUnavailable: true as const } : {}),
          launchConfig: ctx.args.launchConfig,
          launchAgent: ctx.args.launchAgent,
          launchToken: ctx.args.launchToken,
          resumeProviderSession: ctx.codexResumeArgvDropped
            ? undefined
            : ctx.args.resumeProviderSession
        })
      }
      return commitRuntimePtySpawn(ctx)
    },
    onCommitted: () => commitRuntimeSpawnHiddenDelivery(ctx),
    releaseHiddenMark: () => releaseRuntimeSpawnPreSpawnHiddenMark(ctx),
    adoption: () => ({ completed: args.adoptedStablePane })
  })
  const result = requireAcceptedSpawn(outcome)
  let stablePaneOwner = result.stablePaneOwner
  if (outcome.owner && args.worktreeId) {
    const handle = stablePaneOwner?.handle ?? outcome.owner.handle ?? args.preAllocatedHandle
    if (!handle) {
      throw new Error('terminal_pane_owner_unknown')
    }
    stablePaneOwner = { handle, tabId: outcome.owner.tabId, leafId: outcome.owner.leafId }
  }
  return {
    ...result,
    wslDistro: result.wslDistro ?? undefined,
    ...(stablePaneOwner ? { stablePaneOwner } : {}),
    ...(result.agentSessionEnsure ? { agentSessionEnsure: result.agentSessionEnsure } : {}),
    ...(result.startupCwdFallback ? { startupCwdFallback: result.startupCwdFallback } : {})
  }
}
