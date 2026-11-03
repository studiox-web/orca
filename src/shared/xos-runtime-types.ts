// XOS fork: stage A runtime types shared by main and renderer (model picker, later fallbacks,
// lane locks and run timeouts).

export type XosCatalogModel = {
  id: string
  label: string
  description?: string
  isDefault: boolean
  defaultEffort?: string
  efforts: { value: string; label: string }[]
}

export type XosModelList =
  | { status: 'ok'; models: XosCatalogModel[]; fetchedAt: number | null }
  /** No catalog for this agent on this host (no chat runtime, not signed in, or still listing). */
  | { status: 'unavailable'; message: string }

export type XosRuntimeApi = {
  listModels: (args: { agent: string }) => Promise<XosModelList>
}
