import { Node } from '@tiptap/core';
import { normalizeLinkTarget } from '@pm/domain';

/**
 * TipTap inline atom for Obsidian `[[wikilinks]]`, the editor-side twin of the
 * remark plugin in @pm/markdown. Parsing goes through a marked tokenizer (so
 * `[[...]]` inside code spans keeps code precedence), targets are normalized
 * with the same `normalizeLinkTarget` the indexer uses, and serialization
 * returns the original `[[...]]` source verbatim so round-trips are byte-exact.
 */

const WIKILINK = /^\[\[([^\]]+)\]\]/;

export interface WikiLinkAttrs {
  /** The exact `[[...]]` source text, emitted back verbatim on serialize. */
  raw: string;
  target: string;
  anchor: string | null;
  alias: string | null;
}

/** Match a wikilink at the start of `src`. Pure, for unit tests. */
export function tokenizeWikilink(src: string): { raw: string; text: string } | undefined {
  const m = WIKILINK.exec(src);
  return m ? { raw: m[0], text: m[1] ?? '' } : undefined;
}

/** Derive node attrs from the inner text of a `[[...]]` match. Pure, for unit tests. */
export function wikilinkAttrs(raw: string, text: string): WikiLinkAttrs {
  const { target, anchor, alias } = normalizeLinkTarget(text);
  return { raw, target, anchor: anchor ?? null, alias: alias ?? null };
}

/** Serialize attrs back to markdown. Pure, for unit tests. */
export function renderWikilink(attrs: WikiLinkAttrs): string {
  if (attrs.raw) return attrs.raw;
  // Reconstruct for nodes created without source (e.g. pasted HTML).
  const anchor = attrs.anchor ? `#${attrs.anchor}` : '';
  const alias = attrs.alias ? `|${attrs.alias}` : '';
  return `[[${attrs.target}${anchor}${alias}]]`;
}

export const WikiLink = Node.create({
  name: 'wikiLink',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: { default: '' },
      target: { default: '' },
      anchor: { default: null },
      alias: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a.note-link[data-target]',
        getAttrs: (el) => {
          const target = el.getAttribute('data-target') ?? '';
          const anchor = el.getAttribute('data-anchor');
          const label = el.textContent ?? '';
          const alias = label && label !== target ? label : null;
          return wikilinkAttrs('', `${target}${anchor ? `#${anchor}` : ''}${alias ? `|${alias}` : ''}`);
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs = node.attrs as WikiLinkAttrs;
    const props: Record<string, string> = { class: 'note-link', 'data-target': attrs.target };
    if (attrs.anchor) props['data-anchor'] = attrs.anchor;
    return ['a', props, attrs.alias ?? attrs.target];
  },

  markdownTokenizer: {
    name: 'wikiLink',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenize(src: string) {
      const match = tokenizeWikilink(src);
      if (!match) return undefined;
      return { type: 'wikiLink', raw: match.raw, text: match.text };
    },
  },

  parseMarkdown(token, helpers) {
    return helpers.createNode('wikiLink', wikilinkAttrs(token.raw ?? '', token.text ?? ''));
  },

  renderMarkdown(node) {
    return renderWikilink(node.attrs as WikiLinkAttrs);
  },
});
