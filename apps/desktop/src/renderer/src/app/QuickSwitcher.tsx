import { useEffect, useMemo, useState } from 'react';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@qale/ui';
import {
  Bot,
  CalendarDays,
  FileText,
  Files,
  Hash,
  History,
  House,
  Library,
  ListTodo,
  MessageSquare,
  ScrollText,
  Settings,
  Sparkles,
  SquarePen,
  StickyNote,
  Wand2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { noteTypeLabel } from '@qale/domain';
import type { SearchHitDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { noteTypeIcon } from '../lib/note-icons';
import { providerRows } from '../lib/providers';
import { SETTINGS_SECTIONS } from '../lib/settings-sections';
import { collectContexts } from '../lib/contexts';

interface CommandSpec {
  id: string;
  label: string;
  /** Extra words this action answers to, matched but never shown. */
  keywords?: string;
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
  const {
    search,
    openDoc,
    openHome,
    openChats,
    openTodos,
    openCalendar,
    openDocuments,
    openMemory,
    openActivity,
    openSession,
    openSettings,
    openSkills,
    openContext,
    openFolder,
    connections,
    tree,
    tabs,
    waitingCount,
  } = useApp();
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
        id: 'home',
        label: 'Go Home: what’s waiting, and what to start',
        hint: '⇧⌘H',
        icon: House,
        run: openHome,
      },
      {
        id: 'chats',
        // The same number the sidebar badge prints, in the same words: one
        // attention list, one count (lib/attention.ts).
        label:
          waitingCount > 0
            ? `Open Sessions: ${waitingCount} need${waitingCount === 1 ? 's' : ''} you`
            : 'Open Sessions',
        keywords: 'chats runs proposals questions',
        icon: History,
        run: openChats,
      },
      { id: 'new-note', label: 'New document', hint: '⌘N', icon: SquarePen, run: onNewNote },
      {
        id: 'capture',
        label: 'Capture anything: transcript, link, screenshot',
        hint: '⇧⌘N',
        icon: StickyNote,
        run: onOpenCapture,
      },
      {
        id: 'calendar',
        label: 'Open Calendar: what is coming, and what happened',
        keywords: 'meetings schedule week',
        icon: CalendarDays,
        run: openCalendar,
      },
      {
        id: 'todos',
        label: 'Open Todos: commitments, yours and theirs',
        icon: ListTodo,
        run: openTodos,
      },
      {
        id: 'documents',
        label: 'Open Documents: the pages you write',
        keywords: 'notes briefs specs folders',
        icon: Files,
        run: () => openDocuments(''),
      },
      {
        id: 'memory',
        label: 'Open Memory: what Qale knows, and where it got it',
        keywords: 'sources decisions insights themes customers people',
        icon: Library,
        run: openMemory,
      },
      {
        id: 'activity',
        label: 'Open Activity: every write I made on my own, and the way back',
        keywords: 'activity history undo revert receipt changes silent',
        icon: ScrollText,
        run: openActivity,
      },
      // One entry, not two. "Ask the memory" and "New session" opened the same
      // blank composer by two names, which is the confusion this list is
      // supposed to end.
      {
        id: 'ask',
        label: 'New session',
        hint: '⌘↵',
        icon: Sparkles,
        run: () => openSession('ask'),
      },
      // Named as the skill names itself — ⌘K and the composer's picker must not
      // call the same playbook two different things.
      {
        id: 'weekly',
        label: 'Write the weekly update',
        icon: MessageSquare,
        run: () => openSession('weekly-update'),
      },
      {
        id: 'skills',
        label: 'Open Skills: what the agent does when you hand work over',
        icon: Wand2,
        run: () => openSkills(),
      },
      // The Agents page folded into the Skills page (SK-12), so this row aims
      // at that tab. Its own words stay: nobody looking for an off switch
      // searches for "skills".
      {
        id: 'agents',
        label: 'Open Agents: what runs on its own, and its off switches',
        icon: Bot,
        run: () => openSkills('agents'),
      },
      {
        id: 'settings',
        label: 'Open Settings',
        hint: '⌘,',
        icon: Settings,
        run: () => openSettings(),
      },
    ],
    [
      waitingCount,
      openHome,
      openChats,
      openTodos,
      openCalendar,
      openDocuments,
      openMemory,
      openActivity,
      openSession,
      openSkills,
      openSettings,
      onOpenCapture,
      onNewNote,
    ],
  );

  /**
   * One row per connected system, the same rows the rail draws
   * (docs/memory-placement.md). ⌘K reaches every place, so a place that only
   * exists while a connection does still has to be typeable.
   */
  const systemCommands = useMemo<CommandSpec[]>(
    () =>
      providerRows(connections, tree).map((row) => ({
        id: `provider:${row.dir}`,
        label:
          row.kind === 'wikipage'
            ? `Open ${row.label}: pages Qale copied from your wiki`
            : `Open ${row.label}: tickets Qale copied from your tracker`,
        keywords: row.providerId,
        icon: noteTypeIcon(row.kind),
        run: () => openFolder(row.dir),
      })),
    [connections, tree, openFolder],
  );

  /**
   * One row per Settings tab, and only while something is typed. Settings is
   * where the app keeps the things you look for by name rather than by place —
   * the API key, the port, the crash reports — so ⌘K matches on what a panel
   * holds, not just on what it is called. Hidden on the empty query because
   * seven more rows would bury the actions above them.
   */
  const settingsCommands = useMemo<CommandSpec[]>(
    () =>
      SETTINGS_SECTIONS.map((s) => ({
        id: `settings:${s.id}`,
        label: `Settings: ${s.label}`,
        keywords: s.keywords,
        icon: s.icon,
        run: () => openSettings(s.id),
      })),
    [openSettings],
  );

  const q = query.trim().toLowerCase();
  const matchedCommands = q
    ? [...commands, ...systemCommands, ...settingsCommands].filter((c) =>
        `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q),
      )
    : [...commands, ...systemCommands];
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
        <CommandInput
          placeholder="Search the workspace or run an action…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>{q ? 'No matches.' : 'Type to search the workspace.'}</CommandEmpty>

          {/* Search reaches every type, so the heading cannot name one of them.
              "Documents" belongs to the `note` folder now (SB-3). */}
          {hits.length > 0 && (
            <CommandGroup heading="Pages">
              {hits.map((h) => (
                <CommandItem
                  key={h.path}
                  value={h.path}
                  onSelect={() => runAndClose(() => void openDoc(h.path))}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{h.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {/* A mirror names its source system, not our folder. */}
                      {noteTypeLabel(h.type)} · {h.summary}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {matchedContexts.length > 0 && (
            <CommandGroup heading="Tags">
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
                  <CommandItem
                    key={t.id}
                    value={`open-${t.id}`}
                    onSelect={() => runAndClose(() => void openDoc(t.path))}
                  >
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
