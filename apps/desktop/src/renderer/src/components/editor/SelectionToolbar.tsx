import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { isTextSelection } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Brackets,
  Check,
  ChevronDown,
  Code,
  CodeSquare,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Pilcrow,
  Sparkles,
  Strikethrough,
  TextQuote,
  Trash2,
  type LucideIcon,
} from 'lucide-react';

/**
 * The floating toolbar over a text selection: turn-into, inline marks, links.
 * Deliberately markdown-honest — only affordances that serialize to the file
 * (no underline/highlight). `Ask` hands the selection to an Ask session;
 * `Link to note` re-enters the `[[` autocomplete seeded with the selection.
 */
interface BlockChoice {
  name: string;
  label: string;
  icon: LucideIcon;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const BLOCKS: BlockChoice[] = [
  { name: 'text', label: 'Text', icon: Pilcrow, isActive: (e) => e.isActive('paragraph'), run: (e) => e.chain().focus().setParagraph().run() },
  { name: 'h1', label: 'Heading 1', icon: Heading1, isActive: (e) => e.isActive('heading', { level: 1 }), run: (e) => e.chain().focus().setNode('heading', { level: 1 }).run() },
  { name: 'h2', label: 'Heading 2', icon: Heading2, isActive: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().setNode('heading', { level: 2 }).run() },
  { name: 'h3', label: 'Heading 3', icon: Heading3, isActive: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().setNode('heading', { level: 3 }).run() },
  { name: 'bullet', label: 'Bullet list', icon: List, isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { name: 'ordered', label: 'Numbered list', icon: ListOrdered, isActive: (e) => e.isActive('orderedList'), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { name: 'task', label: 'Task list', icon: ListTodo, isActive: (e) => e.isActive('taskList'), run: (e) => e.chain().focus().toggleTaskList().run() },
  { name: 'quote', label: 'Quote', icon: TextQuote, isActive: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { name: 'code', label: 'Code block', icon: CodeSquare, isActive: (e) => e.isActive('codeBlock'), run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

const barButton =
  'flex size-7 items-center justify-center rounded-md text-foreground transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';
const activeButton = 'bg-brand/10 text-brand hover:bg-brand/15';

function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, '\n');
}

export function SelectionToolbar({ editor, onAsk }: { editor: Editor; onAsk?: (text: string) => void }) {
  const [mode, setMode] = useState<'bar' | 'link' | 'turninto'>('bar');

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      href: (e.getAttributes('link')['href'] as string | undefined) ?? '',
      block: BLOCKS.find((b) => b.isActive(e)) ?? BLOCKS[0]!,
      // Selection identity — any move collapses transient menu modes below.
      from: e.state.selection.from,
      to: e.state.selection.to,
    }),
  });

  // A new selection always reopens as the plain bar, never a stale submenu.
  useEffect(() => setMode('bar'), [state.from, state.to]);

  const linkToNote = () => {
    const text = selectedText(editor).trim().replace(/\s+/g, ' ');
    editor.chain().focus().deleteSelection().insertContent(`[[${text}`).run();
  };

  return (
    <BubbleMenu
      editor={editor}
      updateDelay={150}
      options={{ placement: 'top-start', offset: 8 }}
      shouldShow={({ editor: e, state: s }) => {
        if (!e.isEditable) return false;
        const sel = s.selection;
        if (sel.empty || !isTextSelection(sel)) return false;
        if (e.isActive('codeBlock')) return false;
        return s.doc.textBetween(sel.from, sel.to, ' ').trim().length > 0;
      }}
      className="z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {mode === 'link' ? (
        <LinkEditor
          href={state.href}
          onApply={(href) => {
            editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
            setMode('bar');
          }}
          onRemove={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            setMode('bar');
          }}
          onCancel={() => setMode('bar')}
        />
      ) : (
        <>
          <div className="relative">
            <button
              className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setMode(mode === 'turninto' ? 'bar' : 'turninto')}
              aria-expanded={mode === 'turninto'}
              aria-haspopup="menu"
              aria-label="Turn into"
            >
              <state.block.icon className="size-3.5 text-muted-foreground" aria-hidden />
              {state.block.label}
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
            </button>
            {mode === 'turninto' && (
              <div
                role="menu"
                aria-label="Turn into"
                className="absolute top-full left-0 z-10 mt-1.5 w-44 rounded-lg border border-border bg-popover p-1 shadow-md"
              >
                {BLOCKS.map((b) => (
                  <button
                    key={b.name}
                    role="menuitem"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-75 hover:bg-accent ${
                      b.name === state.block.name ? 'text-brand' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      b.run(editor);
                      setMode('bar');
                    }}
                  >
                    <b.icon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="flex-1">{b.label}</span>
                    {b.name === state.block.name && <Check className="size-3.5" aria-hidden />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />

          <MarkButton icon={Bold} label="Bold" shortcut="⌘B" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
          <MarkButton icon={Italic} label="Italic" shortcut="⌘I" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <MarkButton icon={Strikethrough} label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
          <MarkButton icon={Code} label="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()} />

          <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />

          <MarkButton icon={LinkIcon} label={state.link ? 'Edit link' : 'Add link'} active={state.link} onClick={() => setMode('link')} />
          <MarkButton icon={Brackets} label="Link to note" onClick={linkToNote} />

          {onAsk && (
            <>
              <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />
              <button
                className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-brand transition-colors duration-150 hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onAsk(selectedText(editor))}
                title="Ask the memory about this selection"
              >
                <Sparkles className="size-3.5" aria-hidden />
                Ask
              </button>
            </>
          )}
        </>
      )}
    </BubbleMenu>
  );
}

function MarkButton({
  icon: Icon,
  label,
  shortcut,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`${barButton} ${active ? activeButton : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function LinkEditor({
  href,
  onApply,
  onRemove,
  onCancel,
}: {
  href: string;
  onApply: (href: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(href);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const apply = () => {
    const value = draft.trim();
    if (value) onApply(value);
    else if (href) onRemove();
    else onCancel();
  };

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        className="h-7 w-56 rounded-md border border-input bg-transparent px-2 text-sm placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        placeholder="Paste or type a URL…"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        aria-label="Link URL"
      />
      <button className={barButton} onClick={apply} aria-label="Apply link" title="Apply link">
        <Check className="size-4" aria-hidden />
      </button>
      {href && (
        <button
          className={`${barButton} text-destructive hover:bg-destructive/10`}
          onClick={onRemove}
          aria-label="Remove link"
          title="Remove link"
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}
