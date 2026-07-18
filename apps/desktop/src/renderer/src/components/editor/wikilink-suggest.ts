import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import type { SearchHitDTO } from '@pm/ipc';
import { FileText, Link2 } from 'lucide-react';
import { suggestionMenuRender, suggestionPopupOptions } from './suggestion-render';
import { wikilinkAttrs } from './wikilink';

/**
 * `[[` autocomplete over the vault. Typing `[[` opens a search-backed picker;
 * selecting a note inserts a proper wikiLink atom (target = full slug, alias =
 * title when it adds anything), so links resolve immediately instead of living
 * as plain text until the next reload. A trailing "link as typed" item covers
 * targets that don't exist yet — an unresolved link is a legitimate first step.
 */
type WikiPick =
  | { kind: 'note'; hit: SearchHitDTO }
  | { kind: 'raw'; query: string };

export interface WikilinkSuggestOptions {
  searchNotes: (query: string) => Promise<SearchHitDTO[]>;
}

/**
 * `[[slug|Title]]` whenever the title reads differently from the slug itself —
 * the editor displays alias ?? target, and a folder-prefixed slug as display
 * text is the librarian's voice, not the PO's.
 */
export function wikilinkSource(slug: string, title: string): string {
  const needsAlias = title.trim() !== '' && title.trim() !== slug;
  return needsAlias ? `[[${slug}|${title.trim()}]]` : `[[${slug}]]`;
}

export const WikilinkSuggest = Extension.create<WikilinkSuggestOptions>({
  name: 'wikilinkSuggest',

  addOptions() {
    return { searchNotes: async () => [] };
  },

  addProseMirrorPlugins() {
    const { searchNotes } = this.options;
    return [
      Suggestion<WikiPick>({
        ...suggestionPopupOptions,
        editor: this.editor,
        pluginKey: new PluginKey('wikilinkSuggest'),
        char: '[[',
        allowSpaces: true,
        allow: ({ editor }) => !editor.isActive('codeBlock'),
        items: async ({ query }) => {
          const q = query.trim();
          if (!q) return [];
          const hits = await searchNotes(q).catch(() => [] as SearchHitDTO[]);
          const picks: WikiPick[] = hits.slice(0, 8).map((hit) => ({ kind: 'note', hit }));
          const exact = hits.some(
            (h) => h.slug.toLowerCase() === q.toLowerCase() || h.title.toLowerCase() === q.toLowerCase(),
          );
          if (!exact) picks.push({ kind: 'raw', query: q });
          return picks;
        },
        command: ({ editor, range, props: pick }) => {
          const source =
            pick.kind === 'note' ? wikilinkSource(pick.hit.slug, pick.hit.title) : `[[${pick.query}]]`;
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent([
              { type: 'wikiLink', attrs: wikilinkAttrs(source, source.slice(2, -2)) },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: suggestionMenuRender<WikiPick>({
          toMenuItem: (pick) =>
            pick.kind === 'note'
              ? { id: pick.hit.path, label: pick.hit.title, icon: FileText, hint: pick.hit.type }
              : { id: '__raw', label: `Link to "${pick.query}"`, icon: Link2, hint: 'new' },
          emptyLabel: 'Type to search the workspace…',
        }),
      }),
    ];
  },
});
