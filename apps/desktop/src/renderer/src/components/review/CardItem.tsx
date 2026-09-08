import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@qale/ui';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  Check,
  ChevronDown,
  Clock,
  MessageSquare,
  Pencil,
  Wrench,
  X,
} from 'lucide-react';
import type { OutboundPayloadDTO, ProposalDTO, UpdatePayloadDTO } from '@qale/ipc';
import {
  answerOutboundQuestion,
  basename,
  dayLabel,
  describeEventWhen,
  normalizeLinkTarget,
  rsvpAnswer,
  ticketFieldRows,
  type NewPageFacts,
} from '@qale/domain';
import { useApp } from '../../state/app-state';
import { invoke } from '../../lib/ipc';
import {
  connections,
  isExternalRef,
  providerLabelOf,
  refMetaCached,
  type ExternalRefMetaDTO,
} from '../../lib/connections';
import { relativeTime } from '../../lib/dates';
import { diffLines, withContext, type DiffRow, type DiffView } from '../../lib/diff';
import { navFromEvent, type NavOpts } from '../../lib/nav';
import { Markdown } from '../Markdown';
import { ExternalRefChip, ticketKeyNodes, TicketKeyText } from '../ExternalRef';
import { splitTicketKeys } from '../../lib/ticket-keys';
import { outboundAct, providerName, rowFocusClass, useQueueFocus, WikiText } from './shared';
import {
  bareRef,
  cardFacts,
  cardHeadline,
  cardLeadIn,
  cardTitle,
  iconForRef,
  sourceRefOf,
  stripFrontmatter,
  titleForRef,
} from './cardMeta';
import { useNoteName } from './titles';

/**
 * One row for every card (docs/review-rework.md RR-3).
 *
 * The review used to draw four shapes for one act: a full card, a one-line
 * housekeeping row, a grouped "Edit 2 customers" row, and a taller card for a
 * send. Same decision, four vocabularies, and on most rows the change itself was
 * missing. Every card now draws the same way:
 *
 * 1. the glyph of the thing that changes,
 * 2. its real title,
 * 3. the change, always on screen,
 * 4. the same three controls: approve, discard, chevron.
 *
 * Everything the agent wants to say for itself sits behind the chevron: what
 * approving does, what it read, why, and the lever to edit the text.
 */
export interface CardItemProps {
  proposal: ProposalDTO;
  busy: boolean;
  focused: boolean;
  error: string | null;
  /** An outbound send was refused because the target moved after drafting —
   *  the card stays pending and grows an explicit "Approve anyway". */
  staleSend?: boolean;
  onFocus: () => void;
  onAccept: (edited?: unknown) => void;
  onReject: () => void;
  onOpen: (path: string, opts?: NavOpts) => void;
  /** The row sits under a group header that already names the thing changing,
   *  so it draws the change alone. */
  inGroup?: boolean;
  /** The batch heading names one source for the whole list. When the cards came
   *  from more than one, each row names its own behind the chevron instead. */
  showSource?: boolean;
}

/** What an external evidence chip is, said from its path. A mirror path names
 *  its tracker ("tickets/jira/…" reads "Jira ticket"); a bare key or a flat
 *  pre-migration path names none, so the chip claims none. */
function evidenceChipKind(target: string): string {
  const [dir, provider, name] = target.split('/');
  const page = dir === 'wikipages';
  if (provider && name) return `${providerLabelOf(provider)} ${page ? 'page' : 'ticket'}`;
  return page ? 'Wiki page' : 'Ticket';
}

/** The app started this run on its own clock. Said in the card's own words
 *  ("Prepared itself, an hour before your 14:00."), because a brief nobody
 *  asked for must never look like one the PO requested. */
function SelfStartedLine({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1" title="You didn’t ask for this one.">
      <Clock className="size-3 shrink-0" aria-hidden />
      {text}
    </span>
  );
}

/** The PO's own words are the source. Quiet, and never the amber flag: a card
 *  built on what they just said is the best-sourced kind there is, and telling
 *  them to double-check it is telling them to double-check themselves. */
function AskedLine() {
  return (
    <span
      className="inline-flex items-center gap-1"
      title="You asked for this in the conversation. Nothing here was inferred."
    >
      <MessageSquare className="size-3 shrink-0" aria-hidden /> You asked for this
    </span>
  );
}

/**
 * The three controls, on every row, in one order: approve, discard, detail.
 *
 * A send and a delete name the act on the approve control, because "Approve" on
 * a row that posts a comment or removes a page is a word a person can click
 * without knowing what they agreed to. It is still the same control, in the same
 * place, at the same size. The label sits beside the check rather than
 * replacing the button with a different one.
 */
function RowControls({
  approveLabel,
  approveTitle,
  sendId,
  busy,
  blocked,
  open,
  onAccept,
  onReject,
  onToggle,
}: {
  /** The word beside the check, for a row whose act is not "approve". */
  approveLabel?: string;
  approveTitle: string;
  /** A send's handle: ↵ moves the caret here rather than firing it. */
  sendId?: string;
  busy: boolean;
  /** The change has nowhere to land, so approving it would do nothing. */
  blocked: boolean;
  open: boolean;
  onAccept: () => void;
  onReject: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-brand/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        data-send={sendId}
        onClick={onAccept}
        disabled={busy || blocked}
        aria-label={approveTitle}
        title={approveTitle}
      >
        <Check className="size-4" />
        {approveLabel && <span>{approveLabel}</span>}
      </button>
      <button
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onReject}
        disabled={busy}
        aria-label="Discard"
        title="Discard"
      >
        <X className="size-4" />
      </button>
      <button
        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? 'Hide detail' : 'Show detail'}
        title={open ? 'Hide detail' : 'Show detail'}
      >
        <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
}

/**
 * The change, kept to a few lines until the reader asks for the rest. A row is a
 * glance: a page-long redline inside one buries the eight rows under it. Nothing
 * is hidden: the fade says there is more, and the button opens all of it.
 */
function Clamped({
  children,
  open,
}: {
  children: ReactNode;
  // The chevron is the card's collapse control, so a preview opened with Show
  // all folds with it. Opening the card again does not unfold the preview.
  open?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [all, setAll] = useState(false);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    if (!open) setAll(false);
  }, [open]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || all) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    // The box is capped, so it never resizes when its content grows — watch the
    // content itself (a late-loading font can push it past the cap).
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [all]);
  return (
    <>
      <div
        ref={ref}
        className={all ? '' : 'qale-scroll-fade max-h-44 overflow-hidden'}
      >
        {children}
      </div>
      {(clipped || all) && (
        <button
          className="mt-1 rounded-md text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            setAll((v) => !v);
          }}
        >
          {all ? 'Show less' : 'Show all'}
        </button>
      )}
    </>
  );
}

