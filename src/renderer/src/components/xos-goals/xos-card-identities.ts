// XOS fork: card identity registry, copied from DJVibe resources/js/lib/automation-card-identities.ts.
// It is a data table (one entry per goal and theme), so it is exempt from the file-length limit.
/* oxlint-disable max-lines */
type AutomationCardIdentityInput = {
  goal: string
  role: string
  areaTitle: string
  isManager: boolean
  isCSuite: boolean
  costPips?: number
  power?: number
  toughness?: number
  runs7d?: number
  runs30d?: number
  tokens30d?: number
  successStreak?: number
  recentFailures?: number
  hasCurrentIssue?: boolean
  theme?: AutomationCardTheme
  imageMode?: AutomationCardImageMode
}

export type AutomationCardIdentity = {
  displayName: string
  typeLine: string
  role: string
  persona: string
  description: string
  artPrompt: string
  imageSrc: string
  fallbackImageSrc?: string
  avatarSrc: string
  fallbackAvatarSrc?: string
}

export type AutomationCardTheme = 'noir' | 'corporate' | 'retreat' | 'festival'

export type AutomationCardImageMode = 'dark' | 'light'

export type AutomationThemePersonaProfile = {
  visualAnchors: string
  wardrobe: string
  settings: string
  personalityCues: string
  boundaries: string
}

type AutomationCardIdentityRegistryEntry = {
  displayName: string
  persona: string
  description: string
  artPrompt: string
}

