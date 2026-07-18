import { ReactRenderer } from '@tiptap/react';
import type { SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { SuggestionMenu, type SuggestionMenuItem } from './SuggestionMenu';
import { createSuggestionPopup, type SuggestionPopup } from './suggestion-popup';

/**
 * The shared `render()` lifecycle for @tiptap/suggestion menus. Owns the
 * popup, the React renderer, and the selection cursor; ArrowUp/Down wrap,
 * Enter and Tab select, Escape closes (the suggestion plugin exits itself).
 * Keyboard and mouse write the same `selectedIndex`, Notion-style.
 */
export function suggestionMenuRender<Item>(config: {
  toMenuItem: (item: Item) => SuggestionMenuItem;
  emptyLabel: string;
}): NonNullable<SuggestionOptions<Item>['render']> {
  return () => {
    let popup: SuggestionPopup | null = null;
    let renderer: ReactRenderer | null = null;
    let items: Item[] = [];
    let selectedIndex = 0;
    let command: SuggestionProps<Item>['command'] = () => {};

    const select = (index: number) => {
      const item = items[index];
      if (item !== undefined) command(item);
    };

    const rerender = () => {
      renderer?.updateProps({
        items: items.map(config.toMenuItem),
        selectedIndex,
        emptyLabel: config.emptyLabel,
        onSelect: select,
        onHover: (index: number) => {
          if (index !== selectedIndex) {
            selectedIndex = index;
            rerender();
          }
        },
      });
    };

    const sync = (props: SuggestionProps<Item>) => {
      items = props.items;
      command = props.command;
      selectedIndex = Math.min(selectedIndex, Math.max(0, items.length - 1));
      rerender();
    };

    return {
      onStart(props) {
        selectedIndex = 0;
        renderer = new ReactRenderer(SuggestionMenu, {
          editor: props.editor,
          props: { items: [], selectedIndex: 0, emptyLabel: config.emptyLabel, onSelect: select, onHover: select },
        });
        popup = createSuggestionPopup(props.editor.view.dom, () => props.clientRect?.() ?? null);
        popup.element.appendChild(renderer.element);
        sync(props);
      },
      onUpdate(props) {
        sync(props);
        popup?.setRect(() => props.clientRect?.() ?? null);
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
          select(selectedIndex);
          return true;
        }
        // Escape falls through: the suggestion plugin exits on it.
        return false;
      },
      onExit() {
        popup?.destroy();
        renderer?.destroy();
        popup = null;
        renderer = null;
      },
    };
  };
}
