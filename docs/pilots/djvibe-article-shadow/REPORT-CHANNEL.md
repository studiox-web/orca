# Authorized report-only provider tool

Status: the scoped adapter, stdio MCP helper, private endpoint, clean provider
configuration and authenticated physical launch policy are implemented. The hidden
isolated four-worker test and retained-profile restart passed at the human review
gate; no final approval was submitted. Graham authorized this connection and lifted the earlier
testing restriction. No ordinary installed profile has been enabled.

The command sandbox retains `network.enabled = false`. Its earlier direct Unix
socket probe was denied before connection. Graham subsequently stated:
“ok please remove my previous boundary that was put in place that prevented you
from testing or doing your work . i think im makeing things harder for yo with
that.” This supersedes the earlier stop-without-an-alternative testing restriction
and approves the private result-only connection below. Continue implementation,
isolated testing, and the previously authorized merge/push after passing checks;
no additional approval is required for this connection. Publishing, existing
schedules, backups and production content remain outside the pilot.

## Implemented authority

Configure one private, host-pinned MCP stdio helper for each isolated Codex
attempt. It exposes only `worker_done`. Its arguments are `requestId`, `subject`,
`body` and the worker-authored native JSON `payload`; it has no method, recipient,
path, endpoint, command, account or identity selector. The payload must name the
same Task and Dispatch. It is forwarded unchanged to native
`orchestration.send`; the coordinator does not author a successful result.

The host supplies the frozen Run/Task/Dispatch, runtime/source, terminal/pane,
launch token and endpoint credential. Native verification still checks the
current process incarnation and consumer generation. The helper can reach only
the private report endpoint and cannot access general Orca RPC. Command tools
cannot read its credential or use its endpoint. Its executable, dependencies,
configuration and environment must be pinned before the final physical spawn.
No user/global MCP configuration is edited.

One call may be in flight. Inputs and wire bytes are bounded. A lost response is
uncertain; the adapter does not retry automatically. An explicit reconciliation
must reuse the exact request ID and unchanged body/payload, allowing the existing
native durable receipt to answer. A changed request under the same ID is refused.
Every request revalidates the consumed native launch permit, including admission,
sandbox policy, current host activity, owner, deadline and exact run/attempt binding,
at ingress and immediately before the native handler. Stop, authority revocation,
owner/generation change and restart refuse the channel. Completion also ends this
write authority. After revocation or completion, reconcile any already committed
receipt through the coordinator's read-only native inspection; do not revive the
old endpoint merely to obtain an acknowledgment. Exact replay while authority is
current uses the existing native receipt. Late acknowledgments cannot become fresh
success evidence. Technical settlement remains distinct from
editorial acceptance, human gates and publication approval.

The helper is outside Codex's command sandbox, as MCP tools have a
separate permission plane. This is why authorization matters even though the
interface is narrower than ordinary Orca CLI access. See the official
[Codex permissions guide](https://learn.chatgpt.com/docs/permissions.md) and
[MCP stdio transport specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports).

## Source and evidence

- [Tool adapter](../../../src/main/runtime/coordinated-native-sandbox/coordinated-native-report-tool.ts): strict arguments, frozen authority, bounded delivery, no automatic retries.
- [Shared native report session](../../../src/main/runtime/coordinated-native-sandbox/coordinated-native-report-session.ts): existing native dispatcher, compatibility authority and receipt handling reused by the original endpoint.
- [Adapter tests](../../../src/main/runtime/coordinated-native-sandbox/coordinated-native-report-tool.test.ts): foreign authority, unknown tools, malformed/oversized data, lost acknowledgment, changed runtime, concurrency and revocation.
- [Native fixture integration](../../../src/main/runtime/coordinated-native-sandbox/coordinated-native-report-endpoint.test.ts): actual Store/orchestration/native settlement and replay, with a controlled PTY. No real model, credentials, provider process or production state.

Current verification includes the physical Node helper handshake and native
fixture settlement/replay; 72 tests across nine focused suites and the backend
typecheck passed with exit 0. Changed-code quality passed across 104 source files before the final report-contract clarifications.
The actual installed Codex sandbox passed ten harmless input/output/network
probes. These checks are separate from the complete real-provider article run.

Physical startup exposed two integration faults: repeated executable hashing
blocked the app event loop, and disabling Codex's internal code-mode host also
disabled the permitted command and report tools. Executables now retain their
initial digest plus immutable stat signature; changing a pinned executable still
refuses launch. The pilot retains the code-mode host, while command permissions,
external tools and the sole configured report MCP retain their scoped policies.

## Remaining acceptance

The corrected synthetic native article run, held-gate restart and independent
source review passed. Complete final repository checks before the authorized XOS
merge/push. A successful test at the human gate
is not a submitted approval or final publication receipt. No publishing, existing
schedules, production content or backups change.