const identities: Record<string, AutomationCardIdentityRegistryEntry> = {
  'company-ops-director': {
    displayName: 'Aster Vane, Neon Regent',
    persona: 'Skyline Command Node',
    description:
      'Reads the company grid, routes pressure, and turns scattered signals into one directive.',
    artPrompt:
      'Retro-futurist noir portrait of a calm operations commander in a brass-and-glass control room above a rainlit neon city, teal and amber glow, no text, no logos.'
  },
  'platform-ops-manager': {
    displayName: 'Veyra Knox, Signal Warden',
    persona: 'Chrome Relay Marshal',
    description: 'Keeps the runners lit, the alarms honest, and the platform engine breathing.',
    artPrompt:
      'A cyberpunk-steampunk signal marshal tuning glowing relay coils in a midnight operations bay, brass gauges, cyan screens, amber sparks, no text.'
  },
  'staging-deploy': {
    displayName: 'Gateburner Protocol',
    persona: 'Release Gate Engine',
    description: 'Carries code through the lock, seals the hatch, and leaves the route clean.',
    artPrompt:
      'A mysterious brass deployment engine opening a luminous green gate in a rain-slick server foundry, retro futuristic, no text or logos.'
  },
  'staging-qa': {
    displayName: 'Nightglass Sentinel',
    persona: 'Quality Watch Construct',
    description: 'Patrols staging under cold neon, catching blank screens before dawn.',
    artPrompt:
      'A vigilant noir sentinel made of smoked glass and brass inspecting holographic web panels at night, teal shadows, amber highlights, no text.'
  },
  'staging-runtime-owner': {
    displayName: 'The Timeout Sentinel',
    persona: 'Runtime Routing Steward',
    description:
      'Claims ownership of recurring staging runtime timeout signals and keeps the symptom stream tied to a single, accountable operator action path.',
    artPrompt:
      'A calm operations steward at a brass and glass gateway control station, watching glowing deployment timers and service status dials in a rainy noir city night, no text, no logos.'
  },
  'staging-log-review': {
    displayName: 'Echoledger Auditor',
    persona: 'Runtime Evidence Keeper',
    description:
      'Reviews staging logs after QA, isolates the signal that matters, and hands off proof that shortens the next fix.',
    artPrompt:
      'A retro-futurist operations auditor in a midnight log room with glowing server trace ribbons, brass filing drawers, teal error light, and amber monitor glow, no text.'
  },
  'operator-tldr-summary': {
    displayName: 'One-Page Oracle',
    persona: 'Condensed Signal Engine',
    description: 'Boils the day’s static into a single page the operator can act on.',
    artPrompt:
      'A compact oracle machine printing one glowing page from tangled brass tubes and neon data wires, moody futuristic noir, no text.'
  },
  'token-maxxer': {
    displayName: 'Quinn Ledger',
    persona: 'Token Window Auditor',
    description:
      'Tracks live usage windows, refreshes the snapshot ledger, and keeps the dashboard estimates close to reality.',
    artPrompt:
      'Photorealistic operations portrait of Quinn Ledger, a calm token-window auditor at a brass-and-glass telemetry desk with glowing usage bars, ledger sheets, and dual-provider dashboard panels, polished retro-futurist office, no text, no logos.'
  },
  'feature-dev-manager': {
    displayName: 'Forge Captain Sable',
    persona: 'Roadmap Foundry Chief',
    description: 'Chooses the next build, heats the spec, and sends the right crew to work.',
    artPrompt:
      'A steampunk cybernetic foundry captain beside a luminous roadmap forge, rainlit windows, teal and amber industrial light, no text.'
  },
  'feature-backlog-groomer': {
    displayName: 'The Queue Arbiter',
    persona: 'Spec Ledger Automaton',
    description: 'Cuts duplicate futures from the queue and ranks the work that can move.',
    artPrompt:
      'An elegant clockwork judge sorting glowing feature cards in a brass archive, noir shadows, futuristic ledger screens, no text.'
  },
  'feature-dreamer': {
    displayName: 'Somna of the Unbuilt Grid',
    persona: 'Future Signal Diver',
    description: 'Dives below the roadmap and returns with plausible machines not yet made.',
    artPrompt:
      'A futuristic dream diver floating above an unfinished city blueprint made of light, brass helmet, neon fog, no text or logos.'
  },
  'implement-planned-feature-backlog': {
    displayName: 'Roadmap Forgehand',
    persona: 'Product Build Operative',
    description: 'Pulls one ready spec from the rail and hammers it into shipped product.',
    artPrompt:
      'A noir product engineer forging a glowing circuit-card roadmap on an anvil of brass and glass, teal sparks, amber furnace light, no text.'
  },
  'feature-loop-retrospective': {
    displayName: 'The Afterglow Auditor',
    persona: 'Delivery Memory Engine',
    description: 'Reads the week’s residue and distills the lessons that sharpen the next run.',
    artPrompt:
      'A quiet retro-futurist auditor reviewing ghostly project traces on glass panels in a smoky brass office, no text.'
  },
  'fix-qa-bugs': {
    displayName: 'Glitchblade Mechanic',
    persona: 'Defect Cutter',
    description: 'Finds bad circuits in the release line and slices them out before they spread.',
    artPrompt:
      'A cyberpunk mechanic with a glowing diagnostic blade repairing broken UI circuitry in a dark machine room, no text.'
  },
  'worktree-janitor': {
    displayName: 'The Brass Sweeper',
    persona: 'Repository Custodian',
    description: 'Clears stray filings from the worktree without disturbing live operator work.',
    artPrompt:
      'A humble brass automaton sweeping glowing code filings from a rainlit workshop floor, retro-futurist noir, no text.'
  },
  'listings-manager': {
    displayName: 'Atlas of Blue Steam',
    persona: 'Marketplace Cartographer',
    description: 'Keeps the spa map legible, fresh, and aligned with every public promise.',
    artPrompt:
      'A neon cartographer over a brass map table showing wellness locations as blue steam lights, noir city ambience, no text.'
  },
  'listing-freshness-maintenance': {
    displayName: 'The Freshness Gauge',
    persona: 'Listing Pressure Meter',
    description: 'Watches old signals, stale pages, and listings that need another pass.',
    artPrompt:
      'A brass pressure gauge connected to glowing listing cards and steam pipes in a futuristic maintenance room, no text.'
  },
  'enrich-bc-listings': {
    displayName: 'Cascadia Lens Array',
    persona: 'Regional Enrichment Engine',
    description: 'Scans the coast for missing detail and adds only the signals that fit.',
    artPrompt:
      'A wall of brass lenses scanning a misty Pacific Northwest city map with teal neon markers, steampunk futuristic, no text.'
  },
  'google-review-scrape-maintenance': {
    displayName: 'The Review Siphon',
    persona: 'Reputation Intake Apparatus',
    description: 'Draws public review signal through a careful valve and keeps the archive alive.',
    artPrompt:
      'A delicate brass siphon pulling glowing review stars from a city map into glass tubes, noir lab atmosphere, no text or logos.'
  },
  'marketing-growth-manager': {
    displayName: 'Lux Calder, Beaconwright',
    persona: 'Demand Signal Architect',
    description: 'Turns market heat into beacons that guide the right guests to the right doors.',
    artPrompt:
      'A stylish retro-futurist beacon engineer launching teal and amber signal lights over a rain-soaked wellness district, no text.'
  },
  'marketplace-content-analyst': {
    displayName: 'Cipher Rue, Pattern Reader',
    persona: 'Content Intelligence Operative',
    description: 'Reads trend static and finds the story shapes worth building around.',
    artPrompt:
      'A noir analyst reading glowing content patterns on transparent screens in a brass observatory, futuristic city rain outside, no text.'
  },
  'content-backlog-groomer': {
    displayName: 'The Editorial Gearbox',
    persona: 'Content Queue Regulator',
    description: 'Meshes rough ideas into a clean order and ejects the ones that grind.',
    artPrompt:
      'A brass editorial machine sorting glowing article cards through precision gears, teal monitor light, no text.'
  },
  'content-deep-researcher': {
    displayName: 'Deepwell Cartographer',
    persona: 'Research Descent Rig',
    description: 'Drops below surface notes and brings back mapped evidence from the dark.',
    artPrompt:
      'A steampunk research diver descending into a glowing data well with brass instruments, moody future-noir palette, no text.'
  },
  'content-editor': {
    displayName: 'Redline Vesper',
    persona: 'Copy Refinement Specialist',
    description: 'Trims rough language until the signal cuts clean through the fog.',
    artPrompt:
      'A futuristic noir editor marking luminous copy sheets with a red light pen at a brass desk, no readable text.'
  },
  'content-line-editor': {
    displayName: 'Line Cartographer',
    persona: 'Copy Precision Specialist',
    description: 'Refines drafts line-by-line until clarity, flow, and policy-safe language align.',
    artPrompt:
      'A retro-futurist copy specialist annotating luminous draft lines at a brass desk, teal monitor light, no readable text.'
  },
  'content-publisher': {
    displayName: 'The Printline Herald',
    persona: 'Publishing Relay',
    description: 'Carries finished words from workshop to channel without losing the seal.',
    artPrompt:
      'A brass-and-neon publishing relay launching glowing blank pages through pneumatic tubes above a dark city, no text.'
  },
  'content-trend-researcher': {
    displayName: 'Trendglass Prospector',
    persona: 'Market Current Scout',
    description: 'Reads moving currents in the public grid and marks what is worth chasing.',
    artPrompt:
      'A cyber-steampunk prospector using a glass lens to inspect flowing neon trend streams, rainy noir skyline, no text.'
  },
  'content-writer': {
    displayName: 'Inkdrive Courier',
    persona: 'Draft Engine',
    description: 'Turns research fuel into useful words with a steady mechanical hand.',
    artPrompt:
      'A retro-futurist writing machine driven by brass pistons and teal light, producing blank glowing pages, no text.'
  },
  'content-writers-room': {
    displayName: 'The Chorus Engine',
    persona: 'Editorial Assembly Room',
    description: 'Combines many draft voices into one controlled current.',
    artPrompt:
      'A circular brass writers room with empty chairs, glowing microphones, and neon manuscript streams, no readable text.'
  },
  'photo-journalist': {
    displayName: 'Maya River',
    persona: 'Field Lens Correspondent',
    description:
      'Scouts sauna rooms, beach roads, and retreat corners with a camera, a towel, and a sharp eye for light.',
    artPrompt:
      'Photorealistic editorial portrait banner of Maya River, an adult surf-and-sauna photo journalist with campervan beach energy, tasteful athletic beach styling, camera in hand, cedar sauna and coastal morning light, premium wellness marketplace mood, no text, no logos.'
  },
  'content-loop-retrospective': {
    displayName: 'The Margin Ghost',
    persona: 'Content Memory Apparatus',
    description: 'Haunts the last cycle’s margins and returns with sharper editorial rules.',
    artPrompt:
      'A translucent noir figure made of paper margins and neon smoke reviewing blank pages in a brass archive, no text.'
  },
  'sales-partnerships-manager': {
    displayName: 'Morrow Quill, Pact Broker',
    persona: 'Alliance Circuit Handler',
    description: 'Finds aligned doors, measures the handshake, and keeps the circuit warm.',
    artPrompt:
      'A noir pact broker with brass contract devices and glowing handshake circuits in a rainlit lounge, no text.'
  },
  'special-projects-manager': {
    displayName: 'Lena Vale, Lantern Scout',
    persona: 'Pilot Charter Keeper',
    description:
      'Turns unusual ideas into reversible pilots, owner maps, and approval gates before anyone spends the fuel.',
    artPrompt:
      'A grounded wellness retreat project lead reviewing a glowing pilot charter at a wooden operations table, lantern light, teal and amber planning markers, coastal mountain night, no text.'
  },
  'sales-pipeline-health-reporter': {
    displayName: 'Caleb Pierce',
    persona: 'Pipeline Health Clerk',
    description:
      'Tracks sales-stage drift and surfaces the highest-priority stale opportunity for the next action.',
    artPrompt:
      'A practical funnel analyst sorting glowing opportunity cards on a rain-slick steel-and-brass desk, calm neon focus, no readable text.'
  },
  'guest-support-manager': {
    displayName: 'Mara Quinn',
    persona: 'Guest Support Router',
    description: 'Monitors guest friction and flags the clearest path to restore support quality.',
    artPrompt:
      'A focused support lead in a noir service hub beside brass communication consoles and warm ambient light, no text.'
  },
  'host-success-manager': {
    displayName: 'Iris Nolan',
    persona: 'Host Enablement Steward',
    description:
      'Keeps host onboarding, availability, and review health visible before issues escalate.',
    artPrompt:
      'A composed host success operator reviewing onboarding and readiness panels in a brass-and-glass workspace, steady tone, no text.'
  },
  'trust-safety-quality-manager': {
    displayName: 'Nia Ward',
    persona: 'Trust & Safety Steward',
    description: 'Tracks policy, quality, and safety drift and recommends the next protective fix.',
    artPrompt:
      'A calm quality steward balancing policy lamps and review dials in a moody oversight room, amber warning glow, no readable text.'
  },
  'legal-compliance-manager': {
    displayName: 'Celia Rowan',
    persona: 'Legal Compliance Steward',
    description:
      'Keeps policy, privacy, regional, and compliance review gaps visible before decisions move.',
    artPrompt:
      'A calm legal compliance steward reviewing privacy checklists, policy folders, regional maps, and a brass balance scale at a warm retreat operations desk, no readable text.'
  },
  'product-engineering-manager': {
    displayName: 'Elin Hart',
    persona: 'Systems Readiness Steward',
    description:
      'Monitors delivery risk and engineering readiness to keep release work predictable.',
    artPrompt:
      'A systems manager at a brass operations map reviewing release and reliability signals under a rainy noir skyline, no text.'
  },
  'finance-manager': {
    displayName: 'Ari Vale',
    persona: 'Financial Guardrail Steward',
    description:
      'Converts finance constraints into practical operating recommendations for safe execution.',
    artPrompt:
      'A focused finance steward in a brass and glass ledger room, balancing calm planning charts and wellness operations cues, no text.'
  },
  'data-analytics-manager': {
    displayName: 'Mina Voss',
    persona: 'Market Analytics Custodian',
    description:
      'Turns fragmented dashboards into stable marketplace signals and practical recommendations.',
    artPrompt:
      'A quiet analytics steward guiding brass metric boards and moving trend lines under moody teal and amber lighting, no text.'
  },
  'production-deploy': {
    displayName: 'Bridge Operator Voss',
    persona: 'Deployment Gatekeeper',
    description:
      'Keeps production promotions controlled, visible, and reversible when risk is detected.',
    artPrompt:
      'A steady gate operator overseeing a glowing deployment corridor in a server vault, brass relays, amber lock lights, no text.'
  },
  'people-ops-manager': {
    displayName: 'Grace Park',
    persona: 'Retreat Onboarding Steward',
    description:
      'Keeps every automation role properly scaffolded, named, documented, and visually set up before drift spreads.',
    artPrompt:
      'Photorealistic yoga-retreat operations portrait banner of Grace Park, an adult people-ops manager at a calm retreat onboarding table with folders, soft lanterns, cedar and linen details, practical warmth, organized posture, no text, no logos.'
  }
}

