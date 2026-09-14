import type { AskAnswerDTO, AskQuestionDTO } from '@qale/ipc';

/**
 * What a question card counts as answered. It decides one thing on screen:
 * whether Next (or Answer, on the last step) is live.
 */

/**
 * Is this question a batch to review rather than a choice to make? One ticked
 * row is enough: the agent is saying "here is what I would do", and the whole
 * step reads differently from that point on.
 */
export function isBatch(question: AskQuestionDTO): boolean {
  return question.options.some((o) => o.checked);
}

/** A question with no rows: the answer is what gets written. */
export function isWritten(question: AskQuestionDTO): boolean {
  return question.options.length === 0;
}

/**
 * Can this step be sent?
 *
 * A written question always can. The box is open from the start and an empty
 * box is a real answer: "nothing to add". Greying Answer out until a word is
 * typed asks the PM to write something they do not have, and the only way past
 * it was Skip, which tells the agent the opposite thing ("decide it yourself").
 *
 * An option question needs a pick, so the card never sends a blank where a
 * choice was asked for. The exception is a batch: clearing every box there is a
 * decision ("none of these"), and it has to reach the agent as one.
 */
export function isAnswered(question: AskQuestionDTO, answer: AskAnswerDTO): boolean {
  if (isWritten(question)) return true;
  if (answer.selected.length > 0 || !!answer.written) return true;
  return isBatch(question);
}
