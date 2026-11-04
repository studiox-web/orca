// XOS fork: the live model catalog for the automation editor's Model picker (plan §3.1). Reads the
// same catalog service as the chat model picker, so new models appear when the CLI ships them.
import type { XosModelList } from '../../shared/xos-runtime-types'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'

const LIST_TIMEOUT_MS = 20_000

export async function listXosModels(agent: string): Promise<XosModelList> {
  const catalog = getStructuredAgentSessionHost()?.deps.modelCatalog
  if (!catalog) {
    return { status: 'unavailable', message: 'The model catalog is not running on this host.' }
  }
  try {
    const result = await Promise.race([
      catalog.read({ agent, waitForListing: true }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), LIST_TIMEOUT_MS))
    ])
    if (!result) {
      return { status: 'unavailable', message: 'Listing models took too long. Try again.' }
    }
    if (result.origin === 'unknown') {
      return {
        status: 'unavailable',
        message: result.unavailable
          ? 'This agent cannot list models right now (check that it is installed and signed in).'
          : 'No model list for this agent yet.'
      }
    }
    return {
      status: 'ok',
      fetchedAt: result.fetchedAt,
      models: result.models.map((model) => ({
        id: model.id,
        label: model.label,
        ...(model.description ? { description: model.description } : {}),
        isDefault: model.isDefault,
        ...(model.defaultEffort ? { defaultEffort: model.defaultEffort } : {}),
        efforts: model.efforts.map((effort) => ({ value: effort.value, label: effort.label }))
      }))
    }
  } catch (error) {
    return {
      status: 'unavailable',
      message: error instanceof Error ? error.message : String(error)
    }
  }
}
