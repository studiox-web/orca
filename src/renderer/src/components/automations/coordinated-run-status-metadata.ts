import type React from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  PauseCircle,
  Play,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle
} from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type {
  CoordinatedParentSemanticState,
  CoordinatedStageExecutionStatus,
  OutcomeFinalState
} from './coordinated-automation-run-projection'
export function stageStatusMetadata(): Record<
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
        'auto.components.automations.AutomationCoordinatedRunStageCard.f76638fb64',
        'Unobserved'
      ),
      variant: 'outline',
      icon: Clock
    },
    ready: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.fddcfaed44',
        'Ready'
      ),
      variant: 'outline',
      icon: Play
    },
    queued: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.07b134f553',
        'Queued'
      ),
      variant: 'outline',
      icon: Clock
    },
    active: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.f82c2c54d0',
        'Active'
      ),
      variant: 'secondary',
      icon: Sparkles
    },
    waiting_for_approval: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.9ced5e0180',
        'Waiting for approval'
      ),
      variant: 'outline',
      icon: PauseCircle
    },
    blocked: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.3d82ec2c1d',
        'Blocked'
      ),
      variant: 'destructive',
      icon: AlertTriangle
    },
    accepted: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.1cb82e248e',
        'Accepted'
      ),
      variant: 'secondary',
      icon: CheckCircle2
    },
    superseded: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.144275d0ea',
        'Superseded'
      ),
      variant: 'outline',
      icon: RefreshCw
    },
    failed: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.9c7fb504f7',
        'Failed'
      ),
      variant: 'destructive',
      icon: XCircle
    },
    uncertain: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.c3d892934f',
        'Uncertain effect'
      ),
      variant: 'destructive',
      icon: ShieldAlert
    },
    skipped: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunStageCard.40b8df290d',
        'Skipped'
      ),
      variant: 'outline',
      icon: Clock
    }
  }
}

export function parentSemanticMetadata(): Record<
  CoordinatedParentSemanticState,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'destructive'
    icon: React.ComponentType<{ className?: string }>
  }
> {
  return {
    completed: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.bf600042c2',
        'Semantic goal completed'
      ),
      variant: 'secondary',
      icon: CheckCircle2
    },
    ready_for_review: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.abb64092ff',
        'Ready for review'
      ),
      variant: 'outline',
      icon: CheckCircle2
    },
    ready_to_publish: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.e37e7eddc6',
        'Ready to publish'
      ),
      variant: 'secondary',
      icon: CheckCircle2
    },
    published_verified: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.8de3a6f2af',
        'Published & verified'
      ),
      variant: 'secondary',
      icon: CheckCircle2
    },
    waiting_for_approval: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.d9fd6a7163',
        'Waiting for approval'
      ),
      variant: 'outline',
      icon: AlertTriangle
    },
    in_progress: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.6dd39b9cc7',
        'In progress'
      ),
      variant: 'default',
      icon: Sparkles
    },
    pending: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.016be9ad83',
        'Pending / Queued'
      ),
      variant: 'outline',
      icon: Clock
    },
    blocked: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.8b9d9a9e7d',
        'Blocked'
      ),
      variant: 'destructive',
      icon: AlertTriangle
    },
    failed: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.0eda6fb321',
        'Failed'
      ),
      variant: 'destructive',
      icon: ShieldAlert
    },
    outcome_uncertain: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.ec6c81c141',
        'Outcome uncertain'
      ),
      variant: 'destructive',
      icon: ShieldAlert
    },
    quarantined: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.6c7ad69e81',
        'Quarantined (fail-closed)'
      ),
      variant: 'destructive',
      icon: ShieldAlert
    },
    unaccepted: {
      label: translate(
        'auto.components.automations.AutomationCoordinatedRunHeaderAndLimits.ebf2a4ff43',
        'Unaccepted technical completion'
      ),
      variant: 'outline',
      icon: AlertTriangle
    }
  }
}

export function receiptStateMetadata(): Record<
  OutcomeFinalState,
  {
    label: string
    variant: 'secondary' | 'outline' | 'destructive'
    icon: React.ComponentType<{ className?: string }>
  }
> {
  return {
    completed: {
      label: translate(
        'auto.components.automations.AutomationCompletionReceiptInspector.8d38902c64',
        'Completed'
      ),
      variant: 'secondary',
      icon: CheckCircle2
    },
    ready_for_review: {
      label: translate(
        'auto.components.automations.AutomationCompletionReceiptInspector.01513b49dd',
        'Ready for review'
      ),
      variant: 'outline',
      icon: CheckCircle2
    },
    ready_to_publish: {
      label: translate(
        'auto.components.automations.AutomationCompletionReceiptInspector.6b9d7963ad',
        'Ready to publish'
      ),
      variant: 'secondary',
      icon: CheckCircle2
    },
    published_verified: {
      label: translate(
        'auto.components.automations.AutomationCompletionReceiptInspector.c716561b21',
        'Published & verified'
      ),
      variant: 'secondary',
      icon: ShieldCheck
    },
    blocked: {
      label: translate(
        'auto.components.automations.AutomationCompletionReceiptInspector.fe786f939d',
        'Blocked'
      ),
      variant: 'outline',
      icon: AlertTriangle
    },
    failed: {
      label: translate(
        'auto.components.automations.AutomationCompletionReceiptInspector.7b104f5c64',
        'Failed'
      ),
      variant: 'destructive',
      icon: XCircle
    },
    outcome_uncertain: {
      label: translate(
        'auto.components.automations.AutomationCompletionReceiptInspector.d3c701c2aa',
        'Outcome uncertain'
      ),
      variant: 'destructive',
      icon: ShieldAlert
    }
  }
}
