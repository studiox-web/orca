import { getLocalPtyProvider } from '../../ipc/pty/provider/registry'
import { LocalPtyProvider } from '../../providers/local-pty/local-pty-provider'
import { bindNativeStubSessionTestComposition } from '../native-stub-session-test-host'
import { bindNativeProviderExecutionAdmission } from '../native-provider-execution-admission'
import type { RuntimeConstructionDependencies } from './runtime-construction-dependencies'

export function bindRuntimeNativeExecutionAdmissions(
  deps: RuntimeConstructionDependencies | undefined,
  input: Omit<Parameters<typeof bindNativeStubSessionTestComposition>[1], 'readInProcessProvider'>
): void {
  const binding = {
    ...input,
    readInProcessProvider: () => {
      const provider = getLocalPtyProvider()
      if (Object.getPrototypeOf(provider) !== LocalPtyProvider.prototype) {
        throw new Error('native_stub_in_process_provider_required')
      }
      return provider
    }
  }
  bindNativeStubSessionTestComposition(deps?.nativeStubSessionTest, binding)
  bindNativeProviderExecutionAdmission(deps?.coordinatedNativeProviderExecution, binding)
}
