import { defineFixture } from '../../component-fixtures/component-fixture'
import { UnifiedAutomationCreateDialog } from './UnifiedAutomationCreateDialog'

export const mobile = defineFixture({
  width: 390,
  render: () => (
    <UnifiedAutomationCreateDialog
      open
      goalProjects={[
        { key: '/projects/alpha', name: 'Alpha' },
        { key: '/projects/beta', name: 'Beta' }
      ]}
      goalProjectsLoading={false}
      goalProjectsError={null}
      onOpenChange={() => undefined}
      onCreateAutomation={() => undefined}
      onCreateGoal={() => undefined}
      onOpenGoalAdvanced={() => undefined}
    />
  )
})
