import {
  retiredEntryPath,
  runnableCandidates,
  runnableEntryPath,
  runnableForms,
  runnableNameFromPath,
  slugify,
} from '@qale/domain';
import {
  newSkillFile,
  parseRunnable,
  shippedHash,
  type DefaultSkill,
  type RetiredSkill,
} from '@qale/sessions';
import type { UseCaseContext } from '../ports.js';

/**
 * The starter pack over time — how a second build reaches a workspace the first
 * build already seeded.
 *
 * Three cases per shipped file, and the whole design is about telling the middle
 * one from the last:
 *
 * - **Absent**: seed it.
 * - **There, and nobody touched it**: bring it up to date without a word. No
 *   prompt, no badge. Getting this wrong in one direction nags people about
 *   changes they never made; in the other it overwrites their writing.
 * - **There, and they edited it**: never overwrite. Their file stays in force
 *   and the Skills page offers a review: keep mine, or take the new one.
 *
 * Which case a file is in is decided by its bytes alone (see `shipped-versions`
 * in @qale/sessions), so it survives the workspace being moved to another machine
 * and needs nothing stored. The one thing that IS stored is "I already said keep
 * mine for this version", because that is a decision, not a fact about the file.
 * It lives in this machine's ledger; losing it costs one extra prompt.
 */

/** What the seed did. Every field is paths, so a caller can log or commit them. */
export interface SkillPackSeed {
  /** Files that were not there at all. */
  seeded: string[];
  /** Untouched files quietly brought up to date. */
  updated: string[];
  /** Untouched retired files taken away. */
  removed: string[];
  /** Retired files the PM had edited, moved out of force with their words intact. */
  retired: string[];
}

/** A shipped file the PM edited, where what we ship has since changed. */
export interface SkillUpdateOffer {
  /** The shipped path. Also the key the "keep mine" decision is stored under. */
  file: string;
  /** What their copy calls itself, so the row names what they see in the list. */
  title: string;
  /** Their file as it stands. */
  yours: string;
  /** What we ship now. */
  ours: string;
}

/** A retired file the PM had edited, now out of force and kept beside its folder. */
export interface RetiredSkillNotice {
  file: string;
  title: string;
  /** Where their copy went. */
  keptAt: string;
}

export interface SkillPackReview {
  updates: SkillUpdateOffer[];
  retired: RetiredSkillNotice[];
}

/** "I looked at this version and I am keeping mine." */
const keepKey = (file: string): string => `skill-pack-keep:${file}`;
/** "I have been told this one stopped running." */
const toldKey = (file: string): string => `skill-pack-retired:${file}`;

/** Is this file byte-for-byte a version we shipped, so nobody has touched it? */
function isOurs(entry: { shipped: string[] }, raw: string): boolean {
  return entry.shipped.includes(shippedHash(raw));
}

/** Whichever layout a workspace is on, the same runnable counts as present. */
async function present(ctx: UseCaseContext, file: string): Promise<string | null> {
  for (const form of runnableForms(file)) if (await ctx.vault.exists(form)) return form;
  return null;
}

/** `skills/ask.md` and `skills/ask/SKILL.md` both answer to dir `skills`, name `ask`. */
function address(file: string): { dir: string; name: string } {
  return { dir: file.split('/')[0] ?? 'skills', name: runnableNameFromPath(file) ?? '' };
}

/** The first path in the `x`, `x-2`, `x-3` … series that is free. */
async function freePath(ctx: UseCaseContext, base: string): Promise<string> {
  if (!(await ctx.vault.exists(base))) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = base.replace(/\.md$/, `-${n}.md`);
    if (!(await ctx.vault.exists(candidate))) return candidate;
  }
  return base.replace(/\.md$/, `-${Date.now()}.md`);
}

/**
 * Take a retired file out of force without destroying it. A rename inside its
 * own folder is enough: the new basename is not an entry file, so nothing
 * indexes it, lists it or resolves an invocation to it, and every word the PM
 * wrote is still exactly where they left it. Deleting instead would be the app
 * throwing away writing it did not author.
 */
async function retireSkillFile(ctx: UseCaseContext, form: string, raw: string): Promise<string> {
  const { dir, name } = address(form);
  const target = await freePath(ctx, retiredEntryPath(dir, name));
  await ctx.vault.writeRaw(target, raw);
  await ctx.vault.remove(form);
  ctx.index.removeByPath(form);
  return target;
}

/**
 * Seed and update the built-in pack (PLAN-V2 §3.2). Content is passed in so the
 * application layer stays free of the sessions package's own registries.
 *
 * `retired` is the files the pack no longer ships. They cannot simply be left
 * alone: a retired file keeps whatever behaviour it declares, so one left in
 * place means a dropped transcript fires both it and the skill that replaced it.
 */
