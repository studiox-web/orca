import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { readMetadata } from '../../../../src/cli/runtime/metadata'
import { sendRequest } from '../../../../src/cli/runtime/transport'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../../src/shared/protocol-version'
import { readRuntimeSourceStamp } from '../../../../src/shared/runtime-source-env'
import { findTransport } from '../../../../src/shared/runtime-bootstrap'
import { createRuntimeTransportMetadata } from '../../../../src/main/runtime/runtime-rpc/runtime-rpc-socket-metadata'
import { buildNativeStubCompletionReport } from '../../../../src/shared/native-stub-fixture-report'
import { startGoldenStubAgent } from './golden-stub-agent.js'

let attempted = false
function mark(state: 'REPORTED' | 'REFUSED' | 'UNKNOWN'): void {
  process.stdout.write(`\r\n[GOLDEN_STUB_REPORT_${state}]\r\n`)
}

async function report(brief: string): Promise<void> {
  if (attempted) {
    return
  }
  attempted = true
  let dispatched = false
  try {
    const env = process.env
    const root = env.ORCA_USER_DATA_PATH
    const source = readRuntimeSourceStamp(env)
    if (
      !root ||
      !isAbsolute(root) ||
      realpathSync(root) !== root ||
      !source ||
      source.profilePath !== root ||
      env.HOME !== realpathSync(join(root, 'home'))
    ) {
      mark('REFUSED')
      return
    }
    const built = buildNativeStubCompletionReport({ brief, env })
    if (built.kind !== 'request') {
      mark('REFUSED')
      return
    }
    const metadata = readMetadata(root)
    const transport = findTransport(metadata, 'unix', 'named-pipe')
    const expected = createRuntimeTransportMetadata(
      root,
      metadata.pid,
      process.platform,
      source.incarnation
    )
    if (
      metadata.runtimeId !== source.incarnation ||
      !Number.isSafeInteger(metadata.pid) ||
      metadata.pid <= 0 ||
      transport?.kind !== expected.kind ||
      transport.endpoint !== expected.endpoint
    ) {
      mark('REFUSED')
      return
    }
    const response = await sendRequest(
      metadata,
      built.request.method,
      built.request.params,
      3_000,
      {
        orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
        orchestrationRequestId: randomUUID(),
        orchestrationCompatibilityEvidence: built.request.orchestrationCompatibilityEvidence
      },
      { sourceId: source.sourceId, runtimeId: source.incarnation },
      {
        requestSelection: {
          paramsForStatus: () => built.request.params,
          onDispatch: () => {
            dispatched = true
          }
        }
      }
    )
    mark(response.ok ? 'REPORTED' : 'REFUSED')
  } catch {
    // Never reveal credentials or retry a mutation whose acknowledgement was lost.
    mark(dispatched ? 'UNKNOWN' : 'REFUSED')
  }
}

startGoldenStubAgent((brief) => {
  void report(brief)
})
