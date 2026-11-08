import { describe, expect, it } from 'vitest'
import { xosOwnsHeadlessSchedules } from './xos-scheduler-owner'

describe('XOS local scheduler ownership', () => {
  it('keeps serve ownership and leaves ordinary desktops as remote mirrors', () => {
    expect(xosOwnsHeadlessSchedules(true, {}, 'linux')).toBe(true)
    expect(xosOwnsHeadlessSchedules(false, {}, 'linux')).toBe(false)
  })

  it('requires explicit Linux local-owner opt-in', () => {
    expect(xosOwnsHeadlessSchedules(false, { ORCA_XOS_LOCAL_SCHEDULER: '1' }, 'linux')).toBe(true)
    expect(xosOwnsHeadlessSchedules(false, { ORCA_XOS_LOCAL_SCHEDULER: '0' }, 'linux')).toBe(false)
    expect(xosOwnsHeadlessSchedules(false, { ORCA_XOS_LOCAL_SCHEDULER: '1' }, 'darwin')).toBe(false)
  })
})
