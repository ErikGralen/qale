import { createElement } from 'react';
import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { linkTypeLabel, normalizeLinkType } from '@pm/domain';
import type { SearchHitDTO } from '@pm/ipc';
import { BookOpen, FileText, Link2, Ticket } from 'lucide-react';
import { connections, type ShallowIndexItemDTO } from '../../lib/connections';
import { StatePill } from '../ExternalRef';
import { requestLinkTypeMenu } from './link-type';
import { suggestionMenuRender, suggestionPopupOptions } from './suggestion-render';
import { wikilinkAttrs } from './wikilink';

/**
 * `[[` autocomplete over the vault. Typing `[[` opens a search-backed picker;
 * selecting a note inserts a proper wikiLink atom (target = full slug, alias =
 * title when it adds anything), so links resolve immediately instead of living
 * as plain text until the next reload. A "link as typed" item covers targets
 * that don't exist yet — an unresolved link is a legitimate first step. It
 * sits with the vault notes (it creates one), never under the external header.
 *
 * Below the vault notes, a second, visually distinct section offers tickets
 * and pages from the followed containers' shallow index — key, title and raw
 * state pill — so `[[PAY-142]]` is one keystroke away from any note.
 *
 * Relationships (docs/typed-links.md) are opt-in and reachable two ways: type
 * the prefix yourself (`[[blocks::pay`, held out of the search and re-attached
 * on insert), or pick with ⇧↵ and choose from the menu afterwards — which is
 * the discoverable path, and the one that can filter the vocabulary by what
 * you actually picked. ↵ stays untyped: that's the common case, forever.
 */
type WikiTarget =
  | { kind: 'note'; hit: SearchHitDTO }
  | { kind: 'external'; item: ShallowIndexItemDTO }
  | { kind: 'raw'; query: string };

/** `withType` is the ⇧↵ variant: insert, then open the relationship menu. */
type WikiPick = WikiTarget & { withType?: boolean };

export interface WikilinkSuggestOptions {
  searchNotes: (query: string) => Promise<SearchHitDTO[]>;
  /** Shallow-index lookup (tickets & pages); defaults to the connections seam. */
  searchExternal: (query: string) => Promise<ShallowIndexItemDTO[]>;
}

/**
 * `[[slug|Title]]` whenever the title reads differently from the slug itself —
 * the editor displays alias ?? target, and a folder-prefixed slug as display
 * text is the librarian's voice, not the PO's.
 */
export function wikilinkSource(slug: string, title: string, typePrefix = ''): string {
  const needsAlias = title.trim() !== '' && title.trim() !== slug;
  return needsAlias ? `[[${typePrefix}${slug}|${title.trim()}]]` : `[[${typePrefix}${slug}]]`;
}

/**
 * Split an optional `type::` prefix off the picker query (docs/typed-links.md):
 * `blocks::pay` searches for "pay" and re-attaches `blocks::` on insert. A
 * prefix that isn't a usable type token stays part of the search text.
 */
export function splitTypePrefix(query: string): { typePrefix: string; search: string } {
  const sep = query.indexOf('::');
  if (sep === -1) return { typePrefix: '', search: query };
  const rawType = query.slice(0, sep);
  const rest = query.slice(sep + 2);
  return normalizeLinkType(rawType)
    ? { typePrefix: `${rawType.trim()}::`, search: rest }
    : { typePrefix: '', search: query };
}

/** The label a fresh external link shows before its mirror meta loads: the
 *  ticket key itself, or the page title. */
export function externalAlias(item: ShallowIndexItemDTO): string {
  return item.kind === 'ticket' ? item.externalId : item.title;
}

