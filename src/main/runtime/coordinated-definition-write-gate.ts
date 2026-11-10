import { isAbsolute } from 'node:path'
import { getAppEnvironment, hasAppEnvironment } from '../../shared/app-environment'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import type { RuntimeStore } from './runtime-store-contract'
import {
  COORDINATED_AUTOMATION_CONTRACT_VERSION,
  type CoordinatedHostCapabilities
} from '../../shared/coordinated-automation-saga-types'
import { assertHostSupportsCoordinatedAutomations } from '../../shared/rpc-contract/coordinated-automation-params'
import type { AutomationDestination } from '../../shared/automation-owner-precondition'
import type { WorkspaceRunContext } from '../../shared/task-source-context'
import type { Repo } from '../../shared/repo-types'
import { isRepoOnCatalogHost } from '../../shared/execution-host'

/** Host composition only; no RPC or settings payload can opt a profile into writes. */
export type CoordinatedDefinitionWriteHost = Readonly<{ profileDirectory: string }>

export function assertCoordinatedDefinitionSelf(
  destination: AutomationDestination,
  runContext?: WorkspaceRunContext | null
): void {
  if (destination.selector.kind !== 'self' || (runContext && runContext.hostId !== 'local')) {
    throw new Error('Coordinated definition writes support only the local host.')
  }
}

export function assertCoordinatedDefinitionLocalTarget(repo: Repo | null | undefined): void {
  if (!repo || !isRepoOnCatalogHost(repo)) {
    throw new Error('Coordinated definition writes require a confirmed local project.')
  }
}

export class CoordinatedDefinitionWriteGate {
  private readonly profileDirectory: string | undefined

  constructor(
    private readonly store: RuntimeStore | null,
    host?: CoordinatedDefinitionWriteHost,
    private readonly isLocalAuthority: () => boolean = () => true
  ) {
    this.profileDirectory = host?.profileDirectory
  }

  capabilities(): CoordinatedHostCapabilities | null {
    const store = this.store
    const profile = store?.getProfileStorageDirectory?.()
    if (
      store?.coordinatedAutomationDefinitionAuthority?.() !== 'desktop' ||
      !this.isLocalAuthority() ||
      !this.profileDirectory ||
      !isAbsolute(this.profileDirectory) ||
      !profile ||
      !isAbsolute(profile) ||
      normalizeRuntimePathForComparison(profile) !==
        normalizeRuntimePathForComparison(this.profileDirectory) ||
      !hasAppEnvironment() ||
      getAppEnvironment().isPackaged() ||
      store?.getSettings().experimentalCoordinatedAutomations !== true ||
      !store.listAutomations ||
      !store.createCoordinatedAutomation ||
      !store.updateCoordinatedAutomation ||
      !store.flushPendingOrThrowAsync ||
      !store.automationOwnerPrecondition ||
      !store.assertAutomationOwnerFence ||
      !store.automationChangeSelector
    ) {
      return null
    }
    return {
      contractVersion: COORDINATED_AUTOMATION_CONTRACT_VERSION,
      supportedCapabilities: ['coordinated_v1']
    }
  }

  assertAvailable(): void {
    assertHostSupportsCoordinatedAutomations(this.capabilities())
  }
}
