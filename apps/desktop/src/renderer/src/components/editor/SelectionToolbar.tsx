import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { isTextSelection } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { linkTypeLabel } from '@qale/domain';
import {
  Bold,
  Brackets,
  Check,
  ChevronDown,
  Code,
  Italic,
  Link as LinkIcon,
  Sparkles,
  Strikethrough,
  Trash2,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import { BLOCK_TYPES, type BlockType } from './blocks';
import { LinkTypeMenu } from './LinkTypeMenu';
import { EDIT_LINK_TYPE_EVENT, targetNoteType } from './link-type';
import { retypeWikilink, type WikiLinkAttrs } from './wikilink';

/**
 * The floating toolbar over a text selection: turn-into, inline marks, links.
 * Deliberately markdown-honest — only affordances that serialize to the file
 * (no underline/highlight). `Ask` hands the selection to an Ask session;
 * `Link to note` re-enters the `[[` autocomplete seeded with the selection.
 */
interface BlockChoice extends BlockType {
  isActive: (editor: Editor) => boolean;
}

/** Current-block detection per registry key — the registry stays view-agnostic. */
const BLOCK_ACTIVE: Record<string, (editor: Editor) => boolean> = {
  text: (e) => e.isActive('paragraph'),
  h1: (e) => e.isActive('heading', { level: 1 }),
  h2: (e) => e.isActive('heading', { level: 2 }),
  h3: (e) => e.isActive('heading', { level: 3 }),
  bullet: (e) => e.isActive('bulletList'),
  ordered: (e) => e.isActive('orderedList'),
  task: (e) => e.isActive('taskList'),
  quote: (e) => e.isActive('blockquote'),
  code: (e) => e.isActive('codeBlock'),
};

const BLOCKS: BlockChoice[] = BLOCK_TYPES.map((b) => ({
  ...b,
  isActive: BLOCK_ACTIVE[b.key] ?? (() => false),
}));

const barButton =
  'flex size-7 items-center justify-center rounded-md text-foreground transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';
const activeButton = 'bg-brand/10 text-brand hover:bg-brand/15';

function selectedText(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, '\n');
}

/** The wikilink under a NodeSelection, or null for any other selection. */
function selectedWikilink(editor: Editor): { attrs: WikiLinkAttrs; pos: number } | null {
  const sel = editor.state.selection;
  if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'wikiLink') return null;
  return { attrs: sel.node.attrs as WikiLinkAttrs, pos: sel.from };
}

export function SelectionToolbar({ editor, onAsk }: { editor: Editor; onAsk?: (text: string) => void }) {
  const [mode, setMode] = useState<'bar' | 'link' | 'turninto' | 'linktype'>('bar');
  // Set by the pill's chevron / the picker's ⇧↵ just before they move the
  // selection onto the link — so the selection change below opens the
  // relationship menu instead of resetting to the plain bar.
  const openLinkType = useRef(false);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const wiki = selectedWikilink(e);
      return {
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        strike: e.isActive('strike'),
        code: e.isActive('code'),
        link: e.isActive('link'),
        href: (e.getAttributes('link')['href'] as string | undefined) ?? '',
        block: BLOCKS.find((b) => b.isActive(e)) ?? BLOCKS[0]!,
        // A selected wikilink flattens to primitives: useEditorState compares
        // the selector's result, and a fresh attrs object every keystroke
        // would never settle.
        wikiTarget: wiki?.attrs.target ?? null,
        wikiLabel: wiki ? (wiki.attrs.alias ?? wiki.attrs.target) : null,
        wikiType: wiki?.attrs.linkType ?? null,
        wikiReversed: wiki?.attrs.reversed ?? false,
        // Selection identity — any move collapses transient menu modes below.
        from: e.state.selection.from,
        to: e.state.selection.to,
      };
    },
  });

  // A new selection always reopens as the plain bar, never a stale submenu —
  // unless it was made expressly to retype a link.
  useEffect(() => setMode(openLinkType.current ? 'linktype' : 'bar'), [state.from, state.to]);
  // One-shot: consumed by whichever render the selection change produced.
  useEffect(() => {
    openLinkType.current = false;
  });

  useEffect(() => {
    const dom = editor.view.dom;
    const open = () => {
      openLinkType.current = true;
      setMode('linktype');
    };
    dom.addEventListener(EDIT_LINK_TYPE_EVENT, open);
    return () => dom.removeEventListener(EDIT_LINK_TYPE_EVENT, open);
  }, [editor]);

  /** Rewrite the selected link's relationship (null clears it back to untyped). */
  const applyLinkType = (option: { type: string; reversed: boolean } | null) => {
    const wiki = selectedWikilink(editor);
    if (!wiki) return;
    const attrs = retypeWikilink(wiki.attrs, option);
    editor
      .chain()
      .focus()
      .command(({ tr }) => {
        tr.setNodeMarkup(wiki.pos, undefined, attrs);
        return true;
      })
      .setNodeSelection(wiki.pos)
      .run();
    setMode('bar');
  };

  /** Drop the link, keeping what it read as — the inverse of `Link to note`. */
  const unlinkNote = () => {
    const wiki = selectedWikilink(editor);
    if (!wiki) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: wiki.pos, to: wiki.pos + 1 }, wiki.attrs.alias ?? wiki.attrs.target)
      .run();
  };

  // Re-enters the `[[` picker seeded with the selection — wikilink-suggest
  // sets `allowedPrefixes: null`, so this triggers regardless of the char
  // before the selection. Escaping the picker leaves the literal `[[text`,
  // exactly as if it had been typed by hand (reverting would also nuke
  // hand-typed triggers, so we don't).
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
        // A selected wikilink gets its own bar: it's an atom, so it has no
        // text to mark up — only a relationship to set.
        if (sel instanceof NodeSelection && sel.node.type.name === 'wikiLink') return true;
        if (sel.empty || !isTextSelection(sel)) return false;
        if (e.isActive('codeBlock')) return false;
        return s.doc.textBetween(sel.from, sel.to, ' ').trim().length > 0;
      }}
      className="z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {state.wikiTarget !== null ? (
        mode === 'linktype' ? (
          <LinkTypeMenu
            targetType={targetNoteType(state.wikiTarget)}
            targetLabel={state.wikiLabel ?? state.wikiTarget}
            current={state.wikiType ? { type: state.wikiType, reversed: state.wikiReversed } : null}
            onPick={applyLinkType}
            onClose={() => setMode('bar')}
          />
        ) : (
          <>
            <button
              className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setMode('linktype')}
              aria-haspopup="listbox"
              aria-label="Relationship"
            >
              {state.wikiType ? (
                <span className="text-brand">{linkTypeLabel(state.wikiType, state.wikiReversed)}</span>
              ) : (
                <span className="text-muted-foreground">Add relationship</span>
              )}
              <ChevronDown className="size-3 text-muted-foreground" aria-hidden />
            </button>
            <div className="mx-0.5 h-5 w-px bg-border" aria-hidden />
            <MarkButton icon={Unlink} label="Remove link" onClick={unlinkNote} />
          </>
        )
      ) : mode === 'link' ? (
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
                    key={b.key}
                    role="menuitem"
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-75 hover:bg-accent ${
                      b.key === state.block.key ? 'text-brand' : ''
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      b.run(editor);
                      setMode('bar');
                    }}
                  >
                    <b.icon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="flex-1">{b.label}</span>
                    {b.key === state.block.key && <Check className="size-3.5" aria-hidden />}
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
