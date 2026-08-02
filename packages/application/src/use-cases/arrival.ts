import {
  classifyCapture,
  dirForType,
  titleFromSlug,
  type CaptureKind,
  type Frontmatter,
  type Note,
} from '@pm/domain';
import { ARRIVAL_AGENT_NAME } from '@pm/sessions';
import type { UseCaseContext, VaultPort } from '../ports.js';
import { ingestCapture, type IngestFollowUp } from './notes.js';
import { listSkills } from './skills.js';

/**
 * Arrival (docs/vision/arrival.md) — the one pipeline every piece of material
 * enters through, whatever the door: the Add material tray, a drop on the
 * window, a paste, and later a notetaker bot delivering recordings unattended.
 *
 * Three things make this different from calling `ingestCapture` in a loop:
 *
 * 1. **Ambition.** A batch of this morning's calls and a batch of last year's
 *    are the same files and completely different jobs. `capture` extracts;
 *    `catchup` files and runs nothing, because history has no live commitments
 *    and forty old transcripts firing After-Meeting is an unusable Inbox.
 * 2. **One ledger, one undo.** Everything an arrival wrote is recorded so the
 *    whole batch can be taken back in one action. The design trades a
 *    per-file approval gate for reversibility, so undo is load-bearing rather
 *    than a convenience.
 * 3. **One receipt.** The caller gets an aggregate of what landed and what
 *    runs, so fifty files produce one legible outcome instead of fifty.
 */

export type ArrivalAmbition = 'capture' | 'catchup';

/** A piece of material, already resolved to content by the entry point. */
export interface ArrivalItem {
  /** File name where there was one — it carries the classifier's best title hint. */
  name?: string;
  /** Text content: a transcript, a note, a link. Absent for images. */
  text?: string;
  /** Image bytes; presence makes this a screenshot. */
  data?: Uint8Array;
  /** ms epoch — the file's own date, used to tell history from today. */
  lastModified?: number;
  /** Per-item override from the tray; omit to let the classifier decide. */
  kind?: CaptureKind;
  /** Transcript only — a meeting the PO was not in. */
  external?: boolean;
  /** Transcript only — attach to this already-synced meeting note. */
  attachTo?: string;
}

export interface ArrivalPlanItem {
  name: string;
  kind: CaptureKind;
  /** Where it will land — `meetings/`, `sources/`, `notes/`. */
  dir: string;
  /** The classifier's title, shown so a bad guess is visible before it lands. */
  title: string;
  /** Its own date if we could establish one (YYYY-MM-DD), for the history read. */
  date?: string;
  /** Older than `HISTORICAL_DAYS` — what tips a batch into `catchup`. */
  historical: boolean;
  /** Set by the entry point when the file could not be read at all. */
  error?: string;
}

/** One piece of agent work the batch would start, named as a person names it. */
export interface ArrivalRun {
  /** Invocation name — the address the session is opened with. */
  skill: string;
  /** What a human calls it ("After-Meeting"). */
  title: string;
  /** How many items in this batch would hand off to it. */
  count: number;
  /** What it does to them, in the tray's voice ("reviews", "reads"). */
  verb: string;
}

export interface ArrivalPlan {
  ambition: ArrivalAmbition;
  /** True when nothing overrode the ambition, so the tray can say "auto". */
  ambitionAuto: boolean;
  items: ArrivalPlanItem[];
  /** Why `catchup` was chosen, in the tray's own words. Empty for `capture`. */
  reason: string;
  /**
   * The agent work this batch would start — resolved through the SAME binding
   * lookup that will dispatch it, so the tray names the actual skill rather
   * than a guess about it. Empty under `catchup`, which runs nothing.
   */
  runs: ArrivalRun[];
}

export interface ArrivalOutcomeItem {
  name: string;
  kind: CaptureKind;
  /** The note this became; absent when the item failed. */
  path?: string;
  dir?: string;
  title?: string;
  followUp?: IngestFollowUp;
  /** Present when this one item failed — the rest of the batch still landed. */
  error?: string;
}

