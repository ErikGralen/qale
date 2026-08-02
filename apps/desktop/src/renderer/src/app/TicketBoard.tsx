import { useMemo, type ReactNode } from 'react';
import type { NoteRefDTO, StateCategory } from '@pm/ipc';
import { AlertTriangle } from 'lucide-react';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { TagChip } from '../components/TagChip';
import { relativeTime } from '../lib/dates';

/**
 * A Jira-style board for the tickets/ mirror — the truth the PO briefs from,
 * read the way a board is read: by where each ticket sits in flight. Columns
 * are the normalized state category (the same axis the chips and hover cards
 * color), so "what's blocked" is a glance, not a scan. Cards open the mirror
 * note; the whole card is one target with tags floating clickable above it.
 *
 * The board is the tickets folder's default; the list is one toggle away. The
 * Week/List — here Board/List — switch is owned by the folder page and passed
 * in as `toolbarLead`, so both views share one control.
 */

type Column = { cat: StateCategory; label: string; dot: string; count: string };

// Left-to-right is flight order. Dots carry the same state tones as the chips
// (muted → brand → warning → success); the column, not the card, is the color.
const COLUMNS: Column[] = [
  { cat: 'open', label: 'To do', dot: 'bg-muted-foreground/45', count: 'text-muted-foreground' },
  { cat: 'in_progress', label: 'In progress', dot: 'bg-brand', count: 'text-brand' },
  { cat: 'blocked', label: 'Blocked', dot: 'bg-warning', count: 'text-warning' },
  { cat: 'done', label: 'Done', dot: 'bg-success', count: 'text-success' },
];

/** "PAY-142 · SAML SSO (epic)" → "SAML SSO (epic)" (the key is its own badge). */
function ticketName(n: NoteRefDTO, key: string): string {
  return n.title.replace(new RegExp(`^${key}\\s*[·—:-]\\s*`), '').trim() || n.title;
}

/** The descriptive tail of the summary — the part after the "KEY — …:" prefix. */
function ticketDetail(n: NoteRefDTO): string {
  const afterColon = n.summary.split(/:\s+/).slice(1).join(': ');
  return (afterColon || n.summary).trim();
}

/** Collapse case/whitespace so "In Progress" matches the "In progress" column. */
function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase();
}

