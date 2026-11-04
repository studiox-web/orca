// XOS fork: what the Analytics view shows, computed in main from the transition index (M11).
export type XosFunnelStep = {
  stage: string
  label: string
  currentCount: number
  cumulativeCount: number
  conversionFromPrevPct: number
  conversionFromTopPct: number
}

export type XosStageDwell = {
  stageId: string
  avgHours: number
  medianHours: number
  maxHours: number
  sampleCount: number
}

export type XosStuckItem = {
  item: string
  path: string
  typeId: string
  stageId: string
  ageHours: number
  oldestAt: string
  claimedBy: string | null
}

export type XosVelocityWeek = {
  weekStart: string
  completedCount: number
  featuresCompleted: number
  bugsFixed: number
  contentPublished: number
}

export type XosRejectionShare = { bucket: string; count: number; sharePct: number }

export type XosShippedFeature = {
  item: string
  completedAt: string
  runs: number
  tokens: number
  costUsd: number
  models: string[]
}

export type XosFeatureCosts = {
  shippedFeatures: XosShippedFeature[]
  avgCostPerFeatureUsd: number
  avgTokensPerFeature: number
  totalShippedCostUsd: number
}

export type XosBurnForecast = {
  agent: string
  usedPercent: number
  targetUtilizationPct: number
  burnRatePctPerHour: number
  projectedPctAtReset: number
  hoursToTarget: number | null
  status: 'on-track' | 'under-burning' | 'over-burning'
}

export type XosProjectAnalytics = {
  timeInQueue: XosStageDwell[]
  stuckAlerts: XosStuckItem[]
  funnel: XosFunnelStep[]
  rejections: XosRejectionShare[]
  velocity: XosVelocityWeek[]
  featureCosts: XosFeatureCosts
  /** Live quota windows; empty when no provider reports one. */
  burn: XosBurnForecast[]
}
