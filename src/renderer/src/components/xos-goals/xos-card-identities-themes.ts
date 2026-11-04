// XOS fork: themed card identity generation.
import data from './xos-card-identities.json'
import type { AutomationCardIdentityRegistryEntry } from './xos-card-identities-types'

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: JSON file matches card identity dictionary structure
const rawData = data as unknown as {
  corporateNames: Record<string, string>
  fallbackFirstNames: string[]
  fallbackLastNames: string[]
  businessTitles: Record<string, string>
  businessDescriptions: Record<string, string>
}
const {
  corporateNames,
  fallbackFirstNames,
  fallbackLastNames,
  businessTitles,
  businessDescriptions
} = rawData

export function corporateCardIdentity(
  goal: string,
  role: string,
  areaTitle: string
): AutomationCardIdentityRegistryEntry {
  if (goal === 'photo-journalist') {
    return {
      displayName: 'Maya River',
      persona: 'Field Photo Journalist',
      description:
        'Travels light, shoots fast, and comes back with sauna-room light, beach-road details, and the small moments that make a place feel alive.',
      artPrompt:
        'Photorealistic corporate editorial portrait banner of Maya River, an adult surf-and-sauna photo journalist and Cascade field representative, relaxed wellness-company wardrobe with camera in hand, coastal operations workspace with campervan and sauna scouting notes, natural confident expression, no text, no logos.'
    }
  }

  const displayName = corporateNames[goal] ?? fallbackIdentity(role, areaTitle).displayName
  const persona = businessTitles[goal] ?? role
  const description =
    businessDescriptions[goal] ??
    `Coordinates ${role.toLowerCase()} operations for ${areaTitle.toLowerCase()}, keeping deliverables moving and cross-functional teams aligned.`

  return {
    displayName,
    persona,
    description,
    artPrompt: `Photorealistic corporate editorial portrait banner of ${displayName}, a ${persona.toLowerCase()} at a modern wellness company, natural office or operations table setting, calm focused presence, premium workplace styling, adult professional, no text, no logos.`
  }
}

export function festivalCardIdentity(
  goal: string,
  role: string,
  areaTitle: string
): AutomationCardIdentityRegistryEntry {
  if (goal === 'photo-journalist') {
    return {
      displayName: 'Maya River',
      persona: 'Festival Media & Content Lead',
      description:
        'Works the photo pit and the crew corridors alike, coming back with the stage light, the crowd energy, and the small backstage moments that make the night feel real.',
      artPrompt:
        'Photorealistic festival production banner of Maya River, an adult field media photographer and content lead, festival crew technical jacket, laminate pass, camera in hand, backstage corridor with warm stage light wash, confident professional presence, adult crew member, no text, no logos.'
    }
  }

  const displayName = corporateNames[goal] ?? fallbackIdentity(role, areaTitle).displayName
  const persona = `${role} (Festival Crew)`
  const description =
    businessDescriptions[goal] ??
    `Runs ${role.toLowerCase()} on the festival operations crew, keeping the grounds, stages, and teams moving under real-time pressure.`

  return {
    displayName,
    persona,
    description,
    artPrompt: `Photorealistic festival-production operations banner of ${displayName}, adult festival crew member in ${areaTitle.toLowerCase()} production, backstage technical booth or stage-side operations station, practical crew streetwear with radio or laminate, focused professional presence, teal and magenta wash, no text, no logos.`
  }
}

export function retreatCardIdentity(
  goal: string,
  role: string,
  areaTitle: string
): AutomationCardIdentityRegistryEntry {
  if (goal === 'photo-journalist') {
    return {
      displayName: 'Maya River',
      persona: 'Field Photo Journalist',
      description:
        'Scouts sauna rooms, beach roads, and retreat corners with a camera, a towel, and a sharp eye for light.',
      artPrompt:
        'Photorealistic retreat editorial portrait banner of Maya River, adult field photo journalist, linen shirt, camera strap, relaxed coastal sauna deck setting with natural morning light, grounded calm presence, no text, no logos.'
    }
  }

  const displayName = corporateNames[goal] ?? fallbackIdentity(role, areaTitle).displayName
  const persona = `${role} (Retreat Operations)`
  const description =
    businessDescriptions[goal] ??
    `Coordinates ${role.toLowerCase()} across retreat locations, keeping guest spaces, hosts, and daily flow calm and reliable.`

  return {
    displayName,
    persona,
    description,
    artPrompt: `Photorealistic wellness retreat banner of ${displayName}, adult retreat operations team member in ${areaTitle.toLowerCase()}, natural cedar, linen, and daylight aesthetic, peaceful operations workspace or outdoor lounge, calm capable expression, no text, no logos.`
  }
}

export function fallbackIdentity(
  role: string,
  areaTitle: string
): AutomationCardIdentityRegistryEntry {
  let hash = 0
  for (let i = 0; i < role.length; i++) {
    hash = (hash * 31 + role.charCodeAt(i)) >>> 0
  }
  const first = fallbackFirstNames[hash % fallbackFirstNames.length] ?? 'Alex'
  const last = fallbackLastNames[((hash >>> 3) + role.length) % fallbackLastNames.length] ?? 'Vance'
  const displayName = `${first} ${last}`

  return {
    displayName,
    persona: role,
    description: `Coordinates ${role.toLowerCase()} operations for ${areaTitle.toLowerCase()}, keeping deliverables moving and cross-functional teams aligned.`,
    artPrompt: `Modern operations card portrait of ${displayName}, a ${role.toLowerCase()} professional in ${areaTitle.toLowerCase()}, clean practical styling, adult team member, natural light, no text, no logos.`
  }
}
