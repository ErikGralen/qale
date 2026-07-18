import { useEffect, useState } from 'react';
import { Badge, Button, Separator } from '@pm/ui';
import { Link2, FileText, Star, Play, Sparkles, Trash2 } from 'lucide-react';
import { useApp } from '../state/app-state';
import { Markdown } from '../components/Markdown';
import { NoteEditor } from '../components/NoteEditor';
import { PropertiesBlock } from '../components/PropertiesBlock';
import { askSelectionSeed, beforeMeetingSeed } from '../lib/agent-nudges';

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

export function NoteView({ path }: { path: string }) {
  const { docData, openDoc, loadDoc, saveNote, renameNote, deleteNote, openSession, activeTabId, keepTab, favorites, toggleFavorite, search } =
    useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const upcoming = currentNote.type === 'meeting' ? upcomingLabel(currentNote.frontmatter) : null;
  const offerBrief = upcoming !== null && !/^## Prep\b/m.test(currentNote.body);
  const sessionSkill =
    currentNote.type === 'skill' && currentNote.frontmatter['skill_kind'] === 'session'
      ? (currentNote.frontmatter['session_type'] as string | undefined)
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-border px-5">
        <FileText className="size-4 text-muted-foreground" />
        <span className="truncate font-mono text-xs text-muted-foreground">{currentNote.path}</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => {
              toggleFavorite(currentNote.path);
              // Pinning commits the tab — it stops being a throwaway preview.
              if (activeTabId) keepTab(activeTabId);
            }}
            aria-pressed={favorites.includes(currentNote.path)}
            aria-label={favorites.includes(currentNote.path) ? 'Remove from favourites' : 'Add to favourites'}
            title={favorites.includes(currentNote.path) ? 'Remove from favourites' : 'Add to favourites'}
          >
            <Star className={`size-4 ${favorites.includes(currentNote.path) ? 'fill-brand text-brand' : ''}`} />
          </button>
          {confirmDelete ? (
            <>
              <span className="text-xs text-destructive">Delete this note?</span>
              <Button size="sm" variant="destructive" onClick={() => void deleteNote(currentNote.path)}>
                Yes, delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <button
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete note"
              title="Delete note"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          {sessionSkill && (
            <Button size="sm" onClick={() => openSession(sessionSkill, { title: currentNote.title })}>
              <Play className="size-3.5" /> Start session
            </Button>
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
                // Retitling commits the tab — it stops being a throwaway preview.
                if (activeTabId) keepTab(activeTabId);
              }}
            />
          )}
          <PropertiesBlock
            key={currentNote.path}
            note={currentNote}
            onDirty={() => {
              // Editing commits the tab — it stops being a throwaway preview.
              if (activeTabId) keepTab(activeTabId);
            }}
          />

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
              onDirty={() => {
                // Editing commits the tab — it stops being a throwaway preview.
                if (activeTabId) keepTab(activeTabId);
              }}
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

          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Link2 className="size-3.5" /> Linked from ({backlinks.length})
          </div>
          {backlinks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No backlinks yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {backlinks.map((b) => (
                <li key={b.from.path}>
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => openDoc(b.from.path)}
                  >
                    <span className="font-medium">{b.from.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{b.from.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