/** "Tom Devlin" → "TD" for the assignee chip. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

function TicketCard({
  note,
  omitTag,
  onOpen,
}: {
  note: NoteRefDTO;
  omitTag?: string | null;
  onOpen: (path: string, e?: React.MouseEvent) => void;
}) {
  const key = note.slug.split('/').pop() ?? note.slug;
  const name = ticketName(note, key);
  const detail = ticketDetail(note);
  const when = note.remoteUpdated ?? note.mtime;
  const tags = (note.tags ?? []).filter((t) => t !== omitTag);
  const blocked = note.stateCategory === 'blocked';
  // The column already names the category; show the provider's raw label only
  // when it says something more ("In Review" under In progress), never when it
  // just echoes the column ("Done" under Done).
  const columnLabel = COLUMNS.find((c) => c.cat === note.stateCategory)?.label;
  const showState =
    note.state && normalizeLabel(note.state) !== normalizeLabel(columnLabel ?? '');

  return (
    <li className="group relative rounded-lg bg-card ring-1 ring-border/70 transition-[box-shadow,transform] duration-150 hover:ring-brand/40 hover:shadow-sm has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring/50">
      <button
        data-ticket-card
        className="absolute inset-0 z-0 w-full cursor-pointer rounded-lg focus:outline-none"
        onClick={(e) => onOpen(note.path, e)}
        onAuxClick={(e) => e.button === 1 && onOpen(note.path, e)}
        aria-label={`${key} — ${name}`}
      />
      <div className="pointer-events-none relative z-10 flex flex-col gap-1.5 p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="rounded-sm bg-brand/10 px-1 py-px font-mono text-micro font-medium tracking-tight text-brand">
            {key}
          </span>
          {blocked && (
            <AlertTriangle className="size-3 shrink-0 text-warning" aria-hidden />
          )}
          {showState && (
            <span className="ml-auto truncate text-micro text-muted-foreground">
              {note.state}
            </span>
          )}
        </div>

        <div className="text-dense leading-snug font-medium text-foreground">{name}</div>
        {detail && (
          <div className="line-clamp-2 text-xs leading-snug text-muted-foreground">{detail}</div>
        )}

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            {tags.map((t) => (
              <span key={t} className="pointer-events-auto">
                <TagChip tag={t} />
              </span>
            ))}
          </div>
        )}

        <div className="mt-0.5 flex items-center gap-1.5 text-micro text-muted-foreground">
          {note.assignee ? (
            <>
              <span
                className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-accent text-micro font-semibold text-accent-foreground"
                aria-hidden
              >
                {initials(note.assignee)}
              </span>
              <span className="truncate">{note.assignee}</span>
            </>
          ) : (
            <span className="truncate text-muted-foreground/70">Unassigned</span>
          )}
          {when && (
            <span className="ml-auto shrink-0 tabular-nums">{relativeTime(when)}</span>
          )}
        </div>
      </div>
    </li>
  );
}

export function TicketBoard({
  notes,
  allTags,
  contextFacet,
  onToggleContext,
  toolbarLead,
}: {
  notes: NoteRefDTO[];
  allTags: string[];
  contextFacet: string | null;
  onToggleContext: (tag: string) => void;
  /** The Board/List switch, owned by the folder page so both views share it. */
  toolbarLead?: ReactNode;
}) {
  const { openDoc } = useApp();

  const byColumn = useMemo(() => {
    const map = new Map<StateCategory, NoteRefDTO[]>(COLUMNS.map((c) => [c.cat, []]));
    for (const n of notes) {
      if (contextFacet && !n.tags?.includes(contextFacet)) continue;
      // Unmapped/missing category reads as not-yet-started, the honest default.
      const cat = map.has(n.stateCategory as StateCategory)
        ? (n.stateCategory as StateCategory)
        : 'open';
      map.get(cat)!.push(n);
    }
    // Most recently touched sits at the top of its column.
    for (const rows of map.values()) {
      rows.sort((a, b) => tickMs(b) - tickMs(a));
    }
    return map;
  }, [notes, contextFacet]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/70 px-4 py-2">
        {toolbarLead}
        {allTags.length > 0 && (
          <div className="ml-auto flex flex-wrap items-center gap-1">
            {allTags.map((t) => (
              <TagChip
                key={t}
                tag={t}
                active={contextFacet === t}
                onToggle={() => onToggleContext(t)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 py-4">
        {COLUMNS.map((col) => {
          const rows = byColumn.get(col.cat) ?? [];
          return (
            <section
              key={col.cat}
              className="flex min-h-0 min-w-[15rem] flex-1 flex-col rounded-xl bg-muted/40 ring-1 ring-border/60"
              aria-label={`${col.label} (${rows.length})`}
            >
              <div className="flex shrink-0 items-center gap-2 px-3 pt-2.5 pb-2">
                <span className={`size-2 shrink-0 rounded-full ${col.dot}`} aria-hidden />
                <span className="text-dense font-semibold text-foreground">{col.label}</span>
                <span className={`text-xs tabular-nums ${col.count}`}>{rows.length}</span>
              </div>
              {rows.length === 0 ? (
                <div className="flex flex-1 items-center justify-center px-3 pb-4 text-xs text-muted-foreground/60">
                  None
                </div>
              ) : (
                <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pt-0.5 pb-2.5">
                  {rows.map((n) => (
                    <TicketCard
                      key={n.path}
                      note={n}
                      omitTag={contextFacet}
                      onOpen={(p, e) => void openDoc(p, e && navFromEvent(e))}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Sort key: last upstream change when known, else file mtime. */
function tickMs(n: NoteRefDTO): number {
  if (n.remoteUpdated) {
    const t = Date.parse(n.remoteUpdated);
    if (!Number.isNaN(t)) return t;
  }
  return n.mtime;
}
