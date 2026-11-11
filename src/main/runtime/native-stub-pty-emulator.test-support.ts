import type { LocalPtyMockProcess } from '../providers/local-pty/local-pty-provider-test-harness'
import {
  NATIVE_STUB_READY_MARKER,
  NATIVE_STUB_SUBMITTED_MARKER
} from './native-stub-fixture-protocol'

/** How the controlled PTY plays the pinned stub: its real marker protocol, or a named failure. */
export type StubPtyBehavior = 'responsive' | 'never_ready' | 'never_submits'

/**
 * Drives a mocked node-pty process with the byte protocol of the pinned golden stub: one READY
 * render after spawn and one SUBMITTED render per Enter. No physical process is started.
 */
export function emulatePinnedStubOnPty(
  process: LocalPtyMockProcess,
  behavior: () => StubPtyBehavior
): void {
  let composer = ''
  const emit = (data: string): void => {
    for (const [listener] of process.onData.mock.calls) {
      listener(data)
    }
  }
  const render = (submission?: string): void => {
    emit(
      [
        '\x1b[H\x1b[2JGolden Stub Agent',
        NATIVE_STUB_READY_MARKER,
        '',
        `> ${composer}`,
        ...(submission === undefined ? [] : [`${NATIVE_STUB_SUBMITTED_MARKER}${submission}`])
      ].join('\r\n')
    )
  }
  // The provider attaches its data listener after spawn returns; render once it has.
  const firstRender = (): void => {
    if (behavior() === 'never_ready') {
      return
    }
    if (process.onData.mock.calls.length === 0) {
      setTimeout(firstRender, 1)
      return
    }
    render()
  }
  setTimeout(firstRender, 1)
  process.write.mockImplementation((data: string) => {
    let typed = false
    for (const char of data) {
      if (char !== '\r') {
        composer += char >= ' ' ? char : ''
        typed = true
        continue
      }
      const submission = composer
      composer = ''
      typed = false
      if (behavior() === 'responsive') {
        render(submission)
      }
    }
    // The stub redraws its composer after every keystroke it consumes.
    if (typed && behavior() !== 'never_ready') {
      render()
    }
  })
}