export function CardItem({
  proposal,
  busy,
  focused,
  error,
  staleSend,
  onFocus,
  onAccept,
  onReject,
  onOpen,
  inGroup,
  showSource,
}: CardItemProps) {
  const { previewProposal, openSession, askInSession, sessions } = useApp();
  const [preview, setPreview] = useState<{
    before: string;
    after: string;
    stale: boolean;
    staleReason?: 'unanchored' | 'duplicate' | 'missing';
    moved?: boolean;
    frontmatterChanges?: { key: string; before: unknown; after: unknown }[];
  } | null>(null);
  // The footnote: what approving does, what the agent read, why, and Edit.
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [draftPatch, setDraftPatch] = useState<{ search: string; replace: string }[]>([]);
  // null = this card has no append lever, so editing must not add one.
  const [draftAppend, setDraftAppend] = useState<string | null>(null);
  const ref = useQueueFocus<HTMLLIElement>(focused);

  // The option the PM picked on the draft's own question, if it asked one. Not
  // picking is an answer too: the draft was written the safe way, so approving
  // it untouched leaves the label off (docs/learning-how-you-work.md ticket 6).
  const [answer, setAnswer] = useState<string | null>(null);

  const drafted = proposal.kind === 'outbound' ? (proposal.payload as OutboundPayloadDTO) : null;
  const question = drafted?.question ?? null;
  // The draft as it now reads: what the answer adds is on the card before they
  // approve it, not only after it lands in Jira.
  const outbound = drafted && answer ? answerOutboundQuestion(drafted, answer) : drafted;
  // A card that takes a page away. It has no text to edit and its control names
  // the act, because "Approve" on a row that removes something is the one label
  // a person can press without knowing what they agreed to.
  const removes = proposal.kind === 'delete';
  // What this card does, in one vocabulary: the control's title and the glyph.
  const act = outbound ? outboundAct(outbound) : null;
  // The two kinds whose change is a diff against what the file says now. The
  // rest carry their whole change in the payload, so they cost no read.
  const needsPreview = proposal.kind === 'update' || removes;

  const { Icon, headline, replaces, retitle } = cardHeadline(proposal);
  const target = proposal.targetPath ?? (proposal.payload as { path?: string }).path ?? '';
  // The page's own name. A file that exists is named by the workspace; a card
  // that creates one names it itself.
  const known = useNoteName(target || null);
  const title = cardTitle(proposal, known?.title);
  const facts = useMemo(() => cardFacts(proposal), [proposal]);
  // The act and the kind, in two words over the title: "New to-do", "Update
  // document". The title alone read as the act.
  const leadIn = useMemo(() => cardLeadIn(proposal), [proposal]);
  // What approving DOES, and where it lands. Composed in main from the payload,
  // never written by the agent, so every card of a kind says the same sentence.
  const effect = proposal.effect;
  const source = sourceRefOf(proposal);

  // The record a card writes to is its subject, not its reasoning, so it never
  // doubles as its own citation. "Based on" is for what made this true, and the
  // note being written is already named in the row above. One source cited twice
  // is one chip: a session can reach the same note by two routes.
  const refMeta = useOutboundRefMeta(outbound);
  const written = bareRef(target);
  const evidence = [
    ...new Set(
      proposal.evidence
        .map((e) => bareRef(e.ref))
        .filter((bare) => {
          if (!bare) return false;
          // The batch heading names the source every card shares, so a chip for
          // it here is the same fact a second time, one fold down.
          if (!showSource && bare === source) return false;
          if (!outbound) return !written || bare !== written;
          const id = outboundRef(outbound);
          // The same item can be linked bare or under its tracker; the id is the
          // last segment either way.
          return bare !== refMeta?.slug && (!id || basename(bare) !== id);
        }),
    ),
  ];

  // Read the diff up front: the change is the row, so a row that waits for a
  // click to say what it changes is the old card with fewer words.
  useEffect(() => {
    if (!needsPreview) return;
    let alive = true;
    void previewProposal(proposal.id).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [needsPreview, proposal.id, previewProposal]);

  const startEdit = () => {
    if (proposal.kind === 'update') {
      const payload = proposal.payload as UpdatePayloadDTO;
      setDraftPatch((payload.patch ?? []).map((p) => ({ ...p })));
      setDraftAppend(payload.append ?? null);
    } else {
      setDraftBody((proposal.payload as { body?: string }).body ?? '');
    }
    setOpen(true);
    setEditing(true);
  };

  // Why this edit has nowhere to go, in one sentence — the card's own words for
  // it, reused by the banner and by the message the session gets.
  const placementProblem = (() => {
    if (preview?.staleReason === 'duplicate')
      return 'the text it adds is already in the note word for word';
    if (preview?.staleReason === 'missing') return 'the note it belongs to is gone';
    return "the text it was pointing at isn't in the note any more, or it now appears there more than once";
  })();

  // Hand a card that can no longer be applied back to the conversation that
  // wrote it: that session is the only one allowed to withdraw its own card,
  // and the only one that knows what the card was for.
  const owningSession = sessions.find((s) => s.id === proposal.sessionId);
  const fix = () => {
    const payload = proposal.payload as UpdatePayloadDTO;
    const anchors = (payload.patch ?? []).map((p) => p.search).filter(Boolean);
    const prompt = [
      `A proposal you put in front of me can't be applied any more: ${placementProblem}.`,
      '',
      `Proposal: ${proposal.id}`,
      `Note: ${payload.path}`,
      `What it was for: ${proposal.rationale}`,
      anchors.length > 0 ? ['', 'The text it was anchored to:', '```', ...anchors, '```'] : null,
      '',
      owningSession
        ? `Read ${payload.path} as it stands now, then withdraw_proposal ${proposal.id} and propose the edit again against the note's current text. If what it wanted is already there, or no longer needed, withdraw it and say so in one line. Don't touch anything else.`
        : `Read ${payload.path} as it stands now, then propose this edit again against the note's current text. The proposal came from a session that is gone, so I'll discard the old one myself. If what it wanted is already there, or no longer needed, say so in one line. Don't touch anything else.`,
    ]
      .flat()
      .filter((line) => line !== null)
      .join('\n');
    if (owningSession) askInSession({ id: owningSession.id, title: owningSession.title }, prompt);
    else
      openSession(undefined, {
        initialPrompt: prompt,
        title: `Fix: ${headline.slice(0, 48)}`,
        fresh: true,
      });
  };

  // A stale edit has nowhere to land, so a second try lands nowhere either. The
  // banner above owns the way out ("Fix this"), and the error row drops its
  // Retry rather than offer the same refusal again.
  const retryable = !preview?.stale || !!outbound;

  // What approving sends up: nothing when the card stands as drafted, so the
  // stored payload is what lands. An answered question is a change like any
  // other edit, and travels the same way.
  const approvePayload = (): unknown =>
    drafted && answer ? answerOutboundQuestion(drafted, answer) : undefined;

  const approveEdited = () => {
    const base =
      proposal.kind === 'update'
        ? {
            ...(proposal.payload as UpdatePayloadDTO),
            patch: draftPatch,
            ...(draftAppend !== null ? { append: draftAppend } : {}),
          }
        : { ...(proposal.payload as unknown as Record<string, unknown>), body: draftBody };
    const edited =
      drafted && answer
        ? answerOutboundQuestion(base as unknown as OutboundPayloadDTO, answer)
        : base;
    setEditing(false);
    onAccept(edited);
  };

  const why = proposal.rationale.trim();

  return (
    <li
      ref={ref}
      tabIndex={-1}
      onClick={onFocus}
      onFocus={onFocus}
      aria-label={headline}
      className={`overflow-hidden ${inGroup ? '' : 'rounded-lg bg-card'} ${rowFocusClass(!inGroup)}`}
    >
      <div className={`flex items-start gap-2.5 px-3 py-2.5 ${inGroup ? 'pl-9' : ''}`}>
        {!inGroup &&
          (outbound ? (
            // A card that leaves the workspace wears the ink arrow beside the
            // glyph of the thing it touches. It used to say "Leaves your
            // workspace" on a tinted band, which restated what the arrow, the
            // chip and the control's own word already said.
            <span className="mt-0.5 flex shrink-0 items-center" title="Leaves your workspace">
              <ArrowUpRight className="size-4 text-brand" aria-hidden />
              <Icon className="-ml-0.5 size-4 text-brand/70" aria-hidden />
              <span className="sr-only">Leaves your workspace.</span>
            </span>
          ) : (
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          ))}
        <div className="min-w-0 flex-1">
          {!inGroup &&
            (outbound ? (
              <OutboundTargetLine payload={outbound} onOpen={onOpen} />
            ) : (
              <TargetTitle
                leadIn={leadIn}
                title={title}
                path={known?.path ?? null}
                onOpen={onOpen}
              />
            ))}
          {/* When a calendar card lands. This is the fact being approved: the
              line above named the event and the system and never once said
              which day or hour, which is the only thing a person checks. */}
          {outbound && <EventWhenLine payload={outbound} />}
          {/* The ticket fields the draft set, which land under the PM's name and
              are nowhere in the body they are about to read. */}
          {outbound && <TicketFieldsLine payload={outbound} />}
          <div className={inGroup ? '' : 'mt-1'}>
            {editing ? (
              <EditFields
                kind={proposal.kind}
                draftBody={draftBody}
                draftPatch={draftPatch}
                draftAppend={draftAppend}
                onBody={setDraftBody}
                onPatch={setDraftPatch}
                onAppend={setDraftAppend}
              />
            ) : outbound ? (
              // A send cannot be taken back, so the whole message is on the row.
              <OutboundDetail payload={outbound} onOpen={onOpen} />
            ) : needsPreview ? (
              preview ? (
                <Clamped open={open}>
                  <ChangePreview
                    kind={proposal.kind}
                    preview={preview}
                    onOpen={onOpen}
                    context={0}
                    inRow
                  />
                </Clamped>
              ) : (
                <PreviewSkeleton />
              )
            ) : (
              <FactsLine facts={facts} fallback={headline} onOpen={onOpen} />
            )}
          </div>
          {proposal.selfStarted && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              <SelfStartedLine text={proposal.selfStarted} />
            </span>
          )}

          {preview?.stale ? (
            <div
              role="alert"
              className="mt-2 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive"
            >
              {preview.staleReason === 'missing' ? (
                // Nothing to redo it against, so there is no repair to offer.
                <span className="flex-1">
                  {removes
                    ? 'This page is already gone, so there is nothing left to delete. Discard the proposal.'
                    : 'The note this edit belongs to is gone, so there is nothing to change. Discard the proposal.'}
                </span>
              ) : (
                <>
                  <span className="flex-1">
                    This edit has nowhere to go: {placementProblem}. Send it back to be redone
                    against the note as it reads now, or edit it yourself.
                  </span>
                  <Button size="sm" variant="outline" onClick={fix}>
                    <Wrench className="size-3.5" />
                    Fix this
                  </Button>
                </>
              )}
            </div>
          ) : (
            // The note moved under a card that still fits. Not a warning: the
            // diff above is against the note as it reads now, so what gets
            // approved is what is on screen.
            preview?.moved && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                The note changed after this was proposed. The change above is against the note as it
                reads now.
              </p>
            )
          )}

          {error && (
            <div
              role="alert"
              className="mt-2 flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive"
            >
              <span className="flex-1">{error}</span>
              {outbound && staleSend ? (
                // Main refused the send because the target moved after drafting.
                // Approving anyway re-accepts with the snapshot refreshed to the
                // mirror's current state — an explicit decision, never a silent
                // retry loop.
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void withFreshSnapshot(outbound).then((p) => onAccept(p))}
                >
                  {act && <act.Icon className="size-3.5" />} Approve anyway
                </Button>
              ) : (
                retryable && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onAccept(approvePayload())}
                    disabled={busy}
                  >
                    Retry
                  </Button>
                )
              )}
            </div>
          )}

          {/* The one thing the draft could not work out, asked where the
              decision is made: between the text they just read and the control
              that sends it. The draft was written the safe way, so leaving it
              alone is a complete answer and the card says so. */}
          {question && (
            <div
              role="group"
              aria-label="Question about this draft"
              className="mt-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2"
            >
              <p className="text-sm leading-snug text-balance break-words text-foreground">
                {question.text}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {question.options.map((option) => (
                  <Button
                    key={option.label}
                    size="sm"
                    variant={answer === option.label ? 'default' : 'outline'}
                    aria-pressed={answer === option.label}
                    disabled={busy}
                    onClick={() => setAnswer(answer === option.label ? null : option.label)}
                  >
                    {option.label}
                  </Button>
                ))}
                {!answer && (
                  <span className="text-xs text-muted-foreground">
                    Approve without answering and it goes as drafted.
                  </span>
                )}
              </div>
            </div>
          )}

          {editing && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={approveEdited} disabled={busy || preview?.stale}>
                <Check className="size-3.5" />
                {act ? `Approve edits & ${act.verb}` : 'Approve edited'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          )}
        </div>

        <RowControls
          approveLabel={act ? act.word : removes ? 'Delete' : undefined}
          approveTitle={
            act ? `Approve & ${act.verb}` : removes ? 'Approve & delete' : 'Approve'
          }
          sendId={outbound ? proposal.id : undefined}
          busy={busy}
          blocked={!!preview?.stale || editing}
          open={open}
          onAccept={() => onAccept(approvePayload())}
          onReject={onReject}
          onToggle={() => setOpen((v) => !v)}
        />
      </div>

      {open && (
        <div className="border-t border-border/60 px-3 py-2.5 pl-9">
          {/* What approving does and where it lands. It is one sentence per card
              kind, so on the row it read as boilerplate the eye skipped; here it
              is what the reader came for. */}
          {effect && <p className="text-sm text-muted-foreground">{effect}</p>}
          {(replaces || retitle) && (
            <p className="mt-1 text-xs text-muted-foreground">
              {replaces && (
                <span>
                  Replaces <span className="text-foreground/75">“{replaces}”</span>
                </span>
              )}
              {replaces && retitle && ' · '}
              {retitle && (
                <span>
                  Retitles to <span className="text-foreground/75">“{retitle}”</span>
                </span>
              )}
            </p>
          )}
          {why && (
            <p className="mt-2 text-sm leading-relaxed text-foreground/80">
              <WikiText text={why} onOpen={onOpen} />
            </p>
          )}
          {evidence.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Based on</span>
              {evidence.map((r) => (
                <EvidenceChip key={r} source={r} onOpen={onOpen} />
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {/* A deletion has no text to edit: the card is a path and a reason.
                The two answers are yes and no. */}
            {!removes && !editing && (
              <Button
                size="sm"
                variant="ghost"
                onClick={startEdit}
                disabled={busy || preview?.stale}
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
            {proposal.asked && <AskedLine />}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * What the row is about, in two lines: a small lead-in that says the act and
 * the kind ("New to-do", "Update document"), then the thing that changes, by its
 * own name. The name opens like every other reference in the app, including ⌘
 * and middle click into a background tab. A page that does not exist yet has
 * nothing to open, so it is plain text.
 *
 * The lead-in is there because the name alone read as the act: "File the
 * missing story under SCH-231" looked like approving the filing.
 *
 * A ticket key in the name is that ticket, so it wears the same chip it wears
 * everywhere else and opens the ticket, not the page. That is why the line is a
 * span holding one button per run of words rather than one button holding
 * everything: a chip inside a button is neither valid nor clickable.
 */
export function TargetTitle({
  leadIn,
  title,
  path,
  onOpen,
}: {
  leadIn: string;
  title: string;
  path: string | null;
  onOpen: (path: string, opts?: NavOpts) => void;
}) {
  const line = 'block text-sm leading-snug font-medium text-balance break-words text-foreground';
  const open = (e: React.MouseEvent) => {
    if (!path) return;
    e.stopPropagation();
    onOpen(path, navFromEvent(e));
  };
  return (
    <>
      <span className="block text-xs leading-snug text-muted-foreground">{leadIn}</span>
      <span className={line}>
        {splitTicketKeys(title).map((part, i) => {
          if (typeof part !== 'string')
            return <TicketKeyText key={`title-${i}`} target={part.key} onOpen={onOpen} />;
          // Nothing to open, or nothing but spacing to hang a control on.
          if (!path || !part.trim()) return <span key={`title-${i}`}>{part}</span>;
          return (
            <button
              key={`title-${i}`}
              className="text-left underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={open}
              // Middle-click = open in background tab (browser semantics).
              onAuxClick={(e) => e.button === 1 && open(e)}
              title={`Open ${title}`}
            >
              {part}
            </button>
          );
        })}
      </span>
    </>
  );
}

/**
 * The change a new page makes, under its title: the facts a person checks (who
 * owes the to-do and when it is due, or the day the meeting was) on one dotted
 * line, then the first line of what the page says. A
 * to-do's line is what someone said, and the file writes it as a blockquote, so
 * the row draws it as one: the same left rule the diff gives a quoted line. Two
 * lines at most, because the page is one click away.
 *
 * The owner keeps their `[[people/…]]` ref, so `renderInline` draws them as the
 * same link a person is everywhere else. A bare name with no page stays text.
 *
 * The fallback is the composed headline, for the rare card that carries no facts
 * at all. A row that says nothing about its change is the fault this replaced.
 */
function FactsLine({
  facts: { facts, line, quoted },
  fallback,
  onOpen,
}: {
  facts: NewPageFacts;
  fallback: string;
  onOpen: (path: string) => void;
}) {
  if (facts.length === 0 && !line)
    return <p className="line-clamp-2 text-sm text-muted-foreground">{fallback}</p>;
  return (
    <>
      {facts.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {facts.map((part, i) => (
            <span key={i}>
              {i > 0 && (
                <span className="mx-1.5 text-muted-foreground/50" aria-hidden>
                  ·
                </span>
              )}
              {renderInline(part, onOpen, `fact-${i}`)}
            </span>
          ))}
        </p>
      )}
      {line &&
        (quoted ? (
          <blockquote className="relative mt-1 pl-3">
            <span
              className="absolute top-0 bottom-0 left-0 w-0.5 rounded bg-brand/30"
              aria-hidden
            />
            <p className="line-clamp-2 text-sm text-foreground/70 italic">
              {renderInline(line, onOpen, 'line')}
            </p>
          </blockquote>
        ) : (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {renderInline(line, onOpen, 'line')}
          </p>
        ))}
    </>
  );
}

/** One source the card was written from, as the openable chip that kind of
 *  thing wears everywhere else in the app. */
function EvidenceChip({
  source: raw,
  onOpen,
}: {
  source: string;
  onOpen: CardItemProps['onOpen'];
}) {
  // Evidence refs are wikilink slugs — resolve through the index like every
  // other link surface, but show the human title only.
  const { target } = normalizeLinkTarget(raw.replace(/^\[\[/, '').replace(/\]\]$/, ''));
  // An external source is the same object here as anywhere else, so it renders
  // as the same chip: typed, hover-carded, and honest about being a local copy.
  // Rolling our own button drew a wiki page with a ticket's glyph.
  if (isExternalRef(target))
    return <ExternalRefChip target={target} onOpen={onOpen} kind={evidenceChipKind(target)} />;
  const Icon = iconForRef(raw);
  // Resolve then open, honoring browser-style modifiers so ⌘/middle click drops
  // the note into a background tab. Snapshot the intent before the await — the
  // event is pooled and gone by then.
  const open = async (ev: {
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    button?: number;
  }) => {
    const opts = navFromEvent(ev);
    const path = await invoke['note:resolveLink'](target);
    if (path) onOpen(path, opts);
  };
  return (
    <button
      className="inline-flex items-center gap-1 rounded bg-brand/8 px-1.5 py-0.5 text-xs text-brand hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={(ev) => {
        ev.stopPropagation();
        void open(ev);
      }}
      onAuxClick={(ev) => {
        if (ev.button !== 1) return;
        ev.stopPropagation();
        void open(ev);
      }}
      title={`Open ${titleForRef(raw)}`}
    >
      <Icon className="size-3 shrink-0 opacity-70" aria-hidden />
      {titleForRef(raw)}
    </button>
  );
}

/** The edit affordance — plain textareas over the raw payload, mono where the
 *  text IS structured (a patch's replacement), never shown at rest. */
function EditFields({
  kind,
  draftBody,
  draftPatch,
  draftAppend,
  onBody,
  onPatch,
  onAppend,
}: {
  kind: ProposalDTO['kind'];
  draftBody: string;
  draftPatch: { search: string; replace: string }[];
  /** The card's appended text, or null when it has no append lever to edit. */
  draftAppend: string | null;
  onBody: (v: string) => void;
  onPatch: (
    fn: (d: { search: string; replace: string }[]) => { search: string; replace: string }[],
  ) => void;
  onAppend: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {kind === 'update' ? (
        <>
          {draftPatch.map((blk, i) => (
            <div key={i} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Replace this:</span>
              <pre className="max-h-24 overflow-y-auto rounded-lg bg-destructive/6 p-2 text-xs whitespace-pre-wrap text-muted-foreground">
                {blk.search}
              </pre>
              <span className="text-xs font-medium text-muted-foreground">With:</span>
              <textarea
                value={blk.replace}
                onChange={(e) =>
                  onPatch((d) => d.map((b, j) => (j === i ? { ...b, replace: e.target.value } : b)))
                }
                rows={Math.min(10, blk.replace.split('\n').length + 1)}
                className="w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          ))}
          {/* An appended section has no "replace this" half — it is only the new
              text, which on an empty page (a meeting the calendar made) is the
              whole write-up. */}
          {draftAppend !== null && (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Add this to the end:
              </span>
              <textarea
                value={draftAppend}
                onChange={(e) => onAppend(e.target.value)}
                rows={Math.min(16, draftAppend.split('\n').length + 2)}
                autoFocus={draftPatch.length === 0}
                className="w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          )}
        </>
      ) : (
        <textarea
          value={draftBody}
          onChange={(e) => onBody(e.target.value)}
          rows={Math.min(16, draftBody.split('\n').length + 2)}
          autoFocus
          className="w-full resize-y rounded-lg border border-input bg-background p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      )}
    </div>
  );
}

/** The external item an outbound card touches, or null (new tickets, messages).
 *  The provider's bare id: refMeta resolves external ids directly, so a page
 *  reference never fabricates a slug real mirror notes won't match. */
function outboundRef(ob: OutboundPayloadDTO): string | null {
  return ob.targetId ?? null;
}

/**
 * The payload re-approved after a stale refusal: the drafted-against snapshot
 * (`remote_updated`/`version`) refreshed to the mirror's current values, so the
 * accept-time check passes deliberately. When the mirror can't say, the
 * snapshot is stripped and the send proceeds unchecked — the PO chose that
 * with the banner in view.
 */
async function withFreshSnapshot(payload: OutboundPayloadDTO): Promise<OutboundPayloadDTO> {
  const next = { ...payload };
  delete next.remote_updated;
  delete next.version;
  const ref = outboundRef(payload);
  if (!ref) return next;
  const meta = await connections.refMeta(ref).catch(() => null);
  if (!meta) return next;
  if (payload.remote_updated !== undefined) next.remote_updated = meta.remoteUpdated;
  if (payload.version !== undefined && meta.notePath) {
    // The mirror's current page version lives on the mirror note.
    const note = await invoke['note:get'](meta.notePath).catch(() => null);
    const version = note?.frontmatter['version'];
    if (typeof version === 'number') next.version = version;
  }
  return next;
}

function useOutboundRefMeta(ob: OutboundPayloadDTO | null): ExternalRefMetaDTO | null {
  const [meta, setMeta] = useState<ExternalRefMetaDTO | null>(null);
  const ref = ob ? outboundRef(ob) : null;
  useEffect(() => {
    if (!ref) return;
    let alive = true;
    void refMetaCached(ref).then((m) => alive && setMeta(m));
    return () => {
      alive = false;
    };
  }, [ref]);
  return meta;
}

/**
 * The target line under the outbound banner: what happens, to what, in the
 * PO's words, with the touched item as a live chip. A ticket chip carries its
 * key, its status and its kind, so the comment line is just "Comment on
 * [PAY-142 · Blocked]": no system, no ticket name. A page is addressed by an
 * opaque id, so its title is what identifies it and stays on the line. Every
 * branch without a chip (a new ticket, a calendar event) names the system,
 * because nothing else on the card says where it lands.
 */
function OutboundTargetLine({
  payload,
  onOpen,
}: {
  payload: OutboundPayloadDTO;
  onOpen: (p: string) => void;
}) {
  const ref = outboundRef(payload);
  const system = providerName(payload);
  const line =
    'flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium text-foreground';
  const quiet = 'text-muted-foreground';

  if (payload.action === 'create_ticket') {
    return (
      <div className={line}>
        <span>
          Create a{system ? ` ${system}` : ''} {payload.issueType?.toLowerCase() ?? 'ticket'}
          {payload.container && <span className={quiet}> in {payload.container}</span>}
        </span>
        {payload.title && <span className={quiet}>: {payload.title}</span>}
      </div>
    );
  }

  // A calendar card touches no mirrored record, so the sentence is the whole
  // target: it must carry the name and the system on its own. The event's own
  // name is quoted — a title with a colon in it ("Erik x Daniel: sync")
  // otherwise runs straight into the words around it.
  if (!ref) {
    const event = payload.title ? `“${payload.title}”` : 'the event';
    const where = system ? ` in ${system}` : '';
    if (payload.action === 'create_event')
      return (
        <div className={line}>
          Add {event} to {system ?? 'your calendar'}
        </div>
      );
    if (payload.action === 'update_event')
      return (
        <div className={line}>
          Change {event}
          {where}
        </div>
      );
    if (payload.action === 'respond_to_event')
      return (
        <div className={line}>
          Reply {rsvpAnswer(payload.responseStatus)} to {event}
          {where}
        </div>
      );
    // Every card that reaches here names its own act above. A card with no
    // reference and no case of its own says nothing rather than guess.
    return null;
  }

  return (
    <div className={line}>
      <span className={quiet}>{payload.action === 'comment_ticket' ? 'Comment on' : 'Update'}</span>
      {/* A page is addressed by an opaque id, so the draft's own title is the
          fallback label — an unsynced connection must never leave the PO
          approving a write to "910231". A ticket key needs no such rescue. */}
      <ExternalRefChip
        target={ref}
        alias={payload.action === 'update_page' ? (payload.title ?? null) : null}
        onOpen={onOpen}
        kind={payload.action === 'update_page' ? `${system ?? 'Wiki'} page` : null}
      />
    </div>
  );
}

/**
 * The ticket fields a draft set: "Labels: scheduling · Priority: High". One
 * quiet line, and only the fields the draft filled in. They belong on the card
 * because nothing else says them: the body is the description, and a label the
 * team does not use is caught here or not at all.
 */
function TicketFieldsLine({ payload }: { payload: OutboundPayloadDTO }) {
  const rows = useMemo(() => ticketFieldRows(payload), [payload]);
  if (payload.action !== 'create_ticket' || rows.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {rows.map((row, i) => (
        <span key={row.label} className="inline-flex items-center gap-2">
          {i > 0 && (
            <span className="text-muted-foreground/50" aria-hidden>
              ·
            </span>
          )}
          <span>
            {row.label}: <span className="text-foreground">{row.value}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * When a calendar card lands: "Mon 10 Aug · 14:00–14:30 · 30 min". The head used
 * to name the event, the system and the reasoning while never once saying the
 * day or the hour — the one fact a person actually checks before letting
 * something onto their calendar. So it sits directly under the target line, at
 * full ink, with the length as the quiet part.
 *
 * A start already in the past is the classic drafting miss ("the tenth" read as
 * last month's tenth), and it is invisible in a date you have to work out. It is
 * marked here instead, in the card's warning vocabulary.
 */
function EventWhenLine({ payload }: { payload: OutboundPayloadDTO }) {
  const when = useMemo(
    () => describeEventWhen(payload.start, payload.end),
    [payload.start, payload.end],
  );
  if (!when) return null;
  // The 30-minute default is a create_event behaviour: rescheduling with a new
  // start leaves the existing end alone, so a length there would be a number
  // nobody wrote and the calendar won't honour.
  const length = when.allDay
    ? 'All day'
    : !when.assumedLength
      ? when.length
      : payload.action === 'create_event'
        ? `${when.length} by default`
        : null;
  const dot = (
    <span className="text-muted-foreground/50" aria-hidden>
      ·
    </span>
  );
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <CalendarClock className="size-3.5 shrink-0 text-brand" aria-hidden />
        {when.day}
      </span>
      {when.time && (
        <>
          {dot}
          <span className="font-medium text-foreground">{when.time}</span>
        </>
      )}
      {length && (
        <>
          {dot}
          <span className="text-muted-foreground">{length}</span>
        </>
      )}
      {when.past && (
        <span className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
          <AlertTriangle className="size-3" aria-hidden /> Already passed
        </span>
      )}
    </div>
  );
}

/**
 * Outbound detail: the body exactly as it will be sent (rendered, never raw
 * syntax), a redline against the page's current text for `update_page`, and the
 * drafted-against-stale banner when the target moved after this was written:
 * one extra glance, never a blocked send. A ticket comment sits on the quiet
 * surface the draft question uses, so it reads as a comment on the ticket and
 * not as a page of its own.
 */
function OutboundDetail({
  payload,
  onOpen,
}: {
  payload: OutboundPayloadDTO;
  onOpen: (p: string) => void;
}) {
  const meta = useOutboundRefMeta(payload);
  const [pageBefore, setPageBefore] = useState<string | null>(null);
  const [mirrorVersion, setMirrorVersion] = useState<number | null>(null);

  useEffect(() => {
    if (payload.action !== 'update_page' || !payload.targetId) return;
    let alive = true;
    void connections.pageBody(payload.targetId).then((b) => alive && setPageBefore(b));
    return () => {
      alive = false;
    };
  }, [payload.action, payload.targetId]);

  // The mirror's current page version lives on the mirror note — only needed
  // when the draft pinned one.
  useEffect(() => {
    if (payload.version === undefined || !meta?.notePath) return;
    let alive = true;
    void invoke['note:get'](meta.notePath)
      .then((note) => {
        const version = note?.frontmatter['version'];
        if (alive && typeof version === 'number') setMirrorVersion(version);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [payload.version, meta?.notePath]);

  // Honest staleness: the banner shows only when the draft carries a snapshot
  // of the mirror it was written against AND the mirror has moved past it —
  // never a clock comparison between two machines.
  const changedSince =
    meta !== null &&
    ((payload.remote_updated !== undefined && meta.remoteUpdated !== payload.remote_updated) ||
      (payload.version !== undefined &&
        mirrorVersion !== null &&
        mirrorVersion !== payload.version));
  const redline = payload.action === 'update_page' && pageBefore !== null;

  // A localized patch previews as the page with just that passage rewritten —
  // the context-collapsing diff then reads as a redline, not a whole-page
  // rewrite. Without a patch the body lands as an appended section. If the
  // page moved and the patch anchor is gone, the passage itself still reads.
  const diffPair = useMemo(() => {
    if (payload.action !== 'update_page' || pageBefore === null) return null;
    const patch = payload.patch;
    if (patch) {
      return pageBefore.includes(patch.search)
        ? { before: pageBefore, after: pageBefore.replace(patch.search, patch.replace) }
        : { before: patch.search, after: patch.replace };
    }
    return { before: pageBefore, after: `${pageBefore}\n\n${payload.body}` };
  }, [payload, pageBefore]);

  // Pages read by their title; only tickets go by key.
  const refName =
    payload.action === 'update_page'
      ? (payload.title ?? meta?.title ?? 'The page')
      : meta?.externalId;

  return (
    <div>
      {changedSince && (
        <div className="mb-2 flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="font-medium">{refName} changed since this was drafted</span>
            {meta.state && <>, now {meta.state}</>}
            {meta.lastChange?.by && <>, by {meta.lastChange.by}</>}
            {', '}
            {relativeTime(meta.lastChange?.at ?? meta.remoteUpdated)}. Worth one more glance before
            sending.
          </span>
        </div>
      )}
      {/* No caption over the box. The head already says "Update <page>" or
          "Comment on <ticket>", and a redline is unmistakably a redline. */}
      <PreviewSurface>
        {redline && diffPair ? (
          <RenderedDiff before={diffPair.before} after={diffPair.after} onOpen={onOpen} />
        ) : payload.action === 'comment_ticket' ? (
          <div className="rounded-md bg-muted/40 px-3 py-2">
            <Markdown content={payload.body} onOpenNote={onOpen} compact />
          </div>
        ) : (
          <Markdown content={payload.body} onOpenNote={onOpen} compact />
        )}
      </PreviewSurface>
    </div>
  );
}
/** The change, still loading — same pulse vocabulary as the session reader's
 *  skeleton, shaped like the lines it becomes rather than a spinner parked in
 *  the middle of the card. */
function PreviewSkeleton() {
  return (
    <div role="status" aria-label="Loading the change" className="flex flex-col gap-2.5 py-1">
      {[92, 76, 84].map((w, i) => (
        <div
          key={i}
          className="h-2.5 animate-pulse rounded bg-muted motion-reduce:animate-none"
          style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * The surface a send's own text sits on. A send cannot be taken back, so the
 * whole message is on the row rather than clamped: the box scrolls at 26rem so
 * a long redline does not bury the rows under it, and every word is still
 * reachable. The cap has to be legible, so content taller than the box fades at
 * the bottom edge. Measured, not assumed — a short comment gets no fade,
 * because a fade over content that isn't clipped is a lie about there being
 * more.
 */
function PreviewSurface({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 1);
    measure();
    // The box is capped, so it never resizes when its content grows — watch the
    // content itself (a late-loading font can push a preview past the cap).
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`max-h-[26rem] overflow-y-auto ${clipped ? 'qale-scroll-fade' : ''}`}
    >
      {children}
    </div>
  );
}

/** Render a frontmatter value for the property-change line: a day as a person
 *  says it, other scalars as they are, arrays joined, empty or absent as the
 *  word "empty" so a set-from-nothing reads. */
function fmValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'empty';
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(', ') : 'empty';
  return dayLabel(v) ?? String(v);
}

/**
 * The property changes an update sets — a todo's due/commitment, a person's ledger.
 * The body diff deliberately hides frontmatter, so a metadata edit would preview
 * as blank; this surfaces it as `key: was → now`. Values render through the same
 * inline pass as the body diff, so an evidence ref reads as its note title, not
 * raw `[[slug]]` syntax.
 */
function PropertyChanges({
  changes,
  onOpen,
}: {
  changes: { key: string; before: unknown; after: unknown }[];
  onOpen: (path: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {changes.map((c) => (
        <li key={c.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-dense">
          <span className="font-medium text-foreground/80 capitalize">
            {c.key.replace(/_/g, ' ')}
          </span>
          <span className="text-muted-foreground/70 line-through decoration-destructive/40">
            {renderInline(fmValue(c.before), onOpen, `${c.key}-was`)}
          </span>
          <span className="text-muted-foreground/50" aria-hidden>
            →
          </span>
          <span className="rounded-sm bg-success/10 px-1 font-medium text-foreground">
            {renderInline(fmValue(c.after), onOpen, `${c.key}-now`)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The change preview — the note as the PO will read it, never its source. New
 * notes/decisions render as real Markdown; an edit renders as a rendered diff
 * where removed content is struck through in red and added content sits on
 * green, with no `+`/`−` gutters, no `#`, and links shown by their title.
 * A metadata edit (frontmatter) is shown as a property-change list above the diff.
 */
export function ChangePreview({
  kind,
  preview,
  onOpen,
  context,
  inRow,
}: {
  kind: ProposalDTO['kind'];
  preview: {
    before: string;
    after: string;
    frontmatterChanges?: { key: string; before: unknown; after: unknown }[];
  };
  onOpen: (path: string) => void;
  /** See {@link RenderedDiff}. */
  context?: number;
  inRow?: boolean;
}) {
  const fmChanges = preview.frontmatterChanges ?? [];
  // A frontmatter-only card leaves the body untouched — don't render an empty diff.
  const bodyChanged = kind === 'update' && preview.before !== preview.after;
  // What a deletion takes: the page as it reads now, struck through. An empty
  // file previews as nothing at all, so it says so in words instead — that is
  // the whole case for the card, and a blank box makes it in one line.
  const empty = kind === 'delete' && !stripFrontmatter(preview.before).trim();
  return (
    /* No caption. A redline looks like a redline and a page looks like a page;
       "What this changes" over a diff named what the eye had already read. */
    <div>
      {(
        kind === 'update' ? (
          <div className="flex flex-col gap-3">
            {fmChanges.length > 0 && <PropertyChanges changes={fmChanges} onOpen={onOpen} />}
            {bodyChanged && (
              <RenderedDiff
                before={preview.before}
                after={preview.after}
                onOpen={onOpen}
                context={context}
                inRow={inRow}
              />
            )}
          </div>
        ) : kind === 'delete' ? (
          empty ? (
            <p className="text-sm text-muted-foreground">This page is empty.</p>
          ) : (
            <RenderedDiff before={preview.before} after="" onOpen={onOpen} context={context} />
          )
        ) : (
          <Markdown content={stripFrontmatter(preview.after)} onOpenNote={onOpen} compact />
        )
      )}
    </div>
  );
}

/**
 * Collapse an isolated one-line swap (a single deleted line immediately followed
 * by a single added line, both bounded by unchanged content — "a sentence was
 * edited") into one `replace` row. Instead of the old paragraph struck *and* the
 * near-identical new one green, the reader sees one line with only the changed
 * words highlighted. Larger, multi-line changes keep the block form.
 */
function mergeReplacements(rows: DiffRow[]): DiffRow[] {
  const out: DiffRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i]!;
    const next = rows[i + 1];
    const isolated =
      cur.kind === 'del' &&
      next?.kind === 'add' &&
      (i === 0 || rows[i - 1]!.kind === 'same') &&
      (i + 2 >= rows.length || rows[i + 2]!.kind === 'same');
    if (isolated && cur.kind === 'del' && next?.kind === 'add') {
      out.push({ kind: 'replace', text: next.text, before: cur.text, after: next.text });
      i++; // consume the paired add
    } else {
      out.push(cur);
    }
  }
  return out;
}

// Markdown atoms ([[link]], **bold**, `code`) stay whole; otherwise split on
// words and whitespace so shared text can be matched token by token.
const WORD_RE = /\[\[[^\]]+\]\]|\*\*[^*]+\*\*|`[^`]+`|\s+|[^\s]+/g;

type AffixDiff = { pre: string; midBefore: string; midAfter: string; suf: string };

/**
 * Trim the shared start and end of two edited lines and hand back the differing
 * middle. Prose reads far better this way than a per-word LCS: the unchanged
 * text shows once, and only the middle that actually changed is marked (removed
 * then added) — no confetti of scattered red/green words when a whole sentence
 * was rewritten.
 */
function affixDiff(before: string, after: string): AffixDiff {
  const b = before.match(WORD_RE) ?? [];
  const a = after.match(WORD_RE) ?? [];
  let p = 0;
  while (p < b.length && p < a.length && b[p] === a[p]) p++;
  let s = 0;
  while (s < b.length - p && s < a.length - p && b[b.length - 1 - s] === a[a.length - 1 - s]) s++;
  return {
    pre: b.slice(0, p).join(''),
    midBefore: b.slice(p, b.length - s).join(''),
    midAfter: a.slice(p, a.length - s).join(''),
    suf: b.slice(b.length - s).join(''),
  };
}

const INLINE_RE = /\[\[([^\]]+)\]\]|\*\*([^*]+)\*\*|`([^`]+)`/g;

/** Render a note line's inline syntax as it reads: references become titles,
 *  bold stays bold, code stays code — no raw `[[ ]]`, `**`, or backticks. A
 *  ticket key typed as bare text becomes the same chip its wikilink form does. */
function renderInline(text: string, onOpen: (p: string) => void, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last)
      nodes.push(...ticketKeyNodes(text.slice(last, match.index), onOpen, `${keyBase}-${last}`));
    const key = `${keyBase}-${match.index}`;
    if (match[1] !== undefined) {
      const { target, alias } = normalizeLinkTarget(match[1]);
      nodes.push(
        isExternalRef(target) ? (
          <ExternalRefChip key={key} target={target} alias={alias} onOpen={onOpen} />
        ) : (
          <button
            key={key}
            className="rounded-sm bg-brand/8 px-1 text-brand hover:bg-brand/15"
            onClick={async (e) => {
              e.stopPropagation();
              const path = await invoke['note:resolveLink'](target);
              if (path) onOpen(path);
            }}
          >
            {alias ?? titleForRef(target)}
          </button>
        ),
      );
    } else if (match[2] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold">
          {match[2]}
        </strong>,
      );
    } else if (match[3] !== undefined) {
      nodes.push(
        <code key={key} className="rounded bg-foreground/8 px-1 text-[0.9em]">
          {match[3]}
        </code>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length)
    nodes.push(...ticketKeyNodes(text.slice(last), onOpen, `${keyBase}-${last}`));
  return nodes;
}

type LineStructure = {
  inner: string;
  structural: string;
  padLeft: number;
  lead: 'bullet' | 'quote' | null;
};

/** Read a note line's block role (heading / bullet / quote) and hand back the
 *  bare inner text — markers become real structure, never raw `#`/`-`/`>`. */
function parseStructure(text: string): LineStructure {
  const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(text);
  const bullet = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(text);
  const quote = /^\s{0,3}>\s?(.*)$/.exec(text);
  if (heading)
    return {
      inner: heading[2]!,
      structural: 'font-semibold text-foreground',
      padLeft: 0,
      lead: null,
    };
  if (bullet)
    return {
      inner: bullet[3]!,
      structural: '',
      padLeft: Math.floor((bullet[1]?.length ?? 0) / 2) * 0.85 + 1.3,
      lead: 'bullet',
    };
  if (quote)
    return {
      inner: quote[1]!,
      structural: 'text-foreground/70 italic',
      padLeft: 0.9,
      lead: 'quote',
    };
  return { inner: text, structural: '', padLeft: 0, lead: null };
}

function leadNode(lead: LineStructure['lead']): ReactNode {
  if (lead === 'bullet') return <span className="absolute left-2 text-muted-foreground/60">•</span>;
  if (lead === 'quote')
    return (
      <span className="absolute top-0 bottom-0 left-1.5 w-0.5 rounded bg-brand/30" aria-hidden />
    );
  return null;
}

/** A wholly added or removed line — the change is carried by color + strikethrough.
 *  A run of such lines is one block: the wash is continuous through the blank
 *  lines between paragraphs, and only the run's first and last line round their
 *  corners. Washed line by line it read as a stack of pills. */
function DiffLine({
  row,
  first,
  last,
  onOpen,
}: {
  row: { kind: 'same' | 'add' | 'del'; text: string };
  /** Whether the neighbouring row is of a different kind. */
  first: boolean;
  last: boolean;
  onOpen: (p: string) => void;
}) {
  const wash = row.kind === 'add' ? 'bg-success/10' : row.kind === 'del' ? 'bg-destructive/8' : '';
  const corners = `${first ? 'rounded-t-sm' : ''} ${last ? 'rounded-b-sm' : ''}`;

  // A blank line is paragraph spacing, not content — render the gap, carrying
  // the run's wash so the block stays whole, never a bar of its own.
  if (row.text.trim() === '') return <div className={`-mx-1 h-2 ${wash} ${corners}`} aria-hidden />;

  const s = parseStructure(row.text);
  const tone =
    row.kind === 'add'
      ? 'text-foreground'
      : row.kind === 'del'
        ? 'text-muted-foreground line-through decoration-destructive/40'
        : 'text-foreground/70';

  return (
    <div
      className={`relative -mx-1 px-2 py-0.5 ${wash} ${corners} ${tone} ${s.structural}`}
      style={s.padLeft ? { paddingLeft: `${s.padLeft}rem` } : undefined}
    >
      {leadNode(s.lead)}
      <span className="[overflow-wrap:anywhere] whitespace-pre-wrap">
        {s.inner ? renderInline(s.inner, onOpen, row.text.slice(0, 8)) : ' '}
      </span>
    </div>
  );
}

/** How long a replaced span can be and still be read in place. Past this the old
 *  wording is a sentence of its own, and printing both doubles the line. */
const SHORT_SPAN = 40;

/**
 * An edited line, shown result-first: the note as it will now read, with only
 * the newly-changed span highlighted.
 *
 * A short swap shows both halves in place: "Shift swaps — ~~Q4~~ Q3". The whole
 * point of the line is which value changed, and a quarter, a date or a name
 * hidden behind a "was…" toggle left the reader unable to see the change without
 * a click. A long rewrite keeps the toggle, because printing the old sentence
 * beside the new one doubles the line and the row has a few lines to spend.
 *
 * A pure deletion has nothing new to show, so the removed span is struck in
 * place.
 */
function ReplaceLine({
  before,
  after,
  onOpen,
}: {
  before: string;
  after: string;
  onOpen: (p: string) => void;
}) {
  const s = parseStructure(after);
  const beforeInner = parseStructure(before).inner;
  const d = useMemo(() => affixDiff(beforeInner, s.inner), [beforeInner, s.inner]);
  const [showOld, setShowOld] = useState(false);
  const removed = d.midBefore.trim() !== '';
  const added = d.midAfter.trim() !== '';
  // Short enough to read in place, so the row shows what it was and what it now
  // is, side by side.
  const inPlace = added && removed && d.midBefore.trim().length <= SHORT_SPAN;
  const pad = s.padLeft ? { paddingLeft: `${s.padLeft}rem` } : undefined;
  return (
    <div>
      <div
        className={`relative -mx-1 rounded-sm px-2 py-0.5 text-foreground/90 ${s.structural}`}
        style={pad}
      >
        {leadNode(s.lead)}
        <span className="[overflow-wrap:anywhere] whitespace-pre-wrap">
          {d.pre && renderInline(d.pre, onOpen, 'pre')}
          {(inPlace || !added) && removed && (
            <span className="rounded-sm bg-destructive/10 text-muted-foreground line-through decoration-destructive/40">
              {renderInline(d.midBefore, onOpen, 'mb')}
            </span>
          )}
          {inPlace && ' '}
          {added && (
            <span className="rounded-sm bg-success/10 text-foreground">
              {renderInline(d.midAfter, onOpen, 'ma')}
            </span>
          )}
          {d.suf && renderInline(d.suf, onOpen, 'suf')}
          {/* The one control that answers "what did it say before?" — it was the
              faintest thing on the card (2.8:1) in the one place the PO is
              checking the agent's work. */}
          {added && removed && !inPlace && (
            <button
              className="ml-1.5 align-baseline text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={(e) => {
                e.stopPropagation();
                setShowOld((v) => !v);
              }}
            >
              {showOld ? 'hide previous' : 'was…'}
            </button>
          )}
        </span>
      </div>
      {showOld && added && removed && !inPlace && (
        <div className="-mx-1 px-2 py-0.5 text-muted-foreground" style={pad}>
          <span className="[overflow-wrap:anywhere] text-muted-foreground/70 line-through whitespace-pre-wrap decoration-destructive/40">
            {renderInline(d.midBefore, onOpen, 'mbo')}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Result first: where a block of lines is replaced by another, the new text
 * comes first and the text it replaced sits under it.
 *
 * A row has a few lines to say what changes. A rewritten paragraph spends all of
 * them on the version that is going away, so the reader sees only what they are
 * about to lose and nothing of what they are about to get. The old text is still
 * there, under the new, struck as it always was.
 */
function resultFirst(rows: DiffView[]): DiffView[] {
  const out: DiffView[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.kind !== 'del') {
      out.push(rows[i]!);
      continue;
    }
    let del = i;
    while (rows[del]?.kind === 'del') del++;
    let add = del;
    while (rows[add]?.kind === 'add') add++;
    out.push(...rows.slice(del, add), ...rows.slice(i, del));
    i = Math.max(del, add) - 1;
  }
  return out;
}

/** A run of unchanged text at either end says nothing: the change has not
 *  started yet, or it is over. */
function trimGaps(rows: DiffView[]): DiffView[] {
  const start = rows[0]?.kind === 'gap' ? 1 : 0;
  const end = rows.at(-1)?.kind === 'gap' ? rows.length - 1 : rows.length;
  return rows.slice(start, end);
}

function RenderedDiff({
  before,
  after,
  onOpen,
  context = 2,
  inRow,
}: {
  before: string;
  after: string;
  onOpen: (p: string) => void;
  /**
   * Lines of unchanged text kept around each change. A row shows none: it has a
   * few lines to say what changes, and spending the first two on text that
   * stayed the same buries the change under the clamp.
   */
  context?: number;
  /** Draw it for a row: the new text first, and no unchanged run at either end. */
  inRow?: boolean;
}) {
  // Frontmatter never reaches the PO — diff only the readable body. Isolated
  // one-line edits collapse to a single word-level line before context-trimming.
  const rows = useMemo(() => {
    const trimmed = withContext(
      mergeReplacements(diffLines(stripFrontmatter(before), stripFrontmatter(after))),
      context,
    );
    return inRow ? resultFirst(trimGaps(trimmed)) : trimGaps(trimmed);
  }, [before, after, context, inRow]);
  return (
    <div className="flex flex-col text-sm leading-relaxed">
      {rows.map((r, i) =>
        r.kind === 'gap' ? (
          // The page continues here. The count leads and one rule runs out to
          // the edge, so the marker reads as a fold in the document rather than
          // a titled divider across the card.
          <div key={i} className="flex items-center gap-2 py-1 select-none" aria-hidden>
            <span className="text-xs text-muted-foreground/80">{r.text}</span>
            <span className="h-px flex-1 bg-border/80" />
          </div>
        ) : r.kind === 'replace' ? (
          <ReplaceLine key={i} before={r.before} after={r.after} onOpen={onOpen} />
        ) : (
          <DiffLine
            key={i}
            row={r}
            first={rows[i - 1]?.kind !== r.kind}
            last={rows[i + 1]?.kind !== r.kind}
            onOpen={onOpen}
          />
        ),
      )}
    </div>
  );
}
