// XOS fork: H9. Stopping a chat run means interrupting the provider turn: a chat has no terminal to
// close. Uses the same in-process host and fence as chat reuse; a refusal surfaces to the caller.
import { structuredAgentSessionPayloadFingerprint } from '../../shared/agent-session/lifecycle/structured-agent-session-mutation'
import type { AutomationRun } from '../../shared/automations-types'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { rpcCallerOperationKey } from '../runtime/rpc/rpc-caller-identity'
import { AUTOMATION_AGENT_CALLER } from './automation-run-operation'

type ChatCancelRuntime = Pick<
  OrcaRuntimeService,
  'ensureStructuredAgentSessionHost' | 'openAgentSessionRecordStore'
>

/** Throws when the turn could not be interrupted, so the run never claims a stop it didn't get. */
export async function cancelAutomationChatRun(
  runtime: ChatCancelRuntime,
  run: Pick<AutomationRun, 'id' | 'chatSessionId'>
): Promise<void> {
  const sessionId = run.chatSessionId
  if (!sessionId) {
    throw new Error('This run has no chat session.')
  }
  await runtime.ensureStructuredAgentSessionHost()
  const host = getStructuredAgentSessionHost()
  const store = await runtime.openAgentSessionRecordStore()
  const conversation = store.getConversation(sessionId)
  if (!host || !conversation) {
    throw new Error('The chat session is unavailable.')
  }
  const method = 'agentSession.cancel'
  const result = await host.cancel(
    { callerKey: rpcCallerOperationKey(AUTOMATION_AGENT_CALLER) },
    {
      envelope: {
        sessionId,
        clientOperationId: `automation-stop-${run.id}`,
        expectedRuntimeFence: conversation.currentFence,
        payloadFingerprint: structuredAgentSessionPayloadFingerprint({
          method,
          sessionId,
          fields: {}
        })
      }
    }
  )
  if (!result.ok) {
    throw new Error(`The chat refused to stop: ${result.refusal.code}`)
  }
}
