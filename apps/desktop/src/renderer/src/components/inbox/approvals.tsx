import { useCallback, useState } from 'react';
import { Button } from '@qale/ui';
import { ArrowUpRight, Check } from 'lucide-react';
import type { MeetingReviewAskDTO, OutboundPayloadDTO, ProposalDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';
import { useToast } from '../toast';
import { receiptEntry, type ReceiptEntry } from './cardMeta';
import { outboundAct, outboundReceipt, staleAcceptMessage } from './shared';

interface SentReceipt {
  id: string;
  target: string;
}

/** How many consequence lines the Inbox's receipt keeps. Past five it is a log
 *  of the sitting rather than what the last few taps did. */
const TOUCHED_MAX = 5;

/**
 * The one approve path. Every surface that shows a card — the Inbox and the
 * session's own review block — drives it through this hook, so a card behaves
 * the same wherever it is read.
 *
 * The stale check rides on the path itself, never on the surface. Main refuses
 * a stale write and hands back `stale`; the refusal becomes an error on the
 * card, and a card with an error always opens. So a keyboard accept, a click on
 * a collapsed row and a batch all end in the same visible banner instead of a
 * write that quietly did nothing.
 */
export interface Approvals {
  busy: boolean;
  /** Per card: why the last accept or discard did not land. */
  errors: Record<string, string>;
  /** Outbound sends refused because the target moved after drafting. */
  staleSends: Record<string, boolean>;
  receipt: { accepted: number; rejected: number };
  sent: SentReceipt[];
  /**
   * What this sitting's approvals touched, oldest dropped past five. The Inbox
   * reads it to say what clearing the queue set in motion, so that surface needs
   * no second query: the hook already knows, because it did the writes.
   */
  touched: ReceiptEntry[];
  reviewAsks: MeetingReviewAskDTO[];
  answerReviewAsk: (ask: MeetingReviewAskDTO) => void;
  dismissReviewAsk: (ask: MeetingReviewAskDTO) => void;
  accept: (p: ProposalDTO, edited?: unknown) => void;
  reject: (p: ProposalDTO) => void;
  /** Approve one group at a time. Outbound never rides along. */
  acceptAll: (cards: ProposalDTO[]) => void;
  rejectAll: (cards: ProposalDTO[]) => void;
}

export function useApprovals(): Approvals {
  const { vault, acceptProposal, rejectProposal, markMeetingReviewed } = useApp();
  // A count, not a flag: a batch runs the same single accept as a click, and a
  // boolean would go false between two cards and re-arm every button mid-run.
  const [busyCount, setBusyCount] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [staleSends, setStaleSends] = useState<Record<string, boolean>>({});
  const [receipt, setReceipt] = useState({ accepted: 0, rejected: 0 });
  const [sent, setSent] = useState<SentReceipt[]>([]);
  const [touched, setTouched] = useState<ReceiptEntry[]>([]);
  const [reviewAsks, setReviewAsks] = useState<MeetingReviewAskDTO[]>([]);
  const toast = useToast();
  const vaultPath = vault?.path ?? '';

  const setError = (id: string, message: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });

  const hold = () => {
    setBusyCount((n) => n + 1);
    return () => setBusyCount((n) => Math.max(0, n - 1));
  };

  // The resolve that empties a session hands back a question when nothing was
  // kept. Asked once per meeting: a "not yet" is remembered for the workspace,
  // so re-resolving another of its sessions never re-opens the same question.
  const noteReviewAsk = useCallback(
    (ask: MeetingReviewAskDTO | undefined) => {
      if (!ask || dismissedReviewAsks(vaultPath).includes(ask.path)) return;
      setReviewAsks((asks) => (asks.some((a) => a.path === ask.path) ? asks : [...asks, ask]));
    },
    [vaultPath],
  );

  const answerReviewAsk = useCallback(
    (ask: MeetingReviewAskDTO) => {
      setReviewAsks((asks) => asks.filter((a) => a.path !== ask.path));
      void markMeetingReviewed(ask.path)
        .catch(() => ({ ok: false }))
        .then((r) => {
          if (!r.ok)
            toast(`Could not mark ${ask.title} reviewed. Open it and set the status there.`);
        });
    },
    [markMeetingReviewed, toast],
  );

  const dismissReviewAsk = useCallback(
    (ask: MeetingReviewAskDTO) => {
      setReviewAsks((asks) => asks.filter((a) => a.path !== ask.path));
      persistDismissedReviewAsk(vaultPath, ask.path);
    },
    [vaultPath],
  );

  /** Approve one card. Hands back whether it actually landed, so a batch can
   *  count without a second code path. */
  const acceptOne = useCallback(
    async (p: ProposalDTO, edited?: unknown): Promise<boolean> => {
      const release = hold();
      setError(p.id, null);
      try {
        const r = await acceptProposal(p.id, edited);
        noteReviewAsk(r.review);
        if (r.ok) {
          setReceipt((x) => ({ ...x, accepted: x.accepted + 1 }));
          setTouched((t) => [...t, receiptEntry(p)].slice(-TOUCHED_MAX));
          markJudged(vaultPath);
          setStaleSends((s) => {
            const next = { ...s };
            delete next[p.id];
            return next;
          });
          if (p.kind === 'outbound') {
            const ob = p.payload as OutboundPayloadDTO;
            setSent((s) => [...s, { id: p.id, target: outboundReceipt(ob) }]);
          }
          return true;
        }
        if (r.stale && p.kind === 'outbound') {
          // The target moved after this was drafted; main refused the send and
          // the card stays pending. The card's error row grows an explicit
          // "Approve anyway" that re-accepts with a refreshed snapshot.
          setStaleSends((s) => ({ ...s, [p.id]: true }));
          setError(
            p.id,
            r.error ??
              `It has changed since this card was drafted. Take one more look, then approve anyway to ${outboundAct(p.payload as OutboundPayloadDTO).verb}.`,
          );
        } else if (r.stale) {
          // The edit has nowhere to land. The card opens on this message and
          // shows its own stale banner, so no accept can pass unseen.
          setError(p.id, staleAcceptMessage(r.staleReason));
        } else {
          setError(p.id, r.error ?? 'Could not apply this proposal: the workspace rejected the write.');
        }
        return false;
      } catch (err) {
        setError(
          p.id,
          err instanceof Error ? err.message : 'Something went wrong applying this proposal.',
        );
        return false;
      } finally {
        release();
      }
    },
    [acceptProposal, noteReviewAsk, vaultPath],
  );

  const rejectOne = useCallback(
    async (p: ProposalDTO): Promise<boolean> => {
      const release = hold();
      setError(p.id, null);
      try {
        noteReviewAsk((await rejectProposal(p.id)).review);
        setReceipt((x) => ({ ...x, rejected: x.rejected + 1 }));
        markJudged(vaultPath);
        return true;
      } catch (err) {
        setError(
          p.id,
          err instanceof Error ? err.message : 'Something went wrong discarding this proposal.',
        );
        return false;
      } finally {
        release();
      }
    },
    [rejectProposal, noteReviewAsk, vaultPath],
  );

  const acceptAll = useCallback(
    async (cards: ProposalDTO[]) => {
      // Outbound never rides along in a batch — each send is its own decision.
      const batch = cards.filter((c) => c.kind !== 'outbound');
      const release = hold();
      try {
        let failed = 0;
        for (const card of batch) {
          if (!(await acceptOne(card))) failed++;
        }
        if (failed > 0)
          toast(`${failed} of ${batch.length} proposals failed to apply. See the proposals for details.`);
      } finally {
        release();
      }
    },
    [acceptOne, toast],
  );

  // Discard a whole cause block at once — the PO judged the premise wrong, so
  // none of the consequent edits should land.
  const rejectAll = useCallback(
    async (cards: ProposalDTO[]) => {
      const release = hold();
      try {
        let failed = 0;
        for (const p of cards) if (!(await rejectOne(p))) failed++;
        if (failed > 0)
          toast(`${failed} of ${cards.length} cards failed to discard. See the cards for details.`);
      } finally {
        release();
      }
    },
    [rejectOne, toast],
  );

  return {
    busy: busyCount > 0,
    errors,
    staleSends,
    receipt,
    sent,
    touched,
    reviewAsks,
    answerReviewAsk,
    dismissReviewAsk,
    accept: (p, edited) => void acceptOne(p, edited),
    reject: (p) => void rejectOne(p),
    acceptAll: (cards) => void acceptAll(cards),
    rejectAll: (cards) => void rejectAll(cards),
  };
}

