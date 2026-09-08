import { useCallback, useRef, useState, type MouseEvent } from 'react';
import { Spinner } from '@qale/ui';
import { ChevronDown, Undo2 } from 'lucide-react';
import type { AppliedRow } from '@qale/domain';
import type { OutboundPayloadDTO, ProposalDTO, UpdatePayloadDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';
import { invoke } from '../../lib/ipc';
import { navFromEvent, type NavOpts } from '../../lib/nav';
import { useToast } from '../toast';
import { orderLanded, putRowBack } from '../../lib/receipt-block';
import { ChangePreview } from './CardItem';

/**
 * What one turn wrote, as lines (docs/fewer-approvals.md FA-4).
 *
 * A write that needs no card still has to be seen, and seen where the PM is
 * already looking. But it is not a decision they have to make, so it must not
 * look like one: a card asks, and these lines only report. Each is one muted
 * line, "New todo: Send the dates · you · due Fri", with the page as a link.
 * The chevron opens the diff and the Undo.
 *
 * The lines sit in the order the PM reads them: todos first, then the meeting,
 * their documents, what went out, and last Qale's own record. No word over a
 * group and no control for the whole turn (docs/receipt-redesign.md, notes at
 * the bottom): a heading over two lines weighed more than the lines did.
 *
 * Activity stays the long-term ledger with the same mechanism. This is the same
 * undo, said at the moment it is cheapest to use.
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

  return (
    <ul aria-label={label ?? undefined} className="my-1 flex flex-col gap-0.5">
      {orderLanded(rows).map((row, i) => (
        <LandedRow
          key={row.activityId ?? row.proposalId ?? `${row.path ?? ''}-${i}`}
          row={row}
          busy={busy === row.activityId}
          undone={!!row.activityId && !!undone[row.activityId]}
          card={cards.get}
          onOpen={onOpen}
          onPutBack={() => row.activityId && void putBack(row.activityId)}
        />
      ))}
    </ul>
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
 * a landed write is already part of. So the line draws the write's own diff, the
 * same one the undo reverses: what the patch replaced, and what the append
 * added. Null when nothing but the properties moved, which the line already
 * says in words.
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

/** One landed write, on one line. */
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
  const sent = row.verb === 'Sent';
  const title = row.title ?? 'a page';
  // A page that was removed has nothing to open, and neither has a line from a
  // session filed before this block existed.
  const path = row.verb === 'Removed' ? null : (row.path ?? null);
  const preview = stored ? landedPreview(stored) : null;
  // The chevron has something to show only when the card is still there to read.
  const canOpen = !!row.proposalId;
  const openPage = (e: MouseEvent) => {
    if (!path) return;
    e.stopPropagation();
    onOpen(path, navFromEvent(e));
  };

  return (
    <li className="text-sm text-muted-foreground">
      <div className="flex min-w-0 items-start gap-1">
        {/* Wraps rather than truncates: the mark at the end of a to-do line
            ("Qale heard this") is the part the PM most needs to see. */}
        <p className={`min-w-0 flex-1 break-words ${undone ? 'line-through opacity-60' : ''}`}>
          <span>{row.verb}: </span>
          {path ? (
            <button
              className="rounded text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={openPage}
              // Middle-click = open in background tab, as every other link in the app.
              onAuxClick={(e) => e.button === 1 && openPage(e)}
              title={`Open ${title}`}
            >
              {title}
            </button>
          ) : (
            <span className="text-foreground">{title}</span>
          )}
          {row.change && <span> · {row.change}</span>}
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
            <p>{sent ? 'It carried no message.' : 'Only the properties changed.'}</p>
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
