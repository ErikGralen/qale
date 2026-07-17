import { useEffect, useState } from 'react';
import { MessageSquare, MessageSquarePlus } from 'lucide-react';
import type { ChatRefDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { ChatView } from './ChatView';

/**
 * The note's chat corner. Properties moved into the document itself (the
 * PropertiesBlock under the title), so the panel is chat-only.
 */
export function RightPanel() {
  const { activeTab, docData } = useApp();
  const path = activeTab?.kind === 'doc' ? activeTab.path : null;
  const note = path ? docData[path]?.note ?? null : null;

  if (!note) {
    return (
      <div className="flex h-full flex-col border-l border-border bg-card/40">
        <div className="flex h-9 items-center border-b border-border px-4 text-sm font-medium text-muted-foreground">
          Context
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col border-l border-border bg-card/40">
      <div className="flex h-9 items-center gap-1.5 border-b border-border px-4 text-sm font-medium text-muted-foreground">
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
