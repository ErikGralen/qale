import { isVoicePath, voicePath } from '@qale/domain';
import { parseRunnable } from '@qale/sessions';
import type { UseCaseContext } from '@qale/application';

/**
 * Voices (SK-6) — how a draft SOUNDS, and nothing else.
 *
 * A voice file is register, sentence length, word choice and the phrases to
 * keep out. It never decides what a draft says: the same week's facts go to the
 * exec team and to CS for different reasons, and the skill that drafts is the
 * one that knows which. A voice that also selected content would quietly
 * rewrite every skill that used it, which is the trap the audience concept fell
 * into (see docs/skills-rethink.md R4-3, R5-3).
 *
 * The files live in `voices/`, which is deliberately not a runnable folder:
 * nothing can invoke a voice, and a voice named like a skill cannot shadow it.
 * They reach the model at ONE moment, drafting, through the tools below.
 */

export interface Voice {
  /** The invocation name, which is the filename: `voices/exec.md` → `exec`. */
  name: string;
  /** What a person calls it ("Exec voice"), from frontmatter `title`. */
  title: string;
  /**
   * One line, shown in the drafting tools' descriptions so the model can
   * choose, and under the title everywhere a person picks a voice.
   *
   * It says WHO reads a draft in this voice before it says how the voice
   * sounds, because choosing is the job it does. "Warm, plain, exact about
   * dates" describes the cs voice perfectly and still leaves an update for a
   * customer looking like it belongs to no voice at all.
   */
  summary: string;
  /** The brief itself, verbatim. */
  body: string;
  path: string;
}

/** `voices/exec.md` → `exec`. */
function nameOf(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '');
}

function toVoice(raw: string, path: string): Voice | null {
  const name = nameOf(path);
  const parsed = parseRunnable(raw, name);
  const body = parsed.body.trim();
  if (!body) return null;
  return { name, title: parsed.title, summary: parsed.summary, body, path };
}

/**
 * Every voice the workspace holds, by name. Read off the index, so a voice the
 * PM wrote this morning is in the roster this afternoon without a restart.
 * Empty is an ordinary answer: a workspace with no voices drafts plain.
 */
export async function listVoices(ctx: UseCaseContext): Promise<Voice[]> {
  const out: Voice[] = [];
  for (const n of ctx.index.all()) {
    if (!isVoicePath(n.path)) continue;
    const raw = await ctx.vault.readRaw(n.path);
    if (!raw) continue;
    const voice = toVoice(raw, n.path);
    if (voice) out.push(voice);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The voice a name asks for, or null. Null is not an error and never a reason
 * to stop: a draft with no voice is a plain draft, which is what the app did
 * before voices existed. What must never happen is a made-up voice, so nothing
 * here falls back to "something close".
 *
 * The file is tried first, by path, so a voice resolves even in a workspace
 * whose index has not caught up. The roster is the second pass, which is what
 * lets a model say "Exec voice" or "voices/exec" and still land on the file.
 */
export async function resolveVoice(ctx: UseCaseContext, name: string): Promise<Voice | null> {
  const wanted = name
    .trim()
    .toLowerCase()
    .replace(/^voices\//, '')
    .replace(/\.md$/, '');
  if (!wanted) return null;
  // A name with a slash in it is not a filename; the roster pass can still
  // match it, but this read must not be allowed to walk out of `voices/`.
  if (!wanted.includes('/')) {
    const raw = await ctx.vault.readRaw(voicePath(wanted));
    if (raw) {
      const voice = toVoice(raw, voicePath(wanted));
      if (voice) return voice;
    }
  }
  const roster = await listVoices(ctx);
  return (
    roster.find((v) => v.name.toLowerCase() === wanted) ??
    roster.find((v) => v.title.toLowerCase() === wanted) ??
    null
  );
}

/**
 * The roster as one sentence for a tool description: the names the model may
 * pass, each with the line the PM wrote about it. Says so plainly when there
 * are none, because "leave `voice` out" is the instruction then, and a
 * description that lists nothing reads as a description that forgot to.
 *
 * This sentence is the whole of how a voice gets chosen, which is why the
 * summary convention is "who reads it, then how it sounds" (see
 * {@link Voice.summary}). Nothing forces a voice onto a draft: a workspace
 * writes for readers it has no voice for, and a jingle has no reader at all.
 * What the model needs is enough to see that a customer mail is the cs voice's
 * job, and it can only see that if the roster says who each one is for.
 */
export function voiceRoster(voices: Voice[]): string {
  if (voices.length === 0) {
    return 'This workspace has no voices, so leave `voice` out and write plainly.';
  }
  const list = voices.map((v) => `"${v.name}" (${v.summary})`).join(', ');
  return (
    `Voices in this workspace: ${list}. ` +
    'Prefer the one written for whoever reads this draft, and use its name exactly. ' +
    'If none of them is for that reader, leave `voice` out and write plainly. Never invent a voice.'
  );
}

/**
 * The brief as the model receives it, at the one moment it applies. The framing
 * line is the whole guardrail: a brief read as reference material becomes
 * something the model weighs, and a brief read as governing becomes how the
 * text is written.
 */
export function voiceBrief(voice: Voice): string {
  return [
    `## Voice in force: ${voice.name} — ${voice.title}`,
    'Write every draft in this voice from here on. It governs tone, register and wording. It does not',
    "govern what the draft says: what goes in is the skill's call, and this brief may not add a fact,",
    'drop one, or change what is promised.',
    '',
    voice.body,
  ].join('\n');
}
