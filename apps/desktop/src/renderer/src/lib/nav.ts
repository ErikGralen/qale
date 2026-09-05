import type { NoteType } from '@qale/ipc';

/**
 * Browser-style navigation intents, and the shape of the rail they act on.
 *
 * Every navigable click in the app funnels its mouse modifiers through
 * `navFromEvent`, so ⌘click / middle-click "open in new tab" works identically
 * everywhere — sidebar rows, wikilinks, list rows, chips.
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

/**
 * The rail, top to bottom (E-11). Seven places, in one order, and the order is
 * how often a person needs them: what is waiting on you, then your week, then
 * the work you handed over, then what you write, then what Qale knows.
 *
 * `chats` is the Sessions page and `memory` the Memory page; both are named
 * here by their tab kind so the rail and the tab strip can never disagree about
 * which row a tab belongs to.
 */
export const RAIL_ORDER = [
  'home',
  'inbox',
  'calendar',
  'todos',
  'chats',
  'documents',
  'memory',
] as const;

export type RailPlace = (typeof RAIL_ORDER)[number];

/**
 * What the Memory page holds, in reading order (E-16, E-17).
 *
 * One entry point, the types kept apart behind it. Meetings and notes are NOT
 * here: a meeting is the Calendar's and a note is Documents', and a type with
 * two homes is a type the user has to guess about. A person is a shelf here
 * rather than a rail row of its own (E-17): a person page is worth keeping, a
 * People directory is not.
 */
export const MEMORY_SHELVES: readonly NoteType[] = [
  'source',
  'decision',
  'insight',
  'theme',
  'customer',
  'person',
];

/** The two types Qale mirrors and never writes. They group under one label. */
export const MIRROR_SHELVES: readonly NoteType[] = ['ticket', 'wikipage'];

/**
 * Which surface owns a type: the answer to "where do I find this?", and the one
 * place that answer is written down. `null` means the type has no browsing home
 * at all. Skills, agents and session receipts are reached by their own doors.
 */
export function surfaceForType(type: NoteType): RailPlace | null {
  if (type === 'meeting') return 'calendar';
  if (type === 'note') return 'documents';
  if (type === 'todo') return 'todos';
  if (MEMORY_SHELVES.includes(type) || MIRROR_SHELVES.includes(type)) return 'memory';
  return null;
}
