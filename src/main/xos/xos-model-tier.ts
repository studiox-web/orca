// XOS fork: model tier inference shared by Auto mode, the runtime IPC and the Agent-facing CLI.
// Kept free of electron and session-registry imports so plain-Node CLI entries can use it.
import type { XosModelTier } from '../../shared/xos-runtime-types'

/** RT5 pairs: gpt-5.5↔opus↔gemini pro, mini↔sonnet↔flash, spark↔haiku↔flash-lite. */
export function inferTier(model: string): XosModelTier | null {
  const id = model.toLowerCase()
  if (/haiku|spark|\bnano\b|\blite\b/.test(id)) {
    return 'light'
  }
  if (/\bmini\b|sonnet|flash|fast/.test(id)) {
    return 'standard'
  }
  if (/opus|fable|pro\b|-pro|gpt-5\.\d|codex-max|grok-4/.test(id)) {
    return 'high'
  }
  return null
}

export const tierKey = (agent: string, model: string): string => `${agent}:${model}`