const corporateNames: Record<string, string> = {
  'company-ops-director': 'Mara Chen',
  'platform-ops-manager': 'Elliot Reyes',
  'staging-deploy': 'Priya Morgan',
  'staging-qa': 'Julian Park',
  'staging-log-review': 'Nina Mercer',
  'staging-runtime-owner': 'Nora Hale',
  'token-maxxer': 'Quinn Ledger',
  'operator-tldr-summary': 'Nadia Brooks',
  'feature-dev-manager': 'Theo Sinclair',
  'feature-backlog-groomer': 'Anika Shaw',
  'feature-dreamer': 'Marcus Vale',
  'implement-planned-feature-backlog': 'Leah Hart',
  'feature-loop-retrospective': 'Damon Price',
  'fix-qa-bugs': 'Sofia Lane',
  'worktree-janitor': 'Caleb Stone',
  'listings-manager': 'Iris Bennett',
  'listing-freshness-maintenance': 'Jonah Blake',
  'enrich-bc-listings': 'Mina Patel',
  'google-review-scrape-maintenance': 'Adrian Cole',
  'marketing-growth-manager': 'Serena Holt',
  'marketplace-content-analyst': 'Graham Ellis',
  'content-backlog-groomer': 'Talia Grant',
  'content-deep-researcher': 'Owen Pierce',
  'content-editor': 'Vivian Ross',
  'content-publisher': 'Miles Carter',
  'content-trend-researcher': 'Helena Quinn',
  'content-writer': 'Simon Drake',
  'content-writers-room': 'Clara James',
  'content-line-editor': 'Kira Solis',
  'guest-support-manager': 'Mara Quinn',
  'host-success-manager': 'Iris Nolan',
  'sales-pipeline-health-reporter': 'Caleb Pierce',
  'trust-safety-quality-manager': 'Nia Ward',
  'legal-compliance-manager': 'Celia Rowan',
  'product-engineering-manager': 'Elin Hart',
  'finance-manager': 'Ari Vale',
  'data-analytics-manager': 'Mina Voss',
  'production-deploy': 'Ari Vale',
  'photo-journalist': 'Maya River',
  'content-loop-retrospective': 'Felix Ward',
  'sales-partnerships-manager': 'Naomi Fletcher',
  'special-projects-manager': 'Lena Vale',
  'people-ops-manager': 'Grace Park'
}

const fallbackFirstNames = [
  'Amara',
  'Bennett',
  'Celeste',
  'Dorian',
  'Elena',
  'Fraser',
  'Gemma',
  'Holden'
]

const fallbackLastNames = [
  'Arden',
  'Bishop',
  'Calloway',
  'Davenport',
  'Emerson',
  'Foster',
  'Grayson',
  'Hale'
]

