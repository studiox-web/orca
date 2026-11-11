import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { runNativeStubBundle } from './native-stub-bundle-vm.test-support'

it('keeps the ordinary golden keyboard entry interactive without a reporting callback', () => {
  const dispatch = vi.fn()
  const entry = runNativeStubBundle({
    file: join(process.cwd(), 'tests/e2e/fixtures/golden-stub-agent/golden-stub-agent.js'),
    env: {},
    dispatch
  })
  expect(entry.output()).toContain('[GOLDEN_STUB_AGENT_READY]')
  entry.stdin.emit('data', 'first\x1b[13;')
  expect(entry.output()).not.toContain('[GOLDEN_STUB_AGENT_SUBMITTED]')
  entry.stdin.emit('data', '2u')
  entry.stdin.emit('data', 'second\r')
  expect(entry.output()).toContain('[GOLDEN_STUB_AGENT_SUBMITTED] first\nsecond')
  expect(entry.output()).not.toContain('GOLDEN_STUB_REPORT_')
  expect(dispatch).not.toHaveBeenCalled()
  entry.stdin.emit('data', 'exit\r')
  expect(entry.output()).toContain('[GOLDEN_STUB_AGENT_EXITED]')
})
