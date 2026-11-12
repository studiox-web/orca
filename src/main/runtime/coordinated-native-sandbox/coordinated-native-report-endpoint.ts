import { randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { OrcaRuntimeService } from '../orca-runtime'
import type { PreparedNativeProviderLaunch } from '../native-provider-execution-admission'
import { UnixSocketTransport } from '../rpc/unix-socket-transport'
import type { RuntimeMetadata } from '../../../shared/runtime-bootstrap'
import {
  assertCoordinatedNativeReportCreation,
  type CoordinatedNativeReportIdentity
} from './coordinated-native-report-admission'
import { createCoordinatedNativeReportSession } from './coordinated-native-report-session'

export async function createCoordinatedNativeReportEndpoint(input: {
  runtime: OrcaRuntimeService
  directory: string
  identity: CoordinatedNativeReportIdentity
  pendingLaunch: PreparedNativeProviderLaunch
}) {
  if (process.platform !== 'linux' || !isAbsolute(input.directory)) {
    throw new Error('coordinated_native_report_platform_unsupported')
  }
  const identity = Object.freeze({ ...input.identity })
  assertCoordinatedNativeReportCreation(input.runtime, identity, input.pendingLaunch)
  const directory = mkdtempSync(join(realpathSync(input.directory), 'report-'))
  chmodSync(directory, 0o700)
  const endpoint = join(directory, 'rpc.sock')
  if (Buffer.byteLength(endpoint) > 100) {
    rmSync(directory, { recursive: true })
    throw new Error('coordinated_native_report_socket_path_too_long')
  }
  const token = randomBytes(32).toString('hex')
  const transport = new UnixSocketTransport({ endpoint, kind: 'unix' })
  const session = createCoordinatedNativeReportSession({
    runtime: input.runtime,
    identity,
    authToken: token,
    pendingLaunch: input.pendingLaunch
  })
  const { handle, assertCurrent, refuse } = session
  transport.onMessage((raw, reply) => {
    void handle(raw).then(
      (response) => reply(JSON.stringify(response)),
      () => reply(JSON.stringify(refuse('unknown', 'runtime_error')))
    )
  })
  try {
    await transport.start()
    assertCoordinatedNativeReportCreation(input.runtime, identity, input.pendingLaunch)
    const metadata: RuntimeMetadata = {
      runtimeId: identity.runtimeId,
      pid: process.pid,
      startedAt: input.runtime.getStartedAt(),
      transports: [{ kind: 'unix', endpoint }],
      authToken: token
    }
    writeFileSync(join(directory, 'orca-runtime.json'), JSON.stringify(metadata), {
      mode: 0o600,
      flag: 'wx'
    })
    writeFileSync(
      join(directory, 'report-ticket.json'),
      JSON.stringify({ endpoint, authToken: token, identity }),
      {
        mode: 0o600,
        flag: 'wx'
      }
    )
  } catch (error) {
    session.revoke()
    await transport.stop()
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  return Object.freeze({
    directory,
    endpoint,
    ticket: join(directory, 'report-ticket.json'),
    assertCurrent,
    async stop() {
      session.revoke()
      await transport.stop()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}