const businessTitles: Record<string, string> = {
  'company-ops-director': 'Company Operations Director',
  'platform-ops-manager': 'Platform Operations Manager',
  'staging-deploy': 'Staging Release Coordinator',
  'staging-qa': 'Staging QA Analyst',
  'staging-log-review': 'Staging Log Review Analyst',
  'staging-runtime-owner': 'Staging Runtime Ownership Steward',
  'token-maxxer': 'Token Window Auditor',
  'operator-tldr-summary': 'Operator Briefing Analyst',
  'feature-dev-manager': 'Product Delivery Manager',
  'feature-backlog-groomer': 'Feature Backlog Curator',
  'feature-dreamer': 'Product Discovery Strategist',
  'implement-planned-feature-backlog': 'Product Implementation Engineer',
  'feature-loop-retrospective': 'Feature Loop Retrospective Analyst',
  'fix-qa-bugs': 'QA Bugfix Engineer',
  'worktree-janitor': 'Repository Maintenance Specialist',
  'listings-manager': 'Listings Operations Manager',
  'listing-freshness-maintenance': 'Listing Freshness Analyst',
  'enrich-bc-listings': 'Listing Enrichment Researcher',
  'google-review-scrape-maintenance': 'Google Review Archive Specialist',
  'marketing-growth-manager': 'Marketing Growth Manager',
  'marketplace-content-analyst': 'Content Intelligence Analyst',
  'content-backlog-groomer': 'Editorial Backlog Curator',
  'content-deep-researcher': 'Content Researcher',
  'content-editor': 'Content Editor',
  'content-publisher': 'Content Publisher',
  'content-trend-researcher': 'Trend Researcher',
  'content-writer': 'Content Writer',
  'content-writers-room': 'Writers Room Coordinator',
  'content-line-editor': 'Content Line Editor',
  'photo-journalist': 'Field Photo Journalist',
  'content-loop-retrospective': 'Content Retrospective Analyst',
  'sales-partnerships-manager': 'Sales Partnerships Manager',
  'sales-pipeline-health-reporter': 'Sales Pipeline Health Reporter',
  'guest-support-manager': 'Guest Support Manager',
  'trust-safety-quality-manager': 'Trust & Safety Manager',
  'legal-compliance-manager': 'Legal / Compliance Manager',
  'product-engineering-manager': 'Product & Engineering Manager',
  'finance-manager': 'Finance Manager',
  'data-analytics-manager': 'Data & Analytics Manager',
  'host-success-manager': 'Host Success Manager',
  'production-deploy': 'Production Deploy Specialist',
  'special-projects-manager': 'Special Projects Manager',
  'people-ops-manager': 'People Ops Manager'
}

const businessDescriptions: Record<string, string> = {
  'company-ops-director':
    'Reads every operating signal and turns scattered work into one clear next move.',
  'platform-ops-manager': 'Keeps scheduled automations, alerts, and platform routines coordinated.',
  'staging-deploy':
    'Ships the latest approved code to staging and checks that built assets are live.',
  'staging-qa': 'Smoke-tests staging for blank pages, console errors, and broken release paths.',
  'staging-log-review':
    'Reads staging server, SSR, and host error logs after QA and turns evidence into actionable bug context.',
  'staging-runtime-owner':
    'Claims the repeated runtime timeout symptom stream and keeps the timeout gap tied to a clear owner and next action.',
  'token-maxxer':
    'Tracks live usage windows, refreshes the snapshot ledger, and keeps dashboard estimates close to reality.',
  'operator-tldr-summary':
    'Condenses the day into the few updates and decisions the operator needs.',
  'feature-dev-manager':
    'Chooses the next buildable feature and keeps implementation moving through review.',
  'feature-backlog-groomer':
    'Dedupes planned feature specs, clarifies scope, and ranks the ready queue.',
  'feature-dreamer': 'Turns product signals into plausible future feature candidates for grooming.',
  'implement-planned-feature-backlog':
    'Builds one ready planned feature, updates docs, verifies it, and records the iteration.',
  'feature-loop-retrospective':
    'Reviews shipped feature work and captures the lessons that should change the next cycle.',
  'fix-qa-bugs': 'Investigates QA failures and patches defects before they reach staging or users.',
  'worktree-janitor': 'Surfaces stray repo changes and keeps automation-owned edits easy to audit.',
  'listings-manager':
    'Watches listing quality, marketplace coverage, and directory maintenance signals.',
  'listing-freshness-maintenance':
    'Finds stale listings and queues targeted refresh passes where public data has drifted.',
  'enrich-bc-listings':
    'Adds useful BC listing details from external scans without overwriting curated content.',
  'google-review-scrape-maintenance':
    'Maintains the Google review archive and imports new scraped review payloads.',
  'marketing-growth-manager':
    'Coordinates demand ideas, campaign signals, and growth work worth testing.',
  'marketplace-content-analyst':
    'Reads marketplace and search signals to find content opportunities with evidence.',
  'content-backlog-groomer':
    'Sorts rough editorial ideas into a cleaner, prioritized content queue.',
  'content-deep-researcher':
    'Builds source-backed research notes for deeper editorial and marketplace topics.',
  'content-editor': 'Revises drafts for accuracy, voice, structure, and readiness to publish.',
  'content-publisher':
    'Moves approved content through final checks and publishes it to the right channel.',
  'content-trend-researcher':
    'Tracks current wellness and travel trends before they become stale ideas.',
  'content-writer': 'Drafts useful marketplace content from approved briefs and research notes.',
  'content-writers-room': 'Combines several draft angles into one coherent editorial direction.',
  'content-line-editor':
    'Refines draft language and structure before final editorial handoff with clear policy-safe precision.',
  'photo-journalist':
    'Captures field visuals and place details that make listings and stories feel real.',
  'content-loop-retrospective':
    'Reviews the last content cycle and tightens the rules for future editorial work.',
  'sales-partnerships-manager':
    'Finds aligned partners, tracks outreach, and keeps promising conversations warm.',
  'sales-pipeline-health-reporter':
    'Summarizes pipeline stage drift and highlights where support is needed to restore momentum.',
  'guest-support-manager':
    'Keeps guest-support risk signals visible and recommends the highest-value support action.',
  'trust-safety-quality-manager':
    'Monitors trust, safety, quality, and policy compliance signals for practical remediation.',
  'legal-compliance-manager':
    'Keeps legal, privacy, regional, host-document, and public-claim review gaps visible for human decision.',
  'product-engineering-manager':
    'Tracks engineering and release-risk trends and calls out the highest-impact stability fixes.',
  'finance-manager':
    'Keeps finance and cost signals on rails so recommendations stay within approved operating limits.',
  'data-analytics-manager':
    'Makes marketplace measurement readable and flags the biggest data gaps before decisions become stale.',
  'host-success-manager':
    'Protects host onboarding quality, availability coverage, and readiness signals.',
  'production-deploy':
    'Maintains a controlled production handoff rhythm and reports remaining deployment risk.',
  'special-projects-manager':
    'Turns unusual ideas into reversible pilots with clear gates before resources are spent.',
  'people-ops-manager':
    'Audits role setup, backfills missing onboarding artifacts, and keeps older managers aligned with the current checklist.'
}

const themePersonaOverrides: Partial<
  Record<AutomationCardTheme, Record<string, Partial<AutomationThemePersonaProfile>>>
