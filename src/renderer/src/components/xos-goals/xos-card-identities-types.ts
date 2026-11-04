// XOS fork: types for card identities and themes.

export type AutomationCardTheme = 'noir' | 'corporate' | 'retreat' | 'festival'

export type AutomationCardImageMode = 'dark' | 'light'

export type AutomationThemePersonaProfile = {
  visualAnchors: string
  wardrobe: string
  settings: string
  personalityCues: string
  boundaries: string
}

export type AutomationCardIdentityRegistryEntry = {
  displayName: string
  persona: string
  description: string
  artPrompt: string
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
