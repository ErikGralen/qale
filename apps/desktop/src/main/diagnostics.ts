import { app } from 'electron';
import { arch, platform, release } from 'node:os';
import pkg from '../../package.json';
import { recentLog } from './log.js';

/**
 * The plain-text block behind "Copy diagnostics". Its whole job is to be
 * technical, so it is the one place in the product that names versions and
 * flags. What it must never carry is the PM's own material: no workspace path
 * or name, no note titles, no addresses, no tokens, no site URLs. Everything
 * below is a count, a boolean or a version, and the log tail is scrubbed on the
 * way into the ring buffer (see log.ts).
 */

/** How many log lines ride along. */
const LOG_TAIL = 50;

/**
 * The app's version, never Electron's. `app.getVersion()` reads the packaged
 * metadata and is the right answer in a shipped build, but when it cannot find
 * that it hands back Electron's own version instead, which in a bug report
 * would be a lie. The bundled package.json is the fallback and the tie-break.
 */
export function appVersion(): string {
  const reported = app.getVersion();
  return reported && reported !== process.versions.electron ? reported : pkg.version;
}

/** What only the handlers can answer. Booleans and counts by design. */
export interface DiagnosticsFacts {
  workspace: { noteCount: number; git: boolean; gitAvailable: boolean; synced: boolean } | null;
  keychainAvailable: boolean;
  secretsUnreadable: boolean;
  hasApiKey: boolean;
  modelId: string;
  /** Provider labels only. A site URL or account address would identify them. */
  connectors: { label: string; health: string }[];
  mcp: { enabled: boolean; running: boolean; port: number };
  /**
   * The telemetry distinct id (docs/telemetry-posthog.md TEL-4). A minted uuid
   * and nothing else, so it passes the bar above — and it is what turns a
   * pasted bug report into a pointer at its own event stream.
   */
  installId: string;
}

function osName(): string {
  // Electron knows the marketing version ("15.6.1", "10.0.22631"); os.release()
  // only knows the kernel, which tells us much less on macOS.
  const version = process.getSystemVersion?.() ?? release();
  const label = platform() === 'darwin' ? 'macOS' : platform() === 'win32' ? 'Windows' : platform();
  return `${label} ${version} (${arch()})`;
}

function row(label: string, value: string): string {
  return `${label.padEnd(16)}${value}`;
}

export function buildDiagnostics(facts: DiagnosticsFacts): string {
  const { lines, total } = recentLog(LOG_TAIL);
  const ws = facts.workspace;

  const body = [
    row('App', `${appVersion()} (${app.isPackaged ? 'installed' : 'dev run'})`),
    row('Install', facts.installId),
    row('System', osName()),
    row('Electron', process.versions.electron),
    row('Chrome', process.versions.chrome),
    row('Node', process.versions.node),
    '',
    row(
      'Workspace',
      ws
        ? `open, ${ws.noteCount} notes, git repo ${ws.git ? 'yes' : 'no'}${
            ws.gitAvailable ? '' : ', git not installed'
          }${ws.synced ? ', inside a synced folder' : ''}`
        : 'none open',
    ),
    row('Keychain', facts.keychainAvailable ? 'available' : 'unavailable (keys only obfuscated)'),
    row('Stored keys', facts.secretsUnreadable ? 'FAILED to decrypt' : 'readable'),
    row('API key', facts.hasApiKey ? 'set' : 'not set'),
    row('Model', facts.modelId),
    row(
      'Connectors',
      facts.connectors.length
        ? facts.connectors.map((c) => `${c.label} (${c.health})`).join(', ')
        : 'none',
    ),
    row(
      'MCP server',
      facts.mcp.enabled ? `on, port ${facts.mcp.port}, ${facts.mcp.running ? 'running' : 'not running'}` : 'off',
    ),
    '',
    `Log (last ${lines.length} of ${total} lines, paths and addresses removed)`,
    ...(lines.length ? lines.map((l) => `  ${l}`) : ['  (nothing logged yet)']),
  ];

  return [`Diagnostics ${new Date().toISOString()}`, '', ...body, ''].join('\n');
}
