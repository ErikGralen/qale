import { useEffect, useState } from 'react';
import { FileText, FolderClosed, MessageSquare, MessageSquarePlus } from 'lucide-react';
import type { ChatRefDTO, SessionFileDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { ChatView } from './ChatView';

/**
 * The note's chat corner, or — on a session tab — that session's working files.
 * Properties moved into the document itself (the PropertiesBlock under the
 * title), so the doc side of the panel is chat-only.
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
        <div className="flex h-10 items-center border-b border-border px-4 text-sm font-medium text-muted-foreground">
          Context
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card/40">
      <div className="flex h-10 items-center gap-1.5 border-b border-border px-4 text-sm font-medium text-muted-foreground">
        <MessageSquare className="size-3.5" /> Chat
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <SideChat key={`side-${note.path}`} path={note.path} title={note.title} />
      </div>
    </div>
  );
}

/**
 * The note's chat corner: resume any conversation that touched this note, or
 * start a fresh one scoped to it.
 */
function SideChat({ path, title }: { path: string; title: string }) {
  const [related, setRelated] = useState<ChatRefDTO[]>([]);
  // nonce forces a remount for "new chat"; id undefined = fresh scoped chat.
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

  const selected = selection.id ? related.find((c) => c.id === selection.id) : undefined;

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
            aria-label="Conversation about this note"
          >
            <option value="">New chat about this note</option>
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
              aria-label="Start a new chat about this note"
              title="New chat about this note"
            >
              <MessageSquarePlus className="size-4" />
            </button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ChatView
          key={`${selection.id ?? 'new'}:${selection.nonce}`}
          sessionType={selected?.sessionType ?? 'ask'}
          sessionId={selection.id}
          scopeHint={
            selection.id
              ? undefined
              : `I'm looking at ${path} — "${title}". Answer with citations from the workspace.`
          }
        />
      </div>
    </>
  );
}

/** Human byte size for the tree footer — a size, not a precision instrument. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Group a flat list of folder-relative paths into a one-level folder tree. */
function group(files: SessionFileDTO[]): { dir: string; files: SessionFileDTO[] }[] {
  const byDir = new Map<string, SessionFileDTO[]>();
  for (const f of files) {
    const idx = f.path.lastIndexOf('/');
    const dir = idx === -1 ? '' : f.path.slice(0, idx);
    const list = byDir.get(dir);
    if (list) list.push(f);
    else byDir.set(dir, [f]);
  }
  // Root files first, then folders alphabetically — a brief.md written before
  // the fan-out should stay at the top as the per-item files pile in below it.
  return [...byDir.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .map(([dir, list]) => ({ dir, files: list }));
}

/**
 * The session's working files (Sessions v2 Part 1), filling live as the agent
 * writes. The agent writes these WITHOUT an approval card, so the
 * nothing-silent principle is honoured differently here: by visibility and
 * disposability rather than by approval. That trade only holds if the tree is
 * genuinely live and every file is one click from being read — hence the push
 * refresh and the plain rows.
 */
function SessionFilesPanel({ sessionId }: { sessionId: string }) {
  const { sessionFiles, openSessionFile, activeTab } = useApp();
  const files = sessionFiles[sessionId] ?? [];
  const openPath = activeTab?.kind === 'sessionFile' ? activeTab.path : null;
  const bytes = files.reduce((sum, f) => sum + f.bytes, 0);

  return (
    <div className="flex h-full flex-col bg-card/40">
      <div className="flex h-10 items-center gap-1.5 border-b border-border px-4 text-sm font-medium text-muted-foreground">
        <FolderClosed className="size-3.5" /> Session files
      </div>
      {files.length === 0 ? (
        <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Nothing yet. Working material this conversation writes shows up here — it is never part of
          your memory, and you can ignore it.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {group(files).map(({ dir, files: rows }) => (
            <div key={dir || '.'}>
              {dir && (
                <div className="px-4 pt-2 pb-0.5 font-mono text-[11px] text-muted-foreground">{dir}/</div>
              )}
              {rows.map((f) => (
                <button
                  key={f.path}
                  className={`flex w-full items-center gap-1.5 px-4 py-1 text-left text-xs hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                    openPath === f.path ? 'bg-accent text-foreground' : 'text-muted-foreground'
                  }`}
                  onClick={() => openSessionFile(sessionId, f.path)}
                  title={f.path}
                >
                  <FileText className="size-3 shrink-0" />
                  <span className="truncate">{f.path.slice(dir ? dir.length + 1 : 0)}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{formatBytes(f.bytes)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
          {files.length} file{files.length === 1 ? '' : 's'} · {formatBytes(bytes)} · not part of your memory
        </div>
      )}
    </div>
  );
}
