import { useCallback, useRef, useState } from 'react';
import { Button } from '@qale/ui';
import { AlertTriangle, ArrowUpRight, Check } from 'lucide-react';
import type { MeetingReviewAskDTO, OutboundPayloadDTO, ProposalDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';
import { useToast } from '../toast';
import { outboundAct, outboundReceipt, staleAcceptMessage } from './shared';

/** Approvals in a row before the spot-audit asks for a closer look. */
const SPOT_AUDIT_EVERY = 5;

interface SentReceipt {
  id: string;
  target: string;
}

/** A batch the spot-audit stopped: what it applied, and what it left. */
interface PausedBatch {
  done: number;
  left: number;
}

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
  reviewAsks: MeetingReviewAskDTO[];
  auditOpen: boolean;
  streak: number;
  paused: PausedBatch | null;
  dismissAudit: () => void;
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
  const [reviewAsks, setReviewAsks] = useState<MeetingReviewAskDTO[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [streak, setStreak] = useState(0);
  const [paused, setPaused] = useState<PausedBatch | null>(null);
  // The batch reads the streak between two awaits, so it lives in a ref as well
  // as in state: state is what the banner prints, the ref is what the loop asks.
  const streakRef = useRef(0);
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
          streakRef.current += 1;
          setStreak(streakRef.current);
          // Anti-rubber-stamping: after N in a row, ask for a closer look.
          if (streakRef.current % SPOT_AUDIT_EVERY === 0) setAuditOpen(true);
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
              `This changed upstream since the card was drafted. Take one more look, then approve anyway to ${outboundAct(p.payload as OutboundPayloadDTO).verb}.`,
          );
        } else if (r.stale) {
          // The edit has nowhere to land. The card opens on this message and
          // shows its own stale banner, so no accept can pass unseen.
          setError(p.id, staleAcceptMessage(r.staleReason));
        } else {
          setError(p.id, r.error ?? 'Could not apply this card: the workspace rejected the write.');
        }
        return false;
      } catch (err) {
        setError(
          p.id,
          err instanceof Error ? err.message : 'Something went wrong applying this card.',
        );
        return false;
      } finally {
        release();
      }
    },
    [acceptProposal, noteReviewAsk],
  );

  const rejectOne = useCallback(
    async (p: ProposalDTO): Promise<boolean> => {
      const release = hold();
      setError(p.id, null);
      try {
        noteReviewAsk((await rejectProposal(p.id)).review);
        setReceipt((x) => ({ ...x, rejected: x.rejected + 1 }));
        streakRef.current = 0;
        setStreak(0);
        return true;
      } catch (err) {
        setError(
          p.id,
          err instanceof Error ? err.message : 'Something went wrong discarding this card.',
        );
        return false;
      } finally {
        release();
      }
    },
    [rejectProposal, noteReviewAsk],
  );

  const acceptAll = useCallback(
    async (cards: ProposalDTO[]) => {
      // Outbound never rides along in a batch — each send is its own decision.
      const batch = cards.filter((c) => c.kind !== 'outbound');
      const release = hold();
      try {
        let done = 0;
        let failed = 0;
        for (let i = 0; i < batch.length; i++) {
          // Anti-rubber-stamping: the run stops at the spot-audit. It used to
          // stop without a word, so the interstitial now carries the count and
          // what is still waiting in this group.
          if (streakRef.current > 0 && streakRef.current % SPOT_AUDIT_EVERY === 0) {
            setAuditOpen(true);
            setPaused({ done, left: batch.length - i });
            return;
          }
          if (await acceptOne(batch[i]!)) done++;
          else failed++;
        }
        if (failed > 0)
          toast(`${failed} of ${batch.length} cards failed to apply. See the cards for details.`);
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

  const dismissAudit = useCallback(() => {
    setAuditOpen(false);
    setPaused(null);
    streakRef.current = 0;
    setStreak(0);
  }, []);

  return {
    busy: busyCount > 0,
    errors,
    staleSends,
    receipt,
    sent,
    reviewAsks,
    auditOpen,
    streak,
    paused,
    dismissAudit,
    answerReviewAsk,
    dismissReviewAsk,
    accept: (p, edited) => void acceptOne(p, edited),
    reject: (p) => void rejectOne(p),
    acceptAll: (cards) => void acceptAll(cards),
    rejectAll: (cards) => void rejectAll(cards),
  };
}

/**
 * The spot-audit interstitial. It appears after N approvals in a row, and a
 * batch that ran into it says how far it got — a run that stopped halfway
 * without a word read as a batch that had finished.
 */
export function SpotAudit({ approvals }: { approvals: Approvals }) {
  const { auditOpen, streak, paused, dismissAudit } = approvals;
  if (!auditOpen) return null;
  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-warning" />
      <span className="flex-1 text-foreground">
        {paused && (
          // A batch that was stopped before its first card has no count to
          // give, so it says what it can rather than "Paused after 0".
          <>
            {paused.done > 0 ? `Paused after ${paused.done}.` : 'Paused.'} {paused.left} left in
            this group.{' '}
          </>
        )}
        You've approved {streak} in a row. Take a closer look at this one before continuing.
      </span>
      <Button size="sm" variant="ghost" onClick={dismissAudit}>
        Got it
      </Button>
    </div>
  );
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
