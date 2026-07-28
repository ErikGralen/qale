import { useEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { BacklinkDTO } from '@pm/ipc';
import { Badge, Button, Separator } from '@pm/ui';
import { CalendarDays, ChevronRight, Link2, MoreHorizontal, Pin, Play, Sparkles, Trash2, History } from 'lucide-react';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { noteTypeIcon } from '../lib/note-icons';
import { Markdown } from '../components/Markdown';
import { MeetingDelivery } from '../components/DeliveryStrip';
import { NoteEditor } from '../components/NoteEditor';
import { NoteHistory } from '../components/NoteHistory';
import { PropertiesBlock } from '../components/PropertiesBlock';
import { askSelectionSeed, beforeMeetingSeed, handleTodoSeed, processNoteSeed } from '../lib/agent-nudges';
import { localDateStr } from '../lib/dates';

/** "today 14:00" / "tomorrow" / "in 3d" — when the meeting starts, or null if past. */
function upcomingLabel(frontmatter: Record<string, unknown>): string | null {
  const date = typeof frontmatter['date'] === 'string' ? frontmatter['date'] : null;
  if (!date) return null;
  const time = typeof frontmatter['time'] === 'string' ? frontmatter['time'] : null;
  const iso = time && !date.includes('T') ? `${date}T${time}` : date;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t <= Date.now()) return null;
  if (new Date(t).toDateString() === new Date().toDateString()) return time ? `today ${time}` : 'today';
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

/**
 * The note's display name — an input styled as the page h1. Commits on blur or
 * Enter (which hands focus to the body); Escape reverts. A fresh untitled note
 * arrives with the title selected, so typing replaces it immediately.
 */
function TitleEditor({
  value,
  autoFocus,
  onCommit,
}: {
  value: string;
  autoFocus: boolean;
  onCommit: (title: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      className="mb-1 w-full rounded-md bg-transparent font-serif text-2xl font-semibold tracking-tight placeholder:text-muted-foreground/40 focus-visible:outline-none"
      value={draft}
      placeholder="Untitled"
      autoFocus={autoFocus}
      onFocus={(e) => {
        if (autoFocus) e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      onBlur={() => {
        const next = draft.trim();
        if (next && next !== value) onCommit(next);
        else setDraft(value);
      }}
      aria-label="Note title"
    />
  );
}

/**
 * Overflow for the note's occasional/destructive actions — version history and
 * delete — kept out of the header's resting state so it reads as a location bar,
 * not an editor toolbar. Fixed-positioned to escape the header's flow (same
 * approach as the tab strip's context menu).
 */
function NoteActionsMenu({ onHistory, onDelete }: { onHistory: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    setOpen((o) => !o);
  };

  const items: { label: string; icon: LucideIcon; action: () => void; danger?: boolean }[] = [
    { label: 'Version history', icon: History, action: onHistory },
    { label: 'Delete note', icon: Trash2, action: onDelete, danger: true },
  ];

  return (
    <>
      <button
        ref={btnRef}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-expanded:bg-accent aria-expanded:text-foreground"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More actions"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div
            role="menu"
            aria-label="Note actions"
            className="fixed z-50 min-w-44 rounded-lg border border-border bg-card py-1 shadow-md"
            style={{ top: pos.top, right: pos.right }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] focus-visible:outline-none ${
                  item.danger
                    ? 'text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10'
                    : 'hover:bg-accent focus-visible:bg-accent'
                }`}
                onClick={() => {
                  item.action();
                  setOpen(false);
                }}
              >
                <item.icon className="size-3.5" aria-hidden />
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** Typed groups first, alphabetical; untyped mentions last as "Linked from". */
function groupBacklinks(backlinks: BacklinkDTO[]): { label: string; items: BacklinkDTO[] }[] {
  const groups = new Map<string, BacklinkDTO[]>();
  for (const b of backlinks) {
    const label = b.typeLabel ?? 'Linked from';
    const items = groups.get(label) ?? [];
    items.push(b);
    groups.set(label, items);
  }
  return [...groups.entries()]
    .map(([label, items]) => ({ label, items }))
    .sort((a, b) =>
      a.label === 'Linked from' ? 1 : b.label === 'Linked from' ? -1 : a.label.localeCompare(b.label),
    );
}

export function NoteView({ path }: { path: string }) {
  const { docData, openDoc, openFolder, loadDoc, saveNote, renameNote, deleteNote, openSession, favorites, toggleFavorite, search } =
    useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const data = docData[path];
  const currentNote = data?.note ?? null;
  const backlinks = data?.backlinks ?? [];

  // Tabs restored from localStorage (or opened in the background) have no
  // docData yet — only the active tab is loaded at boot. Fetch on first view;
  // `data` present-but-null means the load already ran and found nothing.
  useEffect(() => {
    if (!data) void loadDoc(path);
  }, [data, loadDoc, path]);

  if (!currentNote) {
    return (
      <div className="flex h-full flex-col">
        <div className="h-10 border-b border-border" />
        <div className="mx-auto w-full max-w-2xl flex-1 px-14 py-6">
          <div className="mb-3 h-4 w-24 animate-pulse rounded bg-muted" />
          <div className="mb-4 h-7 w-2/3 animate-pulse rounded bg-muted" />
          <div className="space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-muted/70" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-muted/70" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted/70" />
          </div>
        </div>
      </div>
    );
  }

  const editable = currentNote.bodyEditable;
  const stance = currentNote.frontmatter['stance'] as string | undefined;
  // An upcoming meeting without prep gets the brief offer here,
  // on the page it would write to — never as an inbox item.
  // Synced-meeting chrome (google-calendar mirror): a quiet glyph + open link,
  // and cancelled renders as state, never as a nudge.
  const syncedMeeting =
    currentNote.type === 'meeting' && currentNote.frontmatter['provider'] === 'google-calendar';
  const eventCancelled =
    currentNote.type === 'meeting' && currentNote.frontmatter['event_status'] === 'cancelled';
  const eventUrl =
    syncedMeeting && typeof currentNote.frontmatter['url'] === 'string'
      ? currentNote.frontmatter['url']
      : null;
  const upcoming =
    currentNote.type === 'meeting' && !eventCancelled ? upcomingLabel(currentNote.frontmatter) : null;
  const offerBrief = upcoming !== null && !/^## Prep\b/m.test(currentNote.body);
  // An open commitment can be handed to the memory to plan/close/reschedule.
  const todoOpen =
    currentNote.type === 'todo' && (currentNote.frontmatter['status'] ?? 'open') === 'open';
  const sessionSkill =
    currentNote.type === 'skill' && currentNote.frontmatter['skill_kind'] === 'session'
      ? (currentNote.frontmatter['session_type'] as string | undefined)
      : undefined;

  // The path as a location, not a raw file label: type glyph → folder (opens
  // it) → filename. Root-level notes drop the folder segment.
  const slash = currentNote.path.lastIndexOf('/');
  const folder = slash >= 0 ? currentNote.path.slice(0, slash) : null;
  const filename = slash >= 0 ? currentNote.path.slice(slash + 1) : currentNote.path;
  const TypeIcon = noteTypeIcon(currentNote.type);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-border px-4">
        <nav aria-label="Location" className="flex min-w-0 items-center gap-1 text-xs">
          <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {folder && (
            <>
              <button
                className="shrink-0 rounded px-1 py-0.5 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={(e) => openFolder(folder, navFromEvent(e))}
                title={`Open ${folder}`}
              >
                {folder}
              </button>
              <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" aria-hidden />
            </>
          )}
          <span className="truncate font-mono text-foreground/80" title={currentNote.path}>
            {filename}
          </span>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          {sessionSkill && (
            <Button size="sm" onClick={() => openSession(sessionSkill, { title: currentNote.title })}>
              <Play className="size-3.5" /> Start session
            </Button>
          )}
          {currentNote.type === 'note' && editable && (
            <Button
              size="sm"
              onClick={() =>
                openSession('process-note', {
                  initialPrompt: processNoteSeed(currentNote.path),
                  title: `Process — ${currentNote.title}`,
                  fresh: true,
                })
              }
              title="Work this note into the memory — clean it up, update the pages it touches, file what it implies — all as approval cards. Re-run anytime after adding more."
            >
              <Sparkles className="size-3.5" /> Process
            </Button>
          )}
          {todoOpen && (
            <Button
              size="sm"
              onClick={() =>
                openSession('commitment-check', {
                  initialPrompt: handleTodoSeed(
                    {
                      path: currentNote.path,
                      title: currentNote.title,
                      due: typeof currentNote.frontmatter['due'] === 'string' ? currentNote.frontmatter['due'] : null,
                      owner: typeof currentNote.frontmatter['owner'] === 'string' ? currentNote.frontmatter['owner'] : null,
                    },
                    localDateStr(),
                  ),
                  title: `Handle — ${currentNote.title}`,
                  fresh: true,
                })
              }
              title="Help me handle this commitment — the memory proposes a plan, a close, or a reschedule as approval cards."
            >
              <Sparkles className="size-3.5" /> Help me handle this
            </Button>
          )}
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 pl-1">
              <span className="text-xs text-muted-foreground">Delete this note?</span>
              <Button size="sm" variant="destructive" onClick={() => void deleteNote(currentNote.path)}>
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-0.5 pl-1">
              <button
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => toggleFavorite(currentNote.path)}
                aria-pressed={favorites.includes(currentNote.path)}
                aria-label={favorites.includes(currentNote.path) ? 'Unpin' : 'Pin to keep on the sidebar'}
                title={favorites.includes(currentNote.path) ? 'Unpin' : 'Pin — keep on the sidebar'}
              >
                <Pin className={`size-4 ${favorites.includes(currentNote.path) ? 'fill-brand text-brand' : ''}`} />
              </button>
              <NoteActionsMenu onHistory={() => setShowHistory(true)} onDelete={() => setConfirmDelete(true)} />
            </div>
          )}
        </div>
      </div>

      {/* px-14: the left gutter must seat the block handle (+ ⋮⋮, 54px) without
          clipping against the panel edge. */}
      <div className="flex-1 overflow-y-auto px-14 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="capitalize">
              {currentNote.type}
            </Badge>
            {stance && <Badge className="capitalize">{stance}</Badge>}
            {currentNote.frontmatter['status'] === 'superseded' && <Badge variant="outline">superseded</Badge>}
            {eventCancelled && <Badge variant="outline">cancelled</Badge>}
            {syncedMeeting &&
              (eventUrl ? (
                <a
                  href={eventUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  title="Open in Google Calendar"
                >
                  <CalendarDays className="size-3.5" aria-hidden /> Google Calendar
                </a>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Synced from Google Calendar">
                  <CalendarDays className="size-3.5" aria-hidden /> Google Calendar
                </span>
              ))}
          </div>
          {currentNote.type === 'session' ? (
            <h1 className="mb-1 font-serif text-2xl font-semibold tracking-tight">{currentNote.title}</h1>
          ) : (
            <TitleEditor
              key={`${currentNote.path}:${currentNote.title}`}
              value={currentNote.title}
              autoFocus={currentNote.title.toLowerCase() === 'untitled' && !currentNote.body.trim()}
              onCommit={(title) => {
                // Rejected rename (immutable title, main-side error) → resync to
                // file truth so the input never lies about what was saved.
                renameNote(currentNote.path, title).catch(() => void loadDoc(currentNote.path));
              }}
            />
          )}
          <PropertiesBlock key={currentNote.path} note={currentNote} />

          {/* Delivery truth for this meeting's series — the "since last time"
              deltas from the mirror live here, on the page they brief. */}
          {currentNote.type === 'meeting' && (
            <MeetingDelivery path={currentNote.path} onOpen={(p) => void openDoc(p)} />
          )}

          {offerBrief && (
            <div className="mb-4 flex items-center gap-2.5 rounded-lg bg-brand/6 px-3 py-2 ring-1 ring-brand/20">
              <Sparkles className="size-4 shrink-0 text-brand" aria-hidden />
              <p className="min-w-0 flex-1 text-sm">
                Happening {upcoming} — the memory can brief you: what changed since these people were
                last told, open questions, loose ends. One approval card writes it here.
              </p>
              <Button
                size="sm"
                onClick={() =>
                  openSession('before-meeting', {
                    initialPrompt: beforeMeetingSeed(currentNote.path),
                    title: `Brief — ${currentNote.title}`,
                    fresh: true,
                  })
                }
              >
                Get the brief
              </Button>
            </div>
          )}

          {!editable && (
            <div className="mb-4 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {currentNote.type === 'decision'
                ? 'Decisions are append-only — the body is never edited. To change course, supersede this decision; only its status flips.'
                : `This is a ${currentNote.type} — its body is immutable. Edit metadata via the properties above.`}
            </div>
          )}

          {editable ? (
            <NoteEditor
              key={currentNote.path}
              body={currentNote.body}
              onSave={(body) => saveNote(currentNote.path, body)}
              onOpenNote={openDoc}
              searchNotes={search}
              onAsk={(text) =>
                openSession('ask', {
                  initialPrompt: askSelectionSeed(currentNote.path, text),
                  title: `Ask — ${currentNote.title}`,
                  fresh: true,
                })
              }
            />
          ) : (
            <Markdown content={currentNote.body} onOpenNote={openDoc} />
          )}

          <Separator className="my-6" />

          {/* Inbound edges grouped by relationship (docs/typed-links.md):
              typed groups first ("Blocked by", "Evidence for"), the untyped
              mentions last under the familiar "Linked from". */}
          {backlinks.length === 0 ? (
            <>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Link2 className="size-3.5" /> Linked from (0)
              </div>
              <p className="text-sm text-muted-foreground">No backlinks yet.</p>
            </>
          ) : (
            groupBacklinks(backlinks).map(({ label, items }) => (
              <div key={label} className="mb-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Link2 className="size-3.5" /> {label} ({items.length})
                </div>
                <ul className="flex flex-col gap-1">
                  {items.map((b) => (
                    <li key={`${b.from.path}:${b.type ?? ''}`}>
                      <button
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                        onClick={(e) => openDoc(b.from.path, navFromEvent(e))}
                        onAuxClick={(e) => e.button === 1 && void openDoc(b.from.path, navFromEvent(e))}
                      >
                        <span className="font-medium">{b.from.title}</span>
                        <span className="truncate text-xs text-muted-foreground">{b.from.summary}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
      <NoteHistory path={currentNote.path} open={showHistory} onOpenChange={setShowHistory} />
    </div>
  );
}
