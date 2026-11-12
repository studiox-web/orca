import { connect } from 'node:net'
import { RuntimeRpcEnvelopeSchema } from '../../../shared/runtime-rpc-envelope'
import { createIncrementalNdjsonFramer } from '../../../shared/main-process-ndjson-framer'
import type { RpcRequest, RpcResponse } from '../rpc/core'

export function exchangeCoordinatedNativeReport(
  endpoint: string,
  request: RpcRequest
): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint)
    let settled = false
    const deadline = setTimeout(() => finish(), 15_000)
    const finish = (response?: RpcResponse) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(deadline)
      socket.destroy()
      if (response) {
        resolve(response)
      } else {
        reject(new Error('coordinated_native_report_delivery_uncertain'))
      }
    }
    const framer = createIncrementalNdjsonFramer(
      (record) => {
        const parsed = RuntimeRpcEnvelopeSchema.safeParse(record)
        if (!parsed.success) {
          finish()
        } else if ('ok' in parsed.data) {
          const runtimeId = parsed.data._meta?.runtimeId
          if (!runtimeId) {
            finish()
          } else {
            finish({ ...parsed.data, _meta: { runtimeId } })
          }
        }
      },
      () => finish(),
      { maxLineBytes: 1024 * 1024 }
    )
    socket.setEncoding('utf8')
    socket.setTimeout(15_000, () => finish())
    socket.once('error', () => finish())
    socket.once('close', () => finish())
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', (chunk) => framer.feed(String(chunk)))
  })
}