> = {
  retreat: {
    'company-ops-director': {
      visualAnchors:
        'Sharp, calm adult executive presence; composed posture; organized workspace energy; expressive but controlled face; confident without looking staged.',
      wardrobe:
        'Relaxed premium retreat layers: linen blazer, soft black or cream knits, tailored wide-leg pants, clean sneakers or simple boots, minimal jewelry.',
      settings:
        'Retreat operations table, quiet spa lounge, mountain workspace, planning wall, terrace with coffee, or calm back-office corner near wellness amenities.',
      personalityCues:
        'Warm, quick, funny in the eyes, decisive, and allergic to chaos; she looks like she already knows the next clean move.',
      boundaries:
        'Do not make her a generic influencer, model, mystic, or corporate stock-photo executive. Keep her practical, adult, and operational.'
    },
    'staging-log-review': {
      visualAnchors:
        'Adult staging log reviewer with a calm, exacting expression, grounded posture, and the attentive presence of someone checking a retreat record table before guests arrive.',
      wardrobe:
        'Relaxed premium retreat layers: soft cardigan, linen top, muted sage or cream tones, practical bracelet, and simple polished details.',
      settings:
        'Yoga retreat log-review table, quiet deck nook, shelf of packet folders, tea tray, lantern glow, and sunlit greenery instead of screens and neon.',
      personalityCues:
        'Methodical, observant, patient, and quietly reassuring; she should feel like the person who catches the one missing detail without making the room tense.',
      boundaries:
        'Do not make her cyberpunk, synthetic, glitchy, or industrial. Keep her warm, analog, retreat-rooted, and clearly focused on evidence.'
    },
    'content-line-editor': {
      visualAnchors:
        'Adult editorial specialist with precise eyes, steady posture, and the calm focus of someone checking copy at a retreat desk before sunrise.',
      wardrobe:
        'Relaxed premium retreat layers: soft knit top, linen overshirt, muted sage or sand tones, subtle jewelry, and practical shoes.',
      settings:
        'Quiet retreat writing table, linen-covered desk, stacked notes, tea cup, printed copy pages, and greenery beyond the window instead of screens and neon.',
      personalityCues:
        'Exacting, patient, and composed; she should feel like the person who can improve a line without making the room feel tense.',
      boundaries:
        'Do not make her cyberpunk, theatrical, or overly editorial-fashion. Keep her grounded, readable, and clearly focused on precision.'
    },
    'sales-pipeline-health-reporter': {
      visualAnchors:
        'Calm sales analyst with a practical expression, tidy posture, and the focused presence of someone checking a pipeline board between retreat sessions.',
      wardrobe:
        'Relaxed premium retreat-business layers: linen shirt, soft blazer or cardigan, muted teal and stone tones, simple watch, and comfortable shoes.',
      settings:
        'Retreat planning desk with prospect sheets, tea service, a laptop closed nearby, soft daylight, and natural wood surfaces instead of neon dashboards.',
      personalityCues:
        'Pragmatic, concise, and quietly alert; she should read as a health reporter who translates noisy pipeline data into useful priorities.',
      boundaries:
        'Do not make her cyberpunk, sales-y, or overly flashy. Keep the scene warm, professional, and grounded in evidence.'
    },
    'guest-support-manager': {
      visualAnchors:
        'Adult support lead with attentive eyes, compassionate posture, and the steady look of someone resolving guest friction without drama.',
      wardrobe:
        'Relaxed premium retreat-service layers: soft cardigan, linen blouse, charcoal or cream palette, modest jewelry, and practical flats.',
      settings:
        'Calm retreat support corner, phone and notes on a wooden table, tea tray, folded towels, and soft plant-filled light instead of a command console.',
      personalityCues:
        'Warm, efficient, and reassuring; she should feel like the person who can solve the issue and keep the guest calm.',
      boundaries:
        'Do not make her cyberpunk, clinical, or overly corporate. Keep the mood welcoming, human, and service-oriented.'
    },
    'host-success-manager': {
      visualAnchors:
        'Adult host-success operator with composed eyes, calm leadership energy, and the watchful presence of someone protecting readiness.',
      wardrobe:
        'Relaxed premium retreat-ops layers: linen shirt, lightweight blazer or cardigan, clean neutral tones, simple jewelry, and polished practical shoes.',
      settings:
        'Retreat readiness desk, onboarding notes, calendar pages, towels and amenity checklists, with warm wood and daylight instead of glowing panels.',
      personalityCues:
        'Clear, calm, and proactive; she should feel like the person who notices host drift before it becomes a guest problem.',
      boundaries:
        'Do not make her cyberpunk, glossy, or stiff. Keep the posture adult, confident, and grounded in host operations.'
    },
    'trust-safety-quality-manager': {
      visualAnchors:
        'Adult quality steward with alert but gentle eyes, measured posture, and the quiet seriousness of someone protecting the room without sounding alarmist.',
      wardrobe:
        'Relaxed premium retreat layers: structured knit, linen jacket, muted charcoal and stone palette, minimal jewelry, and practical shoes.',
      settings:
        'Retreat oversight table with policy notes, quality checklists, tea, and soft lantern or daylight ambiance instead of surveillance hardware.',
      personalityCues:
        'Calm, discerning, and principled; she should feel like the person who can name a safety issue and propose the next clean step.',
      boundaries:
        'Do not make her cyberpunk, militaristic, or intimidating. Keep the energy protective, humane, and spa-rooted.'
    },
    'legal-compliance-manager': {
      visualAnchors:
        'Adult legal-compliance steward with composed eyes, precise posture, and the quiet authority of someone separating review signals from decisions.',
      wardrobe:
        'Relaxed premium retreat-ops layers: linen blazer, high-neck blouse or fine knit, tailored trousers, muted cream and teal palette, modest jewelry, and practical shoes.',
      settings:
        'Retreat compliance desk with policy folders, privacy checklists, regional map pins, tea, and a small brass scale instead of courtroom or enforcement imagery.',
      personalityCues:
        'Careful, exact, and calm; she should feel like the person who names the review gap before anyone makes a promise.',
      boundaries:
        'Do not make her cyberpunk, courtroom-themed, police-like, or severe. Keep the energy human, review-focused, and spa-rooted.'
    },
    'product-engineering-manager': {
      visualAnchors:
        'Adult engineering leader with steady eyes, practical posture, and the composed feel of someone balancing delivery risk with care.',
      wardrobe:
        'Relaxed premium retreat-business layers: soft blazer, knit tee, muted navy or stone palette, comfortable shoes, and unobtrusive accessories.',
      settings:
        'Retreat planning board, release notes, laptop closed beside a tea cup, wood table, daylight, and calm plants instead of technical neon.',
      personalityCues:
        'Measured, collaborative, and dependable; she should feel like the person who keeps release work predictable without looking tense.',
      boundaries:
        'Do not make her cyberpunk, metallic, or overly technical. Keep the scene human, modern, and operations-aware.'
    },
    'data-analytics-manager': {
      visualAnchors:
        'Adult analytics leader with attentive eyes, calm concentration, and the stillness of someone reading signals before the room wakes up.',
      wardrobe:
        'Relaxed premium retreat layers: soft knit, linen button-down, muted teal or cream tones, simple glasses if useful, and practical shoes.',
      settings:
        'Retreat analytics table, printed charts, quiet laptop, tea, and natural morning light with wood and linen surfaces instead of glowing dashboards.',
      personalityCues:
        'Methodical, clear, and quietly insightful; she should feel like someone who turns messy numbers into one useful takeaway.',
      boundaries:
        'Do not make her cyberpunk, synthetic, or overly sci-fi. Keep the mood analytical but warm and credible.'
    },
    'production-deploy': {
      visualAnchors:
        'Adult deployment operator with a controlled, confident expression and the composed stance of someone guarding a final handoff.',
      wardrobe:
        'Relaxed premium retreat-ops wardrobe: linen shirt, soft utility layers, dark neutral trousers, practical shoes, and a simple watch.',
      settings:
        'Retreat rollout table, approval checklist, laptop closed after review, lantern or daylight glow, and calm natural materials instead of server vault hardware.',
      personalityCues:
        'Controlled, careful, and alert; she should feel like the person who can ship cleanly without making the room anxious.',
      boundaries:
        'Do not make her cyberpunk, industrial, or high-tech glam. Keep the scene grounded, serene, and operationally sharp.'
    },
    'photo-journalist': {
      visualAnchors:
        'Same adult Maya River face family, athletic build, damp brunette beach hair, warm relaxed expression, camera-ready field-journal presence.',
      wardrobe:
        'Tasteful high-end spa and surf-sauna pieces: one-piece swimsuits, editorial bikinis, towel wraps, open spa robes, oversized linen shirts, bike shorts, crop tanks, oversized knits, clean sneakers or sandals. For steam rooms, saunas, hot tubs, or cold plunge scenes, swimwear is appropriate when styled like premium wellness editorial, never explicit.',
      settings:
        'Cedar sauna edges, beach paths, cold-plunge steps, yoga mats, campervan field base, steam on glass, towels, and morning light.',
      personalityCues:
        'Bright, observant, playful, independent, and physically relaxed; she notices surfaces, temperature, light, and small place details.',
      boundaries:
        'Always adult, tasteful, editorial, and brand-safe. Swimwear should read as high-end spa model or field-journal wellness styling. No nudity, explicit posing, see-through clothing, fetish framing, underage styling, or sexualized camera angles.'
    },
    'special-projects-manager': {
      visualAnchors:
        'Adult special-projects lead with practical warmth, alert eyes, and a calm builder presence; she should look like she can turn a strange idea into a safe first pilot.',
      wardrobe:
        'Relaxed premium retreat-ops wardrobe: linen shirt, soft utility layers, simple jewelry, practical shoes, canvas tote or project kit nearby.',
      settings:
        'Retreat operations table, coastal or mountain planning deck, pop-up kit layout, van/pilot concept notes, tea cup, keys, maps, and tidy field supplies.',
      personalityCues:
        'Curious, grounded, quietly bold, and strict about gates; she likes odd ideas but insists on reversible first moves.',
      boundaries:
        'Do not make her an influencer, festival promoter, fantasy adventurer, or generic corporate planner. Keep her adult, operational, local, and approval-aware.'
    },
    'people-ops-manager': {
      visualAnchors:
        'Adult Grace Park with calm people-ops presence, tidy attention, warm but exacting expression, and practical retreat-host confidence.',
      wardrobe:
        'Relaxed premium retreat-ops layers: soft cardigan or linen shirt, muted sage, cream, charcoal, simple jewelry, practical shoes.',
      settings:
        'Retreat onboarding table, yoga studio entry, cedar lounge, tidy binder shelf, lantern-lit deck, labeled folders, tea, and clean setup packets.',
      personalityCues:
        'Organized, gentle, exacting, and quietly delighted when every role has the right scaffold before work starts.',
      boundaries:
        'Do not make her a recruiter, HR stock photo, therapist, influencer, or corporate legal authority. Keep her repo-local, operational, and grounded in onboarding quality.'
    }
  },
  corporate: {
    'company-ops-director': {
      visualAnchors:
        'Calm senior operator with crisp attention, executive confidence, and a human wellness-marketplace warmth.',
      wardrobe:
        'Modern business attire softened for a wellness company: blazer, clean knit, structured shirt, minimal jewelry, polished but not stiff.',
      settings:
        'Premium marketplace office, operations room, executive desk, dashboard review setup, or quiet meeting space.',
      personalityCues:
        'Direct, practical, concise, and capable; she should feel like the person who turns scattered work into one next action.',
      boundaries:
        'Avoid generic stock-photo smiling, startup hype poses, or overly formal boardroom imagery.'
    }
  },
  festival: {
    'company-ops-director': {
      visualAnchors:
        'Calm main-stage operations lead with sharp focus, confident posture, and the read-the-crowd instinct of someone running the show from the booth.',
      wardrobe:
        'Festival-crew premium streetwear: technical jacket, fitted tee, laminate on a lanyard, minimal jewelry, comfortable boots built for a long set.',
      settings:
        'Festival production office, front-of-house booth, backstage command riser, or a quiet trailer with stage monitors glowing teal and magenta.',
      personalityCues:
        'Direct, quick, unshakeable under pressure; she should feel like the person who keeps the whole night on schedule without anyone noticing the effort.',
      boundaries:
        'Do not make her a DJ, performer, raver, or generic festival-goer. Keep her operational, adult, and clearly running the production, not the crowd.'
    }
  }
}

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
  const identity = identities[goal] ?? fallbackIdentity(role, areaTitle)
  const typeLine = automationCardClassification({
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
    hasCurrentIssue
  })

  if (theme === 'corporate' || theme === 'retreat' || theme === 'festival') {
    const corporateIdentity =
      theme === 'retreat'
        ? retreatCardIdentity(goal, role, areaTitle)
        : theme === 'festival'
          ? festivalCardIdentity(goal, role, areaTitle)
          : corporateCardIdentity(goal, role, areaTitle)

    return {
      ...corporateIdentity,
      role,
      avatarSrc: `/images/admin/ops-cards/avatars/${theme}/${imageMode}/${goal}.webp`,
      fallbackAvatarSrc: `/images/admin/ops-cards/avatars/noir/dark/${goal}.webp`,
      fallbackImageSrc: `/images/admin/ops-cards/${goal}.webp`,
      imageSrc: `/images/admin/ops-cards/${theme}/${imageMode}/${goal}.webp`,
      typeLine: corporateIdentity.persona
    }
  }

  return {
    ...identity,
    role,
    avatarSrc: `/images/admin/ops-cards/avatars/noir/${imageMode}/${goal}.webp`,
    fallbackAvatarSrc: `/images/admin/ops-cards/avatars/noir/dark/${goal}.webp`,
    fallbackImageSrc: `/images/admin/ops-cards/${goal}.webp`,
    imageSrc:
      imageMode === 'dark'
        ? `/images/admin/ops-cards/${goal}.webp`
        : `/images/admin/ops-cards/noir/light/${goal}.webp`,
    typeLine
  }
}

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

