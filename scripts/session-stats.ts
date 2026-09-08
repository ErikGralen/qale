/**
 * Print what a pi session run cost: wall time, tokens, thinking, and the
 * residual (wall time minus the model's own time). Reads the newest session
 * file in a sessions folder, or one file given by path.
 *
 * The run recipe this is built for, so numbers compare across changes:
 *
 *   pnpm refresh-demo
 *   open the runtime demo vault (.vault-dev)
 *   drop a demo-samples/ transcript
 *   wait for the run to end
 *   pnpm session-stats
 *
 * `pnpm refresh-demo` deletes every session file in the demo dev sessions
 * folder before it rebuilds the vault. A run worth keeping has to be copied
 * out first, or the next refresh takes it with it.
 *
 * Usage:
 *   pnpm session-stats                       # newest file under the demo dev userData
 *   pnpm session-stats <sessions-folder>      # newest *.jsonl in that folder
 *   pnpm session-stats <file.jsonl>           # that file, directly
 *
 * No column for the maintenance tick: the app has no log file to read one
 * from. `apps/desktop/src/main/log.ts` says so directly. Console output goes
 * to stdout and a small in-memory ring buffer for "Copy diagnostics", never
 * to disk. Nothing here invents one; see docs/agent-speed.md AS-1.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import {
  loadSessionEntries,
  sessionStats,
  type SessionStats,
  type TurnStat,
} from '@qale/agent/session-stats';

/** The demo dev userData dir: `Qale Demo Dev` under the OS's app-data root,
 * the profile a demo-mode dev run writes its sessions to. Override with a
 * path argument for a different folder or a specific file. */
function defaultSessionsDir(): string {
  const appData =
    platform() === 'darwin'
      ? join(homedir(), 'Library', 'Application Support')
      : platform() === 'win32'
        ? (process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'))
        : (process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'));
  return join(appData, 'Qale Demo Dev', 'sessions');
}

/** The most recently modified `*.jsonl` in a folder: still growing for a run
 * in progress, freshest for a finished one. */
function newestSessionFile(dir: string): string | null {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(dir, f));
  if (files.length === 0) return null;
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return files[0]!;
}

function resolveTarget(arg: string | undefined): string {
  const target = arg ? arg : defaultSessionsDir();
  if (!existsSync(target)) {
    throw new Error(`Not found: ${target}`);
  }
  if (statSync(target).isFile()) return target;
  const newest = newestSessionFile(target);
  if (!newest) throw new Error(`No *.jsonl files in ${target}`);
  return newest;
}

function fmtSec(sec: number): string {
  return `${sec.toFixed(1)}s`;
}

function fmtPct(pct: number): string {
  return `${pct.toFixed(0)}%`;
}

function printTurnTable(title: string, turns: TurnStat[]): void {
  console.log(title);
  if (turns.length === 0) {
    console.log('  (none)');
    return;
  }
  for (const t of turns) {
    const tools = t.toolCalls.length > 0 ? t.toolCalls.join(', ') : '(no tool call)';
    console.log(
      `  #${t.turn}  ${fmtSec(t.durationSec).padStart(7)}  ` +
        `thinking ${String(t.thinkingTokens).padStart(5)}  ` +
        `output ${String(t.outputTokens).padStart(5)}  ` +
        `${t.tokensPerSec.toFixed(0).padStart(3)} tok/s  ${tools}`,
    );
  }
}

function printReport(filePath: string, stats: SessionStats): void {
  console.log(`Session file: ${filePath}`);
  if (stats.empty) {
    console.log('No message entries in this file. Nothing to report.');
    return;
  }

  console.log(`Wall time: ${fmtSec(stats.wallTimeSec)}`);
  console.log(`Model calls: ${stats.modelCalls}`);
  console.log(
    `Output tokens: ${stats.outputTokens} (thinking: ${stats.thinkingTokens}, ` +
      `${fmtPct(stats.thinkingPercent)} of output)`,
  );
  console.log(
    `Turn model time: ${fmtSec(stats.turnModelTimeSec)}  |  ` +
      `Residual: ${fmtSec(stats.residualSec)} (${fmtPct(stats.residualPercent)} of wall time)`,
  );
  console.log(
    `Setup, first user message to first model call: ` +
      `${stats.setupSec !== null ? fmtSec(stats.setupSec) : 'n/a'}`,
  );
  console.log('');

  console.log(
    `First propose_* call: ` +
      `${stats.firstProposalSec !== null ? fmtSec(stats.firstProposalSec) + ' from start' : 'none in this run'}`,
  );
  if (stats.timeAfterFirstProposalSec !== null) {
    console.log(`Time after the first proposal: ${fmtSec(stats.timeAfterFirstProposalSec)}`);
  }
  const kinds = Object.entries(stats.proposalCountsByKind);
  if (kinds.length > 0) {
    console.log('Proposals by kind:');
    for (const [kind, count] of kinds) console.log(`  ${kind}: ${count}`);
  }
  console.log('');

  console.log('ask_user calls:');
  if (stats.askUserParks.length === 0) {
    console.log('  (none: the run did not park on a question)');
  } else {
    for (const park of stats.askUserParks) {
      const when =
        park.gapSec !== null
          ? `answered after ${fmtSec(park.gapSec)}`
          : 'still parked as of this file (no answer yet)';
      console.log(`  ${park.timestamp}  ${when}`);
    }
  }
  console.log('');

  printTurnTable('Five slowest turns:', stats.slowestTurns);
}

function main(): void {
  const arg = process.argv[2];
  const filePath = resolveTarget(arg);
  const entries = loadSessionEntries(filePath);
  const stats = sessionStats(entries);
  printReport(filePath, stats);
}

main();
