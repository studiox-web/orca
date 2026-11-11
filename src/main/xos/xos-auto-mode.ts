// XOS fork: Auto mode (plan §3.3). At dispatch it takes the catalog models of the automation's
// tier from its allowed agents, drops those whose quota would be exceeded, and ranks the rest by
// remaining quota relative to reset ("use the plan that expires soonest"), then by agent order.
// The tier map defaults from the model name (RT5 pairs) and is editable per model.
import type {
  XosAutoCandidate,
  XosAutoModeConfig,
  XosAutoPreview,
  XosCatalogModel,
  XosModelChoice,
  XosModelTier,
  XosTierModel
} from '../../shared/xos-runtime-types'
import { xosModelArgsSupported } from '../../shared/xos-model-args'
import type { TuiAgent } from '../../shared/tui-agent'
import { listXosModels } from './xos-model-catalog'
import { inferTier, tierKey } from './xos-model-tier'
import { assessQuota, type XosQuota } from './xos-quota'
import { readTierEdits } from './xos-runtime-store'

type Listed = { agent: string; models: XosCatalogModel[] }

async function listAgents(agents: string[]): Promise<{ listed: Listed[]; missing: string[] }> {
  const usable = agents.filter((agent) => xosModelArgsSupported(agent as TuiAgent))
  const results = await Promise.all(
    usable.map(async (agent) => ({ agent, list: await listXosModels(agent) }))
  )
  const listed: Listed[] = []
  const missing: string[] = []
  for (const { agent, list } of results) {
    if (list.status === 'ok' && list.models.length > 0) {
      listed.push({ agent, models: list.models })
    } else {
      missing.push(agent)
    }
  }
  return { listed, missing: [...missing, ...agents.filter((agent) => !usable.includes(agent))] }
}

export async function xosTierModels(agents: string[]): Promise<XosTierModel[]> {
  const edits = readTierEdits()
  const { listed } = await listAgents(agents)
  return listed.flatMap(({ agent, models }) =>
    models.map((model) => {
      const key = tierKey(agent, model.id)
      const edited = key in edits
      return {
        agent,
        model: model.id,
        label: model.label,
        tier: edited ? edits[key] : inferTier(model.id),
        edited
      }
    })
  )
}

type Ranked = XosAutoCandidate & { quotaInfo: XosQuota; order: number }

/** Pure ranking, separated for tests. */
export function rankCandidates(
  auto: XosAutoModeConfig,
  listed: Listed[],
  edits: Record<string, XosModelTier | null>,
  quotaOf: (agent: string, model: string) => XosQuota
): Ranked[] {
  const ranked: Ranked[] = []
  listed.forEach(({ agent, models }) => {
    const agentOrder = auto.providers.indexOf(agent)
    models.forEach((model, modelIndex) => {
      const key = tierKey(agent, model.id)
      const tier = key in edits ? edits[key] : inferTier(model.id)
      if (tier !== auto.tier) {
        return
      }
      const quotaInfo = quotaOf(agent, model.id)
      const effort =
        auto.effort && model.efforts.some((option) => option.value === auto.effort)
          ? auto.effort
          : null
      ranked.push({
        choice: { agent, model: model.id, effort },
        quota: quotaInfo.note,
        available: !quotaInfo.exhausted,
        quotaInfo,
        order: agentOrder * 1000 + modelIndex
      })
    })
  })
  const bucket = (entry: Ranked): number => (!entry.available ? 2 : entry.quotaInfo.known ? 0 : 1)
  return ranked.toSorted(
    (a, b) => bucket(a) - bucket(b) || b.quotaInfo.score - a.quotaInfo.score || a.order - b.order
  )
}

function choiceText(choice: XosModelChoice): string {
  return `${choice.agent} ${choice.model ?? 'default'}`
}

export async function xosPreviewAuto(auto: XosAutoModeConfig): Promise<XosAutoPreview> {
  const { listed, missing } = await listAgents(auto.providers)
  const ranked = rankCandidates(auto, listed, readTierEdits(), (agent, model) =>
    assessQuota(agent, model, auto.reservePercent)
  )
  const candidates = ranked.map(({ choice, quota, available }) => ({ choice, quota, available }))
  const best = ranked.find((entry) => entry.available)
  const skipped = ranked
    .filter((entry) => !entry.available)
    .slice(0, 2)
    .map((entry) => entry.quota)
  const notes = [
    ...skipped,
    ...(missing.length > 0 ? [`no model list for ${missing.join(', ')}`] : [])
  ]
  if (!best) {
    return {
      candidates,
      reason:
        ranked.length === 0
          ? `no ${auto.tier} model from ${auto.providers.join(', ')}${notes.length ? ` (${notes.join('; ')})` : ''}`
          : `every ${auto.tier} model is out of quota (${notes.join('; ')})`
    }
  }
  return {
    candidates,
    reason: `Auto → ${choiceText(best.choice)}: ${best.quota}${notes.length ? `; skipped ${notes.join('; ')}` : ''}`
  }
}
