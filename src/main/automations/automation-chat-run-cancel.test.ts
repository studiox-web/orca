import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CancelParams } from '../../shared/rpc-contract/structured-agent-session-params'
import { cancelAutomationChatRun } from './automation-chat-run-cancel'

const cancel = vi.fn()
let hostAvailable = true

vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => (hostAvailable ? { cancel } : null)
}))

const SESSION = '11111111-1111-4111-8111-111111111111'
const getConversation = vi.fn()
const runtime = {
  ensureStructuredAgentSessionHost: vi.fn(async () => undefined),
  openAgentSessionRecordStore: vi.fn(async () => ({ getConversation }))
}
const run = { id: 'run-1', chatSessionId: SESSION }
// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only these two methods are called.
const asRuntime = runtime as unknown as Parameters<typeof cancelAutomationChatRun>[0]

beforeEach(() => {
  vi.clearAllMocks()
  hostAvailable = true
  getConversation.mockReturnValue({ currentFence: 7 })
  cancel.mockResolvedValue({ ok: true })
})

describe('cancelAutomationChatRun (H9)', () => {
  it('interrupts the turn with a request the RPC contract accepts, at the current fence', async () => {
    await cancelAutomationChatRun(asRuntime, run)
    const [caller, params] = cancel.mock.calls[0]
    expect(caller.callerKey).toEqual(expect.any(String))
    expect(params.envelope).toMatchObject({ sessionId: SESSION, expectedRuntimeFence: 7 })
    expect(CancelParams.safeParse(params).success).toBe(true)
  })

  it('reports a refusal instead of pretending the agent stopped', async () => {
    cancel.mockResolvedValue({ ok: false, refusal: { code: 'agent_session_stale_fence' } })
    await expect(cancelAutomationChatRun(asRuntime, run)).rejects.toThrow(
      'agent_session_stale_fence'
    )
  })

  it('fails when the session or host is gone', async () => {
    getConversation.mockReturnValue(null)
    await expect(cancelAutomationChatRun(asRuntime, run)).rejects.toThrow('unavailable')
    getConversation.mockReturnValue({ currentFence: 7 })
    hostAvailable = false
    await expect(cancelAutomationChatRun(asRuntime, run)).rejects.toThrow('unavailable')
    await expect(
      cancelAutomationChatRun(asRuntime, { id: 'run-1', chatSessionId: null })
    ).rejects.toThrow('no chat session')
  })
})
