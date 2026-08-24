import { typeForDir, type NoteType } from '@qale/domain';
import { isTicketKey, refKeyOf } from '../../lib/connections';

/**
 * Shared plumbing for authoring a link's relationship type.
 * Two surfaces open the same menu — the pill's chevron in the body, and
 * ⇧↵ in the `[[` picker — and both announce it the same way: select the
 * wikiLink node, then fire this event on the editor DOM. `SelectionToolbar`
 * listens, because it already owns the floating bar over a selection.
 */
export const EDIT_LINK_TYPE_EVENT = 'qale:edit-link-type';

/**
 * Which KIND of thing a link points at, from the target alone — the folder is
 * the type (`people/asa-lindqvist` → person). A bare ticket key has no folder,
 * but nothing else is ever written that way, so the shape answers the question
 * without asking which tracker holds it. `null` when the target has no folder
 * (a not-yet-created note), which the picker reads as "offer everything".
 */
export function targetNoteType(target: string): NoteType | null {
  if (isTicketKey(target)) return 'ticket';
  const dir = refKeyOf(target).split('/')[0];
  return dir ? typeForDir(dir) : null;
}

/** Ask the toolbar to open the relationship menu for the current selection. */
export function requestLinkTypeMenu(dom: HTMLElement): void {
  dom.dispatchEvent(new CustomEvent(EDIT_LINK_TYPE_EVENT));
}
