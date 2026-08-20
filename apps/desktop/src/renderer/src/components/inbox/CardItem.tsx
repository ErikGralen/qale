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
import { describeEventWhen, normalizeLinkTarget, rsvpAnswer } from '@qale/domain';
import { useApp } from '../../state/app-state';
import { invoke } from '../../lib/ipc';
import {
  connections,
  externalSlugOf,
  isExternalRef,
  refMetaCached,
  type ExternalRefMetaDTO,
} from '../../lib/connections';
import { relativeTime } from '../../lib/dates';
import { diffLines, withContext, type DiffRow } from '../../lib/diff';
import { navFromEvent, type NavOpts } from '../../lib/nav';
import { Markdown } from '../Markdown';
import { ExternalRefChip } from '../ExternalRef';
import { outboundAct, providerName, rowFocusClass, useQueueFocus, WikiText } from './shared';
import {
  bareRef,
  cardHeadline,
  iconForRef,
  sourceHint,
  stripFrontmatter,
  titleForRef,
} from './cardMeta';

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
  /** Open with the detail showing (a housekeeping row expanding into the full card). */
  initialExpanded?: boolean;
  /** When set, collapsing the open detail returns to the caller's compact form instead. */
  onCollapse?: () => void;
}

/** The note a card refers to, as a distinct, openable chip — so a note title
 *  never reads as loose words run together with the verb around it. A leading
 *  type glyph says what kind of note it is; ⌘/middle-click opens it in a
 *  background tab like every other link surface. */