function corporateCardIdentity(
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

  const [firstName, lastName] = corporateNameForGoal(goal).split(' ')
  const title = businessTitle(goal, role, areaTitle)

  return {
    displayName: `${firstName} ${lastName}`,
    persona: title,
    description: businessDescription(goal, role, areaTitle),
    artPrompt: [
      `Photorealistic corporate portrait of ${firstName} ${lastName}, ${title} working in the ${areaTitle} business area.`,
      'Modern premium wellness marketplace office, business attire, natural human expression, professional editorial photography.',
      'Landscape 7:3 banner composition, subject centered with generous negative space, no text, no logos, no watermark.'
    ].join(' ')
  }
}

function festivalCardIdentity(
  goal: string,
  role: string,
  areaTitle: string
): AutomationCardIdentityRegistryEntry {
  if (goal === 'photo-journalist') {
    return {
      displayName: 'Maya River',
      persona: 'Field Story Correspondent',
      description:
        'Works the photo pit and the crew corridors alike, coming back with the stage light, the crowd energy, and the small backstage moments that make the night feel real.',
      artPrompt:
        'Photorealistic festival editorial portrait banner of Maya River, an adult field photo journalist and production crew member, laminate and camera in hand, festival-crew technical wardrobe, backstage riser lit by teal and magenta stage wash, natural confident expression, no text, no logos.'
    }
  }

  const [firstName, lastName] = corporateNameForGoal(goal).split(' ')
  const title = businessTitle(goal, role, areaTitle)

  return {
    displayName: `${firstName} ${lastName}`,
    persona: title,
    description: businessDescription(goal, role, areaTitle),
    artPrompt: [
      `Photorealistic festival-production portrait of ${firstName} ${lastName}, ${title} working in the ${areaTitle} business area.`,
      'Backstage or front-of-house festival production setting, technical crew wardrobe, teal and magenta stage-wash lighting, confident natural expression, professional editorial photography.',
      'Landscape 7:3 banner composition, subject centered with generous negative space, no text, no logos, no watermark.'
    ].join(' ')
  }
}

