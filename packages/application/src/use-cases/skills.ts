import {
  parseRunnable,
  newSkillFile,
  newVoiceFile,
  type Capability,
  type DefaultSkill,
  type Runnable,
} from '@qale/sessions';
import {
  isRunnableEntry,
  isVoicePath,
  runnableCandidates,
  runnableEntryPath,
  runnableForms,
  runnableNameFromPath,
  slugify,
  voicePath,
} from '@qale/domain';
import type { UseCaseContext } from '../ports.js';

/**
 * Skills + Agents — the read layer behind both views. They are the same kind of
 * file (see `@qale/sessions/runnable`): free-text instructions plus a `can` list
 * saying what they may do. The folder is filing — `skills/` is what you reach
 * for, `agents/` is what reaches for itself — so one parser serves both and
 * neither view branches on a type.
 *
 * WHAT puts either one in force is not in the file at all: a skill is work you
 * hand over, and an agent's clocks live in code beside the sweep that runs them,
 * which main merges onto the row.
 *
 * Each one is a FOLDER (`skills/spec-review/SKILL.md`), and the files beside the
 * entry are the skill's own material: not indexed, not listed here as skills of
 * their own, read only when the instructions name one. {@link migrateRunnableFolders}
 * moves a flat vault into that shape; until it has, both layouts resolve.
 */

/**
 * Which of the three files this row is. The note type cannot say it: a voice is
 * filed as a skill note (one type for every instruction file the PM edits), and
 * what makes it a voice is the folder it sits in. Rows carry the answer so no
 * consumer has to re-derive it from the path — the picker offers skills only,
 * and the Skills page lists voices apart from them (SK-6; SK-12 gives them a
 * tab of their own).
 */
export type RunnableKind = 'skill' | 'voice' | 'agent';

