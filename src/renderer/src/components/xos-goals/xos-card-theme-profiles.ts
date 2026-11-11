// XOS fork: theme persona profiles for operations goals.
import data from './xos-card-identities.json'
import type { AutomationCardIdentityInput } from './xos-card-classification'
import type {
  AutomationCardTheme,
  AutomationThemePersonaProfile
} from './xos-card-identities-types'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: JSON file matches theme persona overrides structure
const rawData = data as unknown as {
  themePersonaOverrides: Record<string, Record<string, Partial<AutomationThemePersonaProfile>>>
}
const themePersonaOverrides = rawData.themePersonaOverrides

export function automationThemePersonaProfile({
  goal,
  role,
  areaTitle,
  theme
}: Pick<
  AutomationCardIdentityInput,
  'goal' | 'role' | 'areaTitle' | 'theme'
>): AutomationThemePersonaProfile {
  const base =
    goal === 'photo-journalist'
      ? photoJournalistThemeProfile(theme ?? 'noir')
      : defaultThemePersonaProfile(role, areaTitle, theme ?? 'noir')
  const override = themePersonaOverrides[theme ?? 'noir']?.[goal] ?? {}

  return {
    ...base,
    ...override
  }
}

function defaultThemePersonaProfile(
  role: string,
  areaTitle: string,
  theme: AutomationCardTheme
): AutomationThemePersonaProfile {
  if (theme === 'retreat') {
    return {
      visualAnchors:
        'Adult wellness-company team member with grounded human presence, natural expression, and role-appropriate confidence.',
      wardrobe:
        'Relaxed premium retreat wardrobe: soft layers, linen, cotton, practical footwear, subtle accessories, and colors that fit a calm spa setting.',
      settings: `${areaTitle} retreat workspace, wellness operations table, quiet lounge, treatment-prep area, outdoor deck, or calm behind-the-scenes staff moment.`,
      personalityCues: `${role} energy: focused, capable, warm with people, and visibly engaged with practical work rather than posing for a campaign.`,
      boundaries:
        'Do not turn them into a fantasy character, influencer, anonymous stock model, or duplicate of the noir card art. Keep them adult, professional, and recognizably tied to their role.'
    }
  }

  if (theme === 'corporate') {
    return {
      visualAnchors:
        'Adult wellness-marketplace employee with clear professional presence, natural expression, and role-specific confidence.',
      wardrobe:
        'Modern premium wellness-office wardrobe: clean business layers, soft knits, structured shirts, simple accessories, and practical polished shoes.',
      settings: `${areaTitle} office, dashboard review station, meeting table, planning wall, or calm marketplace operations workspace.`,
      personalityCues: `${role} energy: precise, useful, collaborative, and focused on the work in front of them.`,
      boundaries:
        'Avoid generic corporate stock-photo tropes, exaggerated smiles, unreadable props, logos, text, and unrelated luxury-office cliches.'
    }
  }

  if (theme === 'festival') {
    return {
      visualAnchors:
        'Adult festival-production crew member with alert eyes, capable posture, and the calm authority of someone running a stage, not attending one.',
      wardrobe:
        'Festival-crew premium streetwear: technical jacket or vest, fitted tee, laminate or radio clipped on, minimal jewelry, and boots built for a long night.',
      settings: `${areaTitle} production booth, backstage riser, front-of-house desk, or a stage-side operations corner lit by teal and magenta wash.`,
      personalityCues: `${role} energy: fast, unshakeable, and quietly in command; they keep the show on time while the crowd never sees the effort.`,
      boundaries:
        'Do not turn them into a DJ, performer, or raver. Keep them adult, professional, and clearly production crew, not talent or attendee.'
    }
  }

  return {
    visualAnchors:
      'Stylized operations-card identity with strong silhouette, consistent role symbolism, and a clear visual link to the existing card art.',
    wardrobe:
      'Noir operations-card styling that fits the existing illustrated identity, using role-appropriate accessories and materials.',
    settings: `${areaTitle} operations environment matching the current noir card world and role symbolism.`,
    personalityCues: `${role} presence: focused, iconic, and legible as a specialized automation employee.`,
    boundaries:
      'Keep it consistent with the operations-card identity. No text, logos, watermarks, or unrelated brand marks.'
  }
}

function photoJournalistThemeProfile(theme: AutomationCardTheme): AutomationThemePersonaProfile {
  if (theme === 'corporate') {
    return {
      visualAnchors:
        'Same adult Maya River face family, athletic build, brunette beach hair, relaxed confident expression, and camera-forward field role.',
      wardrobe:
        'Relaxed wellness-company field wardrobe: camera strap, linen shirt, clean tank, utility jacket, sneakers, towel or notebook as practical props.',
      settings:
        'Coastal operations workspace, campervan scouting notes, sauna-location planning table, or field edit station.',
      personalityCues:
        'Curious, bright, observant, practical, and socially easy; she looks like she just came back with usable visual notes.',
      boundaries:
        'Always adult, tasteful, editorial, and brand-safe. No influencer selling, explicit posing, or medical authority framing.'
    }
  }

  if (theme === 'festival') {
    return {
      visualAnchors:
        'Same adult Maya River face family, athletic build, brunette hair pulled back for stage work, alert confident expression, and a camera-ready field-crew presence.',
      wardrobe:
        'Festival-crew field wardrobe: camera strap, laminate, technical jacket, fitted tee, cargo pants, sneakers built for a long night on the grounds.',
      settings:
        'Stage-side photo pit, backstage crew corridor, production trailer, or a front-of-house vantage point lit by teal and magenta wash.',
      personalityCues:
        'Fast, observant, unbothered by crowds or noise; she reads light and timing instinctively and always comes back with the shot that matters.',
      boundaries:
        'Always adult, tasteful, editorial, and brand-safe. She is crew, not a performer or attendee — no stage costuming, no explicit posing.'
    }
  }

  return defaultThemePersonaProfile('Photo Journalist', 'Content', theme)
}
