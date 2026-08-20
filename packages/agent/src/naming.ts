import { languageName } from '@qale/domain';

/**
 * What a conversation calls itself.
 *
 * A session's name is read far more often than the session is: it is the tab,
 * the row in Sessions, the line in the rail, the thing an OS notification says
 * came back. Until now it was the first sixty characters of whatever was said
 * first, which for a typed question is a sentence cut mid-word and for a
 * machine-composed kickoff is a path.
 *
 * So the first message gets one small completion on the cheapest model the
 * workspace can reach, and the answer becomes the name. Three things keep that
 * honest:
 *
 * 1. **It is best-effort.** The heuristic name is set first and shown
 *    immediately; the model's answer replaces it a second later or never. No
 *    turn waits on this, and nothing breaks without a key.
 * 2. **What comes back is display text, not an instruction.** The first message
 *    can be material the PM never read (a kickoff over a dropped transcript), so
 *    the reply is cleaned to one short line before it is allowed anywhere near
 *    the UI ({@link cleanTitle}) and is never fed back to an agent.
 * 3. **Cheap means priced, not guessed.** {@link cheapestModel} ranks what pi
 *    says is actually available by what it costs, so this follows the catalogue
 *    instead of hardcoding a model id that a release will quietly retire.
 */

/** Enough of a pi model to price it. */
export interface PricedModel {
  id: string;
  cost?: { input?: number; output?: number };
}

/**
 * The cheapest model the workspace can actually reach, by input plus output
 * price. A model whose price the catalogue does not state is skipped rather
 * than treated as free: an unknown price is not a cheap one. Everything unknown
 * returns undefined, and the caller falls back to the model the session runs
 * on — a named session on an expensive model beats an unnamed one.
 */
export function cheapestModel<T extends PricedModel>(models: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestPrice = Infinity;
  for (const model of models) {
    const { input, output } = model.cost ?? {};
    if (typeof input !== 'number' || typeof output !== 'number') continue;
    const price = input + output;
    if (!Number.isFinite(price) || price >= bestPrice) continue;
    best = model;
    bestPrice = price;
  }
  return best;
}

/**
 * What a session is about, in the only words available before anything has run:
 * what was said into it, and — when the app composed that opening rather than a
 * person typing it — the skill it was pointed at and the pages it was given.
 */
export interface SessionSubject {
  /** The first message, as typed. Absent for a kickoff, which is machine prose. */
  prompt?: string;
  /** The skill this run was started with, in the PM's own words (its title). */
  skill?: string;
  /** The pages the run was pointed at, by title. */
  targets?: string[];
}

/**
 * The naming rules. Deliberately strict about the shape of the reply: this is
 * one call with no retry, so anything the model adds around the name is
 * something {@link cleanTitle} has to guess its way out of.
 */
export function namingSystemPrompt(language?: string): string {
  const inLanguage =
    language && language !== 'en'
      ? `Write the name in ${languageName(language)}, keeping names of people, products and pages spelled as they are.\n`
      : '';
  return (
    "You name conversations in a product manager's workspace, from the first thing said in one.\n" +
    'Reply with ONLY the name. No quotes, no final period, no preamble, no explanation.\n' +
    'Two to five words, sentence case, in the words the person used.\n' +
    inLanguage +
    'Name the thing itself, not the shape of it: "Nordkap SSO renewal", not "Customer question".\n' +
    'Keep the names of people, products, customers and pages exactly as they are spelled.'
  );
}

/** The one user message: the subject, in the plainest form we have it. */
export function namingUserPrompt(subject: SessionSubject): string {
  const parts: string[] = [];
  if (subject.skill) parts.push(`This run was started with the "${subject.skill}" skill.`);
  const targets = subject.targets?.filter(Boolean) ?? [];
  if (targets.length) parts.push(`It was pointed at: ${targets.join(', ')}.`);
  // Truncated, not summarised: the first paragraph of a long message carries
  // what it is about, and a title has never needed page four.
  const prompt = subject.prompt?.replace(/\s+/g, ' ').trim().slice(0, 1500);
  if (prompt) parts.push(`First message:\n${prompt}`);
  return parts.join('\n\n');
}

/**
 * One clean line out of whatever came back, or null to keep the name we had.
 *
 * Null is the ordinary outcome for anything unexpected — an apology, a
 * paragraph, an empty reply. The name is not worth a second call and a bad name
 * is worse than a plain one, so "did not answer the question" and "answered
 * badly" get the same treatment.
 */
export function cleanTitle(raw: string): string | null {
  const line = raw.split('\n').find((l) => l.trim()) ?? '';
  const title = line
    .replace(/^\s*(?:title|name)\s*[:\-–]\s*/i, '')
    // Markdown emphasis anywhere, not just at the ends: a model that bolds half
    // the name leaves the asterisks in the middle of it.
    .replace(/[*`#]/g, '')
    .replace(/^[\s"']+/, '')
    .replace(/[\s"'.,!?;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A sentence is not a name. Truncating one would keep the tab readable and
  // the row wrong, so a long answer loses to the first message it was made from.
  if (title.length < 2 || title.length > 60) return null;
  return title;
}