/** The receipt for what left the workspace, in the banner's own past tense. */
export function SentReceipts({ sent }: { sent: SentReceipt[] }) {
  if (sent.length === 0) return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2 text-sm">
      <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-success" />
      <div className="min-w-0 flex-1">
        {/* The banner promised "leaves your workspace"; the receipt says it
            left, in the same words and in past tense. */}
        <span className="font-medium text-foreground">Left your workspace</span>
        <ul className="mt-0.5 text-muted-foreground">
          {sent.slice(-3).map((s) => (
            <li key={s.id} className="truncate">
              {s.target}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The one question a discarded pile leaves behind, in the spot its cards just
 * vacated: nothing was kept, so nothing says the meeting was read. "Not yet"
 * leaves it in needs review and never asks again.
 */
export function ReviewAsks({ approvals }: { approvals: Approvals }) {
  const { reviewAsks, answerReviewAsk, dismissReviewAsk } = approvals;
  return (
    <>
      {reviewAsks.map((ask) => (
        <div
          key={ask.path}
          className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1 text-muted-foreground">
            Nothing kept from <span className="text-foreground">{ask.title}</span>. Mark it
            reviewed?
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            onClick={() => answerReviewAsk(ask)}
          >
            <Check className="size-3.5" /> Mark reviewed
          </Button>
          <button
            className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => dismissReviewAsk(ask)}
          >
            Not yet
          </button>
        </div>
      ))}
    </>
  );
}

/**
 * Meetings the PO answered "not yet" to. Per workspace, like the pin set, and
 * view-only: the answer is "don't ask me again", not a fact about the meeting,
 * so it stays out of the vault. The meeting itself stays in needs review.
 */
const REVIEW_ASK_KEY = 'qale.reviewAskDismissed.v1';

function dismissedReviewAsks(vaultPath: string): string[] {
  try {
    const raw = localStorage.getItem(`${REVIEW_ASK_KEY}:${vaultPath}`);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function persistDismissedReviewAsk(vaultPath: string, path: string): void {
  try {
    const next = [...new Set([...dismissedReviewAsks(vaultPath), path])];
    localStorage.setItem(`${REVIEW_ASK_KEY}:${vaultPath}`, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

/**
 * Whether the PO has ever judged a card in this workspace. Per workspace and
 * view-only, like the dismissed asks above: it is a fact about what they have
 * seen, not about the vault.
 *
 * The empty Inbox explains what the Inbox is for. That sentence is worth a lot
 * on day one and nothing at all in week three, and the one moment it becomes
 * furniture is the first tap on Approve or Discard. So the first tap sets this,
 * and the explainer never comes back (docs/closing-beat.md).
 */
const JUDGED_KEY = 'qale.cardJudged.v1';

export function hasJudgedACard(vaultPath: string): boolean {
  try {
    return localStorage.getItem(`${JUDGED_KEY}:${vaultPath}`) === '1';
  } catch {
    return false;
  }
}

function markJudged(vaultPath: string): void {
  try {
    localStorage.setItem(`${JUDGED_KEY}:${vaultPath}`, '1');
  } catch {
    /* ignore quota */
  }
}
