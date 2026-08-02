import type { Root, Text, PhrasingContent } from 'mdast';
import { visit } from 'unist-util-visit';
import { linkTypeLabel, normalizeLinkTarget } from '@pm/domain';

/**
 * In-house remark plugin for Obsidian `[[wikilinks]]` (the published
 * @flowershow/remark-wiki-link@4.0.0 ships an empty tarball — no dist — so we own
 * this). Splits text nodes on `[[target|alias#anchor]]` into `wikiLink` mdast
 * nodes carrying hName/hProperties so remark-rehype renders an <a class="note-link">
 * with data attributes the renderer intercepts. Shared by the indexer and the
 * read view (PLAN §3.5, §4).
 */

const WIKILINK = /\[\[([^\]]+)\]\]/g;

export interface WikiLinkData {
  target: string;
  anchor?: string;
  alias?: string;
  /** Canonical link type from a `[[type::target]]` link. */
  linkType?: string;
  /** True when the type was an inverse spelling — the semantic edge runs target → source. */
  reversed?: boolean;
  /** 1-based line in the source, if position info is available. */
  line?: number;
}

/** mdast node we emit. */
interface WikiLinkNode {
  type: 'wikiLink';
  value: string;
  data: {
    target: string;
    anchor?: string;
    alias?: string;
    linkType?: string;
    reversed?: boolean;
    hName: 'a';
    hProperties: Record<string, string>;
    hChildren: { type: 'text'; value: string }[];
  };
  position?: Text['position'];
}

export function remarkWikiLink() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;
      const value = node.value;
      if (!value.includes('[[')) return;

      const children: PhrasingContent[] = [];
      let last = 0;
      let match: RegExpExecArray | null;
      WIKILINK.lastIndex = 0;
      while ((match = WIKILINK.exec(value)) !== null) {
        if (match.index > last) {
          children.push({ type: 'text', value: value.slice(last, match.index) });
        }
        const { target, anchor, alias, linkType, reversed } = normalizeLinkTarget(match[1] ?? '');
        const label = alias ?? target;
        const props: Record<string, string> = { className: 'note-link', 'data-target': target };
        if (anchor) props['data-anchor'] = anchor;
        // The read view renders the relationship as a muted prefix chip.
        if (linkType) props['data-link-type'] = linkTypeLabel(linkType, reversed);
        const wl: WikiLinkNode = {
          type: 'wikiLink',
          value: target,
          data: {
            target,
            anchor,
            alias,
            linkType,
            reversed,
            hName: 'a',
            hProperties: props,
            hChildren: [{ type: 'text', value: label }],
          },
          position: node.position,
        };
        children.push(wl as unknown as PhrasingContent);
        last = match.index + match[0].length;
      }
      if (last < value.length) {
        children.push({ type: 'text', value: value.slice(last) });
      }
      if (children.length > 0) {
        parent.children.splice(index, 1, ...children);
        return index + children.length;
      }
      return;
    });
  };
}

/** Walk an mdast tree and collect every wikilink with its line number. */
export function collectWikiLinks(tree: Root): WikiLinkData[] {
  const out: WikiLinkData[] = [];
  visit(tree, 'wikiLink', (node: unknown) => {
    const n = node as WikiLinkNode;
    out.push({
      target: n.data.target,
      anchor: n.data.anchor,
      alias: n.data.alias,
      linkType: n.data.linkType,
      reversed: n.data.reversed,
      line: n.position?.start.line,
    });
  });
  return out;
}
