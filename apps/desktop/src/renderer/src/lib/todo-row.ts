import { INFERRED_TODO_MARK } from '@qale/domain';
import type { NoteRefDTO } from '@qale/ipc';

/**
 * What a todo row says about where the commitment came from
 * (docs/fewer-approvals.md FA-7).
 *
 * A todo lands without a card, so two kinds of promise sit in the same list: one
 * the PM made, and one Qale worked out of a transcript. The row carries the
 * difference in two places, and both are composed here so they cannot drift:
 * the mark under the title, and what the drop button promises.
 */

export interface TodoRowCopy {
  /** The quiet line beside the title, or null when the PM's own word made it. */
  mark: string | null;
  /** What dropping it does, for the drop button's tooltip on the row and the panel. */
  dropHint: string;
}

export function todoRowCopy(todo: Pick<NoteRefDTO, 'inference'>): TodoRowCopy {
  // Dropping a todo Qale only heard removes the file: the PM is not closing a
  // promise, they are saying there was never one. The button has to say so
  // before the press, because the row will be gone after it.
  return todo.inference
    ? { mark: INFERRED_TODO_MARK, dropHint: 'Qale only heard this, so the todo is removed' }
    : { mark: null, dropHint: 'Keeps the record, closes the todo' };
}
