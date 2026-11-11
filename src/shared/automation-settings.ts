export type AutomationSettings = {
  /** Read-only, request-derived Goals/Automations/Scripts/External list. */
  unifiedAutomationSurface?: boolean
  /** Enables the delegated create chooser on the unified automation list. */
  unifiedAutomationEditors?: boolean
  /** Experimental: coordinated multi-worker automation definitions and workers UI; off preserves single automation UI. */
  experimentalCoordinatedAutomations?: boolean
}
