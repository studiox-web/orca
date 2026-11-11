// XOS fork: model strength table, copied from DJVibe resources/js/lib/model-strength.ts.
export type ModelStrengthSource =
  | 'Artificial Analysis Intelligence Index'
  | 'LMArena'
  | 'SWE-bench Verified'
  | 'Local fallback'

export type ModelStrengthMatch = {
  score: number
  source: ModelStrengthSource
  label: string
}

type ModelStrengthRegistryEntry = ModelStrengthMatch & {
  aliases: string[]
}

const modelStrengthRegistry: ModelStrengthRegistryEntry[] = [
  // XOS fork: current families first (aliases match by substring, in order).
  {
    aliases: ['opus-5', 'opus 5', 'fable'],
    score: 10,
    source: 'Local fallback',
    label: 'Claude Opus 5 / Fable'
  },
  {
    aliases: ['gpt-5.5', 'gpt-5.6', 'gpt-5.4'],
    score: 10,
    source: 'Local fallback',
    label: 'GPT-5.4+'
  },
  {
    aliases: ['sonnet-5', 'sonnet 5'],
    score: 9,
    source: 'Local fallback',
    label: 'Claude Sonnet 5'
  },
  {
    aliases: ['gemini-3'],
    score: 9,
    source: 'Local fallback',
    label: 'Gemini 3'
  },
  {
    aliases: ['claude-opus-4-7', 'opus-4.7', 'opus 4.7'],
    score: 10,
    source: 'Artificial Analysis Intelligence Index',
    label: 'Claude Opus 4.7'
  },
  {
    aliases: ['claude-opus-4-6', 'opus-4.6', 'opus 4.6'],
    score: 10,
    source: 'SWE-bench Verified',
    label: 'Claude Opus 4.6'
  },
  {
    aliases: ['claude-opus-4-5', 'opus-4.5', 'opus 4.5'],
    score: 10,
    source: 'SWE-bench Verified',
    label: 'Claude Opus 4.5'
  },
  {
    aliases: ['claude-opus-4-1', 'opus-4.1', 'opus 4.1'],
    score: 9,
    source: 'LMArena',
    label: 'Claude Opus 4.1'
  },
  {
    aliases: ['gpt-5.3-codex', 'gpt-5.3 codex', 'gpt-5-codex'],
    score: 10,
    source: 'SWE-bench Verified',
    label: 'GPT-5 Codex'
  },
  {
    aliases: ['gpt-5.1-codex', 'gpt-5.1 codex'],
    score: 9,
    source: 'LMArena',
    label: 'GPT-5.1 Codex'
  },
  {
    aliases: ['gpt-5.1', 'gpt-5-1', 'gpt 5.1'],
    score: 9,
    source: 'LMArena',
    label: 'GPT-5.1'
  },
  {
    aliases: ['gpt-5', 'gpt 5'],
    score: 9,
    source: 'LMArena',
    label: 'GPT-5'
  },
  {
    aliases: ['claude-sonnet-4-6', 'sonnet-4.6', 'sonnet 4.6'],
    score: 9,
    source: 'SWE-bench Verified',
    label: 'Claude Sonnet 4.6'
  },
  {
    aliases: ['claude-sonnet-4-5', 'sonnet-4.5', 'sonnet 4.5'],
    score: 9,
    source: 'LMArena',
    label: 'Claude Sonnet 4.5'
  },
  {
    aliases: ['claude-sonnet-4', 'sonnet-4', 'sonnet 4'],
    score: 8,
    source: 'SWE-bench Verified',
    label: 'Claude Sonnet 4'
  },
  {
    aliases: ['o4', 'o4-mini'],
    score: 8,
    source: 'Local fallback',
    label: 'OpenAI o4'
  },
  {
    aliases: ['o3', 'o3-pro'],
    score: 9,
    source: 'LMArena',
    label: 'OpenAI o3'
  },
  {
    aliases: ['gpt-4.1', 'gpt-4-1'],
    score: 8,
    source: 'LMArena',
    label: 'GPT-4.1'
  },
  {
    aliases: ['gpt-4o', 'gpt-4-o'],
    score: 8,
    source: 'LMArena',
    label: 'GPT-4o'
  },
  {
    aliases: ['gpt-4'],
    score: 7,
    source: 'Local fallback',
    label: 'GPT-4 family'
  },
  {
    aliases: ['opus'],
    score: 10,
    source: 'Local fallback',
    label: 'Claude Opus'
  },
  {
    aliases: ['sonnet'],
    score: 9,
    source: 'Local fallback',
    label: 'Claude Sonnet'
  },
  {
    aliases: ['claude-haiku', 'haiku'],
    score: 6,
    source: 'Local fallback',
    label: 'Claude Haiku'
  },
  {
    aliases: ['mini'],
    score: 6,
    source: 'Local fallback',
    label: 'Mini model family'
  },
  {
    aliases: ['codex'],
    score: 8,
    source: 'Local fallback',
    label: 'Codex model family'
  }
]

export function modelStrengthScore(model: string | null | undefined): ModelStrengthMatch {
  const normalized = normalizeModelName(model)

  if (normalized === '') {
    return {
      score: 5,
      source: 'Local fallback',
      label: 'Unknown model'
    }
  }

  const match = modelStrengthRegistry.find((entry) =>
    entry.aliases.some((alias) => normalized.includes(alias))
  )

  if (match) {
    return {
      score: match.score,
      source: match.source,
      label: match.label
    }
  }

  return {
    score: 7,
    source: 'Local fallback',
    label: model?.trim() || 'Unranked model'
  }
}

function normalizeModelName(model: string | null | undefined): string {
  return (model ?? '').trim().toLowerCase().replaceAll('_', '-').replaceAll('/', '-')
}
