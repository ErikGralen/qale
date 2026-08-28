import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isMirrorType,
  lifecycleValue,
  lifecycleValueLabel,
  noteTypeLabel,
  readOnlyReason,
  transcriptRefs,
} from '@qale/domain';
import type { BacklinkDTO } from '@qale/ipc';
import { Badge, Button } from '@qale/ui';
import {
  CalendarDays,
  CheckCheck,
  ChevronRight,
  Link2,
  Lock,
  MessageSquare,
  Mic,
  Pin,
  Sparkles,
  Trash2,
  History,
} from 'lucide-react';
import { useApp, type SessionOverview } from '../state/app-state';
import { useAimedDrop } from '../lib/aimed-drop';
import { requestCapture } from '../lib/capture-event';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { noteTypeIcon } from '../lib/note-icons';
import { Markdown } from '../components/Markdown';
import { HeaderAction, HeaderActions, HeaderMenu, PageHeader } from '../components/PageHeader';
import { MeetingDelivery } from '../components/DeliveryStrip';
import { NoteEditor } from '../components/NoteEditor';
import { NoteHistory } from '../components/NoteHistory';
import { PropertiesBlock } from '../components/PropertiesBlock';
import { TitleEditor } from '../components/TitleEditor';
import { SkillAgentPage } from './SkillAgentPage';
import {
  askSelectionSeed,
  beforeMeetingSeed,
  handleTodoSeed,
  processNoteSeed,
  readMeetingSeed,
} from '../lib/agent-nudges';
import { localDateStr } from '../lib/dates';

/** "today 14:00" / "tomorrow" / "in 3d" — when the meeting starts, or null if past. */
function upcomingLabel(frontmatter: Record<string, unknown>): string | null {
  const date = typeof frontmatter['date'] === 'string' ? frontmatter['date'] : null;
  if (!date) return null;
  const time = typeof frontmatter['time'] === 'string' ? frontmatter['time'] : null;
  const iso = time && !date.includes('T') ? `${date}T${time}` : date;
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t <= Date.now()) return null;
  if (new Date(t).toDateString() === new Date().toDateString())
    return time ? `today ${time}` : 'today';
  const days = Math.ceil((t - Date.now()) / 86_400_000);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
}

const LINKS_OPEN_KEY = 'qale.note.links.open';

/**
 * A session receipt cites every note the run touched, as `reads` and `writes`.
 * On the note side that grew two headings, "Reads" and "Writes", on every page
 * a session ever opened, and the difference between them is the run's business,
 * not the page's. They fold into one "Sessions" group, so "this decision was
 * taken in that run" is still one click, at the cost of one line.
 */
const SESSION_EDGES = new Set(['reads', 'writes']);
const SESSIONS = 'Sessions';
const UNTYPED = 'Linked from';

/** Where a group sits: named relationships first, the two quiet ones last. */
function groupOrder(label: string): number {
  return label === SESSIONS ? 2 : label === UNTYPED ? 1 : 0;
}

/** Typed groups first, alphabetical; untyped mentions and sessions last. */
function groupBacklinks(backlinks: BacklinkDTO[]): { label: string; items: BacklinkDTO[] }[] {
  const groups = new Map<string, BacklinkDTO[]>();
  for (const b of backlinks) {
    const session = b.type !== undefined && SESSION_EDGES.has(b.type);
    const label = session ? SESSIONS : (b.typeLabel ?? UNTYPED);
    const items = groups.get(label) ?? [];
    // One row per session: a run that read AND wrote this note arrives twice.
    if (session && items.some((i) => i.from.path === b.from.path)) continue;
    items.push(b);
    groups.set(label, items);
  }
  return [...groups.entries()]
    .map(([label, items]) => ({ label, items }))
    .sort((a, b) => groupOrder(a.label) - groupOrder(b.label) || a.label.localeCompare(b.label));
}

/**
 * Inbound edges as a quiet footer: one folded row under the note, titles only.
 * What links here is context for the page, not part of it, so it stays out of
 * the way until asked for — and the preference sticks once you open it.
 */
