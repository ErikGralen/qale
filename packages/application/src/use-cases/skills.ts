import {
  parseRunnable,
  describeStarts,
  type Capability,
  type Runnable,
  type Start,
} from '@pm/sessions';
import { isRunnableEntry, runnableEntryPath, runnableNameFromPath } from '@pm/domain';
import type { UseCaseContext } from '../ports.js';

/**
 * Skills + Agents — the read layer behind both views. They are the same kind of
 * file (see `@pm/sessions/runnable`): free-text instructions, a `starts` list
 * saying what puts them in force, and a `can` list saying what they may do. The
 * folder is filing — `skills/` is what you reach for, `agents/` is what reaches
 * for itself — so one parser serves both and neither view branches on a type.
 *
 * WHEN a self-starting agent fires is not in the file at all: those clocks live
 * in code beside the sweep that runs them, and main merges them onto the row.
 *
 * Each one is a FOLDER (`skills/spec-review/SKILL.md`), and the files beside the
 * entry are the skill's own material: not indexed, not listed here as skills of
 * their own, read only when the instructions name one. {@link migrateRunnableFolders}
 * moves a flat vault into that shape; until it has, both layouts resolve.
 */

/** A parsed runnable as either view's row sees it. */
export interface RunnableSummary {
  path: string;
  slug: string;
  /** The invocation name — the bare filename, what `use_skill` resolves. */
  name: string;
  /** What a human calls it; never a path. */
  title: string;
  summary: string;
  /** What puts it in force, as the file declares it. */
  starts: Start[];
  /** What it may do beyond reading and proposing cards. */
  can: Capability[];
  /** `always` only — the audience the rule is scoped to. */
  audience?: string;
  /** The off switch, from frontmatter. */
  enabled: boolean;
  /** Plain-language sentence: how this file applies. */
  sentence: string;
  errors: string[];
  mtime: number;
  /**
   * The material beside the entry file, as vault paths. Names only: the point of
   * the folder is that these are NOT loaded with the skill, so nothing here ever
   * carries content.
   */
  files: string[];
  /** Epoch ms this runnable was last in force in a session; null if never. */
  lastUsedMs: number | null;
  /**
   * Epoch ms of the last scheduled run that had nothing to report (QM ticket 2);
   * null if that has never happened. Only meaningful against
   * {@link lastUsedMs} / an agent's last run: it says the LAST run was silent
   * only while it is the newer of the two.
   */
  lastQuietMs: number | null;
  /**
   * Epoch ms of the last scheduled run that stopped because it needed a decision
   * and nobody was there to make it (QM ticket 9); null if that has never
   * happened. Read against {@link lastUsedMs} the same way {@link lastQuietMs}
   * is: it speaks for the LAST run only while it is the newer of the two.
   */
  lastStoppedMs: number | null;
}

/**
 * Where "last used" is kept: the app's own durable ledger, not the vault. When a
 * skill last ran is a fact about this machine's use of the workspace, not
 * something the workspace states about itself, and a git diff per session would
 * be noise in a folder whose whole content is authored prose.
 */
const usedKey = (name: string): string => `runnable-used:${name}`;

/**
 * Where a run that left NOTHING is recorded (QM ticket 2). A scheduled run with
 * nothing to report writes no receipt, no row and no badge, so this stamp is the
 * only trace it leaves, and the agent's own page is the one place it shows: "Ran
 * 2 days ago, nothing to report". Same ledger as `usedKey`, written with the
 * same timestamp, so the two can be compared to tell whether the LAST run was
 * the quiet one.
 */
const quietKey = (name: string): string => `runnable-quiet:${name}`;

/**
 * Where a run that stopped for want of a decision is recorded (QM ticket 9). An
 * unattended run must not park a question nobody can answer, so it stops instead
 * — and stopping silently would be the same disappearance by another route. Same
 * ledger, same timestamp rule as {@link quietKey}, and the two are mutually
 * exclusive per run: this one is written when there is a reason to name, the
 * quiet one when there was simply nothing to say.
 */
const stoppedKey = (name: string): string => `runnable-stopped:${name}`;

/** Stamp a runnable as used now. Called once per settled turn, per name in force. */
export function markRunnableUsed(ctx: UseCaseContext, name: string, at = Date.now()): void {
  ctx.checks?.set(usedKey(name), String(at), at);
}

/** Stamp a run that finished with nothing to report. The primary runnable only. */
export function markRunnableQuiet(ctx: UseCaseContext, name: string, at = Date.now()): void {
  ctx.checks?.set(quietKey(name), String(at), at);
}

/** Stamp a run that stopped because it needed the PM and the PM was not there. */
export function markRunnableStopped(ctx: UseCaseContext, name: string, at = Date.now()): void {
  ctx.checks?.set(stoppedKey(name), String(at), at);
}