function NoteChip({
  title,
  path,
  onOpen,
  small,
}: {
  title: string;
  path: string;
  onOpen: (opts: NavOpts) => void;
  small?: boolean;
}) {
  const Icon = iconForRef(path);
  return (
    <button
      className={`inline-flex max-w-full items-baseline gap-1 rounded-md bg-brand/8 px-1.5 font-medium text-brand transition-colors hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
        small ? 'py-0.5 text-xs' : 'py-px'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(navFromEvent(e));
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.stopPropagation();
        onOpen(navFromEvent(e));
      }}
      title={`Open ${title}`}
    >
      <Icon className="size-3 shrink-0 self-center opacity-70" aria-hidden />
      <span className="truncate">{title}</span>
    </button>
  );
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

/** Amber flag — an unsourced claim is never the quietest thing on screen. */
function InferenceFlag() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning"
      title="The agent inferred this without citing a source. Double-check it."
    >
      <AlertTriangle className="size-3" aria-hidden /> Unverified
    </span>
  );
}

/** The PO's own words are the source. Quiet, and never the amber flag: a card
 *  built on what they just said is the best-sourced kind there is, and telling
 *  them to double-check it is telling them to double-check themselves. A chat
 *  message is not a note, so there was nothing to cite and the card said
 *  "Unverified" instead of saying who asked. */
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
 * The housekeeping tier of a meeting review — mechanical writes (hub links,
 * ledger bumps) shown as one-line rows so the review reads as a couple of real
 * decisions plus a batch, not six equal cards. Expands to the full card.
 */
export function HousekeepingItem(props: CardItemProps) {
  const { proposal, busy, focused, error, onFocus, onAccept, onReject, onOpen } = props;
  const [expanded, setExpanded] = useState(false);
  const ref = useQueueFocus<HTMLLIElement>(focused);

  // Expanding opens the full card WITH its detail (that's what the click asked
  // for), and the card's collapse chevron folds it back to this one-line row.
  // Error cards force the full form and stay there — the row can't show why.
  if (expanded || error)
    return (
      <CardItem
        {...props}
        initialExpanded={expanded}
        onCollapse={expanded ? () => setExpanded(false) : undefined}
      />
    );

  const { headline } = cardHeadline(proposal);
  const target = proposal.targetPath ?? (proposal.payload as { path?: string }).path ?? '';
  const noteTitle = titleForRef(target);
  return (
    <li
      ref={ref}
      tabIndex={-1}
      onClick={onFocus}
      onFocus={onFocus}
      className={`group flex items-center gap-2 rounded-lg bg-card py-1.5 pr-1.5 pl-3 ${rowFocusClass(focused)}`}
    >
      <button
        className="min-w-0 flex-1 truncate text-left text-sm text-foreground/85 focus-visible:outline-none"
        onClick={() => setExpanded(true)}
        title="Show the full change"
      >
        {headline}
      </button>
      {noteTitle && (
        <button
          className="hidden max-w-48 shrink-0 truncate text-xs text-muted-foreground hover:text-foreground sm:block"
          onClick={() => onOpen(target)}
          title={`Open ${noteTitle}`}
        >
          {noteTitle}
        </button>
      )}
      <button
        className="rounded p-1 text-muted-foreground opacity-0 group-focus-within:opacity-70 group-hover:opacity-70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setExpanded(true)}
        aria-label="Show the full change"
        title="Show the full change"
      >
        <Pencil className="size-3.5" />
      </button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onAccept()}
        disabled={busy}
        aria-label="Approve"
      >
        <Check className="size-3.5" />
      </Button>
      <Button size="sm" variant="ghost" onClick={onReject} disabled={busy} aria-label="Discard">
        <X className="size-3.5" />
      </Button>
    </li>
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
  initialExpanded,
  onCollapse,
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
  const [expanded, setExpanded] = useState(!!initialExpanded);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState('');
  const [draftPatch, setDraftPatch] = useState<{ search: string; replace: string }[]>([]);
  // null = this card has no append lever, so editing must not add one.
  const [draftAppend, setDraftAppend] = useState<string | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const ref = useQueueFocus<HTMLLIElement>(focused);

  const outbound = proposal.kind === 'outbound' ? (proposal.payload as OutboundPayloadDTO) : null;
  // What this card does, in one vocabulary: the button's verb and the glyph.
  const act = outbound ? outboundAct(outbound) : null;
  // An outbound send is the review's own last decision — never a one-line row.
  // It always shows its detail so nothing leaves the workspace unseen.
  const open = expanded || editing || !!outbound;

  // Collapsing hands control back to the caller's compact form (the
  // housekeeping row) when there is one — except mid-edit, where the detail
  // holds unsaved changes.
  const toggleDetail = () => {
    if (open && !editing && onCollapse) onCollapse();
    else setExpanded((x) => !x);
  };

  const { Icon, headline, authored, verb, note, creates, replaces, retitle } =
    cardHeadline(proposal);
  // Provenance is stated once. Closed, it is this line — the only thing telling
  // the PO where a change came from. Open, the evidence chips below say it
  // better (they open), so the line goes rather than sit above its own echo.
  const source = (() => {
    const s = sourceHint(proposal);
    return s && s !== note?.title && !open ? s : null;
  })();

  // The record a send writes to is the card's subject, not its reasoning, so it
  // never doubles as its own citation — "Based on" is for what made this true.
  const target = useOutboundRefMeta(outbound);
  const evidence = proposal.evidence.filter((e) => {
    if (!outbound) return true;
    const bare = bareRef(e.ref);
    return bare !== target?.slug && bare !== externalSlugOf(outboundRef(outbound) ?? '');
  });

  // Fetch the preview lazily — only once the card is open, so a 24-card review
  // doesn't fire two dozen preview reads up front.
  useEffect(() => {
    if (!open || preview) return;
    let alive = true;
    void previewProposal(proposal.id).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [open, preview, proposal.id, previewProposal]);

  const startEdit = () => {
    if (proposal.kind === 'update') {
      const payload = proposal.payload as UpdatePayloadDTO;
      setDraftPatch((payload.patch ?? []).map((p) => ({ ...p })));
      setDraftAppend(payload.append ?? null);
    } else {
      setDraftBody((proposal.payload as { body?: string }).body ?? '');
    }
    setExpanded(true);
    setEditing(true);
  };

  // The escape hatch: talk the card through in a seeded session. The card stays
  // pending — the session can end in approval here or a revised card.
  const discuss = () => {
    const prompt = [
      "I'm looking at a pending approval card and want to talk it through before deciding. Don't apply anything. The card stays pending until I act on it.",
      '',
      `Change: ${headline}`,
      `Why: ${proposal.rationale}`,
      proposal.evidence.length > 0
        ? `Sources: ${proposal.evidence.map((e) => e.ref).join(', ')}`
        : null,
      '',
      'Proposed payload:',
      '```json',
      JSON.stringify(proposal.payload, null, 2).slice(0, 4000),
      '```',
      '',
      "Briefly explain why this was proposed and what approving would change, citing sources. Then ask what I'd like to adjust. If I want changes, propose a revised card.",
    ]
      .filter((line) => line !== null)
      .join('\n');
    openSession(undefined, {
      initialPrompt: prompt,
      title: `About: ${headline.slice(0, 48)}`,
      fresh: true,
    });
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
  // and the only one that knows what the card was for. This used to re-run the
  // skill from scratch, which opened a session that had never heard of the card
  // and asked the PM what they wanted.
  const owningSession = sessions.find((s) => s.id === proposal.sessionId);
  const fix = () => {
    const payload = proposal.payload as UpdatePayloadDTO;
    const anchors = (payload.patch ?? []).map((p) => p.search).filter(Boolean);
    const prompt = [
      `A card you put in front of me can't be applied any more: ${placementProblem}.`,
      '',
      `Card: ${proposal.id}`,
      `Note: ${payload.path}`,
      `What it was for: ${proposal.rationale}`,
      anchors.length > 0 ? ['', 'The text it was anchored to:', '```', ...anchors, '```'] : null,
      '',
      owningSession
        ? `Read ${payload.path} as it stands now, then withdraw_proposal ${proposal.id} and propose the edit again against the note's current text. If what it wanted is already there, or no longer needed, withdraw it and say so in one line. Don't touch anything else.`
        : `Read ${payload.path} as it stands now, then propose this edit again against the note's current text. The card came from a session that is gone, so I'll discard the old one myself. If what it wanted is already there, or no longer needed, say so in one line. Don't touch anything else.`,
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

  const approveEdited = () => {
    const edited =
      proposal.kind === 'update'
        ? {
            ...(proposal.payload as UpdatePayloadDTO),
            patch: draftPatch,
            ...(draftAppend !== null ? { append: draftAppend } : {}),
          }
        : { ...(proposal.payload as unknown as Record<string, unknown>), body: draftBody };
    setEditing(false);
    onAccept(edited);
  };

  return (
    <li
      ref={ref}
      tabIndex={-1}
      onClick={onFocus}
      onFocus={onFocus}
      className={`overflow-hidden rounded-xl bg-card ${rowFocusClass(focused)} ${
        outbound && !focused ? 'ring-brand/30' : ''
      }`}
    >
      {/* A send's head is one statement, not a banner stacked on a headline:
          where it goes, what it touches, what it says. The warning strip and the
          title row were two containers narrating the same fact, and the card
          spent three bordered regions before showing a word of the change. */}
      {outbound ? (
        <div className="border-b border-brand/20 bg-brand/6 px-4 py-3">
          <div className="flex items-center gap-2 text-xs">
            <ArrowUpRight className="size-3.5 shrink-0 text-brand" />
            <span className="font-medium text-foreground">Leaves your workspace</span>
          </div>
          <OutboundTargetLine payload={outbound} onOpen={onOpen} />
          {/* When it lands. On a calendar card this is the fact being approved —
              the head named the event and the system and never once said which
              day or hour, which is the only thing a person checks. */}
          <EventWhenLine payload={outbound} />
          {/* The target line names the record; this names the change. Full ink,
              regular weight — the longest line in the head shouldn't also be
              the faintest one. 4px binds the label to its target, 8px separates
              the pair from the sentence: one beat, not three even ones. Only an
              agent-authored headline earns the line: the mechanical fallback is
              built from the same payload as the target line, so it can only
              ever restate it. */}
          {authored && (
            <p className="mt-2 text-sm leading-snug text-balance break-words text-foreground">
              {headline}
            </p>
          )}
          {(proposal.asked || proposal.inference || proposal.selfStarted) && (
            <span className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              {proposal.asked ? <AskedLine /> : proposal.inference && <InferenceFlag />}
              {proposal.selfStarted && <SelfStartedLine text={proposal.selfStarted} />}
            </span>
          )}
        </div>
      ) : (
        /* Header: the scannable human headline + inline approve/discard. The whole
         line toggles the detail. Actions stay top-aligned and reachable even
         when the headline wraps to two lines. */
        <div className="flex items-start gap-2 px-4 py-3">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 cursor-pointer" onClick={toggleDetail}>
            <span className="block text-sm leading-snug font-medium text-balance break-words text-foreground">
              {note && !authored ? (
                // "Update <note>" — the note is the subject, so it renders as a
                // distinct, openable chip instead of running into the verb.
                <>
                  <span className="text-muted-foreground">{verb} </span>
                  <NoteChip
                    title={note.title}
                    path={note.path}
                    onOpen={(opts) => onOpen(note.path, opts)}
                  />
                </>
              ) : (
                headline
              )}
            </span>
            {(replaces ||
              retitle ||
              (note && authored) ||
              creates ||
              source ||
              proposal.asked ||
              proposal.inference ||
              proposal.selfStarted) && (
              <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                {note && authored && (
                  <NoteChip
                    title={note.title}
                    path={note.path}
                    onOpen={(opts) => onOpen(note.path, opts)}
                    small
                  />
                )}
                {/* Where a create card lands. Plain text, not a chip: the note
                    does not exist yet, and a chip that cannot be clicked is a
                    promise the card can't keep. The path is on hover. */}
                {creates && (
                  <span title={creates.path}>
                    Files as <span className="text-foreground/75">“{creates.title}”</span>
                  </span>
                )}
                {replaces && (
                  <span>
                    Replaces <span className="text-foreground/75">“{replaces}”</span>
                  </span>
                )}
                {retitle && (
                  <span>
                    Retitles to <span className="text-foreground/75">“{retitle}”</span>
                  </span>
                )}
                {proposal.asked ? (
                  <AskedLine />
                ) : proposal.inference ? (
                  <InferenceFlag />
                ) : (
                  source && <span>from {source}</span>
                )}
                {proposal.selfStarted && <SelfStartedLine text={proposal.selfStarted} />}
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {!open && (
              <>
                <button
                  className="rounded-md p-1.5 text-brand transition-colors hover:bg-brand/10 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => onAccept()}
                  disabled={busy || preview?.stale}
                  aria-label="Approve"
                  title="Approve"
                >
                  <Check className="size-4" />
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
              </>
            )}
            <button
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={toggleDetail}
              aria-label={open ? 'Collapse' : 'Show detail'}
              title={open ? 'Collapse' : 'Show detail'}
            >
              <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="border-t border-border/60 px-4 pt-3 pb-4">
          {/* What approving DOES, and who it reaches — composed from the payload
              in the main process, so it is the same sentence on every card of a
              kind. It sits above the "why" and carries full ink: the reason is
              the agent's, the consequence is the PO's. Outbound cards only. */}
          {proposal.effect && (
            <p className="mb-2 text-sm leading-relaxed text-foreground">{proposal.effect}</p>
          )}
          {/* The human "why" — clamped to two lines so a long agent rationale
              never becomes a wall; the change itself is the point, not the essay. */}
          {proposal.rationale && (
            <div className="text-sm leading-relaxed text-foreground/80">
              <p className={whyOpen ? '' : 'line-clamp-2'}>
                <WikiText text={proposal.rationale} onOpen={onOpen} />
              </p>
              {proposal.rationale.length > 150 && (
                <button
                  className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  onClick={() => setWhyOpen((v) => !v)}
                >
                  {whyOpen ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}

          {evidence.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Based on</span>
              {evidence.map((e) => {
                // Evidence refs are wikilink slugs — resolve through the index
                // like every other link surface, but show the human title only.
                const { target: evTarget } = normalizeLinkTarget(
                  e.ref.replace(/^\[\[/, '').replace(/\]\]$/, ''),
                );
                // An external source is the same object here as anywhere else,
                // so it renders as the same chip: typed, hover-carded, and
                // honest about being a local copy. Rolling our own button drew
                // a Confluence page with a ticket's glyph.
                if (isExternalRef(evTarget))
                  return (
                    <ExternalRefChip
                      key={e.ref}
                      target={evTarget}
                      onOpen={onOpen}
                      kind={evTarget.startsWith('wikipages/') ? 'Confluence page' : 'Jira ticket'}
                    />
                  );
                const EvIcon = iconForRef(e.ref);
                // Resolve then open, honoring browser-style modifiers so ⌘/middle
                // click drops the note into a background tab. Snapshot the intent
                // before the await — the event is pooled and gone by then.
                const openEvidence = async (ev: {
                  metaKey: boolean;
                  ctrlKey: boolean;
                  shiftKey: boolean;
                  button?: number;
                }) => {
                  const opts = navFromEvent(ev);
                  const path = await invoke['note:resolveLink'](evTarget);
                  if (path) onOpen(path, opts);
                };
                return (
                  <button
                    key={e.ref}
                    className="inline-flex items-center gap-1 rounded bg-brand/8 px-1.5 py-0.5 text-xs text-brand hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void openEvidence(ev);
                    }}
                    onAuxClick={(ev) => {
                      if (ev.button !== 1) return;
                      ev.stopPropagation();
                      void openEvidence(ev);
                    }}
                    title={`Open ${titleForRef(e.ref)}`}
                  >
                    <EvIcon className="size-3 shrink-0 opacity-70" aria-hidden />
                    {titleForRef(e.ref)}
                  </button>
                );
              })}
            </div>
          )}

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
            <OutboundDetail payload={outbound} onOpen={onOpen} />
          ) : preview ? (
            <ChangePreview kind={proposal.kind} preview={preview} onOpen={onOpen} />
          ) : (
            // The preview is read on open, so the card would otherwise sit with
            // its "why" and no change under it — the one thing being approved,
            // absent. Shaped like the diff it becomes, per the reader skeleton.
            <PreviewSkeleton />
          )}

          {preview?.stale ? (
            <div
              role="alert"
              className="mt-3 flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive"
            >
              {preview.staleReason === 'missing' ? (
                // Nothing to redo it against, so there is no repair to offer.
                <span className="flex-1">
                  The note this edit belongs to is gone, so there is nothing to change. Discard the
                  card.
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
            // approved is what is on screen. Said quietly because the sentence
            // the card was written about may have moved with it.
            preview?.moved && (
              <p className="mt-3 text-xs text-muted-foreground">
                The note changed after this was proposed. The change above is against the note as it
                reads now.
              </p>
            )
          )}

          {error && (
            <div
              role="alert"
              className="mt-3 flex items-center gap-3 rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive"
            >
              <span className="flex-1">{error}</span>
              {outbound && staleSend ? (
                // Main refused the send because the target moved after
                // drafting. Approving anyway re-accepts with the snapshot
                // refreshed to the mirror's current state — an explicit
                // decision, never a silent retry loop.
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void withFreshSnapshot(outbound).then((p) => onAccept(p))}
                >
                  {act && <act.Icon className="size-3.5" />} Approve anyway
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onAccept()} disabled={busy}>
                  Retry
                </Button>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {editing ? (
              <>
                <Button
                  size="sm"
                  data-send={outbound ? proposal.id : undefined}
                  onClick={approveEdited}
                  disabled={busy || preview?.stale}
                >
                  {act ? <act.Icon className="size-3.5" /> : <Check className="size-3.5" />}
                  {act ? `Approve edits & ${act.verb}` : 'Approve edited'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {/* The queue's ↵ lands here rather than firing — `data-send` is
                    the handle it focuses, so a send always costs a second,
                    deliberate press on the button itself. The label names the
                    act: only a message is sent, a page is updated in place. */}
                <Button
                  size="sm"
                  data-send={outbound ? proposal.id : undefined}
                  onClick={() => onAccept()}
                  disabled={busy || preview?.stale}
                >
                  {act ? <act.Icon className="size-3.5" /> : <Check className="size-3.5" />}
                  {act ? `Approve & ${act.verb}` : 'Approve'}
                </Button>
                {/* One filled control on the row. Edit and Discard were two
                    identical outlines flanking it, so three buttons competed at
                    the same weight; as ghosts they read as what they are —
                    adjuncts to the one decision the card is asking for. */}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={startEdit}
                  disabled={busy || preview?.stale}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={onReject} disabled={busy}>
                  <X className="size-3.5" /> Discard
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={discuss}>
                  <MessageSquare className="size-3.5" /> Ask about this
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
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
    <div className="mt-3 flex flex-col gap-2">
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
 *  The bare issue key / page id — refMeta resolves external ids directly, so a
 *  page reference never fabricates a slug real mirror notes won't match. */
function outboundRef(ob: OutboundPayloadDTO): string | null {
  return ob.issueKey ?? ob.pageId ?? null;
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
 * The target line under the outbound banner — what happens, to what, in the
 * PO's words, with the touched item as a live chip that names its own kind:
 * "Comment on the Jira ticket [PAY-142 · Blocked] — SAML SSO (epic)".
 * Every branch names the system, because a card with no chip (a message, a
 * calendar event) would otherwise never say where it lands.
 */
function OutboundTargetLine({
  payload,
  onOpen,
}: {
  payload: OutboundPayloadDTO;
  onOpen: (p: string) => void;
}) {
  const meta = useOutboundRefMeta(payload);
  const ref = outboundRef(payload);
  const system = providerName(payload);
  const line =
    'mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-medium text-foreground';
  const quiet = 'text-muted-foreground';

  if (payload.action === 'create_ticket') {
    return (
      <div className={line}>
        <span>
          Create a{system ? ` ${system}` : ''} {payload.issueType?.toLowerCase() ?? 'ticket'}
          {payload.projectKey && <span className={quiet}> in {payload.projectKey}</span>}
        </span>
        {payload.title && <span className={quiet}>: {payload.title}</span>}
      </div>
    );
  }

  // Calendar and message cards touch no mirrored record, so the sentence is
  // the whole target: it must carry the name and the system on its own. The
  // event's own name is quoted — a title with a colon in it ("Erik x Daniel:
  // sync") otherwise runs straight into the words around it.
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
    return (
      <div className={line}>
        <span>Send an update to {payload.audience ?? 'stakeholders'}</span>
        {payload.title && <span className={quiet}>: {payload.title}</span>}
      </div>
    );
  }

  return (
    <div className={line}>
      <span>
        {payload.action === 'comment_ticket'
          ? `Comment on the${system ? ` ${system}` : ''} ticket`
          : 'Update'}
      </span>
      {/* A page is addressed by an opaque id, so the draft's own title is the
          fallback label — an unsynced connection must never leave the PO
          approving a write to "910231". A ticket key needs no such rescue. */}
      <ExternalRefChip
        target={ref}
        alias={payload.action === 'update_page' ? (payload.title ?? null) : null}
        onOpen={onOpen}
        kind={payload.action === 'update_page' ? `${system ?? 'Wiki'} page` : null}
      />
      {meta?.kind === 'ticket' && meta.title && <span className={quiet}>: {meta.title}</span>}
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
 * drafted-against-stale banner when the target moved after this was written —
 * one extra glance, never a blocked send.
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
    if (payload.action !== 'update_page' || !payload.pageId) return;
    let alive = true;
    void connections.pageBody(payload.pageId).then((b) => alive && setPageBefore(b));
    return () => {
      alive = false;
    };
  }, [payload.action, payload.pageId]);

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
    <div className="mt-3">
      {changedSince && (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">
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
      {/* Name what the box holds. "What gets sent" over a page redline
          promised a delivery and showed an edit. */}
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {redline
          ? 'How the page changes'
          : payload.action === 'update_page'
            ? 'What gets added to the page'
            : payload.action === 'comment_ticket'
              ? 'The comment'
              : payload.action === 'create_ticket'
                ? 'The ticket'
                : payload.action.endsWith('_event')
                  ? 'The event description'
                  : 'What gets sent'}
      </div>
      <PreviewSurface>
        {redline && diffPair ? (
          <RenderedDiff before={diffPair.before} after={diffPair.after} onOpen={onOpen} />
        ) : (
          <Markdown content={payload.body} onOpenNote={onOpen} />
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
    <div className="mt-4" role="status" aria-label="Loading the change">
      <div className="mb-2 h-3 w-24 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      <div className="flex flex-col gap-2.5 rounded-lg bg-muted/30 px-4 py-3">
        {[92, 76, 84].map((w, i) => (
          <div
            key={i}
            className="h-2.5 animate-pulse rounded bg-muted motion-reduce:animate-none"
            style={{ width: `${w}%`, animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The surface every preview sits on — one capped, scrollable region, shared so
 * a redline and a filed note never drift apart. The cap has to be legible: a
 * region that simply stops at 26rem reads as the whole change, so when the
 * content is taller than the box it fades at the bottom edge. Measured, not
 * assumed — a short comment gets no fade, because a fade over content that
 * isn't clipped is a lie about there being more.
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
      className={`max-h-[26rem] overflow-y-auto rounded-lg bg-muted/30 px-4 py-3 ${
        clipped ? 'qale-scroll-fade' : ''
      }`}
    >
      {children}
    </div>
  );
}

/** Render a frontmatter value for the property-change line — dates and scalars
 *  as-is, arrays joined, empty/absent as the word "empty" so a set-from-nothing reads. */
function fmValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return 'empty';
  if (Array.isArray(v)) return v.length ? v.map((x) => String(x)).join(', ') : 'empty';
  return String(v);
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
function ChangePreview({
  kind,
  preview,
  onOpen,
}: {
  kind: ProposalDTO['kind'];
  preview: {
    before: string;
    after: string;
    frontmatterChanges?: { key: string; before: unknown; after: unknown }[];
  };
  onOpen: (path: string) => void;
}) {
  const fmChanges = preview.frontmatterChanges ?? [];
  // A frontmatter-only card leaves the body untouched — don't render an empty diff.
  const bodyChanged = kind === 'update' && preview.before !== preview.after;
  return (
    <div className="mt-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {kind === 'update' ? 'What this changes' : 'What gets filed'}
      </div>
      <PreviewSurface>
        {kind === 'update' ? (
          <div className="flex flex-col gap-3">
            {fmChanges.length > 0 && <PropertyChanges changes={fmChanges} onOpen={onOpen} />}
            {bodyChanged && (
              <RenderedDiff before={preview.before} after={preview.after} onOpen={onOpen} />
            )}
          </div>
        ) : (
          <Markdown content={stripFrontmatter(preview.after)} onOpenNote={onOpen} />
        )}
      </PreviewSurface>
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
 *  bold stays bold, code stays code — no raw `[[ ]]`, `**`, or backticks. */
function renderInline(text: string, onOpen: (p: string) => void, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
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
  if (last < text.length) nodes.push(text.slice(last));
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
      padLeft: Math.floor((bullet[1]?.length ?? 0) / 2) * 0.85 + 0.9,
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

/** A wholly added or removed line — the change is carried by color + strikethrough. */
function DiffLine({
  row,
  onOpen,
}: {
  row: { kind: 'same' | 'add' | 'del'; text: string };
  onOpen: (p: string) => void;
}) {
  // A blank line is paragraph spacing, not content — render the gap, never an
  // empty colored bar.
  if (row.text.trim() === '') return <div className="h-2" aria-hidden />;

  const s = parseStructure(row.text);
  const tone =
    row.kind === 'add'
      ? 'bg-success/10 text-foreground'
      : row.kind === 'del'
        ? 'bg-destructive/8 text-muted-foreground line-through decoration-destructive/40'
        : 'text-foreground/70';

  return (
    <div
      className={`relative -mx-1 rounded-sm px-2 py-0.5 ${tone} ${s.structural}`}
      style={s.padLeft ? { paddingLeft: `${s.padLeft}rem` } : undefined}
    >
      {leadNode(s.lead)}
      <span className="[overflow-wrap:anywhere] whitespace-pre-wrap">
        {s.inner ? renderInline(s.inner, onOpen, row.text.slice(0, 8)) : ' '}
      </span>
    </div>
  );
}

/**
 * An edited line, shown result-first: the note as it will now read, with only
 * the newly-changed span softly highlighted. The old wording it replaced is one
 * click away ("was…") rather than doubling the text inline. A pure deletion has
 * nothing new to show, so the removed span is struck in place.
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
          {added && (
            <span className="rounded-sm bg-success/10 text-foreground">
              {renderInline(d.midAfter, onOpen, 'ma')}
            </span>
          )}
          {!added && removed && (
            <span className="rounded-sm bg-destructive/10 text-muted-foreground line-through decoration-destructive/40">
              {renderInline(d.midBefore, onOpen, 'mb')}
            </span>
          )}
          {d.suf && renderInline(d.suf, onOpen, 'suf')}
          {/* The one control that answers "what did it say before?" — it was the
              faintest thing on the card (2.8:1) in the one place the PO is
              checking the agent's work. */}
          {added && removed && (
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
      {showOld && added && removed && (
        <div className="-mx-1 px-2 py-0.5 text-muted-foreground" style={pad}>
          <span className="[overflow-wrap:anywhere] text-muted-foreground/70 line-through whitespace-pre-wrap decoration-destructive/40">
            {renderInline(d.midBefore, onOpen, 'mbo')}
          </span>
        </div>
      )}
    </div>
  );
}

function RenderedDiff({
  before,
  after,
  onOpen,
}: {
  before: string;
  after: string;
  onOpen: (p: string) => void;
}) {
  // Frontmatter never reaches the PO — diff only the readable body. Isolated
  // one-line edits collapse to a single word-level line before context-trimming.
  const rows = useMemo(
    () =>
      withContext(
        mergeReplacements(diffLines(stripFrontmatter(before), stripFrontmatter(after))),
        2,
      ),
    [before, after],
  );
  return (
    <div className="flex flex-col gap-0.5 text-dense leading-relaxed">
      {rows.map((r, i) =>
        r.kind === 'gap' ? (
          // A rule through the middle says "the page continues here" better than
          // a floating ellipsis, and the count rides on it at readable weight.
          <div key={i} className="flex items-center gap-2 py-1 select-none" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">{r.text}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : r.kind === 'replace' ? (
          <ReplaceLine key={i} before={r.before} after={r.after} onOpen={onOpen} />
        ) : (
          <DiffLine key={i} row={r} onOpen={onOpen} />
        ),
      )}
    </div>
  );
}
