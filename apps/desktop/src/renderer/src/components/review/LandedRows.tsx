import {
  Fragment,
  useCallback,
  useId,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { Spinner } from '@qale/ui';
import { ArrowUpRight, Check, ChevronDown, FileText, Undo2 } from 'lucide-react';
import { typeForDir, type AppliedRow } from '@qale/domain';
import type { OutboundPayloadDTO, ProposalDTO, UpdatePayloadDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';
import { invoke } from '../../lib/ipc';
import { navFromEvent, type NavOpts } from '../../lib/nav';
import { noteTypeIcon } from '../../lib/note-icons';
import { useToast } from '../toast';
import {
  GROUP_WORD,
  groupLanded,
  memoryFold,
  putRowBack,
  putTurnBack,
  revertableIds,
  turnBackMessage,
} from '../../lib/receipt-block';
import { ChangePreview, TargetTitle } from './CardItem';

/**
 * What one turn wrote, as rows (docs/fewer-approvals.md FA-4).
 *
 * A write that needs no card still has to be seen, and seen where the PM is
 * already looking. Each row is the same shape a waiting card draws: the glyph
 * for the kind of thing, the page by its real name as a link, the change in one
 * line, controls on the right, and the diff behind the chevron. The controls
 * are the only difference: a waiting row asks, this one offers the way back.
 *
 * The rows sit in groups, by what they change for the PM rather than by the
 * order the tools ran (docs/receipt-redesign.md RC-1). Todos, the meeting and
 * the PM's documents draw full rows under the sidebar's own word. Qale's own
 * record is one folded line, because it only has to be findable.
 *
 * Activity stays the long-term ledger with the same mechanism. This is the same
 * put-back, said at the moment it is cheapest to use.
 *
 * The session review draws its approved cards through here too, once every card
 * is judged: an approved card is a landed write from the moment it is approved,
 * so it reads the same way (docs/receipt-redesign.md RC-3).
 */
export function LandedRows({
  rows,
  sessionId,
  onOpen,
  label = 'What I wrote',
  turnBack = true,
}: {
  rows: readonly AppliedRow[];
  /** The session the writes came out of, for reading their cards back. */
  sessionId: string | null;
  onOpen: (path: string, opts?: NavOpts) => void;
  /** What the list is called. Null where the surface around it already says so,
   *  because two names for one list is one name too many. */
  label?: string | null;
  /** Offer "Put this turn back". Off where the rows are not one turn's writes:
   *  the receipt's rows are a whole sitting's approvals. */
  turnBack?: boolean;
}) {
  const { revertActivity } = useApp();
  const toast = useToast();
  const [undone, setUndone] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [turnBusy, setTurnBusy] = useState(false);
  const cards = useCards(sessionId);
  const headingId = useId();

  if (rows.length === 0) return null;

  const putBack = async (id: string) => {
    setBusy(id);
    const result = await putRowBack(id, revertActivity);
    setBusy(null);
    if (!result.ok) {
      toast(result.error ?? 'That could not be put back.');
      return;
    }
    setUndone((was) => ({ ...was, [id]: true }));
    // The undo normally takes out the agent's own lines and leaves anything
    // typed since. When it cannot, the whole page goes back and those later
    // edits go with it, which the PM has to hear the moment it happens.
    if (result.snapshot)
      toast('Put back as a whole page. Anything you wrote after this went with it.');
  };

  // Everything this turn wrote that is still there. A row already put back is
  // not offered again, and a row with no Activity behind it has no handle.
  const left = revertableIds(rows).filter((id) => !undone[id]);

  const putTheTurnBack = async () => {
    setTurnBusy(true);
    try {
      const result = await putTurnBack(left, revertActivity);
      setUndone((was) => ({ ...was, ...Object.fromEntries(result.done.map((id) => [id, true])) }));
      const said = turnBackMessage(result);
      if (said) toast(said);
    } finally {
      setTurnBusy(false);
    }
  };

  // One row, wherever it is drawn: in its group, or under the memory line once
  // that is opened. The controls are the same either way.
  const drawRow = (row: AppliedRow, i: number) => (
    <LandedRow
      key={row.activityId ?? row.proposalId ?? `${row.path ?? ''}-${i}`}
      row={row}
      busy={busy === row.activityId || turnBusy}
      undone={!!row.activityId && !!undone[row.activityId]}
      card={cards.get}
      onOpen={onOpen}
      onPutBack={() => row.activityId && void putBack(row.activityId)}
    />
  );

  return (
    <section aria-label={label ?? undefined} className="mt-1">
      <div className="flex flex-col gap-3">
        {groupLanded(rows).map(({ group, rows: inGroup }) => {
          if (group === 'memory')
            return <MemoryLine key={group} rows={inGroup} onOpen={onOpen} drawRow={drawRow} />;
          const word = GROUP_WORD[group];
          return (
            <div key={group}>
              {/* The word names the group and nothing else. It is not a stop for
                  the keyboard: the rows are what a person moves between. */}
              {word && (
                <p
                  id={`${headingId}-${group}`}
                  className="mb-1.5 ml-1 text-xs font-medium text-muted-foreground"
                >
                  {word}
                </p>
              )}
              <ul
                className="flex flex-col gap-2"
                aria-labelledby={word ? `${headingId}-${group}` : undefined}
              >
                {inGroup.map(drawRow)}
              </ul>
            </div>
          );
        })}
      </div>
      {/* One control for the whole turn, and only when there is more than one
          row to put back. On a single row the row's own button is the shorter
          way to the same place. */}
      {turnBack && left.length > 1 && (
        <button
          className="mt-1.5 ml-1 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          onClick={() => void putTheTurnBack()}
          disabled={turnBusy}
          title="Put every change from this turn back, newest first."
        >
          {turnBusy ? <Spinner className="size-3" /> : <Undo2 className="size-3" aria-hidden />}
          Put this turn back
        </button>
      )}
    </section>
  );
}

/**
 * Qale's own record, in one line (docs/receipt-redesign.md RC-1).
 *
 * A decision, a hub edit or a person page is Qale's memory, not the PM's work.
 * It lands, Activity keeps it, and a wrong one is put back. In the chat it only
 * has to be findable, so it is one muted line of titles that open the pages.
 * The chevron opens the same rows the other groups draw, Put back and all, and
 * "Put this turn back" covers them whether the line is open or folded.
 */
function MemoryLine({
  rows,
  onOpen,
  drawRow,
}: {
  rows: readonly AppliedRow[];
  onOpen: (path: string, opts?: NavOpts) => void;
  drawRow: (row: AppliedRow, i: number) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { shown, more } = memoryFold(rows);

  return (
    <div>
      <div className="flex items-start gap-1">
        <p className="mt-0.5 min-w-0 flex-1 text-sm text-muted-foreground">
          {GROUP_WORD.memory}:{' '}
          {shown.map((row, i) => (
            <Fragment key={row.activityId ?? row.path ?? i}>
              {i > 0 && <span aria-hidden> · </span>}
              <MemoryTitle row={row} onOpen={onOpen} />
            </Fragment>
          ))}
          {more > 0 && <span> · {more} more</span>}
        </p>
        <button
          className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? 'Hide the memory writes' : 'Show the memory writes'}
          title={open ? 'Hide the memory writes' : 'Show the memory writes'}
        >
          <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && <ul className="mt-2 flex flex-col gap-2">{rows.map(drawRow)}</ul>}
    </div>
  );
}

/** One title on the memory line. A page that was removed, and a row from a
 *  session filed before this block existed, have nothing to open. */
function MemoryTitle({
  row,
  onOpen,
}: {
  row: AppliedRow;
  onOpen: (path: string, opts?: NavOpts) => void;
}) {
  const title = row.title ?? 'a page';
  const path = row.verb === 'Removed' ? null : (row.path ?? null);
  if (!path) return <span>{title}</span>;
  const open = (e: MouseEvent) => {
    e.stopPropagation();
    onOpen(path, navFromEvent(e));
  };
  return (
    <button
      className="rounded text-left text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={open}
      // Middle-click = open in background tab, as every other link in the app.
      onAuxClick={(e) => e.button === 1 && open(e)}
      title={`Open ${title}`}
    >
      {title}
    </button>
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
 * added. Null when nothing but the properties moved, which the change line on
 * the row already says in words.
 */
function landedPreview(card: ProposalDTO): { before: string; after: string } | null {
  if (card.kind === 'delete') return null;
  // A send cannot be taken back, so the whole message stays readable: what left
  // the workspace in the PM's name is the one thing they may need to answer for.
  if (card.kind === 'outbound') {
    const body = (card.payload as OutboundPayloadDTO).body ?? '';
    return body.trim() ? { before: '', after: body } : null;
  }
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
 * The to-do's own glyph: the checkbox the Todos view draws, filled once the
 * commitment closed. It does nothing here on purpose. The row is a receipt, and
 * the Todos view is where a to-do is worked (docs/receipt-redesign.md RC-2).
 */
function TodoBox({ done }: { done: boolean }) {
  return (
    <span
      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${
        done
          ? 'border-transparent bg-muted text-muted-foreground'
          : 'border-border text-transparent'
      }`}
      aria-hidden
    >
      <Check className="size-2.5" />
    </span>
  );
}

/** One landed write. */
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
  const dir = (row.path ?? '').split('/')[0] ?? '';
  const type = typeForDir(dir);
  const Icon = type ? noteTypeIcon(type) : FileText;
  const todo = row.verb === 'New todo' || row.verb === 'Todo changed' || row.verb === 'Todo done';
  // What left the workspace wears the ink arrow the send card wears. The card's
  // own glyph rides on the card, which the row only reads when asked, so the
  // arrow stands alone rather than appearing a second later.
  const sent = row.verb === 'Sent';
  const title = row.title ?? 'a page';
  // A page that was removed has nothing to open, and neither has a row from a
  // session filed before this block existed.
  const path = row.verb === 'Removed' ? null : (row.path ?? null);
  const preview = stored ? landedPreview(stored) : null;

  return (
    <li className="overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {sent ? (
          <span className="mt-0.5 flex shrink-0 items-center" title="Left your workspace">
            <ArrowUpRight className="size-4 text-brand" aria-hidden />
            <span className="sr-only">Left your workspace.</span>
          </span>
        ) : todo ? (
          <TodoBox done={row.verb === 'Todo done'} />
        ) : (
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <TargetTitle leadIn={row.verb} title={title} path={path} onOpen={onOpen} />
          {row.change && <p className="mt-1 text-sm text-muted-foreground">{row.change}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {undone ? (
            // The same word Activity uses once a row has gone back, so the two
            // surfaces never describe one undo two ways.
            <span className="px-1.5 py-1 text-xs text-muted-foreground">Put back</span>
          ) : (
            row.activityId && (
              <button
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
                onClick={onPutBack}
                disabled={busy}
                title="Put it back the way it was. The undo is itself undoable."
              >
                {busy ? <Spinner className="size-3" /> : <Undo2 className="size-3.5" aria-hidden />}
                Put back
              </button>
            )
          )}
          {row.proposalId && (
            <button
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => {
                load();
                setOpen((v) => !v);
              }}
              aria-expanded={open}
              aria-label={open ? 'Hide the change' : 'Show the change'}
              title={open ? 'Hide the change' : 'Show the change'}
            >
              <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-border/60 px-3 py-2.5 pl-9">
          {loading ? (
            <p className="text-sm text-muted-foreground">Reading the change…</p>
          ) : preview && stored ? (
            <ChangePreview kind={stored.kind} preview={preview} onOpen={onOpen} context={0} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {sent ? 'It carried no message.' : 'Only the properties changed.'}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
