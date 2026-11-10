import {
  readNativeStubLaunchRecord,
  requireNativeStubLaunch,
  type PreparedNativeStubLaunch
} from './native-stub-session-test-host'

export type NativeStubPhysicalIdentity = Readonly<{
  ptyId: string
  incarnationId: string
  handle: string
  paneKey: string
  workspaceId: string
  runtimeGeneration: string
}>

export function observeNativeStubPhysicalSpawn(
  permit: PreparedNativeStubLaunch,
  observer: (identity: NativeStubPhysicalIdentity) => void,
  assertCurrent: () => void
): void {
  const record = requireNativeStubLaunch(permit)
  if (record.observePhysicalSpawn || record.phase !== 'prepared') {
    throw new Error('native_stub_observer_reused')
  }
  assertCurrent()
  record.observePhysicalSpawn = observer
  record.assertDispatchCurrent = assertCurrent
}

// Retention of an already-spawned process is evidence, not renewed admission after revocation.
export function recordNativeStubPhysicalSpawn(
  permit: PreparedNativeStubLaunch,
  ptyId: string,
  incarnationId: string
): void {
  const record = readNativeStubLaunchRecord(permit)
  if (!record || record.phase !== 'dispatched' || !record.surface) {
    throw new Error('native_stub_physical_identity_unproven')
  }
  const observer = record.observePhysicalSpawn
  delete record.observePhysicalSpawn
  observer?.(
    Object.freeze({
      ptyId,
      incarnationId,
      handle: record.surface.handle,
      paneKey: `${record.surface.tabId}:${record.surface.leafId}`,
      workspaceId: record.workspace.id,
      runtimeGeneration: record.composition.generation!
    })
  )
}
