import { test } from 'node:test';
import assert from 'node:assert/strict';
import { todoRowCopy } from '../src/renderer/src/lib/todo-row.js';

/**
 * What a todo row says about where the commitment came from (FA-7). The mark is
 * quiet text, not a badge, and the drop button has to promise what dropping it
 * really does: a todo Qale only heard goes away for good.
 */

test('a todo Qale heard wears the mark, and the drop button says it is removed', () => {
  const copy = todoRowCopy({ inference: true });
  assert.equal(copy.mark, 'Qale heard this');
  assert.equal(copy.dropHint, 'Qale only heard this, so the todo is removed');
});

test('a todo the PM made wears no mark, and dropping it keeps the record', () => {
  for (const todo of [{}, { inference: false }]) {
    const copy = todoRowCopy(todo);
    assert.equal(copy.mark, null);
    assert.equal(copy.dropHint, 'Keeps the record, closes the todo');
  }
});
