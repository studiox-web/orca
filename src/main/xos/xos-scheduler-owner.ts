/** Only the explicitly launched XOS local owner may service the headless profile's schedules. */
export function xosOwnsHeadlessSchedules(
  isServeMode: boolean,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  return isServeMode || (platform === 'linux' && env.ORCA_XOS_LOCAL_SCHEDULER === '1')
}
