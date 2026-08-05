import { Node } from '@tiptap/core';
import { linkTypeLabel, linkTypeToken, normalizeLinkTarget } from '@qale/domain';
import { isExternalRef, refMetaCached } from '../../lib/connections';
import { pillClass } from '../ExternalRef';
import { requestLinkTypeMenu } from './link-type';

/**
 * TipTap inline atom for Obsidian `[[wikilinks]]`, the editor-side twin of the
 * remark plugin in @qale/markdown. Parsing goes through a marked tokenizer (so
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
  /** Canonical link type from a `[[type::target]]` link; null = untyped. */
  linkType: string | null;
  /** True when the type was an inverse spelling ("blocked-by"). */
  reversed: boolean;
}

/** Match a wikilink at the start of `src`. Pure, for unit tests. */
export function tokenizeWikilink(src: string): { raw: string; text: string } | undefined {
  const m = WIKILINK.exec(src);
  return m ? { raw: m[0], text: m[1] ?? '' } : undefined;
}

/** Derive node attrs from the inner text of a `[[...]]` match. Pure, for unit tests. */
export function wikilinkAttrs(raw: string, text: string): WikiLinkAttrs {
  const { target, anchor, alias, linkType, reversed } = normalizeLinkTarget(text);
  return {
    raw,
    target,
    anchor: anchor ?? null,
    alias: alias ?? null,
    linkType: linkType ?? null,
    reversed: reversed ?? false,
  };
}

/** Serialize attrs back to markdown. Pure, for unit tests. */
export function renderWikilink(attrs: WikiLinkAttrs): string {
  if (attrs.raw) return attrs.raw;
  // Reconstruct for nodes created without source (e.g. pasted HTML) — the type
  // re-emits in the author's direction, never silently dropped.
  const type = attrs.linkType ? `${linkTypeToken(attrs.linkType, attrs.reversed)}::` : '';
  const anchor = attrs.anchor ? `#${attrs.anchor}` : '';
  const alias = attrs.alias ? `|${attrs.alias}` : '';
  return `[[${type}${attrs.target}${anchor}${alias}]]`;
}

/**
 * Set (or clear, with `null`) the relationship on an existing link. `raw` is
 * dropped so `renderWikilink` rebuilds the source from the parts — the one
 * place a retype is allowed to renormalize spacing, since the author asked for
 * the edit. Everything else about the link (target, anchor, alias) survives.
 */
export function retypeWikilink(
  attrs: WikiLinkAttrs,
  option: { type: string; reversed: boolean } | null,
): WikiLinkAttrs {
  const next: WikiLinkAttrs = {
    ...attrs,
    raw: '',
    linkType: option?.type ?? null,
    reversed: option?.reversed ?? false,
  };
  return { ...next, raw: renderWikilink(next) };
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
      linkType: { default: null },
      reversed: { default: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'a.note-link[data-target]',
        getAttrs: (el) => {
          const target = el.getAttribute('data-target') ?? '';
          const anchor = el.getAttribute('data-anchor');
          // Pasted HTML may carry the type as either the canonical token
          // (editor-rendered) or a display label (read-view-rendered) — both
          // normalize through the same spelling map.
          const type = el.getAttribute('data-link-type');
          const label = el.textContent ?? '';
          const alias = label && label !== target ? label : null;
          return wikilinkAttrs(
            '',
            `${type ? `${type}::` : ''}${target}${anchor ? `#${anchor}` : ''}${alias ? `|${alias}` : ''}`,
          );
        },
      },
    ];
  },

  renderHTML({ node }) {
    const attrs = node.attrs as WikiLinkAttrs;
    const props: Record<string, string> = { class: 'note-link', 'data-target': attrs.target };
    if (attrs.anchor) props['data-anchor'] = attrs.anchor;
    if (attrs.linkType) props['data-link-type'] = linkTypeToken(attrs.linkType, attrs.reversed);
    return ['a', props, attrs.alias ?? attrs.target];
  },

  /**
   * Display-only node view: an external reference (ticket/wikipage mirror)
   * upgrades in place to a chip — key + raw-state pill from the local mirror —
   * and stamps `data-external-ref` so the app-level hover layer serves it the
   * same hover card as the read view. Serialization is untouched: the markdown
   * round-trip still emits the original `[[...]]` source byte-exact.
   *
   * The one interactive part is the relationship chevron: a click on the pill
   * navigates (that's the whole point of a link), so retyping needs its own
   * target rather than a modifier nobody would guess. It appears on hover and
   * hands off to the toolbar via a NodeSelection.
   */
  addNodeView() {
    return ({ node, editor, getPos }) => {
      const attrs = node.attrs as WikiLinkAttrs;
      const dom = document.createElement('a');
      dom.className = 'note-link group/link';
      dom.setAttribute('data-target', attrs.target);
      if (attrs.anchor) dom.setAttribute('data-anchor', attrs.anchor);
      if (attrs.linkType) {
        // The relationship reads as a muted prefix chip — same quiet register
        // as the ticket state pill, never louder than the link itself.
        dom.classList.add('inline-flex', 'items-baseline', 'gap-1');
        const typeChip = document.createElement('span');
        typeChip.className = 'self-center rounded bg-muted px-1 text-2xs font-medium text-muted-foreground';
        typeChip.textContent = linkTypeLabel(attrs.linkType, attrs.reversed);
        dom.appendChild(typeChip);
      }
      const label = document.createElement('span');
      label.textContent = attrs.alias ?? attrs.target;
      dom.appendChild(label);

      // The chevron always sits last, so anything appended later (the ticket
      // state pill, which arrives async) inserts before it.
      let chevron: HTMLButtonElement | null = null;
      if (editor.isEditable) {
        dom.classList.add('inline-flex', 'items-baseline', 'gap-1');
        chevron = document.createElement('button');
        chevron.type = 'button';
        chevron.dataset['linkTypeButton'] = '';
        chevron.className =
          'link-type-btn self-center rounded px-0.5 text-2xs leading-none opacity-0 transition-opacity hover:bg-brand/20 group-hover/link:opacity-70 focus-visible:opacity-100 focus-visible:outline-none';
        chevron.textContent = '▾';
        chevron.setAttribute(
          'aria-label',
          attrs.linkType ? `Relationship: ${linkTypeLabel(attrs.linkType, attrs.reversed)}` : 'Add a relationship',
        );
        chevron.title = 'Relationship';
        // mousedown, not click: ProseMirror sets its own selection on mousedown
        // and `handleClickOn` navigates on click — owning the gesture from the
        // start is what keeps the pill from navigating out from under us.
        chevron.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const pos = getPos();
          if (pos === undefined) return;
          editor.chain().focus().setNodeSelection(pos).run();
          requestLinkTypeMenu(editor.view.dom as HTMLElement);
        });
        chevron.addEventListener('click', (event) => event.preventDefault());
        dom.appendChild(chevron);
      }

      if (isExternalRef(attrs.target)) {
        dom.setAttribute('data-external-ref', attrs.target);
        void refMetaCached(attrs.target).then((meta) => {
          if (!meta || !dom.isConnected) return;
          if (meta.kind === 'ticket') {
            label.textContent = meta.externalId;
            if (meta.state && meta.stateCategory) {
              dom.classList.add('inline-flex', 'items-baseline', 'gap-1');
              const pill = document.createElement('span');
              pill.className = `self-center ${pillClass(meta.stateCategory)}`;
              pill.textContent = meta.state;
              dom.insertBefore(pill, chevron);
            }
          } else if (!attrs.alias && meta.title) {
            label.textContent = meta.title;
          }
        });
      }
      return { dom };
    };
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
