import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';

/**
 * Body-appended fixed-position popup for caret-anchored editor menus (slash
 * command, wikilink autocomplete). Escapes every overflow container, tracks
 * scroll/resize via floating-ui autoUpdate, and stays invisible until the
 * first position resolves so it never flashes at (0,0).
 */
export interface SuggestionPopup {
  element: HTMLElement;
  /** Swap the anchor rect (the caret moves as the query grows). */
  setRect: (getRect: () => DOMRect | null) => void;
  destroy: () => void;
}

export function createSuggestionPopup(
  contextElement: HTMLElement,
  getRect: () => DOMRect | null,
): SuggestionPopup {
  const element = document.createElement('div');
  element.className =
    'z-50 w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md';
  element.style.position = 'fixed';
  element.style.top = '0';
  element.style.left = '0';
  element.style.visibility = 'hidden';
  element.style.maxHeight = 'var(--suggestion-max-h, 40vh)';
  document.body.appendChild(element);

  let rectFn = getRect;
  const fallback = () => contextElement.getBoundingClientRect();
  const virtual = {
    getBoundingClientRect: () => rectFn() ?? fallback(),
    contextElement,
  };

  let destroyed = false;
  const update = () => {
    // Reset before measuring so flip() sees the natural height, not a
    // previously clamped one.
    element.style.removeProperty('--suggestion-max-h');
    void computePosition(virtual, element, {
      placement: 'bottom-start',
      strategy: 'fixed',
      middleware: [
        offset(6),
        flip({ padding: 8 }),
        shift({ padding: 8 }),
        size({
          padding: 8,
          apply({ availableHeight }) {
            element.style.setProperty(
              '--suggestion-max-h',
              `${Math.min(availableHeight, window.innerHeight * 0.4)}px`,
            );
          },
        }),
      ],
    }).then(({ x, y }) => {
      if (destroyed) return;
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
      element.style.visibility = 'visible';
    });
  };

  const stopAutoUpdate = autoUpdate(virtual, element, update);

  return {
    element,
    setRect(next) {
      rectFn = next;
      update();
    },
    destroy() {
      destroyed = true;
      stopAutoUpdate();
      element.remove();
    },
  };
}
