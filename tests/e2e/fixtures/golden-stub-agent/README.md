# Coordinated native report fixture

The ordinary `golden-stub-agent.js` entry retains the interactive keyboard fixture. The
host-admitted coordinated entry is `coordinated-report-entry.ts`, bundled with the existing
CLI metadata reader and RPC transport. It can attest only the `native-stub-brief-echo`
acceptance check. It receives its brief through stdin and its launch identity through the
isolated environment; it never places credentials in argv or output.

Build without launching the fixture:

```sh
node config/scripts/build-coordinated-native-stub.mjs
```

The build verifies the checked-in bundle and transitive-input digests before writing
`out-coordinated/native-stub/entry.cjs`. After reviewing an intentional source/dependency
change, regenerate the pin with `--write-pin` and review the pin diff. The isolated host
rechecks those bytes at composition and immediately before physical spawn. Tests build
in-process and evaluate the actual bundle with emulated stdin and an in-memory socket to
the native dispatcher; they do not start a stub binary, physical PTY, or provider.

The reporting entry requires the exact canonical admitted user-data root, isolated home,
and launch-bound runtime source/incarnation. Its socket probe and mutation both carry
`expectedRuntimeSource`; it never selects a default root or accepts a new incarnation.
A submitted brief produces at most one report request. A lost acknowledgement emits only
an unknown marker and never retries; the host retains its own durable report/custody truth.
