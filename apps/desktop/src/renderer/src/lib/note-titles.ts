import { slugFromPath, titleForRef } from '@qale/domain';
import type { VaultTreeDTO } from '@qale/ipc';

/**
 * Note titles by slug, for the surfaces that draw outside React.
 *
 * The read view looks a link's title up in the workspace tree it holds in a
 * React context (components/Markdown.tsx). The editor's wikilink chips are
 * plain DOM inside a TipTap node view, so they cannot read that context. The
 * tree is published here instead, and the node views read it and follow it.
 *
 * One map for the whole renderer: the tree is one workspace, and every editor
 * on screen wants the same answer for the same link.
 */

let titles = new Map<string, string>();
const listeners = new Set<() => void>();

/** Publish the workspace tree. Call it from React when the tree changes. */
export function setNoteTitles(tree: VaultTreeDTO | null): void {
  const next = new Map<string, string>();
  for (const group of tree?.groups ?? []) {
    for (const note of group.notes) next.set(note.slug, note.title);
  }
  if (same(titles, next)) return;
  titles = next;
  for (const listener of [...listeners]) listener();
}

/**
 * What to print for a link that carries no alias. The note's own name when the
 * workspace holds it, and the target's last segment de-slugged when it does
 * not. This is the answer the read view prints, so a storage path never
 * reaches the reader on either side.
 */
export function noteTitleFor(target: string): string {
  const slug = slugFromPath(target);
  // A title that is blank, or that is the slug itself, is not a name. A
  // calendar mirror has no `title:` in its frontmatter, so its name is derived
  // off the slug, which is what the sidebar shows for it too.
  const fromTree = titles.get(slug)?.trim();
  if (fromTree && fromTree !== slug && fromTree !== target) return fromTree;
  return titleForRef(target) || target;
}

/** Run `fn` whenever the titles change. Returns the unsubscribe. */
export function onNoteTitles(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function same(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [slug, title] of a) if (b.get(slug) !== title) return false;
  return true;
}
