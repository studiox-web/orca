import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { createIncrementalNdjsonFramer } from '../../../shared/main-process-ndjson-framer'
import { ProviderStdioWriteQueue } from '../../provider-process/provider-stdio-write-queue'
import { exchangeCoordinatedNativeReport } from './coordinated-native-report-client'
import { createCoordinatedNativeReportMcp } from './coordinated-native-report-mcp'
import { createCoordinatedNativeReportTool } from './coordinated-native-report-tool'

const Ticket = z
  .object({
    endpoint: z.string().min(1),
    authToken: z.string().min(32),
    identity: z
      .object({
        runtimeId: z.string().min(1),
        sourceId: z.string().min(1),
        runId: z.string().min(1),
        taskId: z.string().min(1),
        dispatchId: z.string().min(1),
        terminalHandle: z.string().min(1),
        paneKey: z.string().min(1),
        launchToken: z.string().min(1),
        consumerGeneration: z.number().int().positive()
      })
      .strict()
  })
  .strict()
const path = process.argv[2]
if (
  process.platform !== 'linux' ||
  process.argv.length !== 3 ||
  !path ||
  !isAbsolute(path) ||
  realpathSync(path) !== path
) {
  throw new Error('coordinated_native_report_ticket_required')
}
const stat = lstatSync(path)
if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8192 || (stat.mode & 0o077) !== 0) {
  throw new Error('coordinated_native_report_ticket_refused')
}
const ticket = Ticket.parse(JSON.parse(readFileSync(path, 'utf8')))
if (!isAbsolute(ticket.endpoint)) {
  throw new Error('coordinated_native_report_endpoint_refused')
}
const server = createCoordinatedNativeReportMcp(
  createCoordinatedNativeReportTool({
    ...ticket,
    exchange: (request) => exchangeCoordinatedNativeReport(ticket.endpoint, request)
  })
)
const fail = () => {
  server.close()
  process.exitCode = 1
  process.stdin.destroy()
  process.stdout.destroy()
}
const writer = new ProviderStdioWriteQueue(process.stdout, 2 * 1024 * 1024, fail, {
  capacity: () => new Error('report_output_limit'),
  closed: () => new Error('report_output_closed')
})
const framer = createIncrementalNdjsonFramer(
  (record) => {
    void server
      .handle(record)
      .then(async (response) => {
        if (response) {
          await writer.write(`${JSON.stringify(response)}\n`)
        }
      })
      .catch(fail)
  },
  fail,
  { maxLineBytes: 1024 * 1024 }
)
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => framer.feed(String(chunk)))
process.stdin.on('error', fail)
process.stdout.on('error', fail)
process.stdin.once('end', () => server.close())