export interface ArrivalResult {
  ambition: ArrivalAmbition;
  ambitionAuto: boolean;
  items: ArrivalOutcomeItem[];
  /** Every path the batch wrote, with the content that was there before it
   *  (null = the file did not exist). Reverse this to undo. */
  ledger: { path: string; before: string | null; binary: boolean }[];
}

/**
 * A batch of material older than this reads as history rather than as work in
 * flight. Three weeks is past the point where a commitment made on a call is
 * still actionable news — by then it has either happened or been forgotten,
 * and either way extracting it as a fresh todo is noise.
 */
export const HISTORICAL_DAYS = 21;

/** How many items make a drop feel like an archive rather than a hand-off. */
export const BATCH_THRESHOLD = 5;

const FILENAME_DATE = /(\d{4})-(\d{2})-(\d{2})/;

/**
 * The material's own date. A file name that carries one beats the filesystem's
 * mtime, which for a downloaded transcript is the day it was downloaded — a
 * fact about the user's browser, not about when the meeting happened.
 */
function itemDate(item: ArrivalItem): string | undefined {
  const fromName = item.name ? FILENAME_DATE.exec(item.name) : null;
  if (fromName) return `${fromName[1]}-${fromName[2]}-${fromName[3]}`;
  if (item.lastModified) return new Date(item.lastModified).toISOString().slice(0, 10);
  return undefined;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** What to call a filed note in the receipt — the same fallback chain the DTO uses. */
function noteTitle(note: Note): string {
  const fm = note.frontmatter as Record<string, unknown>;
  const title = typeof fm['title'] === 'string' ? fm['title'].trim() : '';
  const summary = typeof fm['summary'] === 'string' ? fm['summary'].trim() : '';
  return title || summary || titleFromSlug(note.slug);
}

/**
 * A file name is a title in disguise. The classifier hands back the base name
 * verbatim, which was fine when a dialog showed it as an editable placeholder —
 * the tray has no title field, so `nordkap-qbr-2026-07-28` would become the
 * note's own name. Slugs go back to words; anything already written like a
 * sentence is left exactly as the PO wrote it.
 */
function prettyTitle(raw: string): string {
  const t = raw.trim();
  if (!t || /\s/.test(t)) return t;
  return /[-_]/.test(t) ? titleFromSlug(t) : t;
}

function kindOf(item: ArrivalItem): CaptureKind {
  if (item.data) return 'screenshot';
  if (item.kind) return item.kind;
  return classifyCapture(item.text ?? '', item.name).kind;
}

/**
 * Which folder a kind lands in. Only a meeting the PO was in gets a derived
 * note of its own; everything else is raw. Nothing an arrival touches ever
 * reaches `notes/` — that layer means "the PO wrote this", and adding material
 * is not writing.
 */
function dirFor(kind: CaptureKind, external: boolean | undefined): string {
  if (kind === 'transcript' && !external) return `${dirForType('meeting')}/`;
  return `${dirForType('source')}/`;
}

/**
 * What will happen, computed by the same rules that will run — so the tray's
 * outcome line is the plan rather than a description of it.
 *
 * `catchup` is chosen when the batch is big enough to be an archive or old
 * enough to be history. Both are stated back to the PO with a one-click flip:
 * the guess has to be legible and correctable, never silent.
 */
export function planArrival(
  ctx: UseCaseContext,
  items: ArrivalItem[],
  override?: ArrivalAmbition,
): ArrivalPlan {
  const today = ctx.clock.now().slice(0, 10);
  const planned: ArrivalPlanItem[] = items.map((item) => {
    const kind = kindOf(item);
    const date = itemDate(item);
    const guess = classifyCapture(item.text ?? '', item.name);
    return {
      name: item.name ?? guess.title ?? 'untitled',
      kind,
      dir: dirFor(kind, item.external),
      title: prettyTitle(guess.title),
      ...(date ? { date } : {}),
      historical: !!date && daysBetween(date, today) > HISTORICAL_DAYS,
    };
  });

  const dated = planned.filter((p) => p.date);
  const allHistorical = dated.length > 0 && dated.every((p) => p.historical);
  const bulk = items.length >= BATCH_THRESHOLD;
  const auto: ArrivalAmbition = allHistorical || bulk ? 'catchup' : 'capture';
  const ambition = override ?? auto;
  const reason =
    ambition !== 'catchup'
      ? ''
      : allHistorical && bulk
        ? `${items.length} files, all older than ${HISTORICAL_DAYS} days`
        : allHistorical
          ? `older than ${HISTORICAL_DAYS} days`
          : `${items.length} files at once`;

  return { ambition, ambitionAuto: !override, items: planned, reason, runs: [] };
}

/**
 * Which sessions this plan would start, and over how many items.
 *
 * Mirrors `ingestCapture` exactly: every item fires the pipeline skill
 * (arrival), so the runs differ only in the VERB — what the pass does depends
 * on what the material is. The tray shows this as a control the PO can switch
 * off, so a guess here would be a lie about what the button is going to do.
 */
export async function resolveRuns(ctx: UseCaseContext, plan: ArrivalPlan): Promise<ArrivalRun[]> {
  if (plan.ambition === 'catchup') return [];

  // Every item reduces to one of three passes, so group by verb.
  const groups = new Map<string, { verb: string; count: number }>();
  for (const item of plan.items) {
    if (item.error) continue;
    const own = item.kind === 'transcript' && item.dir.startsWith('meetings');
    const verb = item.kind === 'transcript' ? (own ? 'reviews' : 'mines for signals') : 'connects';
    const existing = groups.get(verb);
    if (existing) existing.count++;
    else groups.set(verb, { verb, count: 1 });
  }
  if (groups.size === 0) return [];

  const title =
    (await listSkills(ctx)).find((s) => s.name === ARRIVAL_AGENT_NAME)?.title ?? ARRIVAL_AGENT_NAME;
  return [...groups.values()].map((g) => ({
    skill: ARRIVAL_AGENT_NAME,
    title,
    count: g.count,
    verb: g.verb,
  }));
}

/**
 * A VaultPort that records every write, snapshotting what was there first.
 *
 * This is how one arrival gets one undo without every capture use case having
 * to report the paths it touched. It sits between the arrival and the real
 * vault, so it cannot miss a write — including ones added later by code that
 * knows nothing about arrivals.
 */
function recordingVault(
  real: VaultPort,
  ledger: { path: string; before: string | null; binary: boolean }[],
): VaultPort {
  const seen = new Set<string>();
  const snapshot = async (path: string, binary: boolean): Promise<void> => {
    if (seen.has(path)) return;
    seen.add(path);
    // A binary's prior content is not text; it is only ever created here, so
    // "did not exist" is the only prior state undo has to restore.
    const before = binary ? null : await real.readRaw(path);
    ledger.push({ path, before, binary });
  };
  return {
    ...real,
    root: () => real.root(),
    ensureScaffold: () => real.ensureScaffold(),
    readNote: (p) => real.readNote(p),
    readRaw: (p) => real.readRaw(p),
    exists: (p) => real.exists(p),
    list: () => real.list(),
    listDir: (p) => real.listDir(p),
    contain: (p) => real.contain(p),
    remove: (p) => real.remove(p),
    async writeNote(path: string, frontmatter: Frontmatter, body: string): Promise<Note> {
      await snapshot(path, false);
      return real.writeNote(path, frontmatter, body);
    },
    async writeBody(path: string, body: string): Promise<Note> {
      await snapshot(path, false);
      return real.writeBody(path, body);
    },
    async writeRaw(path: string, content: string): Promise<void> {
      await snapshot(path, false);
      return real.writeRaw(path, content);
    },
    async writeBinary(path: string, data: Uint8Array): Promise<void> {
      await snapshot(path, true);
      return real.writeBinary(path, data);
    },
  };
}

export interface IngestArrivalInput {
  items: ArrivalItem[];
  /** Omit to take the planner's choice. */
  ambition?: ArrivalAmbition;
}

/**
 * File a whole batch. Every item lands even if its neighbours fail — a bad file
 * in a drop of fifty reports itself and costs nothing else.
 *
 * Items are filed one at a time rather than in parallel: `freePath` resolves
 * collisions by looking at the disk, so two same-titled transcripts racing each
 * other would both take the same path and one would win silently.
 */
export async function ingestArrival(
  ctx: UseCaseContext,
  input: IngestArrivalInput,
): Promise<ArrivalResult> {
  const plan = planArrival(ctx, input.items, input.ambition);
  const ledger: ArrivalResult['ledger'] = [];
  const recording: UseCaseContext = { ...ctx, vault: recordingVault(ctx.vault, ledger) };
  const items: ArrivalOutcomeItem[] = [];

  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i]!;
    const planned = plan.items[i]!;
    try {
      const result = await ingestCapture(recording, {
        ...(item.kind ? { kind: item.kind } : {}),
        text: item.text ?? '',
        ...(item.name ? { fileName: item.name } : {}),
        // The plan's title is what the tray showed; filing under a different
        // one would make the preview a lie.
        ...(planned.title ? { title: planned.title } : {}),
        ...(item.external ? { external: true } : {}),
        ...(item.attachTo ? { attachTo: item.attachTo } : {}),
        ...(item.data ? { attachment: { name: item.name ?? 'image.png', data: item.data } } : {}),
        // The whole ambition, expressed in one flag: catch-up files exactly as
        // capture does and runs nothing over it.
        process: plan.ambition === 'capture',
      });
      items.push({
        name: planned.name,
        kind: result.kind,
        path: result.note.path,
        dir: `${result.note.path.slice(0, result.note.path.indexOf('/') + 1)}`,
        title: noteTitle(result.note),
        ...(result.followUp ? { followUp: result.followUp } : {}),
      });
    } catch (err) {
      items.push({
        name: planned.name,
        kind: planned.kind,
        error: err instanceof Error ? err.message : 'could not be filed',
      });
    }
  }

  const wrote = ledger.map((l) => l.path);
  if (wrote.length > 0) {
    await ctx.git.commitPaths(
      wrote,
      `arrival: ${items.length} item${items.length === 1 ? '' : 's'}${plan.ambition === 'catchup' ? ' (catch-up)' : ''}`,
    );
  }

  return { ambition: plan.ambition, ambitionAuto: plan.ambitionAuto, items, ledger };
}

