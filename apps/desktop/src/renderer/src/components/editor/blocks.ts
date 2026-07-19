import type { Editor } from '@tiptap/core';
import {
  CodeSquare,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  TextQuote,
  type LucideIcon,
} from 'lucide-react';

/**
 * The turn-into block registry — the single list of block types shared by the
 * selection toolbar's Turn-into menu and the `/` menu's Blocks group. Each
 * consumer decorates the core: the toolbar adds `isActive` per entry, the
 * slash menu adds search aliases and its Insert-group extras.
 */
export interface BlockType {
  key: string;
  label: string;
  icon: LucideIcon;
  run: (editor: Editor) => void;
}

export const BLOCK_TYPES: BlockType[] = [
  { key: 'text', label: 'Text', icon: Pilcrow, run: (e) => e.chain().focus().setParagraph().run() },
  { key: 'h1', label: 'Heading 1', icon: Heading1, run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { key: 'h2', label: 'Heading 2', icon: Heading2, run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { key: 'h3', label: 'Heading 3', icon: Heading3, run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { key: 'bullet', label: 'Bullet list', icon: List, run: (e) => e.chain().focus().toggleBulletList().run() },
  { key: 'ordered', label: 'Numbered list', icon: ListOrdered, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { key: 'task', label: 'Task list', icon: ListTodo, run: (e) => e.chain().focus().toggleTaskList().run() },
  { key: 'quote', label: 'Quote', icon: TextQuote, run: (e) => e.chain().focus().toggleBlockquote().run() },
  // toggle (not set) so the toolbar's Turn-into can also leave a code block;
  // from the slash menu the caret is never inside one (allow bars it), so
  // toggling there always sets — behavior is identical for both consumers.
  { key: 'code', label: 'Code block', icon: CodeSquare, run: (e) => e.chain().focus().toggleCodeBlock().run() },
];
