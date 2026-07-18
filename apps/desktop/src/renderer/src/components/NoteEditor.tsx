import { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor, JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import type { SearchHitDTO } from '@pm/ipc';
import { invoke } from '../lib/ipc';
import { WikiLink } from './editor/wikilink';
import { SlashCommand } from './editor/slash-command';
import { WikilinkSuggest } from './editor/wikilink-suggest';
import { BlockHandle } from './editor/block-handle';
import { SelectionToolbar } from './editor/SelectionToolbar';

/**
 * Always-editable WYSIWYG note body (TipTap). Loads/saves markdown — the file
 * on disk stays the source of truth. Markdown input rules (`# `, `**`, `- `,
 * `> `) remain the fastest path; on top of them: a selection bubble toolbar,
 * a `/` block menu, `[[` wikilink autocomplete, and a left-gutter block handle
 * (+ / drag). Every affordance serializes cleanly to markdown — nothing here
 * can put something in the editor that the file can't hold.
 *
 * Autosave: debounced 1.5s after the last keystroke, flushed on blur/hide/
 * unmount/quit. Only user edits mark the note dirty, so merely opening a note
 * never re-serializes it (each save is a git commit — no gratuitous diffs).
 */

const AUTOSAVE_MS = 1500;

/** Trailing-newline-insensitive equality; the vault may normalize the tail. */
function sameBody(a: string, b: string): boolean {
  return a.replace(/\n+$/, '') === b.replace(/\n+$/, '');
}

/**
 * Join source-wrapped lines into flowing paragraphs. Agents hard-wrap prose,
 * and ProseMirror renders literal `\n` as a visual break (pre-wrap) where the
 * read view flows it. Explicit breaks already parsed into hardBreak nodes, so
 * any `\n` left inside a text node is a soft wrap. Code blocks keep theirs.
 */
function collapseSoftBreaks(node: JSONContent): JSONContent {
  if (node.type === 'codeBlock') return node;
  if (node.type === 'text' && node.text?.includes('\n')) {
    return { ...node, text: node.text.replace(/[ \t]*\n[ \t]*/g, ' ') };
  }
  if (node.content) return { ...node, content: node.content.map(collapseSoftBreaks) };
  return node;
}

/** Parse markdown into a doc with soft wraps collapsed for display. */
function parseBody(editor: Editor, md: string): JSONContent | string {
  const manager = editor.markdown;
  return manager ? collapseSoftBreaks(manager.parse(md)) : md;
}

export function NoteEditor({
  body,
  onSave,
  onOpenNote,
  onDirty,
  onAsk,
  searchNotes,
}: {
  body: string;
  onSave: (body: string) => Promise<void>;
  onOpenNote: (path: string) => void;
  onDirty?: () => void;
  /** Hand the selected text to an Ask session (bubble toolbar's Ask). */
  onAsk?: (text: string) => void;
  /** Workspace search backing the `[[` wikilink autocomplete. */
  searchNotes?: (query: string) => Promise<SearchHitDTO[]>;
}) {
  // Callbacks live in refs so the editor (created once) never sees stale closures.
  const callbacks = useRef({ onSave, onOpenNote, onDirty, onAsk, searchNotes });
  callbacks.current = { onSave, onOpenNote, onDirty, onAsk, searchNotes };

  const lastSaved = useRef(body);
  const pendingMd = useRef<string | null>(null); // captured in onUpdate; survives editor destroy
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    const md = pendingMd.current;
    if (md === null || sameBody(md, lastSaved.current)) return;
    lastSaved.current = md;
    void callbacks.current.onSave(md).catch((err: unknown) => {
      console.error('note autosave failed', err);
      dirty.current = true;
    });
  }, []);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const openLink = useCallback((target: string) => {
    void invoke['note:resolveLink'](target).then((path) => {
      if (path) callbacks.current.onOpenNote(path);
    });
  }, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: { openOnClick: false },
        dropcursor: { color: 'var(--brand)', width: 2 },
      }),
      Markdown.configure({ markedOptions: { gfm: true } }),
      Placeholder.configure({ placeholder: 'Write, or type / for blocks and [[ to link…' }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      WikiLink,
      SlashCommand,
      WikilinkSuggest.configure({
        searchNotes: (q) => callbacks.current.searchNotes?.(q) ?? Promise.resolve([]),
      }),
      BlockHandle,
    ],
    onCreate: ({ editor }) => {
      // Content goes through parseBody (not the `content` option) so soft
      // wraps collapse before first paint.
      editor.commands.setContent(parseBody(editor, body), { emitUpdate: false });
    },
    editorProps: {
      // pl-14/-ml-14: the left gutter lives INSIDE the editor's box (text
      // position unchanged), so mousing from a block to the floating handle
      // never leaves view.dom — leaving is what hides the handle.
      attributes: { class: 'note-body pl-14 -ml-14' },
      // Wikilink pills are atom nodes — ProseMirror hands us the node directly.
      handleClickOn: (_view, _pos, node, _nodePos, event) => {
        if (node.type.name !== 'wikiLink') return false;
        event.preventDefault();
        openLink(node.attrs['target'] as string);
        return true;
      },
      // Regular links render as <a href>; route relative hrefs in-app,
      // absolute ones to the system browser (via main's window-open handler).
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement).closest('a[href]');
        const href = anchor?.getAttribute('href');
        if (!href || href.startsWith('#')) return false;
        event.preventDefault();
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) window.open(href);
        else openLink(decodeURIComponent(href));
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      pendingMd.current = editor.getMarkdown();
      if (!dirty.current) {
        dirty.current = true;
        callbacks.current.onDirty?.();
      }
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flushRef.current(), AUTOSAVE_MS);
    },
  });

  // External change to the note body (agent edit, Obsidian, git checkout…).
  // Our own save echoes back through the vault watcher — ignore that; only
  // replace content for genuine external edits, and never mid-typing.
  useEffect(() => {
    if (!editor || sameBody(body, lastSaved.current)) return;
    if (dirty.current) return; // user's in-flight edit wins (single-user vault)
    lastSaved.current = body;
    if (sameBody(body, editor.getMarkdown())) return;
    editor.commands.setContent(parseBody(editor, body), { emitUpdate: false });
  }, [body, editor]);

  // Flush pending edits whenever focus leaves: window blur, app hidden,
  // quit (beforeunload — the fire-and-forget IPC still reaches main), unmount
  // (covers tab switch and note switch; NoteView keys this component by path).
  useEffect(() => {
    const onFlush = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('blur', onFlush);
    window.addEventListener('beforeunload', onFlush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', onFlush);
      window.removeEventListener('beforeunload', onFlush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, [flush]);

  return (
    // Relative: the block handle's floating-ui wrapper positions against
    // EditorContent's root (the editor DOM's parent element).
    <div className="relative">
      <EditorContent editor={editor} />
      {editor && (
        <SelectionToolbar editor={editor} onAsk={onAsk ? (text) => callbacks.current.onAsk?.(text) : undefined} />
      )}
    </div>
  );
}
