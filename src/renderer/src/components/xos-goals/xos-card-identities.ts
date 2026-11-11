// XOS fork: card identity registry, ported from DJVibe resources/js/lib/automation-card-identities.ts.
import data from './xos-card-identities.json'
import {
  automationCardClassification,
  type AutomationCardIdentityInput
} from './xos-card-classification'
import {
  corporateCardIdentity,
  fallbackIdentity,
  festivalCardIdentity,
  retreatCardIdentity
} from './xos-card-identities-themes'
import { automationThemePersonaProfile } from './xos-card-theme-profiles'
import type {
  AutomationCardIdentity,
  AutomationCardIdentityRegistryEntry,
  AutomationCardImageMode,
  AutomationCardTheme,
  AutomationThemePersonaProfile
} from './xos-card-identities-types'

export type {
  AutomationCardIdentity,
  AutomationCardIdentityInput,
  AutomationCardIdentityRegistryEntry,
  AutomationCardImageMode,
  AutomationCardTheme,
  AutomationThemePersonaProfile
}

export { automationThemePersonaProfile }

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: JSON payload structure matches the registry interface
const identities = (data as { identities: Record<string, AutomationCardIdentityRegistryEntry> })
  .identities

export function automationCardIdentity({
  goal,
  role,
  areaTitle,
  isManager,
  isCSuite,
  costPips = 0,
  power = 0,
  toughness = 0,
  runs7d = 0,
  runs30d = 0,
  tokens30d = 0,
  successStreak = 0,
  recentFailures = 0,
  hasCurrentIssue = false,
  theme = 'noir',
  imageMode = 'dark'
}: AutomationCardIdentityInput): AutomationCardIdentity {
  const registered =
    theme === 'corporate'
      ? corporateCardIdentity(goal, role, areaTitle)
      : theme === 'festival'
        ? festivalCardIdentity(goal, role, areaTitle)
        : theme === 'retreat'
          ? retreatCardIdentity(goal, role, areaTitle)
          : (identities[goal] ?? fallbackIdentity(role, areaTitle))

  const classification = automationCardClassification({
    goal,
    role,
    areaTitle,
    isManager,
    isCSuite,
    costPips,
    power,
    toughness,
    runs7d,
    runs30d,
    tokens30d,
    successStreak,
    recentFailures,
    hasCurrentIssue,
    theme,
    imageMode
  })

  const modeSegment = imageMode === 'light' ? 'light/' : ''
  const themeSegment = theme !== 'noir' ? `${theme}/` : ''
  const avatarThemeSegment = theme !== 'noir' ? `${theme}/` : ''

  return {
    ...registered,
    typeLine: `${classification} — ${role}`,
    role,
    imageSrc: `/storage/automations/cards/${themeSegment}${modeSegment}${goal}.webp`,
    fallbackImageSrc: `/storage/automations/cards/${goal}.webp`,
    avatarSrc: `/storage/automations/avatars/${avatarThemeSegment}${goal}.webp`,
    fallbackAvatarSrc: `/storage/automations/avatars/${goal}.webp`
  }
}