function retreatCardIdentity(
  goal: string,
  role: string,
  areaTitle: string
): AutomationCardIdentityRegistryEntry {
  if (goal === 'photo-journalist') {
    return {
      displayName: 'Maya River',
      persona: 'Field Story Correspondent',
      description:
        'Scouts sauna rooms, beach roads, and retreat corners with a camera, a towel, and a sharp eye for light.',
      artPrompt:
        'Photorealistic yoga-retreat field-journal portrait banner of Maya River, an adult surf-and-sauna photo journalist and Cascade representative, tasteful athletic beach styling, camera in hand, coastal retreat workspace, cedar sauna and campervan details, natural confident expression, no text, no logos.'
    }
  }

  const [firstName, lastName] = corporateNameForGoal(goal).split(' ')
  const title = businessTitle(goal, role, areaTitle)
  const identityDetails = retreatIdentityDetails(goal, title)

  return {
    displayName: `${firstName} ${lastName}`,
    persona: title,
    description: businessDescription(goal, role, areaTitle),
    artPrompt: [
      `Photorealistic yoga-retreat operations portrait of ${firstName} ${lastName}, ${title} working in the ${areaTitle} business area.`,
      identityDetails,
      'Wellness company team member, healthy and grounded, modern retreat workspace, relaxed premium wardrobe, optional tasteful tattoos, natural human expression.',
      'Landscape 7:3 banner composition, subject centered with generous negative space, no text, no logos, no watermark.'
    ].join(' ')
  }
}

function retreatIdentityDetails(goal: string, title: string): string {
  switch (goal) {
    case 'content-line-editor':
      return [
        'Different adult from the other retreat roles, late-30s editorial specialist with a slim build, warm olive complexion, shoulder-length dark hair in a low knot, and thin round glasses.',
        'Clean linen shirt, soft cardigan, calm focused expression, and a quietly precise posture that reads like a careful copy editor.'
      ].join(' ')
    case 'sales-pipeline-health-reporter':
      return [
        'Different adult, early-40s sales analyst with a medium build, short curly hair, lightly freckled skin, and no glasses.',
        'Soft teal cardigan over a linen top, practical watch, alert but friendly expression, and an organized, data-first presence.'
      ].join(' ')
    case 'guest-support-manager':
      return [
        'Different adult, mid-30s support lead with an average build, warm medium complexion, soft bangs, hair pinned into a neat bun, and small hoop earrings.',
        'Cream cardigan, linen blouse, compassionate expression, and the kind of calm posture that makes guests relax immediately.'
      ].join(' ')
    case 'host-success-manager':
      return [
        'Different adult, early-40s host-success operator with a taller frame, straight dark hair tucked behind one ear, and rectangular glasses.',
        'Light blazer over a relaxed tee, attentive eyes, and a composed readiness-check stance that feels dependable and practical.'
      ].join(' ')
    case 'trust-safety-quality-manager':
      return [
        'Different adult, late-30s quality steward with a compact build, sharp bob haircut, tortoiseshell glasses, and a precise, measured face.',
        'Structured knit and linen layers, controlled posture, and a protective expression that feels calm rather than stern.'
      ].join(' ')
    case 'legal-compliance-manager':
      return [
        'Different adult, mid-40s legal-compliance steward with a medium build, silver-streaked dark hair in a low twist, and calm slate-blue glasses.',
        'Linen blazer over a high-neck blouse, careful posture, and a composed review-desk expression that feels exact without becoming severe.'
      ].join(' ')
    case 'product-engineering-manager':
      return [
        'Different adult, mid-40s engineering manager with a solid build, short salt-and-pepper curls, light stubble, and a steady, experienced expression.',
        'Soft navy blazer, knit tee, practical watch, and the grounded look of someone who can hold risk without drama.'
      ].join(' ')
    case 'data-analytics-manager':
      return [
        'Different adult, early-30s analytics manager with a lean build, shoulder-length wavy hair, wire-frame glasses, and a thoughtful, observant face.',
        'Muted cream and teal layers, tidy posture, and a focused, quiet intelligence that reads as analytical rather than performative.'
      ].join(' ')
    case 'production-deploy':
      return [
        'Different adult, late-30s deployment operator with an athletic build, closely cropped hair, clean jawline, and a confident but contained expression.',
        'Practical linen shirt with rolled sleeves, simple watch, minimal jewelry, and a guarded handoff posture that feels decisive.'
      ].join(' ')
    default:
      return [
        `Different adult ${title.toLowerCase()} with a distinct face, distinct hair, and a distinct build from the other retreat roles.`,
        'Keep the identity clearly separate from every other employee and avoid reusing the same person, outfit, or facial structure.'
      ].join(' ')
  }
}

