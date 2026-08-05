import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderClosed,
  FolderOpen,
  MessageSquare,
  MessageSquarePlus,
  SquareArrowOutUpRight,
} from 'lucide-react';
import type { ChatRefDTO, SessionFileDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { relativeTime } from '../lib/dates';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { fileIconFor, formatBytes } from '../lib/session-files';
import { PageHeader } from '../components/PageHeader';
import { ToolbarButton } from '../components/ToolbarButton';
import { SessionView } from './SessionView';
import { SessionFileBody } from './SessionFileReader';

/**
 * The note's session corner, or — on a session tab — that session's working files.
 * Properties moved into the document itself (the PropertiesBlock under the
 * title), so the doc side of the panel is session-only.
 */
export function RightPanel() {
  const { activeTab, docData } = useApp();
  if (activeTab?.kind === 'session' && activeTab.sessionId) {
    return <SessionFilesPanel sessionId={activeTab.sessionId} />;
  }
  const path = activeTab?.kind === 'doc' ? activeTab.path : null;
  const note = path ? docData[path]?.note ?? null : null;

  if (!note) {
    return (
      <div className="flex h-full flex-col bg-card/40">
        <PageHeader label="Context" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card/40">
      <PageHeader icon={MessageSquare} label="Session" />
      <div className="flex min-h-0 flex-1 flex-col">
        <SideSession key={`side-${note.path}`} path={note.path} />
      </div>
    </div>
  );
}

/**
 * The note's session corner: resume any session that touched this note, or
 * start a fresh one scoped to it.
 */
function SideSession({ path }: { path: string }) {
  const [related, setRelated] = useState<ChatRefDTO[]>([]);
  // nonce forces a remount for "new session"; id undefined = fresh scoped session.
  const [selection, setSelection] = useState<{ id?: string; nonce: number }>({ nonce: 0 });

  useEffect(() => {
    let cancelled = false;
    invoke['chats:forNote'](path)
      .then((list) => {
        if (!cancelled) setRelated(list);
      })
      .catch(() => {
        if (!cancelled) setRelated([]);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <>
      {related.length > 0 && (
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
          <select
            className="min-w-0 flex-1 truncate rounded-md border border-input bg-card px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            value={selection.id ?? ''}
            onChange={(e) =>
              setSelection((s) => ({ id: e.target.value || undefined, nonce: s.nonce + 1 }))
            }
            aria-label="Session about this note"
          >
            <option value="">New session about this note</option>
            {related.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          {selection.id && (
            <button
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setSelection((s) => ({ nonce: s.nonce + 1 }))}
              aria-label="Start a new session about this note"
              title="New session about this note"
            >
              <MessageSquarePlus className="size-4" />
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <SessionView
          key={`${selection.id ?? 'new'}:${selection.nonce}`}
          // The panel's own header already says "Session" and which note it is
          // scoped to; a second rail under it would be pure chrome.
          embedded
          // A fresh side session opens on `ask`; reopening a stored one invokes
          // nothing — it has already spent whatever it started with.
          skill={selection.id ? undefined : 'ask'}
          sessionId={selection.id}
          scopeHint={
            selection.id
              ? undefined
              : // The path is for the agent; the bubble the PM sees renders it as
                // the note's name (Markdown links every note path it finds).
                `I'm looking at ${path}. Answer with citations from the workspace.`
          }
        />
      </div>
    </>
  );
}

/** A file as a row: the DTO plus its bare name, since the DTO path is folder-relative. */
interface FileRow {
  file: SessionFileDTO;
  name: string;
}

/** One folder in the session's working directory, as the rail draws it. */
interface Dir {
  /** Folder name, e.g. "per-item". Empty at the root. */
  name: string;
  /** Full folder path, the collapse key. Empty at the root. */
  path: string;
  dirs: Dir[];
  files: FileRow[];
  /** Files anywhere beneath, so a collapsed folder still says how much it holds. */
  total: number;
}

/**
 * The flat path list as the folder tree it actually is. The agent works in a
 * directory (`brief.md` at the root, a `per-item/` fan-out beneath it) and says
 * so in its own prompts — the rail draws the same shape, at whatever depth the
 * session chose to nest.
 */
function buildTree(files: SessionFileDTO[]): Dir {
  const root: Dir = { name: '', path: '', dirs: [], files: [], total: 0 };
  for (const f of files) {
    const segments = f.path.split('/');
    const name = segments.pop()!;
    let dir = root;
    dir.total++;
    for (const segment of segments) {
      const path = dir.path ? `${dir.path}/${segment}` : segment;
      let next = dir.dirs.find((d) => d.name === segment);
      if (!next) {
        next = { name: segment, path, dirs: [], files: [], total: 0 };
        dir.dirs.push(next);
      }
      dir = next;
      dir.total++;
    }
    dir.files.push({ file: f, name });
  }
  // Files before folders at every level — a brief written before the fan-out
  // stays at the top as the per-item files pile in below it.
  const sort = (d: Dir): void => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name));
    d.files.sort((a, b) => a.name.localeCompare(b.name));
    d.dirs.forEach(sort);
  };
  sort(root);
  return root;
}

/** Row indent per level — deep enough to read as nesting, shallow enough that a
 *  narrow rail still shows the filename. */
const INDENT = 13;

/** A file written this recently is still warm — the rail marks it so a live
 *  fan-out reads as movement rather than as a list that changed when nobody
 *  was looking. */
const WARM_MS = 90_000;

interface RowProps {
  depth: number;
  collapsed: ReadonlySet<string>;
  onToggle: (path: string, force?: boolean) => void;
  /** Plain click — read the file in this panel. */
  onRead: (path: string) => void;
  /** ⌘click / middle-click — the full-width tab. */
  onOpenTab: (path: string, opts: NavOpts) => void;
  returnFocus: React.RefObject<string | null>;
}

/** One folder's contents: its files, then its subfolders, each a row. */
function DirRows({ dir, ...props }: RowProps & { dir: Dir }) {
  const { depth } = props;
  return (
    <ul className="flex flex-col">
      {dir.files.map((row) => (
        <FileRowItem key={row.file.path} row={row} {...props} />
      ))}
      {dir.dirs.map((child) => (
        <DirRowItem key={child.path} dir={child} {...props} depth={depth} />
      ))}
    </ul>
  );
}

/** A folder row: a disclosure that says what it holds even while shut. */
function DirRowItem({ dir, ...props }: RowProps & { dir: Dir }) {
  const { depth, collapsed, onToggle } = props;
  const open = !collapsed.has(dir.path);
  const Icon = open ? FolderOpen : Folder;
  return (
    <li>
      <div className="px-1.5">
        <button
          className="flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-dense font-medium text-foreground/90 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          style={{ paddingLeft: 6 + depth * INDENT }}
          onClick={() => onToggle(dir.path)}
          onKeyDown={(e) => {
            // Tree keys: → opens, ← shuts. Cheaper than reaching for the mouse.
            if (e.key === 'ArrowRight') onToggle(dir.path, true);
            else if (e.key === 'ArrowLeft') onToggle(dir.path, false);
            else return;
            e.preventDefault();
          }}
          aria-expanded={open}
          title={dir.name}
        >
          <ChevronRight
            className={`size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
            aria-hidden
          />
          <Icon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
          <span className="truncate">{dir.name}</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground/70">
            {dir.total}
          </span>
        </button>
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden" inert={!open ? true : undefined}>
          <DirRows dir={dir} {...props} depth={depth + 1} />
        </div>
      </div>
    </li>
  );
}

/** A file row: name, size, and — on hover — the chevron that says it opens here. */
function FileRowItem({ row, depth, onRead, onOpenTab, returnFocus }: RowProps & { row: FileRow }) {
  const { file, name } = row;
  const Icon = fileIconFor(file.path);
  const warm = Date.now() - file.mtime < WARM_MS;
  return (
    <li className="group/file relative px-1.5">
      <button
        ref={(el) => {
          if (el && returnFocus.current === file.path) {
            returnFocus.current = null;
            el.focus();
          }
        }}
        // Files sit where a folder's name sits, one chevron's width in, so the
        // column of icons reads as one tree rather than two lists.
        style={{ paddingLeft: 6 + depth * INDENT + 18 }}
        className="flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-dense text-foreground/90 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={(e) => {
          const opts = navFromEvent(e);
          if (opts.newTab) onOpenTab(file.path, opts);
          else onRead(file.path);
        }}
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          onOpenTab(file.path, navFromEvent(e));
        }}
        title={name}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden />
        <span className="truncate">{name}</span>
        {warm && (
          <>
            <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
            <span className="sr-only">, just written</span>
          </>
        )}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground transition-opacity group-hover/file:opacity-0 group-focus-within/file:opacity-0">
          {formatBytes(file.bytes)}
        </span>
      </button>
      <ChevronRight
        className="pointer-events-none absolute top-1/2 right-3.5 size-3.5 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover/file:opacity-100 group-focus-within/file:opacity-100"
        aria-hidden
      />
    </li>
  );
}

/**
 * The session's working files (Sessions v2 Part 1), filling live as the agent
 * writes. The agent writes these WITHOUT an approval card, so the
 * nothing-silent principle is honoured differently here: by visibility and
 * disposability rather than by approval. That trade only holds if the tree is
 * genuinely live and every file is one glance from being read.
 *
 * Hence the rail is a reader, not an index: a file opens INSIDE it (rendered,
 * not raw), widening the column for prose and leaving the session in place
 * beside it. Working material is read while the run continues; sending the PM
 * to a tab for it would trade the thing they were watching for the thing they
 * glanced at. ⌘click and "open in a tab" keep the full-width route for a long
 * transcript.
 */
function SessionFilesPanel({ sessionId }: { sessionId: string }) {
  const { sessionFiles, openSessionFile } = useApp();
  const files = sessionFiles[sessionId] ?? [];
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  // Folders open by default: a fan-out writing into `per-item/` must be visible
  // as it happens, not behind a disclosure the PM has to think to open.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  // Returning from a preview puts focus back on the row it came from — the
  // keyboard path through the list must not reset to the top.
  const returnFocus = useRef<string | null>(null);

  const toggleDir = useCallback((path: string, force?: boolean) => {
    setCollapsed((prev) => {
      const shut = force === undefined ? !prev.has(path) : !force;
      if (shut === prev.has(path)) return prev;
      const next = new Set(prev);
      if (shut) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);
  // Relative stamps and the warm marks age on their own; nothing else ticks.
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, []);

  const closePreview = useCallback(() => {
    setPreviewPath((path) => {
      returnFocus.current = path;
      return null;
    });
  }, []);

  useEffect(() => {
    if (!previewPath) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) closePreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewPath, closePreview]);

  if (previewPath) {
    const meta = files.find((f) => f.path === previewPath);
    const Icon = fileIconFor(previewPath);
    const name = previewPath.slice(previewPath.lastIndexOf('/') + 1);
    return (
      <div className="flex h-full flex-col bg-card/40">
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-1.5">
          <ToolbarButton icon={ChevronLeft} label="Back to session files" keys={['esc']} onClick={closePreview} />
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {/* Same leaf as the page rail states; this bar only adds a way back.
              The file's name, not its path: the tree behind this bar already
              draws where it sits, so the path was chrome twice over. */}
          <span className="truncate text-xs font-medium text-foreground/80" title={name}>
            {name}
          </span>
          <ToolbarButton
            className="ml-auto"
            icon={SquareArrowOutUpRight}
            label="Open in a tab"
            onClick={() => openSessionFile(sessionId, previewPath, { newTab: true, foreground: true })}
          />
        </div>
        <div
          key={previewPath}
          className="min-h-0 flex-1 animate-in overflow-y-auto px-4 py-4 duration-150 fade-in-0 slide-in-from-right-1 motion-reduce:animate-none"
        >
          <SessionFileBody
            sessionId={sessionId}
            path={previewPath}
            version={meta?.mtime}
            onGone={
              <button
                className="rounded-md px-2 py-1 text-dense font-medium text-brand transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={closePreview}
              >
                Back to session files
              </button>
            }
          />
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-1.5 text-micro text-muted-foreground">
          <span className="truncate tabular-nums">
            {meta ? `${formatBytes(meta.bytes)} · written ${relativeTime(meta.mtime)}` : 'no longer on disk'}
          </span>
          <span className="ml-auto shrink-0">not part of your memory</span>
        </div>
      </div>
    );
  }

  const bytes = files.reduce((sum, f) => sum + f.bytes, 0);

  return (
    <div className="flex h-full flex-col bg-card/40">
      <PageHeader
        icon={FolderClosed}
        label="Session files"
        meta={files.length > 0 ? files.length : undefined}
      />
      {files.length === 0 ? (
        <p className="px-4 py-3.5 text-dense leading-relaxed text-muted-foreground">
          Nothing yet. Working material this session writes (a brief, per-item notes, a draft)
          shows up here to read. It never enters your memory, and you can ignore it.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          <DirRows
            dir={buildTree(files)}
            depth={0}
            collapsed={collapsed}
            onToggle={toggleDir}
            onRead={setPreviewPath}
            onOpenTab={(path, opts) => openSessionFile(sessionId, path, opts)}
            returnFocus={returnFocus}
          />
        </div>
      )}
      {files.length > 0 && (
        <div className="shrink-0 border-t border-border px-4 py-1.5 text-micro text-muted-foreground">
          {files.length} file{files.length === 1 ? '' : 's'} · {formatBytes(bytes)} · not part of your memory
        </div>
      )}
    </div>
  );
}
