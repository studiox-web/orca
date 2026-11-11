import { describe, expect, it } from 'vitest'
import {
  readOnlyUnifiedCapabilities,
  readOnlyUnifiedScheduleChildCapabilities,
  unavailableUnifiedScriptRunnerCapabilities,
  type UnifiedDenialReason,
  type UnifiedReadOnlyCapabilityContext
} from './unified-automation-capabilities'

const localAuthority = {
  stable: {
    authority: { kind: 'desktop' as const },
    selector: { kind: 'self' as const }
  },
  ownerKey: 'owner:desktop:self',
  runtimePairingRevision: null,
  sshTargetGeneration: null
}

describe('unified automation capabilities', () => {
  it('serializes only open-detail as granted for every row kind', () => {
    for (const kind of ['goal', 'automation', 'script', 'external'] as const) {
      const capabilities = readOnlyUnifiedCapabilities({
        kind,
        manager: kind === 'external' ? 'supported' : undefined
      })

      expect(capabilities.granted).toEqual(['open-detail'])
      expect(capabilities.denied.length).toBeGreaterThan(0)
      expect(JSON.parse(JSON.stringify(capabilities))).toEqual(capabilities)
    }
  })

  it.each<{
    context: UnifiedReadOnlyCapabilityContext
    reason: UnifiedDenialReason
  }>([
    { context: { kind: 'automation', surfaceEnabled: false }, reason: 'flag-off' },
    { context: { kind: 'goal', localOnlyGoal: true }, reason: 'local-only-goal' },
    {
      context: { kind: 'automation', hostConnection: 'disconnected' },
      reason: 'host-disconnected'
    },
    { context: { kind: 'script', identity: 'legacy' }, reason: 'legacy-identity' },
    {
      context: { kind: 'script', platform: 'unsupported' },
      reason: 'unsupported-platform'
    },
    {
      context: { kind: 'external', manager: 'unsupported' },
      reason: 'manager-unsupported'
    },
    { context: { kind: 'goal', lifecycle: 'archived' }, reason: 'archived' },
    { context: { kind: 'automation', conflict: true }, reason: 'conflict' }
  ])('denies every unsafe action with $reason', ({ context, reason }) => {
    const capabilities = readOnlyUnifiedCapabilities(context)

    expect(capabilities.granted).toEqual(['open-detail'])
    expect(new Set(capabilities.denied.map((denial) => denial.reason))).toEqual(new Set([reason]))
  })

  it('keeps schedule-child ownership read-only and owner-specific', () => {
    expect(readOnlyUnifiedScheduleChildCapabilities({ owner: 'orca' })).toEqual({
      granted: [],
      denied: [{ capability: 'edit-schedule-child', reason: 'read-only-surface' }]
    })
    expect(readOnlyUnifiedScheduleChildCapabilities({ owner: 'legacy-cron' })).toEqual({
      granted: [],
      denied: [{ capability: 'edit-schedule-child', reason: 'legacy-identity' }]
    })
    expect(readOnlyUnifiedScheduleChildCapabilities({ owner: 'external-manager' })).toEqual({
      granted: [],
      denied: [{ capability: 'edit-schedule-child', reason: 'manager-unsupported' }]
    })
  })

  it('keeps disconnected Script runner evidence separate and entirely unavailable', () => {
    const snapshot = unavailableUnifiedScriptRunnerCapabilities({
      authority: localAuthority,
      observedAt: '2026-11-08T12:00:00.000Z',
      status: 'unavailable',
      reason: 'host-disconnected',
      platform: 'linux'
    })

    expect(snapshot.authority).toEqual(localAuthority)
    expect(snapshot.platform).toEqual({ status: 'supported', value: 'linux', reason: null })
    expect(snapshot.availability).toEqual({
      status: 'unavailable',
      value: null,
      reason: 'host-disconnected'
    })
    expect(snapshot.invocationModes.status).toBe('unavailable')
    expect(snapshot.cancellation.value).toBeNull()
    expect(snapshot.outputArtifacts.value).toBeNull()
    expect(snapshot.elevation).toEqual({
      status: 'unsupported',
      value: false,
      reason: 'host-disconnected'
    })
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
  })
})
