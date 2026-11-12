import { isAbsolute, relative, sep } from 'node:path'

export const COORDINATED_CODEX_PERMISSION_PROFILE = 'orca-article-pilot'

const toolEnvironmentKeys = new Set([
  'PATH',
  'HOME',
  'CODEX_HOME',
  'TERM',
  'LANG',
  'ORCA_USER_DATA_PATH',
  'ORCA_TERMINAL_HANDLE',
  'ORCA_PANE_KEY',
  'ORCA_AGENT_LAUNCH_TOKEN',
  'ORCA_RUNTIME_SOURCE_ID',
  'ORCA_RUNTIME_SOURCE_INCARNATION',
  'ORCA_RUNTIME_SOURCE_PROFILE_PATH',
  'ORCA_CLI_COMMAND'
])

export function coordinatedNativeCodexConfig(input: {
  inputRoot: string
  outputRoot: string
  writableFiles: readonly string[]
  readOnlyPaths: readonly string[]
  runtimeDirectory: string
  workspacePath: string
  reportTool: { nodeBinary: string; helperFile: string; ticket: string }
  toolEnvironment: Readonly<Record<string, string>>
}): string {
  const quote = JSON.stringify
  if (Object.keys(input.toolEnvironment).some((key) => !toolEnvironmentKeys.has(key))) {
    throw new Error('coordinated_native_sandbox_tool_environment_unsupported')
  }
  for (const file of [...input.writableFiles, ...input.readOnlyPaths]) {
    const child = relative(input.outputRoot, file)
    if (
      !isAbsolute(file) ||
      !child ||
      child === '..' ||
      child.startsWith(`..${sep}`) ||
      isAbsolute(child)
    ) {
      throw new Error('coordinated_native_sandbox_write_outside_outputs')
    }
  }
  return [
    `default_permissions = ${quote(COORDINATED_CODEX_PERMISSION_PROFILE)}`,
    'approval_policy = "never"',
    'web_search = "disabled"',
    'cli_auth_credentials_store = "file"',
    'project_doc_max_bytes = 0',
    'check_for_update_on_startup = false',
    'file_opener = "none"',
    `[projects.${quote(input.workspacePath)}]`,
    'trust_level = "trusted"',
    '[mcp_servers.orca_assigned_report]',
    `command = ${quote(input.reportTool.nodeBinary)}`,
    `args = [${quote(input.reportTool.helperFile)}, ${quote(input.reportTool.ticket)}]`,
    `cwd = ${quote(input.workspacePath)}`,
    'enabled_tools = ["worker_done"]',
    'required = true',
    'startup_timeout_sec = 15',
    'tool_timeout_sec = 20',
    '[mcp_servers.orca_assigned_report.env]',
    'NODE_OPTIONS = ""',
    'NODE_PATH = ""',
    'ELECTRON_RUN_AS_NODE = "1"',
    '[shell_environment_policy]',
    'inherit = "none"',
    '[shell_environment_policy.set]',
    ...Object.entries(input.toolEnvironment).map(
      ([key, value]) => `${quote(key)} = ${quote(value)}`
    ),
    '[apps._default]',
    'enabled = false',
    '[features]',
    ...[
      'apps',
      'apps_early_resource_discovery',
      'browser_use',
      'browser_use_external',
      'browser_use_full_cdp_access',
      'computer_use',
      'hooks',
      'plugins',
      'remote_plugin',
      'plugin_discovery_prefetch',
      'plugin_sharing',
      'tool_suggest',
      'skill_search',
      'skill_mcp_dependency_install',
      'multi_agent',
      'multi_agent_v2',
      'goals',
      'memories',
      'shell_snapshot',
      'workspace_dependencies',
      'image_generation',
      'in_app_browser',
      'in_app_updates',
      'daemon_auto_start',
      'use_legacy_landlock',
      'request_permissions_tool',
      'guardian_approval',
      'system_proxy_fallback'
    ].map((feature) => `${feature} = false`),
    'skip_host_skill_discovery = true',
    `[permissions.${COORDINATED_CODEX_PERMISSION_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    `${quote(input.inputRoot)} = "read"`,
    `${quote(input.outputRoot)} = "write"`,
    ...input.readOnlyPaths.map((file) => `${quote(file)} = "read"`),
    `${quote(input.runtimeDirectory)} = "read"`,
    `[permissions.${COORDINATED_CODEX_PERMISSION_PROFILE}.network]`,
    'enabled = false',
    ''
  ].join('\n')
}