/** A parsed runnable as either view's row sees it. */
export interface RunnableSummary {
  path: string;
  slug: string;
  kind: RunnableKind;
  /** The invocation name — the bare filename, what `use_skill` resolves. */
  name: string;
  /** What a human calls it; never a path. */
  title: string;
  summary: string;
  /** What it may do beyond reading and proposing cards. */
  can: Capability[];
  /** The off switch, from frontmatter. Agents only; a skill reads as on. */
  enabled: boolean;
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
async function listRunnables(
  ctx: UseCaseContext,
  type: 'skill' | 'agent',
): Promise<RunnableSummary[]> {
  const out: RunnableSummary[] = [];
  for (const n of ctx.index.all().filter((x) => x.type === type)) {
    const raw = (await ctx.vault.readRaw(n.path)) ?? '';
    const config: Runnable = parseRunnable(raw, bareName(n.slug));
    // Only the folder layout can carry material; a legacy flat file has nowhere
    // to put any. Listed, never read: the page shows what is there.
    const files = isRunnableEntry(n.path)
      ? (await ctx.vault.listDir(n.path.slice(0, n.path.lastIndexOf('/')))).filter(
          (f) => f !== n.path,
        )
      : [];
    out.push({
      path: n.path,
      slug: n.slug,
      kind: type === 'agent' ? 'agent' : isVoicePath(n.path) ? 'voice' : 'skill',
      name: config.name,
      title: config.title,
      summary: config.summary,
      can: config.can,
      enabled: config.enabled,
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

/**
 * Every skill file AND every voice, parsed for the Skills view — one read, each
 * row saying which it is. They come back together because they are the same
 * kind of file to the vault (a skill note the PM edits) and because the view
 * shows both; a caller that wants only one filters on {@link RunnableSummary.kind}.
 */
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
 * The `enabled` switch on the agent file a name resolves to, read as a FLOOR:
 * off means the agent does not run, on any path, whatever else would grant it
 * (the layering rule is written out on `Capability` in @qale/sessions). Main's
 * `fireSession` asks this once for every session a trigger starts, so a new
 * trigger cannot forget; the sweeps ask again before they begin, because they
 * do judgment work before firing anything and off has to mean that work never
 * happens either.
 *
 * AGENTS ONLY (SK-2). An agent starts itself, so it needs a way to be told not
 * to; a skill runs when you ask for it, and deleting it is how you stop asking.
 * A skill file that still carries `enabled: false` says nothing, and its page
 * flags the key.
 *
 * A name with no file reads as ON. The seed restores shipped files on next open,
 * and a sweep that silently died because a file was renamed would be a lie the
 * view can't show.
 */
export async function runnableEnabled(ctx: UseCaseContext, name: string): Promise<boolean> {
  const files = ctx.index.all().filter((x) => x.type === 'agent' && bareName(x.slug) === name);
  for (const f of files) {
    const raw = (await ctx.vault.readRaw(f.path)) ?? '';
    if (!parseRunnable(raw, name).enabled) return false;
  }
  return true;
}

/** Whichever layout a workspace is on, the same runnable counts as present. */
async function present(ctx: UseCaseContext, file: string): Promise<boolean> {
  for (const form of runnableForms(file)) if (await ctx.vault.exists(form)) return true;
  return false;
}

/**
 * Write the starter pack into a workspace that does not have it yet: the skill
 * files, the agent files, and the notes the pack seeds into the memory (SK-5).
 * One rule for all three, because "already there is the PM's" does not change
 * with the folder.
 *
 * Seeding only. A file that is already there is left exactly as it is, whatever
 * we ship today: once a workspace holds a skill, that skill is the PM's. There
 * is no upgrade path and nothing compares a file to a version we shipped. When
 * we want to offer a newer text, an agent will propose it as a card like any
 * other change.
 *
 * Both layouts count as present, not just the folder one: a workspace whose
 * migration has not run yet holds the PM's edits under the flat name, and
 * seeding a pristine copy beside it would shadow their file with ours.
 */
export async function ensureDefaultSkills(
  ctx: UseCaseContext,
  skills: DefaultSkill[],
): Promise<string[]> {
  const seeded: string[] = [];
  for (const skill of skills) {
    if (await present(ctx, skill.file)) continue;
    await ctx.vault.writeRaw(skill.file, skill.content);
    const note = await ctx.vault.readNote(skill.file);
    if (note) ctx.index.reindex(note);
    seeded.push(skill.file);
  }
  if (seeded.length > 0) await ctx.git.commitPaths(seeded, 'workspace: seed the starter pack');
  return seeded;
}

/**
 * The basename a retired skill's entry file is moved to. Not an entry basename,
 * so nothing indexes it, nothing lists it and nothing resolves it: the file is
 * out of force the moment it is renamed, and every word in it is still there.
 */
const RETIRED_ENTRY = 'RETIRED-SKILL.md';

/**
 * Take out of force what the pack used to seed and does not seed any more
 * (`RETIRED_SKILLS`). A workspace opened before the change still holds the file,
 * and a skill nobody maintains sitting in the picker is worse than one fewer
 * entry there.
 *
 * The file is RENAMED, never deleted. Nothing here can tell an untouched copy
 * from one the PM rewrote (the fingerprint ledger went with the shipped-versions
 * machinery, SK-1), and deleting somebody's writing on a guess is the one thing
 * worse than leaving an inert file in its folder. The PM can delete the folder;
 * the app does not.
 *
 * The name still resolves. Every retired skill has an alias in
 * `DEFAULT_SKILL_BY_NAME` pointing at whatever does the work now, so an old
 * receipt or a stale picker entry opens the merged skill instead of nothing.
 *
 * Safe to run repeatedly: after the first pass there is no entry file left to
 * find. Both layouts are checked, so a vault that never migrated is caught too.
 */
export async function retireDefaultSkills(ctx: UseCaseContext, files: string[]): Promise<string[]> {
  const touched: string[] = [];
  for (const file of files) {
    const folder = file.slice(0, file.lastIndexOf('/'));
    const target = `${folder}/${RETIRED_ENTRY}`;
    for (const form of runnableForms(file)) {
      const raw = await ctx.vault.readRaw(form);
      if (raw === null) continue;
      if (!(await ctx.vault.exists(target))) await ctx.vault.writeRaw(target, raw);
      await ctx.vault.remove(form);
      ctx.index.removeByPath(form);
      touched.push(form, target);
      // One form is the truth: `migrateRunnableFolders` runs first and leaves at
      // most one entry file per skill.
      break;
    }
  }
  if (touched.length > 0)
    await ctx.git.commitPaths(touched, 'skills: retire what the pack no longer ships');
  return touched;
}

export interface CreatedSkill {
  path: string;
  /** The invocation name, which is the folder name and never changes after this. */
  name: string;
}

/**
 * Write a new skill and hand back where it landed, so the caller can open it.
 *
 * The name is taken from the title HERE and never again: a skill's folder is the
 * address the runtime resolves and every stored session receipt cites, so the
 * page that edits it deliberately cannot rename it. That is why the PM names it
 * up front instead of getting an "Untitled skill" to rename later, which is the
 * pattern a plain note follows: a note's filename is disposable, and this one is
 * not.
 */
export async function createSkill(ctx: UseCaseContext, title: string): Promise<CreatedSkill> {
  const clean = title.trim() || 'New skill';
  const base = slugify(clean) || 'new-skill';
  let name = base;
  // A name already in use anywhere it could resolve from gets a number, rather
  // than either failing or landing on top of somebody's file.
  for (let n = 2; n < 100; n++) {
    const taken = await Promise.all(runnableCandidates(name).map((p) => ctx.vault.exists(p)));
    if (!taken.some(Boolean)) break;
    name = `${base}-${n}`;
  }
  const path = runnableEntryPath('skills', name);
  await ctx.vault.writeRaw(path, newSkillFile(clean));
  const note = await ctx.vault.readNote(path);
  if (note) ctx.index.reindex(note);
  await ctx.git.commitPaths([path], `skills: add ${name}`);
  return { path, name };
}

/**
 * Write a new voice and hand back where it landed (SK-13). The twin of
 * {@link createSkill}, and deliberately its own function rather than a flag on
 * it: a voice is a flat file in `voices/`, not a folder in `skills/`, and the
 * two address spaces are separate on purpose (see `VOICES_DIR` in @qale/domain)
 * so a voice can never be invoked as a skill.
 *
 * The name is taken from the title once, for the same reason: the drafting
 * tools resolve a voice by its filename, so renaming it later would break every
 * draft that names it.
 */
export async function createVoice(ctx: UseCaseContext, title: string): Promise<CreatedSkill> {
  const clean = title.trim() || 'New voice';
  const base = slugify(clean) || 'new-voice';
  let name = base;
  for (let n = 2; n < 100; n++) {
    if (!(await ctx.vault.exists(voicePath(name)))) break;
    name = `${base}-${n}`;
  }
  const path = voicePath(name);
  await ctx.vault.writeRaw(path, newVoiceFile(clean));
  const note = await ctx.vault.readNote(path);
  if (note) ctx.index.reindex(note);
  await ctx.git.commitPaths([path], `voices: add ${name}`);
  return { path, name };
}
