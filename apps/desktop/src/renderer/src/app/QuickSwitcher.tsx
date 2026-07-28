import { useEffect, useMemo, useState } from 'react';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@pm/ui';
import { FileText, Hash, Inbox, Library, ListTodo, MessageSquare, Settings, Sparkles, SquarePen, StickyNote } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SearchHitDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { collectContexts } from '../lib/contexts';

interface CommandSpec {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  run: () => void;
}

/**
 * ⌘K — the primary navigation instrument. Empty query surfaces the core
 * actions and the open documents; typing searches the FTS5 index over IPC
 * (no second search engine) and filters the actions alongside.
 */
export function QuickSwitcher({
  open,
  onOpenChange,
  onOpenCapture,
  onNewNote,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onOpenCapture: () => void;
  onNewNote: () => void;
}) {
  const { search, openDoc, openInbox, openTodos, openMemory, openSession, openSettings, openContext, tree, tabs, pendingCount } = useApp();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHitDTO[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const results = await search(query);
      if (alive) setHits(results);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, search]);

  const commands = useMemo<CommandSpec[]>(
    () => [
      {
        id: 'inbox',
        label: pendingCount > 0 ? `Open Inbox — ${pendingCount} pending` : 'Open Inbox',
        icon: Inbox,
        run: openInbox,
      },
      { id: 'new-note', label: 'New note', hint: '⌘N', icon: SquarePen, run: onNewNote },
      { id: 'capture', label: 'Capture anything — transcript, link, screenshot', hint: '⇧⌘N', icon: StickyNote, run: onOpenCapture },
      { id: 'todos', label: 'Open Todos — commitments, yours and theirs', icon: ListTodo, run: openTodos },
      { id: 'memory', label: 'Browse memory — sources, insights, customers, people', icon: Library, run: openMemory },
      { id: 'ask', label: 'Ask the memory', hint: '⌘↵', icon: Sparkles, run: () => openSession('ask') },
      { id: 'weekly', label: 'Run Weekly Update', icon: MessageSquare, run: () => openSession('weekly-update') },
      { id: 'chat', label: 'New chat', icon: MessageSquare, run: () => openSession('chat', { fresh: true }) },
      { id: 'settings', label: 'Open Settings', icon: Settings, run: openSettings },
    ],
    [pendingCount, openInbox, openTodos, openMemory, openSession, openSettings, onOpenCapture, onNewNote],
  );

  const q = query.trim().toLowerCase();
  const matchedCommands = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  const openDocs = q ? [] : tabs.filter((t) => t.kind === 'doc');
  // Contexts are first-class results: `#pricing` or just `pricing` finds the page.
  const contexts = useMemo(() => collectContexts(tree), [tree]);
  const matchedContexts = q
    ? contexts.filter((c) => c.tag.toLowerCase().includes(q.replace(/^#/, ''))).slice(0, 5)
    : contexts.slice(0, 4);

  const runAndClose = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search the workspace or run an action…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{q ? 'No matches.' : 'Type to search the workspace.'}</CommandEmpty>

          {hits.length > 0 && (
            <CommandGroup heading="Notes">
              {hits.map((h) => (
                <CommandItem key={h.path} value={h.path} onSelect={() => runAndClose(() => void openDoc(h.path))}>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{h.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {h.type} · {h.summary}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {matchedContexts.length > 0 && (
            <CommandGroup heading="Contexts">
              {matchedContexts.map((c) => (
                <CommandItem
                  key={c.tag}
                  value={`ctx-${c.tag}`}
                  onSelect={() => runAndClose(() => openContext(c.tag))}
                >
                  <Hash className="size-4 text-brand" />
                  <span className="flex-1">{c.tag}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{c.count}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {openDocs.length > 0 && (
            <CommandGroup heading="Open documents">
              {openDocs.map((t) =>
                t.kind === 'doc' ? (
                  <CommandItem key={t.id} value={`open-${t.id}`} onSelect={() => runAndClose(() => void openDoc(t.path))}>
                    <FileText className="size-4 text-muted-foreground" />
                    <span className="truncate">{t.title}</span>
                  </CommandItem>
                ) : null,
              )}
            </CommandGroup>
          )}

          {matchedCommands.length > 0 && (
            <CommandGroup heading="Actions">
              {matchedCommands.map((c) => (
                <CommandItem key={c.id} value={`cmd-${c.id}`} onSelect={() => runAndClose(c.run)}>
                  <c.icon className="size-4 text-muted-foreground" />
                  <span className="flex-1">{c.label}</span>
                  {c.hint && <span className="text-xs text-muted-foreground">{c.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