function stamp(ctx: UseCaseContext, key: string): number | null {
  const raw = ctx.checks?.get(key);
  const ms = raw ? Number(raw) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Parse under the BARE filename, not the vault slug: the name a file is parsed
 * with is the name callers invoke it by, and the runtime resolves it under its
 * folder. Handing it "skills/synthesis" made every UI pick resolve to
 * `skills/skills/synthesis.md` — a silent no-op.
 */
const bareName = (slug: string): string => slug.split('/').pop() ?? slug;

/** Every file of one note type, parsed for its view. */
async function listRunnables(ctx: UseCaseContext, type: 'skill' | 'agent'): Promise<RunnableSummary[]> {
  const out: RunnableSummary[] = [];
  for (const n of ctx.index.all().filter((x) => x.type === type)) {
    const raw = (await ctx.vault.readRaw(n.path)) ?? '';
    const config: Runnable = parseRunnable(raw, bareName(n.slug));
    // Only the folder layout can carry material; a legacy flat file has nowhere
    // to put any. Listed, never read: the page shows what is there.
    const files = isRunnableEntry(n.path)
      ? (await ctx.vault.listDir(n.path.slice(0, n.path.lastIndexOf('/')))).filter((f) => f !== n.path)
      : [];
    out.push({
      path: n.path,
      slug: n.slug,
      name: config.name,
      title: config.title,
      summary: config.summary,
      starts: config.starts,
      can: config.can,
      ...(config.audience ? { audience: config.audience } : {}),
      enabled: config.enabled,
      sentence: describeStarts(config),
      errors: config.errors,
      mtime: n.mtime,
      files,
      lastUsedMs: stamp(ctx, usedKey(config.name)),
      lastQuietMs: stamp(ctx, quietKey(config.name)),
      lastStoppedMs: stamp(ctx, stoppedKey(config.name)),
    });
  }
  return out;
}

/** Every skill file, parsed for the Skills view. */
export function listSkills(ctx: UseCaseContext): Promise<RunnableSummary[]> {
  return listRunnables(ctx, 'skill');
}

/** Every agent file, parsed for the Agents view. */
export function listAgentFiles(ctx: UseCaseContext): Promise<RunnableSummary[]> {
  return listRunnables(ctx, 'agent');
}

/**
 * Move a flat vault into the folder layout: `skills/synthesis.md` becomes
 * `skills/synthesis/SKILL.md`, `agents/librarian.md` becomes
 * `agents/librarian/AGENT.md`. Every skill in a workspace is somebody's writing,
 * so this MOVES bytes and never rewrites them: the content is read raw and
 * written raw, frontmatter untouched, not a note round-trip that would reformat
 * whatever the parser doesn't model.
 *
 * Safe to run repeatedly, and safe to interrupt. Write-then-remove means a crash
 * between the two leaves both files, where the folder form already wins (see
 * `runnableCandidates`); the next run finds the pair, sees identical bytes, and
 * finishes the move. If the bytes DIFFER — someone edited the flat file after a
 * half-migration — both are left alone and the path is returned as `left`.
 * Guessing which one the PM meant is the one thing worse than doing nothing.
 */
export async function migrateRunnableFolders(
  ctx: UseCaseContext,
): Promise<{ moved: string[]; left: string[] }> {
  const moved: string[] = [];
  const left: string[] = [];
  for (const file of await ctx.vault.list()) {
    const name = runnableNameFromPath(file.path);
    // Already a folder entry (or not a runnable at all): nothing to move.
    if (!name || isRunnableEntry(file.path)) continue;
    const dir = file.path.split('/')[0] ?? '';
    const target = runnableEntryPath(dir, name);
    const raw = await ctx.vault.readRaw(file.path);
    if (raw === null) continue;
    const existing = await ctx.vault.readRaw(target);
    if (existing !== null && existing !== raw) {
      left.push(file.path);
      continue;
    }
    if (existing === null) await ctx.vault.writeRaw(target, raw);
    await ctx.vault.remove(file.path);
    ctx.index.removeByPath(file.path);
    const note = await ctx.vault.readNote(target);
    if (note) ctx.index.reindex(note);
    moved.push(file.path, target);
  }
  if (moved.length > 0) await ctx.git.commitPaths(moved, 'skills: one folder per skill');
  return { moved, left };
}

/**
 * The `enabled` switch on the file(s) a name resolves to, read as a FLOOR: off
 * means the runnable does not run, on any path, whatever else would grant it
 * (the layering rule is written out on `Capability` in @pm/sessions). Main's
 * `fireSession` asks this once for every session a trigger starts, so a new
 * trigger cannot forget; the sweeps ask again before they begin, because they
 * do judgment work before firing anything and off has to mean that work never
 * happens either.
 *
 * Every file of either kind under the name has a veto, rather than the resolver
 * order picking one: `skills/x` shadows `agents/x` when a session is started
 * (in either layout), but the Agents view writes the switch into the agent file,
 * and a floor that depends on getting that order right is not a floor.
 *
 * A name with no file reads as ON. The seed restores shipped files on next open,
 * and a sweep that silently died because a file was renamed would be a lie the
 * view can't show.
 */
export async function runnableEnabled(ctx: UseCaseContext, name: string): Promise<boolean> {
  const files = ctx.index
    .all()
    .filter((x) => (x.type === 'agent' || x.type === 'skill') && bareName(x.slug) === name);
  for (const f of files) {
    const raw = (await ctx.vault.readRaw(f.path)) ?? '';
    if (!parseRunnable(raw, name).enabled) return false;
  }
  return true;
}