/**
 * Take a whole arrival back: created files are removed, modified ones are
 * restored byte-for-byte from the snapshot, newest write first so a file
 * written twice ends up at its true prior state.
 *
 * Returns the paths it restored, which is what the receipt reports. Errors on
 * individual paths are swallowed deliberately — a file the PO already deleted
 * by hand must not block the rest of the undo.
 */
export async function undoArrival(
  ctx: UseCaseContext,
  ledger: ArrivalResult['ledger'],
): Promise<{ removed: string[]; restored: string[] }> {
  const removed: string[] = [];
  const restored: string[] = [];
  for (const entry of [...ledger].reverse()) {
    try {
      if (entry.before === null) {
        if (await ctx.vault.exists(entry.path)) await ctx.vault.remove(entry.path);
        ctx.index.removeByPath(entry.path);
        removed.push(entry.path);
      } else {
        await ctx.vault.writeRaw(entry.path, entry.before);
        const note = await ctx.vault.readNote(entry.path);
        if (note) ctx.index.reindex(note);
        restored.push(entry.path);
      }
    } catch {
      /* a path the PO already moved or deleted; the rest of the undo still runs */
    }
  }
  const touched = [...removed, ...restored];
  if (touched.length > 0) {
    await ctx.git.commitPaths(touched, `undo arrival: ${touched.length} path(s)`);
  }
  return { removed, restored };
}
