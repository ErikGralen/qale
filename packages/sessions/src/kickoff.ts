/**
 * Kickoff prompts — how a button in the app invokes a skill on a page.
 *
 * These first messages are composed by the app, not typed by the PM ("Run the
 * arrival skill on sources/…: read the capture, search the memory…"), and a
 * conversation replays from its transcript text alone — nothing attached to a
 * message survives the round trip. So the sentence IS the contract: build every
 * one of them here and the chat can render the turn as what it actually was — a
 * skill run on a page, with the page linked and the instructions one click away
 * — instead of a wall of imperative prose in a bubble the PM never wrote.
 *
 * Build with `buildKickoff`, read back with `parseKickoff`. A prompt the PM
 * really did type never matches and stays a message.
 */

export interface Kickoff {
  /** Skill NAME — the filename the runtime resolves (`before-meeting`), not its title. */
  skill: string;
  /** The vault path the run is about, when it has one. */
  target?: string;
  /** Everything the run should do; may be empty for a bare "run this skill". */
  instruction: string;
}

export function buildKickoff({ skill, target, instruction }: Kickoff): string {
  const head = `Run the ${skill} skill${target ? ` on ${target}` : ''}`;
  return instruction.trim() ? `${head}: ${instruction.trim()}` : `${head}.`;
}

/**
 * Tolerant on the way in: `session` was the older word for the same thing, and
 * transcripts written before this contract existed still say it.
 */
const KICKOFF = /^Run the ([\w.-]+) (?:skill|session)(?: on ([^\s:]+\.md))?\s*[:.]\s*([\s\S]*)$/;

export function parseKickoff(text: string): Kickoff | null {
  const m = KICKOFF.exec(text.trim());
  if (!m) return null;
  return {
    skill: m[1]!,
    ...(m[2] ? { target: m[2] } : {}),
    instruction: (m[3] ?? '').trim(),
  };
}
