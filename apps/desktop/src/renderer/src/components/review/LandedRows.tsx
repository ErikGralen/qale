import { Fragment, useCallback, useRef, useState, type MouseEvent } from 'react';
import { Spinner } from '@qale/ui';
import {
  Check,
  ChevronDown,
  FileText,
  Minus,
  Pencil,
  Plus,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import type { AppliedRow, AppliedVerb } from '@qale/domain';
import type { ProposalDTO, UpdatePayloadDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';
import { invoke } from '../../lib/ipc';
import { navFromEvent, type NavOpts } from '../../lib/nav';
import { noteTypeIcon } from '../../lib/note-icons';
import { useToast } from '../toast';
import {
  chipForRow,
  foldsLanded,
  landedSummary,
  orderLanded,
  putRowBack,
  rowChange,
  type LandedSummary,
  type SummaryChip,
} from '../../lib/receipt-block';
import { ChangePreview } from './CardItem';

/**
 * What one turn wrote (docs/fewer-approvals.md FA-4).
 *
 * A write that needs no card still has to be seen, and seen where the PM is
 * already looking. But it is not a decision they have to make, so it must not
 * look like one: a card asks, and this only reports.
 *
 * One to three writes draw as rows: a mark for what happened (plus, pencil,
 * check, minus) and the thing it happened to, as the chip a ticket wears in a
 * page. From four, the rows fold behind one line that says what the turn
 * touched, and the chevron opens them. Seven rows in a row read as a wall and
 * the PM scrolled past all of it (Erik, 2026-09-09). The line names pages
 * rather than counting them, because "changed 3 pages" answers nobody's
 * question and "did it touch the thing I care about" is the question.
 *
 * The line and the rows read in one fixed order, by what the PM has to act on:
 * to-dos and meeting pages Qale made, then to-dos and meeting pages that moved,
 * then their documents, then everything Qale filed for itself, then anything
 * that went (`orderLanded`). No word over a tier and no control for the whole
 * turn (docs/receipt-redesign.md, notes at the bottom). The chevron on a row
 * opens the diff and the Undo.
 *
 * Activity stays the long-term ledger with the same mechanism. This is the same
 * undo, said at the moment it is cheapest to use.
 *
 * The session review draws its approved cards through here too, once every card
 * is judged, apart from a send: what left the workspace keeps the green card it
 * was given the moment it left (docs/receipt-redesign.md RC-3, revised).
 */
export function LandedRows({
  rows,
  sessionId,
  onOpen,
  label = 'What I wrote',
}: {
  rows: readonly AppliedRow[];
  /** The session the writes came out of, for reading their cards back. */
  sessionId: string | null;
  onOpen: (path: string, opts?: NavOpts) => void;
  /** What the list is called, for a screen reader. Null where the surface
   *  around it already says so. */
  label?: string | null;
}) {
  const { revertActivity } = useApp();
  const toast = useToast();
  const [undone, setUndone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const cards = useCards(sessionId);

  if (rows.length === 0) return null;

  const putBack = async (id: string) => {
    setBusy(id);
    const result = await putRowBack(id, revertActivity);
    setBusy(null);
    if (!result.ok) {
      toast(result.error ?? 'That could not be undone.');
      return;
    }
    setUndone((was) => ({ ...was, [id]: true }));
    // The undo normally takes out the agent's own lines and leaves anything
    // typed since. When it cannot, the whole page goes back and those later
    // edits go with it, which the PM has to hear the moment it happens.
    if (result.snapshot)
      toast('Undone as a whole page. Anything you wrote after this went with it.');
  };

  const ordered = orderLanded(rows);
  const isUndone = (row: AppliedRow) => !!row.activityId && !!undone[row.activityId];
  const list = (
    <ul aria-label={label ?? undefined} className="my-1 flex flex-col gap-0.5">
      {ordered.map((row, i) => (
        <LandedRow
          key={row.activityId ?? row.proposalId ?? `${row.path ?? ''}-${i}`}
          row={row}
          busy={busy === row.activityId}
          undone={isUndone(row)}
          card={cards.get}
          onOpen={onOpen}
          onPutBack={() => row.activityId && void putBack(row.activityId)}
        />
      ))}
    </ul>
  );
  if (!foldsLanded(ordered)) return list;

  // The line is built from what still stands, so a row put back from the open
  // list takes itself out of the line rather than leaving it to lie.
  const summary = landedSummary(ordered.filter((row) => !isUndone(row)));
  return (
    <div className="my-1 text-xs">
      {/* The same shape and the same classes as the work trail above it: one
          line, one button, the chevron at the end. The line's own words are its
          label, so it needs no other one. */}
      <button
        className="flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {/* One mark for the line, in ink: four marks over a fold would be a
            legend for rows nobody has opened yet. A plus when the turn made a
            to-do or a meeting page, a pencil when it only moved things that
            were already there. */}
        <LineMark mark={summary.mark} />
        <span className="truncate">
          {summary.text ? <SummaryLine summary={summary} /> : 'Undone'}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && list}
    </div>
  );
}

/** The one mark over a folded line. It follows the line's first tier: a plus
 *  when the turn made a to-do or a meeting page, a pencil otherwise. */
function LineMark({ mark }: { mark: LandedSummary['mark'] }) {
  const Mark = mark === 'new' ? Plus : Pencil;
  return <Mark className="size-3.5 shrink-0 text-foreground/70" strokeWidth={2.25} aria-hidden />;
}

/**
 * The folded line itself: one clause per tier, with a dot between them.
 *
 * Words only. Naming every page made the line longer than the rows it stands
 * for, and a name that matters is one chevron away on its own row, where it
 * opens (Erik, 2026-09-11). A page that went keeps its name and its colour:
 * nothing else on screen says it is gone.
 */
function SummaryLine({ summary }: { summary: LandedSummary }) {
  return (
    <>
      {summary.clauses.map((clause, i) => (
        <Fragment key={`${clause.tier}-${i}`}>
          {i > 0 && ' · '}
          {clause.tier === 'removed' ? (
            <span className="text-destructive">{clause.text}</span>
          ) : (
            clause.text
          )}
        </Fragment>
      ))}
    </>
  );
}

/**
 * The cards behind a turn's writes, read once and only when someone asks.
 *
 * A landed write is still a card in the store, so its payload is the diff. The
 * read is deferred to the first chevron: a session with ten turns must not cost
 * ten reads for detail nobody opened.
 */
function useCards(sessionId: string | null) {
  const [cards, setCards] = useState<Map<string, ProposalDTO> | null>(null);
  const asked = useRef(false);
  const load = useCallback(() => {
    if (asked.current || !sessionId) return;
    asked.current = true;
    void invoke['proposals:resolved'](sessionId)
      .then((stored) => setCards(new Map(stored.map((p) => [p.id, p]))))
      .catch(() => setCards(new Map()));
  }, [sessionId]);
  return {
    get: (id: string | undefined) => ({
      load,
      loading: !!id && cards === null,
      card: id ? (cards?.get(id) ?? null) : null,
    }),
  };
}

/**
 * The diff for a write that already landed, off the card's own payload.
 *
 * The preview a waiting card uses re-places its change against the file, which
 * a landed write is already part of. So the row draws the write's own diff, the
 * same one the undo reverses: what the patch replaced, and what the append
 * added. Null when nothing but the properties moved, which the open row says in
 * words.
 */
function landedPreview(card: ProposalDTO): { before: string; after: string } | null {
  if (card.kind === 'delete') return null;
  if (card.kind !== 'update') {
    const body = (card.payload as { body?: string }).body ?? '';
    return body.trim() ? { before: '', after: body } : null;
  }
  const payload = card.payload as UpdatePayloadDTO;
  const patch = payload.patch ?? [];
  const before = patch.map((block) => block.search).join('\n\n');
  const after = [...patch.map((block) => block.replace), payload.append ?? '']
    .filter((part) => part.trim())
    .join('\n\n');
  return before.trim() || after.trim() ? { before, after } : null;
}

/**
 * The mark in front of the row, by what happened: plus for new, a pencil for
 * changed, a check for done, minus for removed.
 *
 * The shape carries the meaning, not the colour. Colour-coding four verbs made
 * a stack of rows read as a chart with a legend nobody was handed, and the
 * tones quiet enough to sit in a chat were too dim to tell apart at this size
 * (Erik, 2026-09-08). So every mark is ink, one tone, a shade darker than the
 * row it stands in front of, and big enough to read. The one exception is a row
 * that took something away: that one stays red, because it is the row you must
 * not miss. A send never draws here.
 */
const MARK: Record<AppliedVerb, LucideIcon> = {
  New: Plus,
  'New todo': Plus,
  Changed: Pencil,
  'Todo changed': Pencil,
  Done: Check,
  'Todo done': Check,
  Removed: Minus,
  Sent: Plus,
};

/**
 * The thing a write touched, drawn the way a ticket is drawn inside a page:
 * a small chip with the kind's icon and the name, that opens it. A removed
 * page, and a row from before this block existed, have nothing to open and
 * draw as plain words.
 */
function Chip({
  chip,
  onOpen,
}: {
  chip: SummaryChip;
  onOpen: (path: string, opts?: NavOpts) => void;
}) {
  const { path, label, type } = chip;
  const Icon = type ? noteTypeIcon(type) : FileText;
  const open = (e: MouseEvent) => {
    if (!path) return;
    e.stopPropagation();
    onOpen(path, navFromEvent(e));
  };
  const shape =
    'inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm px-1 py-px font-medium';
  if (!path)
    return (
      <span className={`${shape} bg-muted text-muted-foreground`}>
        <Icon className="size-3 shrink-0 opacity-70" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
    );
  return (
    <button
      type="button"
      className={`${shape} bg-brand/8 text-brand transition-colors hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none`}
      onClick={open}
      // Middle-click = open in background tab, as every other link in the app.
      onAuxClick={(e) => e.button === 1 && open(e)}
      title={`Open ${label}`}
    >
      <Icon className="size-3 shrink-0 opacity-70" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}

/** One landed write, on one line: the mark, the page, and for a page that
 *  changed, how much of its body moved. */
function LandedRow({
  row,
  busy,
  undone,
  card,
  onOpen,
  onPutBack,
}: {
  row: AppliedRow;
  busy: boolean;
  undone: boolean;
  card: (id: string | undefined) => {
    load: () => void;
    loading: boolean;
    card: ProposalDTO | null;
  };
  onOpen: (path: string, opts?: NavOpts) => void;
  onPutBack: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { load, loading, card: stored } = card(row.proposalId);
  const preview = stored ? landedPreview(stored) : null;
  // The chevron has something to show only when the card is still there to read.
  const canOpen = !!row.proposalId;
  const change = rowChange(row);
  const Mark = MARK[row.verb];
  // The whole story on hover, for the one row in ten where the mark and the
  // name are not enough.
  const hover = [row.verb, row.title, row.change].filter(Boolean).join(' · ');

  return (
    <li className="text-sm text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1.5" title={hover}>
        <Mark
          className={`size-4 shrink-0 ${row.verb === 'Removed' ? 'text-destructive' : 'text-foreground/70'}`}
          strokeWidth={2.25}
          aria-hidden
        />
        <span className="sr-only">{row.verb}: </span>
        <p
          className={`flex min-w-0 flex-1 items-center gap-1.5 ${undone ? 'line-through opacity-60' : ''}`}
        >
          <Chip chip={chipForRow(row)} onOpen={onOpen} />
          {change && <span className="truncate">{change}</span>}
        </p>
        {undone && (
          // The same word Activity uses once a row has gone back, so the two
          // surfaces never describe one undo two ways.
          <span className="shrink-0 text-xs">Undone</span>
        )}
        {canOpen && (
          <button
            className="shrink-0 rounded-md p-0.5 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => {
              load();
              setOpen((v) => !v);
            }}
            aria-expanded={open}
            aria-label={open ? 'Hide the change' : 'Show the change'}
            title={open ? 'Hide the change' : 'Show the change'}
          >
            <ChevronDown
              className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
              aria-hidden
            />
          </button>
        )}
      </div>
      {open && (
        <div className="my-1.5 ml-3 border-l border-border/60 pl-3">
          {loading ? (
            <p>Reading the change…</p>
          ) : preview && stored ? (
            <ChangePreview kind={stored.kind} preview={preview} onOpen={onOpen} context={0} />
          ) : (
            <p>Only the properties changed.</p>
          )}
          {row.activityId && !undone && (
            <button
              className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
              onClick={onPutBack}
              disabled={busy}
              title="Undo this write. The undo is itself undoable."
            >
              {busy ? <Spinner className="size-3" /> : <Undo2 className="size-3" aria-hidden />}
              Undo
            </button>
          )}
        </div>
      )}
    </li>
  );
}
