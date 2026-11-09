import type {
  ChildLaunchConfig,
  ChildLaunchConfigField,
  ChildPromptSource,
  CoordinatedAutomationChildDefinition
} from '../../../../shared/coordinated-automation-types'
import { sha256Hex } from '../../../../shared/coordinated-automation-canonical-digest'
import { createBrowserUuid } from '@/lib/browser-uuid'

export function computePromptDigest(promptSource: ChildPromptSource): string {
  if (promptSource.kind === 'inline') {
    return `sha256:${sha256Hex(promptSource.text)}`
  }
  return promptSource.digest ?? `sha256:ref(${promptSource.path})`
}

export function createDefaultChildDefinition(index: number): CoordinatedAutomationChildDefinition {
  const id = createBrowserUuid()
  return {
    id,
    role: `worker-${index + 1}`,
    name: `Worker ${index + 1}`,
    description: '',
    promptSource: {
      kind: 'inline',
      text: ''
    },
    dependencies: [],
    mutationClass: 'read_only',
    enabled: true,
    launchConfig: {
      provenance: {
        agentId: 'inherited',
        model: 'inherited',
        reasoningEffort: 'inherited',
        surface: 'inherited',
        workspaceMode: 'inherited',
        timeoutSeconds: 'inherited',
        maxRetries: 'inherited',
        maxReviewIterations: 'inherited'
      }
    }
  }
}

export function addChildWorker(
  children: readonly CoordinatedAutomationChildDefinition[],
  child?: Partial<CoordinatedAutomationChildDefinition>
): CoordinatedAutomationChildDefinition[] {
  const defaultChild = createDefaultChildDefinition(children.length)
  const nextChild: CoordinatedAutomationChildDefinition = {
    ...defaultChild,
    ...child,
    launchConfig: {
      ...defaultChild.launchConfig,
      ...child?.launchConfig,
      provenance: {
        ...defaultChild.launchConfig.provenance,
        ...child?.launchConfig?.provenance
      }
    }
  }
  return [...children, nextChild]
}

export function updateChildWorker(
  children: readonly CoordinatedAutomationChildDefinition[],
  childId: string,
  patch: Partial<CoordinatedAutomationChildDefinition>
): CoordinatedAutomationChildDefinition[] {
  return children.map((child) => {
    if (child.id !== childId) {
      return child
    }
    const updated: CoordinatedAutomationChildDefinition = {
      ...child,
      ...patch,
      launchConfig: patch.launchConfig
        ? {
            ...child.launchConfig,
            ...patch.launchConfig,
            provenance: {
              ...child.launchConfig.provenance,
              ...patch.launchConfig.provenance
            }
          }
        : child.launchConfig
    }
    return updated
  })
}

export function removeChildWorker(
  children: readonly CoordinatedAutomationChildDefinition[],
  childId: string
): CoordinatedAutomationChildDefinition[] {
  return children
    .filter((child) => child.id !== childId)
    .map((child) => ({
      ...child,
      dependencies: child.dependencies.filter((dep) => dep.childId !== childId)
    }))
}

export function reorderChildWorkers(
  children: readonly CoordinatedAutomationChildDefinition[],
  fromIndex: number,
  toIndex: number
): CoordinatedAutomationChildDefinition[] {
  if (
    fromIndex < 0 ||
    fromIndex >= children.length ||
    toIndex < 0 ||
    toIndex >= children.length ||
    fromIndex === toIndex
  ) {
    return [...children]
  }
  const result = [...children]
  const [removed] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, removed)
  return result
}

export function toggleChildWorkerEnabled(
  children: readonly CoordinatedAutomationChildDefinition[],
  childId: string
): CoordinatedAutomationChildDefinition[] {
  return children.map((child) =>
    child.id === childId ? { ...child, enabled: !child.enabled } : child
  )
}

export function resetChildLaunchConfigFieldToInherited(
  child: CoordinatedAutomationChildDefinition,
  field: ChildLaunchConfigField
): CoordinatedAutomationChildDefinition {
  const nextConfig: ChildLaunchConfig = {
    ...child.launchConfig,
    [field]: undefined,
    provenance: {
      ...child.launchConfig.provenance,
      [field]: 'inherited'
    }
  }
  return {
    ...child,
    launchConfig: nextConfig
  }
}

export function setChildLaunchConfigFieldOverridden<K extends ChildLaunchConfigField>(
  child: CoordinatedAutomationChildDefinition,
  field: K,
  value: ChildLaunchConfig[K]
): CoordinatedAutomationChildDefinition {
  const nextConfig: ChildLaunchConfig = {
    ...child.launchConfig,
    [field]: value,
    provenance: {
      ...child.launchConfig.provenance,
      [field]: 'overridden'
    }
  }
  return {
    ...child,
    launchConfig: nextConfig
  }
}

export function setChildLaunchConfigFieldExplicitNone(
  child: CoordinatedAutomationChildDefinition,
  field: ChildLaunchConfigField
): CoordinatedAutomationChildDefinition {
  const nextConfig: ChildLaunchConfig = {
    ...child.launchConfig,
    [field]: null,
    provenance: {
      ...child.launchConfig.provenance,
      [field]: 'overridden'
    }
  }
  return {
    ...child,
    launchConfig: nextConfig
  }
}