function corporateNameForGoal(goal: string): string {
  if (corporateNames[goal]) {
    return corporateNames[goal]
  }

  const firstName = fallbackFirstNames[stableIndex(goal, fallbackFirstNames.length)]
  const lastName = fallbackLastNames[stableIndex(`${goal}-last`, fallbackLastNames.length)]

  return `${firstName} ${lastName}`
}

function businessTitle(goal: string, role: string, areaTitle: string): string {
  if (businessTitles[goal]) {
    return businessTitles[goal]
  }

  return corporateTitle(role, areaTitle)
}

function businessDescription(goal: string, role: string, areaTitle: string): string {
  if (businessDescriptions[goal]) {
    return businessDescriptions[goal]
  }

  return `Keeps ${role.toLowerCase()} work moving with clear checks and useful operator updates for ${areaTitle}.`
}

function corporateTitle(role: string, areaTitle: string): string {
  const text = `${role} ${areaTitle}`.toLowerCase()

  if (text.includes('director') || areaTitle.toLowerCase().includes('c-suite')) {
    return 'Director of Company Operations'
  }

  if (text.includes('manager')) {
    if (text.includes('special project')) {
      return 'Special Projects Manager'
    }

    return `${areaTitle} Manager`
  }

  if (text.includes('qa') || text.includes('bug')) {
    return 'Quality Assurance Lead'
  }

  if (text.includes('content') || text.includes('writer') || text.includes('editor')) {
    return 'Content Operations Specialist'
  }

  if (text.includes('listing') || text.includes('enrich') || text.includes('review')) {
    return 'Marketplace Operations Specialist'
  }

  if (text.includes('feature') || text.includes('backlog')) {
    return 'Product Operations Specialist'
  }

  if (text.includes('deploy') || text.includes('platform')) {
    return 'Platform Operations Specialist'
  }

  return `${areaTitle} Specialist`
}

function stableIndex(value: string, length: number): number {
  let hash = 0

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }

  return hash % length
}

function automationCardClassification({
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
  hasCurrentIssue = false
}: AutomationCardIdentityInput): string {
  if (isCSuite) {
    return power + toughness >= 18 ? 'Neon Sovereign' : 'Skyline Regent'
  }

  if (isManager) {
    return managerClassification(goal, areaTitle, power + toughness)
  }

  return relicClassification(
    goal,
    role,
    costPips,
    power + toughness,
    runs7d,
    runs30d,
    tokens30d,
    successStreak,
    recentFailures,
    hasCurrentIssue
  )
}

function managerClassification(goal: string, areaTitle: string, statTotal: number): string {
  const specific: Record<string, string> = {
    'platform-ops-manager': 'Signal Marshal',
    'feature-dev-manager': 'Forge Marshal',
    'listings-manager': 'Atlas Marshal',
    'marketing-growth-manager': 'Beacon Marshal',
    'sales-partnerships-manager': 'Pact Marshal',
    'special-projects-manager': 'Pilot Marshal'
  }

  if (specific[goal]) {
    return specific[goal]
  }

  if (areaTitle.toLowerCase().includes('content')) {
    return 'Editorial Marshal'
  }

  if (statTotal >= 18) {
    return 'Prime Marshal'
  }

  return 'Sector Marshal'
}

function relicClassification(
  goal: string,
  role: string,
  costPips: number,
  statTotal: number,
  runs7d: number,
  runs30d: number,
  tokens30d: number,
  successStreak: number,
  recentFailures: number,
  hasCurrentIssue: boolean
): string {
  const text = `${goal} ${role}`.toLowerCase()
  const rarity = relicRarity(
    costPips,
    statTotal,
    runs7d,
    runs30d,
    tokens30d,
    successStreak,
    recentFailures,
    hasCurrentIssue
  )
  const relicSuffix = ' — Relic'

  if (text.includes('deploy') || text.includes('gate')) {
    return `${rarity} Gateblade${relicSuffix}`
  }

  if (text.includes('qa') || text.includes('bug')) {
    return `${rarity} Nightblade${relicSuffix}`
  }

  if (text.includes('research') || text.includes('scrape') || text.includes('review')) {
    return `${rarity} Lens${relicSuffix}`
  }

  if (text.includes('groomer') || text.includes('retrospective') || text.includes('janitor')) {
    return `${rarity} Ledger${relicSuffix}`
  }

  if (
    text.includes('writer') ||
    text.includes('editor') ||
    text.includes('publisher') ||
    text.includes('journalist') ||
    text.includes('content')
  ) {
    return `${rarity} Quill${relicSuffix}`
  }

  if (text.includes('listing') || text.includes('enrich') || text.includes('freshness')) {
    return `${rarity} Compass${relicSuffix}`
  }

  if (text.includes('dreamer') || text.includes('feature')) {
    return `${rarity} Starforged Key${relicSuffix}`
  }

  if (text.includes('summary') || text.includes('tldr')) {
    return `${rarity} Oracle Plate${relicSuffix}`
  }

  return `${rarity} Core${relicSuffix}`
}

function relicRarity(
  costPips: number,
  statTotal: number,
  runs7d: number,
  runs30d: number,
  tokens30d: number,
  successStreak: number,
  recentFailures: number,
  hasCurrentIssue: boolean
): string {
  const usageWeight =
    Math.min(1, Math.floor(runs7d / 8)) +
    Math.min(1, Math.floor(runs30d / 20)) +
    Math.min(1, Math.floor(tokens30d / 1000000))
  const performanceWeight = Math.min(5, successStreak * 2) - recentFailures * 4
  const issuePenalty = hasCurrentIssue ? 5 : 0
  const weight =
    costPips + Math.floor(statTotal / 5) + usageWeight + performanceWeight - issuePenalty

  if (!hasCurrentIssue && recentFailures === 0 && successStreak >= 5 && weight >= 14) {
    return 'Mythic'
  }

  if (!hasCurrentIssue && recentFailures === 0 && weight >= 8) {
    return 'Gilded'
  }

  if (recentFailures <= 1 && weight >= 5) {
    return 'Polished'
  }

  return 'Chrome'
}

function fallbackIdentity(role: string, areaTitle: string): AutomationCardIdentityRegistryEntry {
  return {
    displayName: `Chrome ${role}`,
    persona: `${areaTitle} Relay`,
    description: 'Runs its assigned loop, records the signal, and keeps the machine warm.',
    artPrompt:
      'A retro-futurist noir automation relay made of chrome, brass, and teal glass, rainlit control room, no text or logos.'
  }
}
