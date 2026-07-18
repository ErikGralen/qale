import { Extension, type Editor } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion from '@tiptap/suggestion';
import {
  Brackets,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
  Table,
  TextQuote,
  type LucideIcon,
} from 'lucide-react';
import { suggestionMenuRender } from './suggestion-render';

/**
 * The `/` block menu. Built on @tiptap/suggestion: typing `/` in an empty or
 * mid-paragraph position opens a filtered listbox; picking an item deletes
 * the `/query` text and runs its command. `Link to note` chains into the
 * `[[` wikilink autocomplete by inserting its trigger.
 */
interface SlashItem {
  name: string;
  label: string;
  icon: LucideIcon;
  group: 'Blocks' | 'Insert';
  aliases?: string[];
  run: (editor: Editor) => void;
}

const SLASH_ITEMS: SlashItem[] = [
  { name: 'text', label: 'Text', icon: Pilcrow, group: 'Blocks', aliases: ['paragraph', 'plain'], run: (e) => e.chain().focus().setParagraph().run() },
  { name: 'h1', label: 'Heading 1', icon: Heading1, group: 'Blocks', aliases: ['title', '#'], run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { name: 'h2', label: 'Heading 2', icon: Heading2, group: 'Blocks', aliases: ['subtitle', '##'], run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { name: 'h3', label: 'Heading 3', icon: Heading3, group: 'Blocks', aliases: ['###'], run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { name: 'bullet', label: 'Bullet list', icon: List, group: 'Blocks', aliases: ['unordered', 'ul'], run: (e) => e.chain().focus().toggleBulletList().run() },
  { name: 'ordered', label: 'Numbered list', icon: ListOrdered, group: 'Blocks', aliases: ['ol', '1.'], run: (e) => e.chain().focus().toggleOrderedList().run() },
  { name: 'task', label: 'Task list', icon: ListTodo, group: 'Blocks', aliases: ['todo', 'checkbox', 'checklist'], run: (e) => e.chain().focus().toggleTaskList().run() },
  { name: 'quote', label: 'Quote', icon: TextQuote, group: 'Blocks', aliases: ['blockquote'], run: (e) => e.chain().focus().toggleBlockquote().run() },
  { name: 'code', label: 'Code block', icon: Code, group: 'Blocks', aliases: ['pre', 'snippet'], run: (e) => e.chain().focus().setCodeBlock().run() },
  { name: 'divider', label: 'Divider', icon: Minus, group: 'Insert', aliases: ['hr', 'rule', 'separator'], run: (e) => e.chain().focus().setHorizontalRule().run() },
  { name: 'table', label: 'Table', icon: Table, group: 'Insert', run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  {
    name: 'wikilink',
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
            id: item.name,
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