function LinksSection({
  backlinks,
  onOpen,
}: {
  backlinks: BacklinkDTO[];
  onOpen: (path: string, opts?: NavOpts) => void;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(LINKS_OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen((was) => {
      try {
        localStorage.setItem(LINKS_OPEN_KEY, was ? '0' : '1');
      } catch {
        /* private-mode / file:// builds just lose the preference */
      }
      return !was;
    });
  };
  const groups = groupBacklinks(backlinks);
  // What the list actually shows: grouping drops a session that both read and
  // wrote the note, and a count nobody can find the rows for is a wrong count.
  const count = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <section className="mt-8 border-t border-border/60 pt-3">
      <button
        className="flex items-center gap-1.5 rounded-md py-0.5 text-xs text-muted-foreground/80 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:hover:text-muted-foreground/80"
        onClick={toggle}
        aria-expanded={count > 0 ? open : undefined}
        disabled={count === 0}
      >
        <ChevronRight
          className={`size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${
            open ? 'rotate-90' : ''
          } ${count === 0 ? 'opacity-0' : ''}`}
          aria-hidden
        />
        <Link2 className="size-3.5 shrink-0" aria-hidden />
        {count === 0 ? 'Nothing links here yet' : `Links (${count})`}
      </button>

      {count > 0 && (
        <div
          className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
            open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-3 pt-2 pb-1">
              {groups.map(({ label, items }) => (
                <div key={label}>
                  <div className="px-1 text-[11px] tracking-wide text-muted-foreground/70 uppercase">
                    {label}
                  </div>
                  <ul className="mt-0.5">
                    {items.map((b) => {
                      const Icon = noteTypeIcon(b.from.type);
                      return (
                        <li key={`${b.from.path}:${b.type ?? ''}`}>
                          <button
                            className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            onClick={(e) => onOpen(b.from.path, navFromEvent(e))}
                            onAuxClick={(e) =>
                              e.button === 1 && onOpen(b.from.path, navFromEvent(e))
                            }
                            tabIndex={open ? undefined : -1}
                          >
                            <Icon
                              className="size-3.5 shrink-0 text-muted-foreground/70"
                              aria-hidden
                            />
                            <span className="truncate">{b.from.title}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The stored conversation a session receipt was filed from, or null if it is no
 * longer in the chat store. `session_id` is the join; receipts written before
 * that field existed end in the id's first 8 characters, which is the same
 * fallback the main process uses to answer "which chats touched this note".
 */
function chatForReceipt(
  path: string,
  frontmatter: Record<string, unknown>,
  sessions: SessionOverview[],
): SessionOverview | null {
  const id = frontmatter['session_id'];
  if (typeof id === 'string') return sessions.find((s) => s.id === id) ?? null;
  const m = /-([0-9a-f]{8})\.md$/.exec(path);
  return m ? (sessions.find((s) => s.id.startsWith(m[1]!)) ?? null) : null;
}

export function NoteView({ path }: { path: string }) {
  const {
    docData,
    openDoc,
    openFolder,
    loadDoc,
    saveNote,
    renameNote,
    deleteNote,
    openSession,
    openChat,
    sessions,
    favorites,
    toggleFavorite,
    search,
    markMeetingReviewed,
  } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // The live editor's "save what's typed, now". Restoring a version replaces
  // the body underneath it, and an unsaved keystroke would otherwise win and
  // then autosave straight back over the restore.
  const editorFlush = useRef<(() => Promise<void>) | null>(null);
  const registerFlush = useCallback((flush: () => Promise<void>) => {
    editorFlush.current = flush;
  }, []);
  /** The live editor's cursor, for the empty-meeting block's second door. */
  const editorFocus = useRef<(() => void) | null>(null);
  const registerFocus = useCallback((focus: () => void) => {
    editorFocus.current = focus;
  }, []);
  const flushEdits = useCallback(() => editorFlush.current?.() ?? Promise.resolve(), []);
  const data = docData[path];
  const currentNote = data?.note ?? null;
  const backlinks = data?.backlinks ?? [];
  /**
   * A meeting page is a drop target for its own recordings (rung 2): dropping
   * here says which meeting this belongs to, which is the one question the
   * matcher used to answer by looking at the clock. Declared above the early
   * returns because hooks cannot move.
   */
  const aimed = useAimedDrop(
    currentNote?.type === 'meeting'
      ? { kind: 'meeting', path: currentNote.path, title: currentNote.title }
      : null,
  );

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

  // Skills and agents are stored as markdown but never shown as markdown —
  // they get a purpose-built page (title, one-liner, instructions; the
  // machinery stays hidden). One branch here catches every door in: lists,
  // wikilinks, search, ⌘K, backlinks.
  if (currentNote.type === 'skill' || currentNote.type === 'agent') {
    return <SkillAgentPage note={currentNote} />;
  }

  const editable = currentNote.bodyEditable;
  // A mirror's read-only line ends in a door: "edits happen there" is only
  // useful next to the way there, and the URL property row is a collapse away.
  const mirrorUrl =
    isMirrorType(currentNote.type) && typeof currentNote.frontmatter['url'] === 'string'
      ? currentNote.frontmatter['url']
      : null;
  // The note's own lifecycle value ('wont-do', 'superseded', …), read under
  // whatever key its type calls it. Only themes and superseded decisions wear it
  // as a badge; the rest carry it quietly in properties.
  const lifecycle = lifecycleValue(currentNote.type, currentNote.frontmatter);
  const lifecycleBadge =
    currentNote.type === 'theme' || lifecycle === 'superseded'
      ? lifecycle && lifecycleValueLabel(currentNote.type, lifecycle)
      : null;
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
    currentNote.type === 'meeting' && !eventCancelled
      ? upcomingLabel(currentNote.frontmatter)
      : null;
  const offerBrief = upcoming !== null && !/^## Prep\b/m.test(currentNote.body);
  // A meeting the calendar made, that has already happened, and that holds
  // nothing at all. Without this the page is machine frontmatter over a blank
  // sheet, with no hint that dropping the transcript here is the whole point
  // (docs/capture-nudge.md). Part of the empty state, so it needs no dismiss:
  // the first word typed takes it away.
  const emptyMeeting =
    syncedMeeting &&
    !eventCancelled &&
    upcoming === null &&
    typeof currentNote.frontmatter['date'] === 'string' &&
    transcriptRefs(currentNote.frontmatter).length === 0 &&
    !currentNote.body.trim();
  /**
   * A meeting that has already happened. It gets two doors of its own (AR-3,
   * AR-4): one to add another recording, because a second half or a colleague's
   * copy arriving later had nowhere to go, and one to read what it already
   * holds, because a review that failed to start had no way to be started again.
   */
  const pastMeeting = currentNote.type === 'meeting' && !eventCancelled && upcoming === null;
  const meetingTranscripts =
    currentNote.type === 'meeting' ? transcriptRefs(currentNote.frontmatter) : [];
  const unreadMeeting = pastMeeting && meetingTranscripts.length > 0;
  /** The material's own door back into the tray, with the meeting preset. */
  const addTranscript = () =>
    requestCapture({
      aim: { kind: 'meeting', path: currentNote.path, title: currentNote.title },
    });
  // An open commitment can be handed to the memory to plan/close/reschedule.
  const todoOpen =
    currentNote.type === 'todo' && (currentNote.frontmatter['commitment'] ?? 'open') === 'open';
  // A session receipt is the filed, git-tracked half of a session, and the
  // session itself is the fuller record: every read, every card, in order.
  // So a [[sessions/…]] link lands here and this button carries on into it.
  // Resolved by `session_id`, falling back to the id prefix older receipts
  // carry in their filename. Null when the session is gone, and then the receipt
  // is the whole record.
  const receiptChat =
    currentNote.type === 'session'
      ? chatForReceipt(currentNote.path, currentNote.frontmatter, sessions)
      : null;
  // Where you are, in the words the app uses everywhere else: type glyph →
  // the shelf this note sits on (opens it) → the note's own name. Never the
  // file path: where a note is stored is not something the reader has to know,
  // and the shelf answers the only question the path was standing in for.
  const slash = currentNote.path.lastIndexOf('/');
  const folder = slash >= 0 ? currentNote.path.slice(0, slash) : null;
  const shelf = folder ? folder.charAt(0).toUpperCase() + folder.slice(1) : null;
  const TypeIcon = noteTypeIcon(currentNote.type);

  return (
    <div
      className={`flex h-full flex-col ${aimed.over ? 'bg-brand/5 ring-1 ring-brand/40 ring-inset' : ''}`}
      {...aimed.handlers}
    >
      <PageHeader
        icon={TypeIcon}
        crumbs={
          folder && shelf
            ? [{ label: shelf, onClick: (e) => openFolder(folder, navFromEvent(e)) }]
            : undefined
        }
        label={currentNote.title}
        labelTitle={currentNote.title}
      >
        <>
          {receiptChat && (
            <Button
              size="sm"
              onClick={(e) =>
                openChat({ id: receiptChat.id, title: receiptChat.title }, navFromEvent(e))
              }
              title="Open the session this record was filed from, with everything it read and proposed"
            >
              <MessageSquare className="size-3.5" /> Open the session
            </Button>
          )}
          {currentNote.type === 'note' && editable && (
            <Button
              size="sm"
              onClick={() =>
                openSession('process-note', {
                  initialPrompt: processNoteSeed(currentNote.path),
                  title: `Go through: ${currentNote.title}`,
                  fresh: true,
                })
              }
              title="Work this note into the memory: clean it up, update the pages it touches, file what it implies, all as approval cards. Re-run anytime after adding more."
            >
              <Sparkles className="size-3.5" /> Go through this note
            </Button>
          )}
          {/* Every past meeting can take another recording, not only the empty
              ones: a second half, a colleague's copy, a transcript that arrived
              a week late all used to have nowhere to go (AR-4). */}
          {pastMeeting && (
            <Button
              size="sm"
              variant="secondary"
              onClick={addTranscript}
              title="Add a recording to this meeting"
            >
              <Mic className="size-3.5" /> Add transcript
            </Button>
          )}
          {unreadMeeting && (
            <Button
              size="sm"
              onClick={() =>
                openSession('arrival', {
                  initialPrompt: readMeetingSeed(currentNote.path),
                  title: `Go through: ${currentNote.title}`,
                  fresh: true,
                })
              }
              title="Go through this meeting's transcripts and propose what they change, as approval cards."
            >
              <Sparkles className="size-3.5" />{' '}
              {meetingTranscripts.length > 1
                ? 'Go through the transcripts'
                : 'Go through the transcript'}
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
                      due:
                        typeof currentNote.frontmatter['due'] === 'string'
                          ? currentNote.frontmatter['due']
                          : null,
                      owner:
                        typeof currentNote.frontmatter['owner'] === 'string'
                          ? currentNote.frontmatter['owner']
                          : null,
                    },
                    localDateStr(),
                  ),
                  title: `Handle: ${currentNote.title}`,
                  fresh: true,
                })
              }
              title="Help me handle this commitment: the memory proposes a plan, a close, or a reschedule as approval cards."
            >
              <Sparkles className="size-3.5" /> Help me handle this
            </Button>
          )}
          {confirmDelete ? (
            <div className="flex items-center gap-1.5 pl-1">
              <span className="text-xs text-muted-foreground">Delete this note?</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => void deleteNote(currentNote.path)}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <HeaderActions>
              <HeaderAction
                icon={Pin}
                label={favorites.includes(currentNote.path) ? 'Unpin' : 'Pin'}
                title={favorites.includes(currentNote.path) ? 'Unpin' : 'Pin: keep on the sidebar'}
                onClick={() => toggleFavorite(currentNote.path)}
                pressed={favorites.includes(currentNote.path)}
                iconClassName={
                  favorites.includes(currentNote.path) ? 'fill-brand text-brand' : undefined
                }
              />
              <HeaderMenu
                items={[
                  // A meeting nobody is going to read: settle it by hand rather
                  // than leave it sitting in the attention list for good (AR-3).
                  ...(unreadMeeting && currentNote.frontmatter['processing'] !== 'processed'
                    ? [
                        {
                          label: 'Mark as filed',
                          icon: CheckCheck,
                          action: () => void markMeetingReviewed(currentNote.path),
                        },
                      ]
                    : []),
                  { label: 'Version history', icon: History, action: () => setShowHistory(true) },
                  {
                    label: 'Delete note',
                    icon: Trash2,
                    action: () => setConfirmDelete(true),
                    danger: true,
                  },
                ]}
              />
            </HeaderActions>
          )}
        </>
      </PageHeader>

      {/* px-14: the left gutter must seat the block handle (+ ⋮⋮, 54px) without
          clipping against the panel edge. */}
      <div className="flex-1 overflow-y-auto px-14 py-4">
        <div className="mx-auto max-w-2xl">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {/* A mirror names the system it copies ("Jira mirror"), not our
                folder — calling it a ticket beside meetings and decisions
                implies the workspace owns it, and it does not. */}
            <Badge variant="secondary">
              {noteTypeLabel(currentNote.type, currentNote.frontmatter)}
            </Badge>
            {currentNote.type === 'theme' && lifecycleBadge && <Badge>{lifecycleBadge}</Badge>}
            {lifecycle === 'superseded' && <Badge variant="outline">{lifecycleBadge}</Badge>}
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
                <span
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                  title="Synced from Google Calendar"
                >
                  <CalendarDays className="size-3.5" aria-hidden /> Google Calendar
                </span>
              ))}
          </div>
          {currentNote.type === 'session' ? (
            <h1 className="mb-1 font-serif text-2xl font-semibold tracking-tight">
              {currentNote.title}
            </h1>
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
                Happening {upcoming}. The memory can brief you: what changed since these people were
                last told, open questions, loose ends. One approval card writes it here.
              </p>
              <Button
                size="sm"
                onClick={() =>
                  openSession('meeting-prep', {
                    initialPrompt: beforeMeetingSeed(currentNote.path),
                    title: `Brief: ${currentNote.title}`,
                    fresh: true,
                  })
                }
              >
                Get the brief
              </Button>
            </div>
          )}

          {emptyMeeting && (
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted/50 px-3 py-2.5">
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                This meeting has nothing in it yet.
              </p>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="secondary" onClick={addTranscript}>
                  <Mic className="size-3.5" /> Add transcript
                </Button>
                {/* Three typed lines are worth more than a guilt trip about a
                    missing recording, so the second door just hands over the
                    cursor. */}
                <Button size="sm" variant="ghost" onClick={() => editorFocus.current?.()}>
                  Write what happened
                </Button>
              </div>
            </div>
          )}

          {/* Why there is no cursor here, one line, right where the eye lands
              when the click does nothing. A box would read as a warning; this
              is orientation. The sentence is the domain's (@qale/domain
              readOnlyReason), so every read-only surface says the same thing. */}
          {!editable && (
            <p className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Lock className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
                {readOnlyReason(currentNote.type, currentNote.frontmatter)}
              </span>
              {mirrorUrl && (
                <a
                  href={mirrorUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  Open the original
                </a>
              )}
            </p>
          )}

          {editable ? (
            <NoteEditor
              key={currentNote.path}
              body={currentNote.body}
              onSave={(body) => saveNote(currentNote.path, body)}
              onOpenNote={openDoc}
              registerFlush={registerFlush}
              registerFocus={registerFocus}
              searchNotes={search}
              onAsk={(text) =>
                openSession('ask', {
                  initialPrompt: askSelectionSeed(currentNote.path, text),
                  title: `Ask: ${currentNote.title}`,
                  fresh: true,
                })
              }
            />
          ) : (
            <Markdown content={currentNote.body} onOpenNote={openDoc} />
          )}

          {/* Inbound edges grouped by relationship: typed groups first
              ("Blocked by", "Evidence for"), untyped mentions last under the
              familiar "Linked from". */}
          <LinksSection
            backlinks={backlinks}
            onOpen={(p, opts) => {
              void openDoc(p, opts);
            }}
          />
        </div>
      </div>
      <NoteHistory
        path={currentNote.path}
        open={showHistory}
        onOpenChange={setShowHistory}
        flushEdits={editable ? flushEdits : undefined}
      />
    </div>
  );
}
