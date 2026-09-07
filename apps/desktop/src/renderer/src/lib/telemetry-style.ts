import { styleAnswerWord, styleWord, voiceWord } from '@qale/ipc';
import { invoke } from './ipc';

/**
 * The PM answered the question under a first-time update panel
 * (docs/learning-how-you-work.md ticket 15).
 *
 * The panel holds the only copy of what was picked, and every label on it comes
 * out of the voice file, which the PM may have rewritten. So the labels are
 * folded to words from the allowlist HERE, before anything leaves the renderer:
 * the channel then carries three words we wrote and can carry nothing else.
 *
 * An answer we do not recognise sends nothing. A half-reported pick would read
 * on the dashboard as a style nobody picked, which is worse than a gap.
 *
 * Fire and forget, like every other report: telling us what happened may never
 * be able to break what happened.
 */
export function trackStylePick(pick: {
  /** The voice the panel drafted for: a name or a path, `voices/exec.md`. */
  voice: string;
  /** The tab the PM copied, as the panel labels it: "One paragraph". */
  styleLabel: string;
  /** The option they clicked: "For exec", "For every audience", "Not now". */
  answerLabel: string;
}): void {
  const answer = styleAnswerWord(pick.answerLabel);
  if (!answer) return;
  void invoke['telemetry:stylePick'](
    voiceWord(pick.voice),
    styleWord(pick.styleLabel),
    answer,
  ).catch(() => undefined);
}
