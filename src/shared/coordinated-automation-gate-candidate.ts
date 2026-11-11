import { z } from 'zod'

export const CoordinatedStageGateCandidateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('report'),
    dispatchId: z.string().min(1),
    reportDigest: z.string().min(1)
  }),
  z.strictObject({ kind: z.literal('attempt'), dispatchId: z.string().min(1) }),
  z.strictObject({ kind: z.literal('no_attempt') })
])

export type CoordinatedStageGateCandidate = z.infer<typeof CoordinatedStageGateCandidateSchema>

export function sameStageGateCandidate(
  left: CoordinatedStageGateCandidate | null | undefined,
  right: CoordinatedStageGateCandidate | null | undefined
): boolean {
  if (!left || !right || left.kind !== right.kind) {
    return false
  }
  if (left.kind === 'no_attempt') {
    return true
  }
  if (right.kind === 'no_attempt' || left.dispatchId !== right.dispatchId) {
    return false
  }
  return (
    left.kind !== 'report' || (right.kind === 'report' && left.reportDigest === right.reportDigest)
  )
}
