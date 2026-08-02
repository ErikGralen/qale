import { typeForDir, type NoteType } from '@pm/domain';
import { externalSlugOf } from '../../lib/connections';

/**
 * Shared plumbing for authoring a link's relationship type.
 * Two surfaces open the same menu — the pill's chevron in the body, and
 * ⇧↵ in the `[[` picker — and both announce it the same way: select the
 * wikiLink node, then fire this event on the editor DOM. `SelectionToolbar`
 * listens, because it already owns the floating bar over a selection.
 */
export const EDIT_LINK_TYPE_EVENT = 'pm:edit-link-type';

/**
 * Which KIND of thing a link points at, from the target alone — the folder is
 * the type (`people/asa-lindqvist` → person), and a bare ticket key normalizes
 * to its mirror folder first. `null` when the target has no folder (a
 * not-yet-created note), which the picker reads as "offer everything".
 */
export function targetNoteType(target: string): NoteType | null {
  const dir = externalSlugOf(target).split('/')[0];
  return dir ? typeForDir(dir) : null;
}

/** Ask the toolbar to open the relationship menu for the current selection. */
export function requestLinkTypeMenu(dom: HTMLElement): void {
  dom.dispatchEvent(new CustomEvent(EDIT_LINK_TYPE_EVENT));
}
