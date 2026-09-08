import { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor, JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { Placeholder } from '@tiptap/extensions';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { SearchHitDTO } from '@qale/ipc';
import { invoke } from '../lib/ipc';
import { EXTERNAL_CHANGE_KEPT, resolveExternalChange, sameBody } from '../lib/merge-body';
import { isExternalRef, openExternalRef, refMetaCached } from '../lib/connections';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { webUrl } from '../lib/urls';
import { useToast } from './toast';
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

/**
 * The markdown the editor would write for this text. Agents and Obsidian write
 * their own dialect (hard wraps, `*` bullets, different blank-line counts), and
 * the merge compares lines, so the incoming body goes through the same parse
 * and serialize the editor puts every other body through. Without this, pure
 * formatting reads as an edit on every line and the merge always refuses.
 */
function serializeBody(editor: Editor, md: string): string {
  const manager = editor.markdown;
  if (!manager) return md;
  try {
    return manager.serialize(collapseSoftBreaks(manager.parse(md)));
  } catch {
    return md;
  }
}

/**
 * Put a new doc in the editor and keep the caret where the reader left it.
 *
 * `setContent` replaces the whole doc in one step, which collapses the caret to
 * the end of the replaced range. Here only the blocks that actually differ are
 * replaced: the matching blocks at the top and the bottom stay, so a caret
 * outside the changed part maps to the same place, and the agent's edit in
 * another paragraph never moves the cursor. A caret inside the changed part
 * lands at the end of it, which is the best the position can be honoured.
 */
function replaceDoc(editor: Editor, content: JSONContent | string): void {
  if (typeof content === 'string') {
    editor.commands.setContent(content, { emitUpdate: false });
    return;
  }
  let parsed: PMNode | null = null;
  try {
    parsed = editor.schema.nodeFromJSON(content);
  } catch {
    parsed = null;
  }
  if (!parsed) {
    editor.commands.setContent(content, { emitUpdate: false });
    return;
  }
  const next = parsed;
  const { state, view } = editor;
  const old = state.doc;
  let head = 0;
  while (head < old.childCount && head < next.childCount && old.child(head).eq(next.child(head))) {
    head++;
  }
  let tail = 0;
  while (
    tail < old.childCount - head &&
    tail < next.childCount - head &&
    old.child(old.childCount - 1 - tail).eq(next.child(next.childCount - 1 - tail))
  ) {
    tail++;
  }
  if (head === old.childCount && head === next.childCount) return; // same doc
  let from = 0;
  for (let i = 0; i < head; i++) from += old.child(i).nodeSize;
  let to = old.content.size;
  for (let i = 0; i < tail; i++) to -= old.child(old.childCount - 1 - i).nodeSize;
  const middle: PMNode[] = [];
  for (let i = head; i < next.childCount - tail; i++) middle.push(next.child(i));

  try {
    const tr = state.tr.replaceWith(from, to, Fragment.fromArray(middle));
    const anchor = Math.min(tr.mapping.map(state.selection.anchor), tr.doc.content.size);
    const focus = Math.min(tr.mapping.map(state.selection.head), tr.doc.content.size);
    tr.setSelection(TextSelection.between(tr.doc.resolve(anchor), tr.doc.resolve(focus)));
    // The caller owns dirty state and the save timer, so the update event that
    // would set them is suppressed here, as `setContent` suppresses it.
    tr.setMeta('preventUpdate', true);
    tr.setMeta('addToHistory', false);
    view.dispatch(tr);
  } catch (err) {
    // The narrow replace can be refused (an empty result, say). The text
    // matters more than the caret, so fall back to replacing the whole doc.
    console.error('narrow content replace failed', err);
    editor.commands.setContent(content, { emitUpdate: false });
  }
}

export function NoteEditor({
  body,
  onSave,
  onOpenNote,
  onDirty,
  onAsk,
  searchNotes,
  registerFlush,
  registerFocus,
}: {
  body: string;
  onSave: (body: string) => Promise<void>;
  /** Receives the click's nav intent so ⌘click opens the note in a new tab. */
  onOpenNote: (path: string, opts?: NavOpts) => void;
  onDirty?: () => void;
  /**
   * Hand the parent a way to land any pending keystrokes before it replaces the
   * body underneath the editor (restoring a version). Without it the in-flight
   * edit wins the effect below and then autosaves back over the restore.
   */
  registerFlush?: (flush: () => Promise<void>) => void;
  /**
   * Hand the parent the cursor. An empty note can carry a prompt above it
   * ("write what happened"), and the button that says so has to be able to put
   * the caret in the body rather than just pointing at it.
   */
  registerFocus?: (focus: () => void) => void;
  /** Hand the selected text to an Ask session (bubble toolbar's Ask). */
  onAsk?: (text: string) => void;
  /** Workspace search backing the `[[` wikilink autocomplete. */
  searchNotes?: (query: string) => Promise<SearchHitDTO[]>;
}) {
  const toast = useToast();
  // Callbacks live in refs so the editor (created once) never sees stale closures.
  const callbacks = useRef({ onSave, onOpenNote, onDirty, onAsk, searchNotes, toast });
  callbacks.current = { onSave, onOpenNote, onDirty, onAsk, searchNotes, toast };

  const lastSaved = useRef(body);
  const pendingMd = useRef<string | null>(null); // captured in onUpdate; survives editor destroy
  const dirty = useRef(false);
  const timer = useRef<number | null>(null);
  /**
   * The body the editor loaded, in the editor's own markdown. It is the base
   * the merge measures the PM's unsaved edit against, so it has to be the
   * editor's dialect rather than the file's.
   */
  const baseMd = useRef(body);
  /** The save still in the air, if any — never rejects (the catch below owns it). */
  const inFlight = useRef<Promise<void>>(Promise.resolve());

  // Returns the save it started, or the one already running, so a caller about
  // to overwrite the body can wait for the user's own edit to land first.
  const flush = useCallback((): Promise<void> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return inFlight.current;
    dirty.current = false;
    const md = pendingMd.current;
    if (md === null || sameBody(md, lastSaved.current)) return inFlight.current;
    const previous = lastSaved.current;
    const previousBase = baseMd.current;
    lastSaved.current = md;
    baseMd.current = md; // what we just wrote is what the next edit builds on
    inFlight.current = callbacks.current.onSave(md).catch((err: unknown) => {
      console.error('note autosave failed', err);
      lastSaved.current = previous;
      baseMd.current = previousBase;
      dirty.current = true;
      callbacks.current.toast(
        `Autosave failed: ${err instanceof Error ? err.message : 'the write was rejected.'} Your edit is kept and will retry.`,
      );
    });
    return inFlight.current;
  }, []);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    registerFlush?.(flush);
  }, [registerFlush, flush]);

  const openLink = useCallback((target: string, opts?: NavOpts) => {
    // A ticket/wikipage reference is addressed by lookup, not by its written
    // form: the mirror note when one exists, else the provider page, else the
    // ordinary resolve. Never a dead click, and never a guessed path.
    if (isExternalRef(target)) {
      void refMetaCached(target).then((meta) =>
        openExternalRef(target, meta, (path) => callbacks.current.onOpenNote(path, opts)),
      );
      return;
    }
    void invoke['note:resolveLink'](target).then((path) => {
      if (path) callbacks.current.onOpenNote(path, opts);
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
      baseMd.current = editor.getMarkdown();
    },
    editorProps: {
      // pl-14/-ml-14: the left gutter lives INSIDE the editor's box (text
      // position unchanged), so mousing from a block to the floating handle
      // never leaves view.dom — leaving is what hides the handle.
      attributes: { class: 'note-body pl-14 -ml-14' },
      // Wikilink pills are atom nodes — ProseMirror hands us the node directly.
      handleClickOn: (_view, _pos, node, _nodePos, event) => {
        if (node.type.name !== 'wikiLink') return false;
        // The pill's relationship chevron lives inside the atom; it owns its
        // own gesture (select the node, open the menu) and must not navigate.
        if ((event.target as HTMLElement).closest('[data-link-type-button]')) return true;
        event.preventDefault();
        openLink(node.attrs['target'] as string, navFromEvent(event));
        return true;
      },
      // Regular links render as <a href>; route relative hrefs in-app,
      // absolute ones to the system browser (via main's window-open handler).
      handleClick: (_view, _pos, event) => {
        const anchor = (event.target as HTMLElement).closest('a[href]');
        const href = anchor?.getAttribute('href');
        if (!href || href.startsWith('#')) return false;
        event.preventDefault();
        // A web address (`https://…`, a scheme-less `www.`/`host.tld`) or any
        // other scheme (`mailto:`) opens externally; a relative href is a note.
        const web = webUrl(href);
        if (web) window.open(web);
        else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) window.open(href);
        else openLink(decodeURIComponent(href), navFromEvent(event));
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

  useEffect(() => {
    if (editor) registerFocus?.(() => editor.commands.focus('end'));
  }, [registerFocus, editor]);

  // External change to the note body (agent edit, Obsidian, git checkout…).
  // Our own save echoes back through the vault watcher — ignore that.
  //
  // The editor used to drop the change whenever the PM was mid-typing, and the
  // next autosave then wrote the stale body back over it with nothing said. Now
  // the PM's unsaved edit is put back on top of the new body. Only when the two
  // touch the same lines does the PM's text stand alone, and then they are told.
  useEffect(() => {
    if (!editor || sameBody(body, lastSaved.current)) return;
    const mine = dirty.current ? editor.getMarkdown() : null;
    const theirs = mine === null ? body : serializeBody(editor, body);
    const outcome = resolveExternalChange({ base: baseMd.current, mine, theirs });
    lastSaved.current = body;
    if (outcome.kind === 'kept') {
      // Base stays what it was: the PM's edit still hangs off it, and the
      // pending autosave still carries their text to disk.
      callbacks.current.toast(EXTERNAL_CHANGE_KEPT);
      return;
    }
    if (sameBody(outcome.body, editor.getMarkdown())) {
      baseMd.current = editor.getMarkdown();
      if (outcome.kind === 'replace') dirty.current = false;
      return;
    }
    replaceDoc(editor, parseBody(editor, outcome.body));
    if (outcome.kind === 'merged') {
      // The merged text is in the editor and not on disk, so the save stands.
      pendingMd.current = editor.getMarkdown();
      baseMd.current = theirs;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flushRef.current(), AUTOSAVE_MS);
      return;
    }
    dirty.current = false;
    pendingMd.current = null;
    baseMd.current = editor.getMarkdown();
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, [body, editor]);

  // Flush pending edits whenever focus leaves: window blur, app hidden,
  // quit (beforeunload — the fire-and-forget IPC still reaches main), unmount
  // (covers tab switch and note switch; NoteView keys this component by path).
  useEffect(() => {
    const onFlush = () => void flush();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush();
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
        <SelectionToolbar
          editor={editor}
          onAsk={onAsk ? (text) => callbacks.current.onAsk?.(text) : undefined}
        />
      )}
    </div>
  );
}
