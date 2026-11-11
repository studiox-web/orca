import type React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  PauseCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  XCircle
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { CoordinatedStageExecutionStatus } from './coordinated-automation-run-projection'
export function graphStageStatusMetadata(): Record<
  CoordinatedStageExecutionStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
    icon: React.ComponentType<{ className?: string }>
  }
> {
  return {
    unknown: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.af86e3f4c7',
        'Unobserved'
      ),
      variant: 'outline',
      icon: Clock
    },
    ready: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.5775175c29',
        'Ready'
      ),
      variant: 'outline',
      icon: Play
    },
    queued: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.89c5a00cff',
        'Queued'
      ),
      variant: 'outline',
      icon: Clock
    },
    active: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.cb0a286bb9',
        'Active'
      ),
      variant: 'secondary',
      icon: Sparkles
    },
    waiting_for_approval: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.e4e883694d',
        'Approval gate'
      ),
      variant: 'outline',
      icon: PauseCircle
    },
    blocked: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.27954e4b42',
        'Blocked'
      ),
      variant: 'destructive',
      icon: AlertTriangle
    },
    accepted: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.65a2222820',
        'Accepted'
      ),
      variant: 'secondary',
      icon: CheckCircle2
    },
    superseded: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.aeac0a3a57',
        'Superseded'
      ),
      variant: 'outline',
      icon: RefreshCw
    },
    failed: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.3defc4b3df',
        'Failed'
      ),
      variant: 'destructive',
      icon: XCircle
    },
    uncertain: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.52b371bc7c',
        'Uncertain'
      ),
      variant: 'destructive',
      icon: ShieldAlert
    },
    skipped: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStagesGraph.99a5963cbf',
        'Skipped'
      ),
      variant: 'outline',
      icon: Clock
    }
  }
}
