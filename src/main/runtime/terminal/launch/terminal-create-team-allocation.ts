import type { TerminalCreateOptions } from '../../runtime-terminal-contracts'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { nativeStubSpawnEnvironment } from '../../native-stub-launch-options'
import { SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV } from '../../../../shared/setup-agent-sequencing'
import type { ClaudeAgentTeamsService } from '../../claude-agent-teams-service'
import type { PtySpawnOutcome } from '../../../ipc/pty/spawn-outcome'
import { buildRuntimeAgentTeamsLaunchPlan } from './agent-teams-launch-plan'

/** Only the exact allocation belongs to this start until the process accepts it. */
export function terminalCreateTeamAllocation(teams: ClaudeAgentTeamsService) {
  let teamId: string | undefined
  const release = () => {
    if (teamId) {
      teams.releaseTeam(teamId)
      teamId = undefined
    }
  }
  const prepare = (
    args: Omit<Parameters<typeof buildRuntimeAgentTeamsLaunchPlan>[0], 'createTeamEnv'>,
    leaderHandle: string
  ) => {
    release()
    return buildRuntimeAgentTeamsLaunchPlan({
      ...args,
      createTeamEnv: (shimDir, shimBin) => {
        const allocation = teams.createLaunchEnv({
          leaderHandle,
          baseEnv: args.baseEnv,
          shimDir,
          shimBin
        })
        teamId = allocation.teamId
        return allocation.env
      }
    })
  }
  return {
    release,
    prepare,
    prepareCreate: async (input: {
      opts: TerminalCreateOptions
      baseEnv: Record<string, string>
      leaderHandle: string
      readMode: () => GlobalSettings['claudeAgentTeamsMode'] | undefined
      workspaceEnv: (
        base: Record<string, string>,
        team?: Record<string, string>
      ) => Record<string, string>
      releaseOnFailure: () => void
    }) => {
      const { opts, baseEnv } = input
      if (opts.preparedNativeStub) {
        return {
          plan: undefined,
          sequencedStartupCommand: undefined,
          effectiveLaunchConfig: opts.launchConfig,
          env: nativeStubSpawnEnvironment(opts.preparedNativeStub)
        }
      }
      const planned = await prepare(
        {
          launchConfig: opts.launchConfig,
          command: opts.command,
          claudeAgentTeamsSourceCommand: opts.claudeAgentTeamsSourceCommand,
          claudeAgentTeamsMode: input.readMode(),
          baseEnv: { ...process.env, ...baseEnv },
          adoptedBeforeLaunch: null
        },
        input.leaderHandle
      ).catch((error: unknown) => {
        input.releaseOnFailure()
        throw error
      })
      return {
        ...planned,
        env: input.workspaceEnv(
          {
            ...baseEnv,
            ...(planned.sequencedStartupCommand
              ? { [SETUP_AGENT_SEQUENCE_STARTUP_COMMAND_ENV]: planned.sequencedStartupCommand }
              : {})
          },
          planned.plan?.env
        )
      }
    },
    acceptOutcome: (outcome: PtySpawnOutcome) => {
      if (outcome.kind === 'committed' && !outcome.result.isReattach) {
        teamId = undefined
      }
    },
    acceptFresh: (
      result: Pick<PtySpawnOutcome['result'], 'agentSessionEnsure' | 'stablePaneOwner'>
    ) => {
      if (result.agentSessionEnsure?.disposition !== 'adopted' && !result.stablePaneOwner) {
        teamId = undefined
      }
    }
  }
}
