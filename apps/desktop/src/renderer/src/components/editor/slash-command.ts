import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import { Brackets, Minus, Table } from 'lucide-react';
import { BLOCK_TYPES, type BlockType } from './blocks';
import { suggestionMenuRender, suggestionPopupOptions } from './suggestion-render';

/**
 * The `/` block menu. Built on @tiptap/suggestion: typing `/` in an empty or
 * mid-paragraph position opens a filtered listbox; picking an item deletes
 * the `/query` text and runs its command. `Link to note` chains into the
 * `[[` wikilink autocomplete by inserting its trigger.
 */
interface SlashItem extends BlockType {
  group: 'Blocks' | 'Insert';
  aliases?: string[];
}

/** Extra search vocabulary per registry key — slash-menu-only concern. */
const BLOCK_ALIASES: Record<string, string[]> = {
  text: ['paragraph', 'plain'],
  h1: ['title', '#'],
  h2: ['subtitle', '##'],
  h3: ['###'],
  bullet: ['unordered', 'ul'],
  ordered: ['ol', '1.'],
  task: ['todo', 'checkbox', 'checklist'],
  quote: ['blockquote'],
  code: ['pre', 'snippet'],
};

const SLASH_ITEMS: SlashItem[] = [
  ...BLOCK_TYPES.map((b) => ({ ...b, group: 'Blocks' as const, aliases: BLOCK_ALIASES[b.key] })),
  { key: 'divider', label: 'Divider', icon: Minus, group: 'Insert', aliases: ['hr', 'rule', 'separator'], run: (e) => e.chain().focus().setHorizontalRule().run() },
  { key: 'table', label: 'Table', icon: Table, group: 'Insert', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  {
    key: 'wikilink',
    label: 'Link to note',
    icon: Brackets,
    group: 'Insert',
    aliases: ['wikilink', 'reference', 'mention'],
    // Typing the trigger re-enters the [[ autocomplete with the caret ready.
    run: (e) => e.chain().focus().insertContent('[[').run(),
  },
];

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        ...suggestionPopupOptions,
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        allowSpaces: false,
        allow: ({ editor }) => !editor.isActive('codeBlock'),
        items: ({ query }) => {
          const q = query.trim().toLowerCase();
          if (!q) return SLASH_ITEMS;
          return SLASH_ITEMS.filter(
            (item) =>
              item.label.toLowerCase().includes(q) ||
              item.aliases?.some((a) => a.includes(q)),
          );
        },
        command: ({ editor, range, props: item }) => {
          editor.chain().focus().deleteRange(range).run();
          item.run(editor);
        },
        render: suggestionMenuRender<SlashItem>({
          toMenuItem: (item) => ({
            id: item.key,
            label: item.label,
            icon: item.icon,
            group: item.group,
          }),
          emptyLabel: 'No matching blocks.',
        }),
      }),
    ];
  },
});
