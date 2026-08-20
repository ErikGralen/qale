import type { ReactNode } from 'react';
import { flip, shift, size } from '@floating-ui/dom';
import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { SuggestionMenu, type SuggestionMenuItem } from './SuggestionMenu';

/**
 * Shared floating-ui options for suggestion menus, spread into each
 * `Suggestion()` config. `flip: false` disables the plugin's padding-less
 * built-in flip so the middleware chain below matches the classic popup:
 * offset(6) → flip → shift → size, fixed-position so the popup escapes every
 * overflow container.
 */
export const suggestionPopupOptions: Pick<SuggestionOptions, 'offset' | 'flip' | 'floatingUi'> = {
  offset: { mainAxis: 6 },
  flip: false,
  floatingUi: {
    strategy: 'fixed',
    middleware: [
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ elements, availableHeight }) {
          elements.floating.style.maxHeight = `${Math.min(availableHeight, window.innerHeight * 0.4)}px`;
        },
      }),
    ],
  },
};

/**
 * The shared `render()` lifecycle for @tiptap/suggestion menus. Owns the
 * React renderer and the selection cursor; positioning, outside-click
 * dismissal, and flash-free reveal are delegated to the plugin's managed
 * `props.mount`. ArrowUp/Down wrap, Enter and Tab select, Escape closes (the
 * suggestion plugin exits itself). Keyboard and mouse write the same
 * `selectedIndex`, Notion-style.
 */
export function suggestionMenuRender<Item>(config: {
  toMenuItem: (item: Item) => SuggestionMenuItem;
  emptyLabel: string;
  /** Context line above the list, recomputed per query. */
  header?: (query: string) => ReactNode;
  /** Static key hint under the list. */
  footer?: ReactNode;
  /**
   * The ⇧↵ variant of a pick: return the item to commit instead. Menus that
   * don't offer a second gesture leave this undefined and ⇧↵ picks normally.
   */
  shiftSelect?: (item: Item) => Item;
}): NonNullable<SuggestionOptions<Item>['render']> {
  return () => {
    let renderer: ReactRenderer | null = null;
    let unmount: (() => void) | null = null;
    let items: Item[] = [];
    let selectedIndex = 0;
    let lastQuery = '';
    let query = '';
    let command: SuggestionProps<Item>['command'] = () => {};

    const select = (index: number, shift = false) => {
      const item = items[index];
      if (item === undefined) return;
      command(shift && config.shiftSelect ? config.shiftSelect(item) : item);
    };

    const hover = (index: number) => {
      if (index !== selectedIndex) {
        selectedIndex = index;
        rerender();
      }
    };

    const rerender = () => {
      renderer?.updateProps({
        items: items.map(config.toMenuItem),
        selectedIndex,
        emptyLabel: config.emptyLabel,
        header: config.header?.(query),
        footer: config.footer,
        onSelect: (index: number) => select(index),
        onHover: hover,
      });
    };

    const sync = (props: SuggestionProps<Item>) => {
      items = props.items;
      command = props.command;
      query = props.query;
      // A changed query is a new search — an arrowed-to index against the old
      // results would silently highlight an unrelated item, so jump back to 0.
      if (props.query !== lastQuery) {
        lastQuery = props.query;
        selectedIndex = 0;
      }
      selectedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));
      rerender();
    };

    return {
      onStart(props) {
        selectedIndex = 0;
        renderer = new ReactRenderer(SuggestionMenu, {
          editor: props.editor,
          props: {
            items: [],
            selectedIndex: 0,
            emptyLabel: config.emptyLabel,
            onSelect: select,
            onHover: hover,
          },
        });
        const element = renderer.element;
        element.className =
          'z-50 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md';
        element.style.maxHeight = '40vh';
        // animationFrame keeps the popup glued to the caret rect even when a
        // keystroke rewraps the line without firing a scroll/resize event.
        unmount = props.mount(element, { autoUpdate: { animationFrame: true } });
        // mount() forces `width: max-content` before measuring; w-72 owns it.
        element.style.width = '';
        sync(props);
      },
      onUpdate(props) {
        sync(props);
      },
      onKeyDown({ event }) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (items.length > 0) {
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            selectedIndex = (selectedIndex + delta + items.length) % items.length;
            rerender();
          }
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          if (items.length === 0) return false;
          select(selectedIndex, event.shiftKey);
          return true;
        }
        // Escape falls through: the suggestion plugin exits on it.
        return false;
      },
      onExit() {
        unmount?.();
        renderer?.destroy();
        unmount = null;
        renderer = null;
      },
    };
  };
}
