# Required isolation and current evidence

Status: corrected real four-worker gate and retained-profile restart test passed; ordinary installed-app activation stays
unavailable (`runnable: false` in the preparation manifest). The coordinator has
launched a real provider through a hidden disposable developer app. Historical
package-worker checks and installed-runtime observations are not this evidence.

## Enforced contract required before a physical run

| Boundary         | Required enforcement                                                                                                                       | Evidence required from the execution host                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Input files      | Frozen package readable, not writable; exact manifest digest                                                                               | Reads succeed; mutation and symlink escape fail                                                  |
| Draft files      | Each declared cross-role artifact is read-only; a role writes its own artifacts and isolated output scratch                                | Per-child output policy and denied cross-role draft mutation                                     |
| Other filesystem | No live project, home, SSH agent/key, database, backup or unrelated workspace exposure                                                     | Negative probes using harmless sentinels, not secret reads                                       |
| Process          | Exact provider executable, fixed arguments and explicit model/effort; sanitized environment; no shell-profile inheritance or extra workers | Captured non-secret launch policy; denied override; verified process-tree termination            |
| Tool network     | No arbitrary HTTP, DNS, browser, hosted search, app connector, remote MCP or shell network                                                 | Tool inventory/config and denied harmless probes at each separate boundary                       |
| Provider backend | Only the approved model API transport and provider authentication                                                                          | Separate authority from agent tools; no provider credential material in prompts, outputs or logs |
| Native reporting | Current attempt can report only for its exact Run/Task/Dispatch; upstream evidence read is scoped to the same parent run                   | Forged/stale report and unrelated mutation refusals; authenticated report acknowledgement        |
| Recovery         | Inspect persisted identities and liveness before retry; no automatic replay of uncertain effects                                           | Restart converges without a second live writer or duplicate report acceptance                    |

`allowExternalMutation: false`, separate folders, an empty `extraAgentArgs`, fresh
HOME, and a sentence saying “do not publish” do not implement this table. Returning
a semantic receipt is not proof that the process could not touch production.

The baseline at `46d5882a055` has exact identity fences in
`src/main/runtime/native-provider-execution-admission.ts` and
`src/main/runtime/native-provider-launch-options.ts`, but no draft-only tool policy.
`nativeProviderStartupSettings` resets saved arguments/choices while retaining
ambient settings. `src/shared/agent-launch-profile.ts` can select permission
defaults from those settings; `src/shared/tui-agent-permissions.ts` includes Codex's
bypass argument. An identity admission must not be described as a filesystem or
credential sandbox. The sandbox worker owns the new enforcement integration.

Codex configuration distinguishes command sandbox networking, shell environment
inheritance and hosted web search; these are separate controls. This is documented
in the [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
That reference is not proof that any setting was applied by this Orca launch.

## Current enforcement and its limits

`coordinated-native-sandbox-policy.ts` issues a process-local opaque policy bound
to the exact native launch permit. At physical spawn, executable, helper, input,
configuration, arguments, environment and identity pins must still match. It
never accepts a serialized caller claim that a sandbox exists. Auth is copied
only into the private disposable provider home and removed on normal disposal;
command tools cannot read it. Original account/configuration files are unchanged.

`coordinated-native-codex-config.ts` configures the installed Codex command sandbox.
Ten harmless physical probes passed: input read, own output write, denial of input
mutation, cross-role write/delete/rename, unrelated file and credential-sentinel
reads, network access and direct connection to an inaccessible Unix endpoint.
This is command containment, not an outer OS sandbox around all provider code.
The authorized private MCP helper is a separate report-only control plane.

The tested Codex build rejects individual writable file roots at sandbox setup.
The supported policy makes the isolated output directory writable and mounts
all other declared role artifacts and prior revisions read-only. Scratch files
can be created inside outputs; only declared digest-bound artifacts count as
completion evidence. Do not claim an exact-file-only write sandbox. Network
restriction does not mean AF_UNIX socket creation itself is prohibited.

The developer entry pins Codex `gpt-6.1-sol` with medium effort for all four roles,
one active worker, at most two revision rounds, 600 seconds per stage and one
hour per run. The six-dollar estimated ceiling charges a host estimate of one
dollar per attempt; it is not measured usage or a cash billing cap. The same
explicit override must be used in the later comparison arm.

The physical path is Linux/local/unpackaged only. The current fixture registers
an ordinary non-Git directory as a Repo workspace. Creating this pilot under the
newer project-group-owned FolderWorkspace API failed `repo_not_found`; that
route is unverified and must not be advertised as supported. macOS, Windows,
remote execution and installed-profile activation remain outside this proof.
A narrow-width desktop renderer check uses an explicitly collapsed sidebar; it
does not establish mobile-device usability. The earlier expanded-sidebar capture
was unreadable and is retained as a limitation, not positive evidence.

Normal disposal closes the owned hidden app and revokes private reporting.
An interrupted pre-fix attempt's incomplete Dispatch audit is retained separately;
it is not treated as success or blindly resumed. The final successful test closed both owned launches. A process census found no
process using its exact profile; exported evidence was preserved and that
disposable profile was removed. This does not establish forced-crash recovery or
termination of a stuck provider.

## Scope of the reference copy

The six Goal snapshots preserve original prompts, models and operational examples
byte for byte. They are reference data, not runnable commands. SOUL, Jae's persona
(including its Lessons section), persona routing and writer/editor LESSONS are
also unchanged snapshots. Only these explicitly selected text files were copied.
No credentials, database, backup, live queue, owner feedback, STATUS, logs or
operational script was copied into worker input. The ordinary loop wrapper was
only read and hash-verified; it transfers production feedback before `--no-sync`
and also processes live rewrites, so it must never be used as a shadow runner.
