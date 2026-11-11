import type { LocalPtyMockProcess } from '../providers/local-pty/local-pty-provider-test-harness'
import {
  NATIVE_STUB_READY_MARKER,
  NATIVE_STUB_SUBMITTED_MARKER
} from './native-stub-fixture-protocol'

/** How the controlled PTY plays the pinned stub: its real marker protocol, or a named failure. */
export type StubPtyBehavior = 'responsive' | 'never_ready' | 'never_submits'

const ESCAPE_TAIL = /^(?:\[[0-9;?]*[ -/]*[@-~]|O[@-~])/

/**
 * Drives a mocked node-pty process with the byte protocol of the pinned golden stub, mirroring
 * its input loop: escape sequences are consumed, CR or LF submits the composer, and each render
 * shows the READY marker plus the last non-empty submission. No physical process is started.
 * `onSubmission` receives everything the stub has been sent so far, the way its own stdin would.
 */
export function emulatePinnedStubOnPty(
  process: LocalPtyMockProcess,
  behavior: () => StubPtyBehavior,
  onSubmission?: (transcript: string) => void
): void {
  let composer = ''
  let lastSubmission = ''
  const received: string[] = []
  const emit = (data: string): void => {
    for (const [listener] of process.onData.mock.calls) {
      listener(data)
    }
  }
  const render = (): void => {
    emit(
      [
        '\x1b[H\x1b[2JGolden Stub Agent',
        NATIVE_STUB_READY_MARKER,
        '',
        `> ${composer}`,
        ...(lastSubmission ? [`${NATIVE_STUB_SUBMITTED_MARKER}${lastSubmission}`] : [])
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
    let pending = data
    let submitted = false
    while (pending.length > 0) {
      if (pending.startsWith('\x1b')) {
        const tail = ESCAPE_TAIL.exec(pending.slice(1))
        pending = pending.slice(1 + (tail?.[0].length ?? 0))
        continue
      }
      const char = pending[0]
      pending = pending.slice(1)
      if (char === '\r' || char === '\n') {
        if (behavior() !== 'responsive') {
          composer = ''
          continue
        }
        received.push(composer)
        lastSubmission = composer
        composer = ''
        submitted = true
      } else if (char >= ' ') {
        composer += char
      }
    }
    if (behavior() === 'never_ready') {
      return
    }
    render()
    if (submitted) {
      const transcript = received.join('\n')
      // The stub is its own process: whatever it does with its input happens off this call.
      setTimeout(() => onSubmission?.(transcript), 0)
    }
  })
}