export async function ensureDefaultSkills(
  ctx: UseCaseContext,
  skills: DefaultSkill[],
  retired: RetiredSkill[] = [],
): Promise<SkillPackSeed> {
  const out: SkillPackSeed = { seeded: [], updated: [], removed: [], retired: [] };
  const committed: string[] = [];

  for (const skill of skills) {
    // Both layouts, not just the folder one: a workspace whose migration has not
    // run yet holds the PM's edits under the flat name, and seeding a pristine
    // copy beside it would shadow their file with ours.
    const form = await present(ctx, skill.file);
    if (!form) {
      await ctx.vault.writeRaw(skill.file, skill.content);
      const note = await ctx.vault.readNote(skill.file);
      if (note) ctx.index.reindex(note);
      committed.push(skill.file);
      out.seeded.push(skill.file);
      continue;
    }
    const raw = (await ctx.vault.readRaw(form)) ?? '';
    if (shippedHash(raw) === shippedHash(skill.content)) continue;
    // Not ours any more: leave it exactly as it is. `reviewSkillPack` offers it.
    if (!isOurs(skill, raw)) continue;
    // Written back where it already lives, so an unmigrated workspace does not
    // end up with our copy in the folder layout and theirs beside it.
    await ctx.vault.writeRaw(form, skill.content);
    const note = await ctx.vault.readNote(form);
    if (note) ctx.index.reindex(note);
    committed.push(form);
    out.updated.push(form);
  }

  for (const gone of retired) {
    // Every form, for the same reason in reverse: a retired file that migrated
    // into a folder is still retired, and must not keep firing because its path
    // changed.
    for (const form of runnableForms(gone.file)) {
      if (!(await ctx.vault.exists(form))) continue;
      const raw = (await ctx.vault.readRaw(form)) ?? '';
      if (isOurs(gone, raw)) {
        await ctx.vault.remove(form);
        ctx.index.removeByPath(form);
        committed.push(form);
        out.removed.push(form);
        continue;
      }
      const keptAt = await retireSkillFile(ctx, form, raw);
      committed.push(form, keptAt);
      out.retired.push(gone.file);
    }
  }

  if (committed.length > 0) await ctx.git.commitPaths(committed, 'skills: update the starter pack');
  return out;
}

/**
 * What is waiting for the PM on the Skills page: files they edited that we have
 * since changed, and retired files of theirs we moved out of force. Computed
 * from disk every time rather than remembered, so it can never claim a change
 * to a file they have already brought into line by hand.
 */
export async function reviewSkillPack(
  ctx: UseCaseContext,
  skills: DefaultSkill[],
  retired: RetiredSkill[] = [],
): Promise<SkillPackReview> {
  const review: SkillPackReview = { updates: [], retired: [] };

  for (const skill of skills) {
    const form = await present(ctx, skill.file);
    if (!form) continue;
    const raw = (await ctx.vault.readRaw(form)) ?? '';
    // Already current, or untouched (the seed brings those up to date itself).
    if (shippedHash(raw) === shippedHash(skill.content)) continue;
    if (isOurs(skill, raw)) continue;
    if (ctx.checks?.get(keepKey(skill.file)) === shippedHash(skill.content)) continue;
    review.updates.push({
      file: skill.file,
      title: parseRunnable(raw, address(skill.file).name).title,
      yours: raw,
      ours: skill.content,
    });
  }

  for (const gone of retired) {
    if (ctx.checks?.get(toldKey(gone.file))) continue;
    const { dir, name } = address(gone.file);
    const keptAt = retiredEntryPath(dir, name);
    const raw = await ctx.vault.readRaw(keptAt);
    if (raw === null) continue;
    review.retired.push({ file: gone.file, title: parseRunnable(raw, name).title, keptAt });
  }

  return review;
}

/** Take the new version of one shipped file, replacing what is there. */
export async function applyShippedSkill(
  ctx: UseCaseContext,
  skills: DefaultSkill[],
  file: string,
): Promise<boolean> {
  const skill = skills.find((s) => s.file === file);
  if (!skill) return false;
  const form = (await present(ctx, file)) ?? file;
  await ctx.vault.writeRaw(form, skill.content);
  const note = await ctx.vault.readNote(form);
  if (note) ctx.index.reindex(note);
  await ctx.git.commitPaths([form], 'skills: take the new version');
  return true;
}

/**
 * Put a notice away. For an edited file that is "keep mine": stored against the
 * version we are shipping right now, so the next time we change that file the
 * offer comes back once, and only once. For a retired file it is "I have read
 * this", which never comes back.
 */
export function dismissSkillNotice(
  ctx: UseCaseContext,
  skills: DefaultSkill[],
  file: string,
): void {
  const skill = skills.find((s) => s.file === file);
  const now = Date.now();
  if (skill) ctx.checks?.set(keepKey(file), shippedHash(skill.content), now);
  else ctx.checks?.set(toldKey(file), 'told', now);
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
