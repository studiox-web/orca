import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import * as os from 'node:os'
import { Script } from 'node:vm'
import type { RpcRequest, RpcResponse } from './rpc/core'

/** Runs the admitted entry in this process; its only socket is an in-memory RPC wire. */
export function runNativeStubBundle(input: {
  file: string
  env: Record<string, string>
  output?: (bytes: string) => void
  dispatch(request: RpcRequest): Promise<RpcResponse | null>
}) {
  const stdin = Object.assign(new EventEmitter(), { setEncoding() {}, resume() {}, isTTY: false })
  let output = ''
  const stdout = Object.assign(new EventEmitter(), {
    isTTY: false,
    write(bytes: string, callback?: () => void) {
      output += bytes
      input.output?.(bytes)
      callback?.()
    }
  })
  const requests: RpcRequest[] = []
  const process = Object.assign(new EventEmitter(), {
    env: input.env,
    platform: globalThis.process.platform,
    argv: ['node', input.file],
    stdin,
    stdout,
    stderr: {
      write: () => {
        throw new Error('Unexpected fixture stderr')
      }
    },
    exit: () => {}
  })
  const net = {
    createConnection() {
      const socket = Object.assign(new EventEmitter(), {
        setEncoding() {},
        end() {},
        destroy() {},
        write(bytes: string) {
          const request: RpcRequest = JSON.parse(bytes)
          requests.push(request)
          void input.dispatch(request).then((response) => {
            if (response) {
              socket.emit('data', `${JSON.stringify(response)}\n`)
            } else {
              socket.emit('close')
            }
          })
        }
      })
      queueMicrotask(() => socket.emit('connect'))
      return socket
    }
  }
  const modules: Record<string, unknown> = {
    'node:fs': fs,
    'node:path': path,
    'node:crypto': crypto,
    'node:os': os,
    'node:net': net
  }
  const module = { exports: {} }
  new Script(fs.readFileSync(input.file, 'utf8'), {
    filename: 'admitted-stub-bundle'
  }).runInNewContext({
    process,
    module,
    exports: module.exports,
    require: Object.assign(
      (name: string) => {
        if (!(name in modules)) {
          throw new Error('Unexpected bundle dependency')
        }
        return modules[name]
      },
      { main: module }
    ),
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Buffer,
    TextEncoder,
    TextDecoder
  })
  return { stdin, requests, output: () => output }
}
