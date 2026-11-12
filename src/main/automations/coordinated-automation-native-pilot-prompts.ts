import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { ResolvePromptFunction } from '../../shared/coordinated-automation-snapshot'
import type { NativeProviderPilotScope } from '../runtime/native-provider-execution-admission'

export function createNativePilotPromptResolver(
  scope: Pick<NativeProviderPilotScope, 'inputRoot' | 'workspacePath' | 'promptAuthority'>
): ResolvePromptFunction {
  const root = realpathSync(scope.inputRoot)
  return (source) => {
    if (source.authority !== scope.promptAuthority || !source.digest || isAbsolute(source.path)) {
      throw new Error('native_pilot_prompt_authority_mismatch')
    }
    const path = realpathSync(resolve(scope.workspacePath, source.path))
    const child = relative(root, path)
    if (
      !child ||
      child === '..' ||
      child.startsWith(`..${sep}`) ||
      isAbsolute(child) ||
      !statSync(path).isFile() ||
      statSync(path).size > 200_000
    ) {
      throw new Error('native_pilot_prompt_outside_input_root')
    }
    return { text: readFileSync(path, 'utf8') }
  }
}
