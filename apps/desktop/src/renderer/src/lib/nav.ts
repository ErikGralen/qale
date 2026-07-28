/**
 * Browser-style navigation intents. Every navigable click in the app funnels
 * its mouse modifiers through `navFromEvent`, so ⌘click / middle-click "open
 * in new tab" works identically everywhere — sidebar rows, wikilinks, list
 * rows, chips.
 */
export interface NavOpts {
  /** Open in a new tab instead of navigating the active tab in place. */
  newTab?: boolean;
  /** With `newTab`: focus the new tab immediately (⌘⇧click) instead of opening it in the background. */
  foreground?: boolean;
}

/** Map a click's modifiers to a navigation intent (browser semantics):
 *  plain → navigate in place · ⌘/ctrl or middle-click → background tab ·
 *  ⌘⇧ → foreground tab. */
export function navFromEvent(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  button?: number;
}): NavOpts {
  const newTab = e.metaKey || e.ctrlKey || e.button === 1;
  if (!newTab) return {};
  return { newTab: true, foreground: e.shiftKey };
}