export const WikilinkSuggest = Extension.create<WikilinkSuggestOptions>({
  name: 'wikilinkSuggest',

  addOptions() {
    return {
      searchNotes: async () => [],
      searchExternal: (q: string) => connections.searchIndex(q),
    };
  },

  addProseMirrorPlugins() {
    const { searchNotes, searchExternal } = this.options;
    return [
      Suggestion<WikiPick>({
        ...suggestionPopupOptions,
        editor: this.editor,
        pluginKey: new PluginKey('wikilinkSuggest'),
        char: '[[',
        // Default allowedPrefixes ([' ']) only fires after whitespace or a
        // block start; `null` lifts the restriction entirely so `[[` opens the
        // picker after punctuation or mid-word too — which is also what lets
        // the toolbar's "Link to note" re-enter the picker wherever the
        // selection sat. `[[` is never typed by accident, so no false fires.
        allowedPrefixes: null,
        allowSpaces: true,
        allow: ({ editor }) => !editor.isActive('codeBlock'),
        items: async ({ query }) => {
          const q = splitTypePrefix(query.trim()).search.trim();
          if (!q) return [];
          const [hits, external] = await Promise.all([
            searchNotes(q).catch(() => [] as SearchHitDTO[]),
            searchExternal(q).catch(() => [] as ShallowIndexItemDTO[]),
          ]);
          const picks: WikiPick[] = hits.slice(0, 8).map((hit) => ({ kind: 'note', hit }));
          const exact =
            hits.some(
              (h) => h.slug.toLowerCase() === q.toLowerCase() || h.title.toLowerCase() === q.toLowerCase(),
            ) || external.some((i) => i.externalId.toLowerCase() === q.toLowerCase());
          // "Link as typed" makes a vault note, so it belongs with the vault
          // rows — appended before the external group, never rendered as the
          // stray last row under "Tickets & pages".
          if (!exact) picks.push({ kind: 'raw', query: q });
          picks.push(...external.slice(0, 5).map((item): WikiPick => ({ kind: 'external', item })));
          return picks;
        },
        command: ({ editor, range, props: pick }) => {
          // Re-derive the typed prefix from what sits in the document between
          // `[[` and the caret — the picker searched without it.
          const typed = editor.state.doc.textBetween(range.from, range.to, '\n', '\n');
          const { typePrefix } = splitTypePrefix(typed.replace(/^\[\[/, '').trim());
          const source =
            pick.kind === 'note'
              ? wikilinkSource(pick.hit.slug, pick.hit.title, typePrefix)
              : pick.kind === 'external'
                ? wikilinkSource(pick.item.slug, externalAlias(pick.item), typePrefix)
                : `[[${typePrefix}${pick.query}]]`;
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'wikiLink', attrs: wikilinkAttrs(source, source.slice(2, -2)) },
              { type: 'text', text: ' ' },
            ])
            .run();
          // ⇧↵: hand the fresh link straight to the relationship menu, which
          // can now filter by what was actually picked (a person link never
          // offers "supersedes"). The link itself is already committed —
          // escaping the menu leaves a perfectly good untyped link.
          if (pick.withType) {
            editor.chain().setNodeSelection(range.from).run();
            requestLinkTypeMenu(editor.view.dom as HTMLElement);
          }
        },
        render: suggestionMenuRender<WikiPick>({
          header: (query) => {
            const { typePrefix } = splitTypePrefix(query.trim());
            const typed = typePrefix ? normalizeLinkType(typePrefix.slice(0, -2)) : null;
            if (!typed) return null;
            return createElement(
              'div',
              { className: 'flex items-center gap-1.5 px-2 pt-1 pb-1.5 text-xs text-muted-foreground' },
              createElement(
                'span',
                { className: 'rounded bg-muted px-1 font-medium text-foreground' },
                linkTypeLabel(typed.type, typed.reversed),
              ),
              'this note → the link you pick',
            );
          },
          footer: createElement(
            'div',
            { className: 'mt-1 border-t border-border px-2 pt-1.5 pb-0.5 text-[11px] text-muted-foreground' },
            '↵ link · ⇧↵ link with a relationship',
          ),
          shiftSelect: (pick) => ({ ...pick, withType: true }),
          toMenuItem: (pick) =>
            pick.kind === 'note'
              ? { id: pick.hit.path, label: pick.hit.title, icon: FileText, hint: pick.hit.type }
              : pick.kind === 'external'
                ? {
                    id: pick.item.slug,
                    label:
                      pick.item.kind === 'ticket'
                        ? `${pick.item.externalId} — ${pick.item.title}`
                        : pick.item.title,
                    icon: pick.item.kind === 'ticket' ? Ticket : BookOpen,
                    group: 'Tickets & pages',
                    hint: pick.item.containerName,
                    trailing:
                      pick.item.kind === 'ticket' && pick.item.state && pick.item.stateCategory
                        ? createElement(StatePill, {
                            state: pick.item.state,
                            category: pick.item.stateCategory,
                            className: 'shrink-0',
                          })
                        : undefined,
                  }
                : { id: '__raw', label: `Link to "${pick.query}"`, icon: Link2, hint: 'new' },
          emptyLabel: 'Type to search the workspace…',
        }),
      }),
    ];
  },
});
