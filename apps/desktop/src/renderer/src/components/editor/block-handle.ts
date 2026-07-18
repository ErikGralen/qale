import { offset } from '@floating-ui/dom';
import { Extension } from '@tiptap/core';
import { DragHandlePlugin, normalizeNestedOptions } from '@tiptap/extension-drag-handle';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * The Notion-style left-gutter block handle: `+` inserts an empty paragraph
 * below the hovered block and opens the slash menu in it; the grip selects the
 * block on click and drags it on drag (the platform suppresses `click` after
 * `dragstart`, so the two gestures need no disambiguation).
 *
 * Uses DragHandlePlugin imperatively with a hand-built DOM element instead of
 * the React wrapper: the wrapper re-parents its ref'd div into the editor DOM,
 * which fights React's reconciliation. Here React never owns the element.
 */

// Lucide `plus` and `grip-vertical`, inlined — this DOM is built outside React.
const svg = (paths: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const PLUS = svg('<path d="M5 12h14"/><path d="M12 5v14"/>');
const GRIP = svg(
  '<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>',
);

export const BlockHandle = Extension.create({
  name: 'blockHandle',

  addProseMirrorPlugins() {
    const { editor } = this;
    let hovered: { node: PMNode; pos: number } | null = null;

    const container = document.createElement('div');
    container.className = 'pm-block-handle';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.tabIndex = -1;
    addBtn.className = 'pm-block-handle-btn pm-block-handle-add';
    addBtn.innerHTML = PLUS;
    addBtn.setAttribute('aria-label', 'Add block below');
    addBtn.title = 'Add block below';
    // Never let a press on + begin a drag of the (draggable) container.
    addBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    addBtn.addEventListener('click', () => {
      if (!hovered) return;
      const insertPos = hovered.pos + hovered.node.nodeSize;
      if (insertPos > editor.state.doc.content.size) return; // stale pos guard
      editor
        .chain()
        .focus()
        .insertContentAt(insertPos, { type: 'paragraph' })
        .setTextSelection(insertPos + 1)
        .run();
      // The `/` lands in the fresh paragraph and opens the slash menu.
      editor.commands.insertContent('/');
    });

    const grip = document.createElement('button');
    grip.type = 'button';
    grip.tabIndex = -1;
    grip.className = 'pm-block-handle-btn pm-block-handle-grip';
    grip.innerHTML = GRIP;
    grip.setAttribute('aria-label', 'Drag to move block');
    grip.title = 'Drag to move · click to select';
    grip.addEventListener('click', () => {
      if (!hovered) return;
      if (hovered.pos < 0 || hovered.pos > editor.state.doc.content.size) return;
      editor.chain().focus().setNodeSelection(hovered.pos).run();
    });

    container.appendChild(addBtn);
    container.appendChild(grip);

    return [
      DragHandlePlugin({
        editor,
        element: container,
        onNodeChange: ({ node, pos }) => {
          hovered = node ? { node, pos } : null;
        },
        computePositionConfig: {
          placement: 'left-start',
          strategy: 'absolute',
          middleware: [offset({ mainAxis: 6, crossAxis: 0 })],
        },
        nestedOptions: normalizeNestedOptions(false),
      }).plugin,
    ];
  },
});
