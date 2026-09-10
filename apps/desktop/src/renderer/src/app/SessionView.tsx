import { useCallback, useMemo, useState, useRef, useEffect, type ReactNode } from 'react';
import { useChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useStickToBottom } from 'use-stick-to-bottom';
import { Button, Spinner } from '@qale/ui';
import {
  AlertTriangle,
  ArrowDown,
  Square,
  Wrench,
  Brain,
  ChevronDown,
  FileText,
  History,
  MessageSquarePlus,
  Pin,
  PinOff,
  RotateCcw,
  Wand2,
} from 'lucide-react';
import type {
  ArrivalItemInputDTO,
  AskRequestDTO,
  CodebaseRequestDTO,
  NoteRefDTO,
  SessionFileDTO,
  SessionScopeDTO,
  SpawnRequestDTO,
} from '@qale/ipc';
import { readAppliedReceipt, titleFromSlug } from '@qale/domain';
import { parseKickoff, type Kickoff } from '@qale/sessions';
import { IpcChatTransport } from '../lib/ipc-transport';
import { navFromEvent, type NavOpts } from '../lib/nav';
import { draftTextShown } from '../lib/draft-text';
import { noteTypeIcon } from '../lib/note-icons';
import { fileIconFor } from '../lib/session-files';
import { isPile, progressLine, receiptLine } from '../lib/source-batch';
import { landedWrites } from '../lib/receipt-block';
import { HeaderAction, HeaderActions, PageHeader } from '../components/PageHeader';
import { InkWriting } from '../components/InkWriting';
import { Markdown } from '../components/Markdown';
import { DraftTextPanel } from '../components/DraftTextPanel';
import { SessionReview } from '../components/review/SessionReview';
import { LandedRows } from '../components/review/LandedRows';
import { SpawnCard } from '../components/review/SpawnCard';
import { CodebaseCard } from '../components/review/CodebaseCard';
import { QuestionCard } from '../components/review/QuestionCard';
import { WikiText } from '../components/review/shared';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { useChatMentions } from './ChatMentions';
import { ModelPicker } from './ModelPicker';
import { SkillPicker } from './SkillPicker';
import {
  COMPOSER_INPUT,
  COMPOSER_ROW,
  COMPOSER_SHELL,
  MentionHint,
  SendButton,
  useAutoGrow,
} from '../components/Composer';
import { Attachments } from '../components/Attachments';
import { attachedMessage } from '../lib/attachments';
import { DROP_OVER, useFileDrop } from '../lib/file-drop';
import { linkifyNotePaths, outsideCode } from '../lib/note-links';

/**
 * What the PM sent, as markdown: the paths and `[[mentions]]` in it become
 * links that open the page, which is the whole point of citing a file in a
 * message. Markdown folds single newlines, so the line breaks they typed are
 * made explicit first.
 */
function messageMarkdown(text: string): string {
  return outsideCode(text, (chunk) => linkifyNotePaths(chunk).replace(/(?<=\S)\n(?!\n)/g, '  \n'));
}

interface AnyPart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function isActivityPart(part: AnyPart): boolean {
  return part.type === 'reasoning' || part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

function isToolPart(part: AnyPart): boolean {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

function toolNameOf(part: AnyPart): string {
  return part.type.startsWith('tool-') ? part.type.slice(5) : (part.toolName ?? 'tool');
}

function toolInputOf(part: AnyPart): Record<string, unknown> {
  return typeof part.input === 'object' && part.input !== null
    ? (part.input as Record<string, unknown>)
    : {};
}

/**
 * A step the agent gave up on. The bridge turns pi's `isError` result into a
 * `tool-output-error` chunk, which useChat lands on the part as that state plus
 * an `errorText`; either one is enough to call it failed.
 */
function isFailedStep(part: AnyPart): boolean {
  return part.state === 'output-error' || part.errorText !== undefined;
}

/**
 * Past tenses that don't take the -ed → -ing rule, plus the vague fallback:
 * "Tried a step" says more than "Tried working" would.
 */
const GERUNDS: Record<string, string> = {
  Read: 'reading',
  Wrote: 'writing',
  Ran: 'running',
  Worked: 'a step',
};

/**
 * The third tense. A failed step reads "Tried reading", never "Read", so a run
 * that tried three times and gave up can't be mistaken for a run that did three
 * things. Derived from the past-tense verb rather than a third column in the
 * table below, so a new tool still only needs one entry.
 */
function triedVerb(verb: string): string {
  const [head = '', ...rest] = verb.split(' ');
  const gerund =
    GERUNDS[head] ?? (head.endsWith('ed') ? `${head.slice(0, -2)}ing` : head).toLowerCase();
  return ['Tried', gerund, ...rest].join(' ');
}

/** Past-tense verb + the thing it acted on, for one step in the expanded trail. */
function stepLabel(part: AnyPart): { verb: string; detail?: string } {
  const label = doneLabel(part);
  return isFailedStep(part) ? { ...label, verb: triedVerb(label.verb) } : label;
}

/**
 * The write that applied on its own, if this step was one, for the expanded
 * trail's own row: "Created the Nordkap write-up", "Added to rules". The block
 * above the closing line is what the PM reads; this keeps the trail from saying
 * "Proposed a note" about something already in the workspace.
 */
function appliedLabel(part: AnyPart): { verb: string; detail?: string } | null {
  if (isFailedStep(part) || typeof part.output !== 'string') return null;
  const receipt = readAppliedReceipt(part.output);
  if (!receipt) return null;
  return receipt.detail ? { verb: receipt.verb, detail: receipt.detail } : { verb: receipt.verb };
}

/** The verb table: one entry per tool, past tense, plain and sentence case. */
function doneLabel(part: AnyPart): { verb: string; detail?: string } {
  const name = toolNameOf(part);
  const input = toolInputOf(part);
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  switch (name) {
    case 'vault_read':
      // The note it read, by name. The trail is provenance the PM reads, so a
      // path here would be the one place in the app that still spells storage.
      return { verb: 'Read', detail: str('path') && titleFromSlug(str('path')!) };
    case 'vault_outline':
      return { verb: 'Skimmed', detail: str('path') && titleFromSlug(str('path')!) };
    case 'search_vault':
      return { verb: 'Searched', detail: str('query') && `“${str('query')}”` };
    case 'vault_grep':
      return { verb: 'Scanned for', detail: str('pattern') && `“${str('pattern')}”` };
    case 'vault_backlinks':
      return { verb: 'Followed links to', detail: str('path') && titleFromSlug(str('path')!) };
    case 'vault_list':
      return {
        verb: 'Listed notes',
        detail: [str('type'), str('lifecycle')].filter(Boolean).join('/') || undefined,
      };
    case 'jira_search':
      return { verb: 'Searched Jira', detail: str('jql') ?? str('query') };
    case 'jira_get_issue':
      return { verb: 'Read Jira issue', detail: str('key') ?? str('issueKey') };
    case 'confluence_search':
      return { verb: 'Searched Confluence', detail: str('query') ?? str('cql') };
    case 'confluence_get_page':
      return { verb: 'Read Confluence page', detail: str('title') ?? str('id') };
    case 'use_skill':
      return { verb: 'Loaded skill', detail: str('name') };
    case 'spawn':
      return { verb: 'Split the work up' };
    case 'ask_user': {
      const questions = Array.isArray(input.questions)
        ? (input.questions as { header?: string }[])
        : [];
      return {
        verb: 'Raised a question',
        detail:
          questions
            .map((q) => q.header)
            .filter(Boolean)
            .join(', ') || undefined,
      };
    }
    case 'get_voice':
      return { verb: 'Read a voice', detail: str('name') };
    // Only ever seen here when the call had nothing to show (still streaming,
    // or malformed) — a usable one renders as its own panel in the chat.
    case 'draft_text':
      return { verb: 'Wrote a draft', detail: str('title') };
    // Only ever visible on a session a person started, where the tool is a
    // no-op: a scheduled run that ends quietly leaves no session to open.
    case 'end_quietly':
      return { verb: 'Asked to end quietly' };
    case 'files_write':
    case 'write_result':
      return { verb: 'Wrote', detail: str('path') };
    case 'files_edit':
      return { verb: 'Edited', detail: str('path') };
    case 'files_read':
      return { verb: 'Read session file', detail: str('path') };
    case 'files_list':
      return { verb: 'Listed session files' };
    // The write tools name no system: the handler resolves the provider from
    // the container or the mirror (PD-9).
    case 'draft_ticket':
      return { verb: 'Drafted a ticket', detail: str('title') };
    case 'draft_ticket_comment':
      return { verb: 'Drafted a comment', detail: str('ticket') };
    case 'draft_page_update':
      return { verb: 'Drafted a page update', detail: str('page') };
    // Retired tool names, kept for replay: sessions filed before the write tools
    // went provider-blind still carry these calls, and the trail is what the PM
    // reads back months later.
    case 'draft_jira_issue':
      return { verb: 'Drafted a ticket', detail: str('summary') };
    case 'draft_jira_comment':
      return { verb: 'Drafted a comment', detail: str('issueKey') };
    case 'draft_confluence_update':
      return { verb: 'Drafted a page update', detail: str('pageId') };
    // Retired tool. Kept for replay only: transcripts filed before checkpoints
    // were removed still contain these calls, and an old session must not
    // render a raw tool name.
    case 'advance_checkpoint':
      return { verb: 'Moved to the next step' };
    default:
      if (name.startsWith('propose_')) {
        // Most writes land without a card now, so the step says what happened
        // rather than what was asked for.
        const landed = appliedLabel(part);
        if (landed) return landed;
        return {
          verb: `Proposed a ${name.slice(8).replace(/_/g, ' ')}`,
          detail: str('title') ?? (str('path') && titleFromSlug(str('path')!)),
        };
      }
      if (name.startsWith('draft_'))
        return {
          verb: `Drafted a ${name.slice(6).replace(/_/g, ' ')}`,
          // A message draft carries a `subject` rather than a title (SK-7), and
          // it may be revising a card it already made.
          detail: str('title') ?? str('subject') ?? str('summary'),
        };
      // A tool shipped without an entry above. Vague beats wrong: the PM should
      // never be shown a raw tool name (`draft_calendar_rsvp`), and a machine
      // name in the detail slot would be the same leak by another door.
      return { verb: 'Worked' };
  }
}

/** Present-tense label for the step currently running, shown on the collapsed row. */
function liveLabel(part: AnyPart | undefined): string {
  if (!part || part.type === 'reasoning') return 'Thinking…';
  const name = toolNameOf(part);
  const input = toolInputOf(part);
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  switch (name) {
    case 'vault_read':
      return str('path') ? `Reading ${titleFromSlug(str('path')!)}` : 'Reading the memory…';
    case 'vault_outline':
      return str('path') ? `Skimming ${titleFromSlug(str('path')!)}` : 'Skimming the memory…';
    case 'search_vault':
      return str('query') ? `Searching “${str('query')}”` : 'Searching the memory…';
    case 'vault_grep':
      return str('pattern') ? `Scanning for “${str('pattern')}”` : 'Scanning the memory…';
    case 'vault_backlinks':
      return str('path') ? `Following links to ${titleFromSlug(str('path')!)}` : 'Following links…';
    case 'vault_list':
      return 'Listing notes…';
    case 'draft_text':
      return 'Writing a draft…';
    case 'spawn':
      return 'Splitting the work up…';
    case 'ask_user':
      return 'Waiting on your answer…';
    case 'files_write':
    case 'files_edit':
    case 'write_result':
      return str('path') ? `Writing ${str('path')}` : 'Writing a session file…';
    case 'files_read':
    case 'files_list':
      return 'Reading its own notes…';
    case 'jira_search':
    case 'jira_get_issue':
      return 'Checking Jira…';
    case 'confluence_search':
    case 'confluence_get_page':
      return 'Checking Confluence…';
    default:
      if (name.startsWith('propose_') || name.startsWith('draft_')) return 'Drafting a proposal…';
      return 'Working…';
  }
}

/** Seconds as the PM would say them: `8s`, `47s`, `2m 5s`. */
function humanSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * How long the run has been going, in whole seconds, so a slow step looks slow
 * instead of looking frozen. Nothing on the parts carries a clock (an AI SDK
 * tool part is state, input, output and nothing else), so it is measured here,
 * from the moment the block went live. The reading freezes when the run
 * settles and the interval is torn down with it: nothing ticks while nothing
 * is running. A replayed transcript never went live in this mount, so it
 * reports no time rather than a made-up one.
 */
function useElapsed(live: boolean): number | null {
  const startedAt = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    // Settled: take the final reading and stop. The start stays put, so a turn
    // that dips out of the working phase to narrate and then picks up another
    // tool keeps counting the one run rather than restarting.
    if (!live) {
      if (startedAt.current !== null)
        setElapsed(Math.round((Date.now() - startedAt.current) / 1000));
      return;
    }
    const started = (startedAt.current ??= Date.now());
    const tick = () => setElapsed(Math.round((Date.now() - started) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [live]);
  return elapsed;
}

/**
 * A ticking reading off a known start time — the background banner's clock.
 * Unlike useElapsed (which measures from its own mount, all it can do for a
 * stream with no timestamps), this one gets the real start from main, so a run
 * kicked off before this tab existed still reads "working for 3m", not "3s".
 */
function useClock(since: number | undefined): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  if (!since) return null;
  const seconds = Math.round((now - since) / 1000);
  return seconds >= 1 ? humanSeconds(seconds) : null;
}

/** One tool step inside the expanded trail — raw receipt stays one click away. */
function ToolStep({ part }: { part: AnyPart }) {
  const [open, setOpen] = useState(false);
  const { verb, detail } = stepLabel(part);
  const done =
    part.state === 'output-available' || part.state === 'output-error' || part.output !== undefined;
  const hasOutput = typeof part.output === 'string' && part.output.length > 0;
  const failed = isFailedStep(part);
  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        onClick={() => hasOutput && setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!hasOutput}
      >
        {/* The glyph carries the same three states as the verb: spinning,
            done, gave up. */}
        {!done ? (
          <Spinner className="size-3 shrink-0" />
        ) : failed ? (
          <AlertTriangle className="size-3 shrink-0 text-destructive" />
        ) : (
          <Wrench className="size-3 shrink-0" />
        )}
        <span className="shrink-0 font-medium">{verb}</span>
        {detail && <span className="truncate">{detail}</span>}
        {hasOutput && (
          <ChevronDown
            className={`ml-auto size-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {part.errorText && <div className="px-1.5 pb-1 text-destructive">{part.errorText}</div>}
      {open && hasOutput && (
        <pre className="mt-0.5 mb-1 max-h-48 overflow-y-auto rounded-md bg-muted/40 px-2 py-1.5 whitespace-pre-wrap text-muted-foreground">
          {(part.output as string).slice(0, 2000)}
        </pre>
      )}
    </div>
  );
}

/**
 * The whole working phase of an assistant turn — reasoning, vault reads,
 * searches, mid-work narration — folded into one quiet row. Collapsed it reads
 * as provenance ("Reasoning · 7 sources · 4 searches"); while streaming it
 * narrates the current step; expanded it shows the chronological trail.
 */
function ActivityBlock({
  parts,
  live,
  onOpen,
}: {
  parts: AnyPart[];
  live: boolean;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const elapsed = useElapsed(live);
  const sources = new Set<string>();
  let searches = 0;
  let actions = 0;
  let failed = 0;
  for (const part of parts) {
    if (!isToolPart(part)) continue;
    const name = toolNameOf(part);
    const input = toolInputOf(part);
    if (name === 'vault_read' && typeof input.path === 'string') sources.add(input.path);
    else if (name === 'jira_get_issue' || name === 'confluence_get_page')
      sources.add(`${name}:${JSON.stringify(input)}`);
    else if (
      // An outline is orientation, not content: it hands back a heading tree, and
      // the note itself only counts as a source once a vault_read returns some of it.
      [
        'search_vault',
        'vault_grep',
        'vault_backlinks',
        'vault_list',
        'vault_outline',
        'jira_search',
        'confluence_search',
      ].includes(name)
    )
      searches++;
    else actions++;
    if (isFailedStep(part)) failed++;
  }
  // Under a second is noise, and a replayed transcript has no reading at all.
  const clock = elapsed !== null && elapsed >= 1 ? humanSeconds(elapsed) : null;
  // The clock follows the label, so the label drops its trailing ellipsis to
  // make room for it: "Working…" alone, "Working for 12s" with a clock.
  const step = liveLabel(parts[parts.length - 1]);
  const running = clock ? step.replace(/…$/, '') : step;
  const bits: string[] = [];
  // How long it took, first: it is the thing the PM was watching a second ago.
  if (!live && clock) bits.push(`worked for ${clock}`);
  if (sources.size > 0) bits.push(`${sources.size} source${sources.size === 1 ? '' : 's'}`);
  if (searches > 0) bits.push(`${searches} search${searches === 1 ? '' : 'es'}`);
  if (actions > 0) bits.push(`${actions} action${actions === 1 ? '' : 's'}`);
  return (
    <div className="my-1 text-xs">
      <button
        className="flex max-w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {live ? (
          <InkWriting small className="shrink-0 text-brand" />
        ) : (
          <Brain className="size-3.5 shrink-0" />
        )}
        <span className="truncate font-medium">{live ? running : 'Reasoning'}</span>
        {/* The running row's own clock ("Working for 12s"), so a step that is
            taking a while reads as slow rather than as stuck. */}
        {live && clock && <span className="shrink-0">for {clock}</span>}
        {!live && bits.length > 0 && <span className="shrink-0">· {bits.join(' · ')}</span>}
        {failed > 0 && <span className="shrink-0 text-destructive">· {failed} failed</span>}
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-1 ml-2 flex flex-col border-l border-border pl-3">
          {parts.map((part, i) => {
            if (part.type === 'reasoning' || part.type === 'text')
              return (
                <div
                  key={i}
                  className="px-1.5 py-1 leading-relaxed whitespace-pre-wrap text-muted-foreground"
                >
                  <WikiText text={linkifyNotePaths(part.text ?? '')} onOpen={onOpen} />
                </div>
              );
            return <ToolStep key={i} part={part} />;
          })}
        </div>
      )}
    </div>
  );
}

/**
 * A turn the app composed rather than the PM typed: a skill invoked on a page,
 * from "Go through this note", the meeting brief, or the receipt after a source
 * lands. Printing the instruction verbatim ("Run the arrival skill on
 * sources/…: read the capture, search the memory…") put a paragraph of machine
 * prose in a bubble the PM never wrote, and buried the two things they wanted:
 * WHICH skill is working, and on WHAT. So the row says exactly that — the skill
 * by its human title, the page as a link that opens it — and keeps the wording
 * one click away, for when the question is what it was actually asked to do.
 *
 * The row is a sentence, and the verb carries the state: "Running Handle new
 * sources on <the files>" while the turn is in flight, "Ran …" once it
 * settled. Sources handed over with the run (the arrival drop) show as file
 * chips exactly like vault targets show as page links — a run is never "on"
 * nothing when there was a something. The raw instruction text stops there:
 * it is machine prose composed for the model, not for the PM to read.
 */
function RunRow({
  kickoff,
  notes,
  skillTitle,
  live,
  sources = [],
  onOpen,
  onOpenFile,
}: {
  kickoff: Kickoff;
  /** Each target's tree entry, keyed by path, for the ones the workspace knows. */
  notes: Map<string, NoteRefDTO>;
  skillTitle: string;
  /** True while this kickoff's turn is the one in flight. */
  live?: boolean;
  /** Session files handed over with this run (`source/…`) — what an arrival ran on. */
  sources?: SessionFileDTO[];
  onOpen: (path: string, opts?: NavOpts) => void;
  /** Opens a source chip in the session-file reader. */
  onOpenFile?: (path: string, opts?: NavOpts) => void;
}) {
  const targets = kickoff.targets ?? [];
  const hasObjects = targets.length > 0 || sources.length > 0;
  // A run carrying handed-over sources is a drop, and a drop's instruction is
  // the sentence the PM typed beside the files. It is theirs, so it is shown.
  // Every other kickoff's instruction is machine prose composed for the model,
  // and stays off the screen.
  const said = sources.length > 0 ? kickoff.instruction.trim() : '';
  return (
    <div className="rounded-xl border border-border bg-secondary/40 px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2.5">
        <div
          className="mt-px flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand/8 text-brand"
          aria-hidden
        >
          <Wand2 className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 leading-6">
            <span className="text-muted-foreground">{live ? 'Running' : 'Ran'}</span>
            <span className="font-medium">{skillTitle}</span>
            {hasObjects && <span className="text-muted-foreground">on</span>}
            {/* Every page, each its own link. A run over three documents that
                named only the first would read as a run over only the first,
                which is the confusion this whole row exists to prevent. */}
            {targets.map((target) => {
              const note = notes.get(target);
              const TargetIcon = note ? noteTypeIcon(note.type) : FileText;
              return (
                <a
                  key={target}
                  href="#"
                  className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-brand/8 px-1.5 py-0.5 font-medium text-brand transition-colors hover:bg-brand/15 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  title={`Open ${note?.title ?? titleFromSlug(target)}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpen(target, navFromEvent(e));
                  }}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    onOpen(target, navFromEvent(e));
                  }}
                >
                  <TargetIcon className="size-3.5 shrink-0" aria-hidden />
                  {/* The page by its name. A target the tree hasn't caught up
                      with (just written, or since deleted) reads as its name
                      too, never as the path it was filed at. */}
                  <span className="truncate">{note?.title ?? titleFromSlug(target)}</span>
                </a>
              );
            })}
            {/* Handed-over sources, not memory: these chips stay neutral — the
                ink-blue wash belongs to pages in the vault, and a session file
                is deliberately not one. */}
            {sources.map((file) => {
              const FileIcon = fileIconFor(file.path);
              const name = file.path.slice(file.path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
              return (
                <button
                  key={file.path}
                  className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/75 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                  title={`Read ${name}`}
                  onClick={(e) => onOpenFile?.(file.path, navFromEvent(e))}
                  onAuxClick={(e) => {
                    if (e.button !== 1) return;
                    e.preventDefault();
                    onOpenFile?.(file.path, navFromEvent(e));
                  }}
                >
                  <FileIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{name}</span>
                </button>
              );
            })}
          </div>
          {said && <p className="mt-1 leading-6 whitespace-pre-wrap">{said}</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * Where the session stands, at the foot of the transcript.
 *
 * Everything here belongs to the session rather than to one turn: the question
 * that holds the run up, a fan-out or a codebase read waiting on a yes, what a
 * dropped pile came to, and the cards still waiting to be judged. They used to
 * draw in three different places — the question spliced above the last turn's
 * closing sentences, the fan-out and the codebase card under the whole
 * transcript, the cards moving to whichever turn was newest. So a card could
 * appear above a paragraph the PM had already read, and the same session drew
 * its two approval cards in two different spots.
 *
 * One block, always in the same place, always in the same order: what stops the
 * run, then what it came to. Nothing above it ever moves once it is on screen.
 */
function SessionFoot({
  sessionId,
  ask,
  spawn,
  codebase,
  pileReceipt,
}: {
  sessionId: string | null;
  /** The parked question, while the run waits on it. */
  ask: AskRequestDTO | null;
  spawn: SpawnRequestDTO | null;
  codebase: CodebaseRequestDTO | null;
  /** What a dropped pile came to, in one sentence (CM-2). */
  pileReceipt: string | null;
}) {
  if (!sessionId) return null;
  return (
    // `empty:hidden` so a session with nothing waiting takes no room: an empty
    // box would still draw the transcript's 16px gap under the last turn.
    <div className="flex flex-col gap-1 empty:hidden">
      {/* The three cards that hold the run. Only one is ever up at a time, and
          while one is the session cannot move, so it leads the block. */}
      {ask && <QuestionCard request={ask} />}
      {spawn && <SpawnCard request={spawn} />}
      {codebase && <CodebaseCard request={codebase} />}

      {/* What the pile came to, in one sentence (CM-2). It sums a batch the
          reply above describes piece by piece, and every number in it was
          counted from a filing that happened.

          It wears the same 20px mark column as the approval receipt under it,
          because the two are one closing moment: what was read, then what was
          approved. */}
      {pileReceipt && (
        <p className="flex items-center gap-2 px-0.5 text-sm text-muted-foreground">
          <span className="flex size-5 shrink-0 items-center justify-center">
            <FileText className="size-3.5" />
          </span>
          {pileReceipt}
        </p>
      )}

      {/* SessionReview draws the waiting cards, and stays the one place a card
          is judged. It also carries the closing beat once every card is judged,
          which is why it renders even when nothing is waiting. */}
      <SessionReview sessionId={sessionId} />
    </div>
  );
}

/** What a blank session says before the first message. */
const EMPTY_HINT =
  'Chat with an agent that can read all your notes. If it wants to change something, it sends you a proposal first.';

interface SessionViewProps {
  /**
   * The skill to invoke on the first turn (Sessions v2 Part 4). Not a mode: the
   * session is the same session either way, and a second skill can arrive after
   * this one. The entry-point buttons and Landing tiles pass it and read exactly
   * as they did — they just mean "start a session and invoke this" now.
   */
  skill?: string;
  /** Stored session to reopen — its transcript replays before the live view mounts. */
  sessionId?: string;
  /** The tab's history entry key: what a half-typed message is filed under so
   *  it survives leaving this tab and coming back (a fresh session has no
   *  sessionId to key off yet, but its tab does). */
  draftKey?: string;
  /** Fired when the main process assigns this session its id (first turn). */
  onSessionId?: (sessionId: string) => void;
  /** Shows a "New session" button in the header wired to this. */
  onNewSession?: () => void;
  initialPrompt?: string;
  /**
   * The model the composer that opened this session was set to. A session
   * started from Home or a browse page sends its first message before this view
   * has a composer to pick in, so the pick travels with the start and is in
   * force from that first turn.
   */
  initialModel?: string;
  /**
   * The page a scoped Ask was started from, as a filter (IM-13). It travels as
   * data, not as words: the session is built with the matching notes listed in
   * its system prompt. Spent on the first turn, like the opening skill.
   */
  scope?: SessionScopeDTO;
  /** Prepended to the first user message to scope the read (side session). */
  scopeHint?: string;
  /**
   * Rendered inside a surface that already states where you are (the note's
   * session corner). Drops this view's own header rather than stacking a second
   * 40px rail under the panel's.
   */
  embedded?: boolean;
}

/**
 * A half-typed message survives leaving the tab and coming back. Module-level
 * and keyed by the tab's history entry (View.key), not the session id — a
 * fresh session has no id yet, but its tab does.
 */
const drafts = new Map<string, string>();

/**
 * Loads the stored transcript (if any) before mounting the live view, so
 * reopening yesterday's session shows its history and keeps going in the
 * same pi session. If the session has a turn running in the background (kicked
 * off, tab closed, reopened), the view shows the transcript so far with a
 * working banner and refreshes itself when the run settles.
 */
export function SessionView({ sessionId, draftKey, ...props }: SessionViewProps) {
  // The id this view mounted with; later binds re-render the parent but must
  // not reset the live useChat state.
  const initialSessionId = useRef(sessionId).current;
  const [history, setHistory] = useState<UIMessage[] | null>(initialSessionId ? null : []);
  const [reloadKey, setReloadKey] = useState(0);
  const { sessions, markSessionSeen } = useApp();

  const overview = initialSessionId ? sessions.find((s) => s.id === initialSessionId) : undefined;
  const backgroundRunning = !!overview?.running;
  // True while THIS view's composer drives the stream — its useChat already
  // renders the live turn, so the settle refresh must not remount it.
  const ownStream = useRef(false);
  const wasRunning = useRef(backgroundRunning);

  // Opening the session counts as seeing it.
  useEffect(() => {
    if (initialSessionId) markSessionSeen(initialSessionId);
  }, [initialSessionId, markSessionSeen]);

  useEffect(() => {
    if (!initialSessionId) return;
    let cancelled = false;
    invoke['chats:history'](initialSessionId)
      .then((h) => {
        if (!cancelled) setHistory((h.messages as UIMessage[]) ?? []);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initialSessionId, reloadKey]);

  // A background run settled while this tab watched — replay the full transcript.
  useEffect(() => {
    if (wasRunning.current && !backgroundRunning && !ownStream.current && initialSessionId) {
      setHistory(null);
      setReloadKey((k) => k + 1);
      markSessionSeen(initialSessionId);
    }
    wasRunning.current = backgroundRunning;
  }, [backgroundRunning, initialSessionId, markSessionSeen]);

  if (history === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Opening the session…
      </div>
    );
  }
  return (
    <SessionThread
      {...props}
      key={reloadKey}
      draftKey={draftKey}
      initialSessionId={initialSessionId}
      initialMessages={history}
      backgroundStreamId={backgroundRunning ? overview?.streamId : undefined}
      onOwnStream={(busy) => {
        ownStream.current = busy;
      }}
    />
  );
}

function SessionThread({
  skill,
  initialSessionId,
  initialMessages,
  onSessionId,
  onNewSession,
  initialPrompt,
  initialModel,
  scope,
  scopeHint,
  embedded,
  backgroundStreamId,
  onOwnStream,
  draftKey,
}: Omit<SessionViewProps, 'sessionId'> & {
  initialSessionId?: string;
  initialMessages: UIMessage[];
  /** Set while a turn runs in the background (started elsewhere / before reopen). */
  backgroundStreamId?: string;
  onOwnStream?: (busy: boolean) => void;
}) {
  // A skill can arrive mid-session and start proposing (Sessions v2), so
  // "does this session type write?" is no longer a thing to know up front.
  // SessionReview renders nothing when there are no cards; let the cards decide.
  const {
    openDoc,
    openChats,
    refreshProposals,
    openSettings,
    markSessionSeen,
    sessions,
    setSessionLifecycle,
    tree,
    spawnRequests,
    codebaseRequests,
    askRequests,
    arrivalProgress,
    skills,
    sessionFiles,
    openSessionFile,
    sessionSeeds,
    takeSessionSeed,
    attachToSession,
    vault,
  } = useApp();
  const [needsKey, setNeedsKey] = useState(false);
  const onSessionIdRef = useRef(onSessionId);
  onSessionIdRef.current = onSessionId;
  const currentSessionId = useRef(initialSessionId);
  // State copy of the bound id so the header's lifecycle control re-renders.
  const [boundSessionId, setBoundSessionId] = useState(initialSessionId);
  // The skill the PM picked for the NEXT message. A ref because the transport
  // is built once and reads it at send time; the state copy drives the chip.
  const [pickedSkill, setPickedSkill] = useState<string | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const pickedSkillRef = useRef<string | null>(null);
  const pickSkill = (name: string | null) => {
    pickedSkillRef.current = name;
    setPickedSkill(name);
  };
  // The model this session runs on, once the PM has moved it off the workspace
  // default. Unlike the skill it is not spent on one turn: it belongs to the
  // session, so it rides along with every message from here on. A pick made in
  // the composer that opened the session starts it off, so the very first turn
  // runs on it too.
  const [pickedModel, setPickedModel] = useState<string | null>(initialModel ?? null);
  const pickedModelRef = useRef<string | null>(initialModel ?? null);
  const pickModel = (modelId: string) => {
    pickedModelRef.current = modelId;
    setPickedModel(modelId);
  };
  const transport = useMemo(
    () =>
      new IpcChatTransport(
        skill,
        initialSessionId,
        (id) => {
          currentSessionId.current = id;
          setBoundSessionId(id);
          onSessionIdRef.current?.(id);
        },
        () => {
          // One turn, not a mode: the pick is consumed as the message goes.
          const name = pickedSkillRef.current ?? undefined;
          pickedSkillRef.current = null;
          return name;
        },
        () => pickedModelRef.current ?? undefined,
        scope,
      ),
    [skill, initialSessionId, scope],
  );
  const { messages, sendMessage, regenerate, status, stop, error } = useChat({
    transport,
    messages: initialMessages,
  });
  const [input, setInputState] = useState(() => (draftKey ? (drafts.get(draftKey) ?? '') : ''));
  const setInput = (v: string) => {
    setInputState(v);
    if (!draftKey) return;
    if (v) drafts.set(draftKey, v);
    else drafts.delete(draftKey);
  };
  // Follow the stream only while the PO is at the bottom — scrolling up to
  // reread must not get yanked back down by the next chunk.
  //
  // This watches the transcript's SIZE, not React state, which is the whole
  // reason it is a library and not four lines here. Half of what lands in a
  // session is not a chat message: a question card, a spawn or codebase
  // approval, and the review cards all come from their own stores, and a card
  // already on screen grows after it mounts (a diff measures itself, Markdown
  // reflows). A follower keyed on `messages` sees none of that, so the card
  // that just arrived stayed below the fold.
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mentions = useChatMentions(tree, inputRef, input, setInput);
  // Titles + glyphs for the pages a run names, so a kickoff row can say
  // "Prep a meeting on Nordkap weekly" instead of restating the path.
  const noteByPath = useMemo(
    () => new Map((tree?.groups ?? []).flatMap((g) => g.notes).map((n) => [n.path, n])),
    [tree],
  );
  useAutoGrow(inputRef, input);

  const sentInitial = useRef(false);
  const firstMsg = useRef(initialMessages.length === 0);

  const busy = status === 'submitted' || status === 'streaming';
  const waitingFirstToken =
    status === 'submitted' || (busy && messages[messages.length - 1]?.role === 'user');
  // A run this view didn't start (background). Own streams handle themselves.
  const backgroundBusy = !!backgroundStreamId && !busy;
  // The turn is parked on a question card. The composer can't move the
  // session while it is: a message sent now is silently dropped, and the
  // answer belongs in the card that is holding the run.
  const askPending = !!boundSessionId && !!askRequests[boundSessionId];
  // Parked on any card that holds the run (a question, a fan-out, a codebase
  // ask). The card is the state, so the working banner stays quiet.
  const parkedOnCard =
    !!boundSessionId &&
    (!!askRequests[boundSessionId] ||
      !!spawnRequests[boundSessionId] ||
      !!codebaseRequests[boundSessionId]);
  // The stored row for this session (once it exists) — drives Mark done/Reopen.
  const overview = boundSessionId ? sessions.find((s) => s.id === boundSessionId) : undefined;

  // Sources handed over with the drop (`source/…`) — the files an arrival
  // run is ON. Only the opening kickoff wears them: they landed with it.
  const sources = useMemo(
    () =>
      boundSessionId
        ? (sessionFiles[boundSessionId] ?? []).filter((f) => f.path.startsWith('source/'))
        : [],
    [sessionFiles, boundSessionId],
  );

  // A pile of dropped files this session is reading, or has read
  // (docs/critical-mass.md CM-2). Small drops carry no batch line: counting two
  // files reads as bookkeeping, and the reply says it better.
  const batch = boundSessionId ? arrivalProgress[boundSessionId] : undefined;
  const pile = isPile(batch) ? batch : undefined;

  // The turn in flight belongs to the last user message; every kickoff before
  // it has settled by definition, so only this one may read "Running".
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === 'user') {
      lastUserIdx = i;
      break;
    }
  }

  // Voices ride the same roster as skills, told apart by the folder they sit in
  // (SkillDTO.kind). A draft panel offers them so a take the PM does not like
  // can be asked for again in another tone without typing the sentence out.
  const voices = useMemo(() => skills.filter((s) => s.kind === 'voice'), [skills]);

  // How long the background run has been at it — from main's clock, so a tab
  // opened mid-run still tells the truth.
  const backgroundClock = useClock(backgroundBusy ? overview?.startedAt : undefined);

  // Tell the wrapper when this view's own composer drives the stream, so the
  // background-settle refresh doesn't remount a live session.
  useEffect(() => {
    onOwnStream?.(busy);
  }, [busy, onOwnStream]);

  // A turn settling while the PO is right here counts as seen.
  useEffect(() => {
    if (status === 'ready' && currentSessionId.current) markSessionSeen(currentSessionId.current);
  }, [status, markSessionSeen]);

  const send = (raw: string) => {
    let text = raw;
    if (firstMsg.current && scopeHint) text = `${scopeHint}\n\n${raw}`;
    firstMsg.current = false;
    void sendMessage({ text });
  };

  // Auto-send the initial prompt once (e.g. a kickoff from a page's button).
  useEffect(() => {
    if (initialPrompt && !sentInitial.current) {
      sentInitial.current = true;
      send(initialPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  // A turn handed to this conversation from somewhere else — a card surface
  // asking the session that proposed a card to fix one that cannot be applied.
  // It waits for a run in flight rather than being dropped into it, and it is
  // claimed before sending so two open views of one session send it once.
  const seeded = boundSessionId ? sessionSeeds[boundSessionId] : undefined;
  useEffect(() => {
    if (!seeded || !boundSessionId || busy || backgroundBusy || askPending) return;
    const prompt = takeSessionSeed(boundSessionId);
    if (prompt) send(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded, boundSessionId, busy, backgroundBusy, askPending]);

  // After a settled turn, refresh the cards — any session may now have proposed.
  useEffect(() => {
    if (status === 'ready') void refreshProposals();
  }, [status, refreshProposals]);

  // Surface the missing-key state BEFORE the first send, not as a failed turn.
  useEffect(() => {
    void invoke['settings:get']()
      .then((s) => setNeedsKey(!s.hasApiKey))
      .catch(() => setNeedsKey(false));
  }, []);
  useEffect(() => {
    // A streaming turn proves the key works — clear a stale banner.
    if (status === 'streaming') setNeedsKey(false);
  }, [status]);

  /**
   * Files dropped on this session, waiting in the composer. They are attached to
   * the session when the message goes, never before: a file dropped by mistake
   * costs one X and nothing is written.
   *
   * A session with no id yet has no folder to put them in, so it claims no
   * drops and the Shell takes them to the Add source tray instead.
   */
  const [attached, setAttached] = useState<ArrivalItemInputDTO[]>([]);
  const [attaching, setAttaching] = useState(false);
  const takeFiles = useCallback(
    (items: ArrivalItemInputDTO[]) => {
      if (items.length === 0) return;
      setAttached((prev) => [...prev, ...items]);
      inputRef.current?.focus();
    },
    [inputRef],
  );
  const drop = useFileDrop(boundSessionId && !backgroundBusy && !askPending ? takeFiles : null);

  const canSend = !busy && !backgroundBusy && !askPending && !attaching;

  /**
   * Put the attached files in this session's folder, then send the message that
   * names them. Nothing else runs: the session already has a skill and the PM is
   * talking to it, so forcing "Handle new sources" over the top would answer a
   * question nobody asked. Somebody who wants the files filed picks that skill
   * in the composer, which is the control that already does it.
   */
  const sendWithFiles = async (text: string) => {
    if (!boundSessionId) return;
    const batch = attached;
    setAttaching(true);
    setInput('');
    setAttached([]);
    try {
      const result = await attachToSession(boundSessionId, batch);
      if (result.files.length === 0) {
        // Every file was refused, so there is nothing to talk about. Put them
        // back with what was typed rather than sending a message about files
        // that are not there.
        setAttached(batch);
        setInput(text);
        return;
      }
      send(attachedMessage(result.files.map((f) => f.file), text));
      setPickedSkill(null);
    } catch {
      setAttached(batch);
      setInput(text);
    } finally {
      setAttaching(false);
    }
  };

  const submit = () => {
    if (!canSend) return;
    const text = input.trim();
    // Files alone are enough to send: the message names them and says nothing
    // else, which is what dropping a file into a conversation means.
    if (attached.length > 0) {
      void sendWithFiles(text);
      return;
    }
    if (!text) return;
    setInput('');
    send(text);
    setPickedSkill(null);
  };

  return (
    <div className={`flex h-full flex-col ${drop.over ? DROP_OVER : ''}`} {...drop.handlers}>
      {!embedded && (
        // A session states its location exactly as a note does: glyph, the list
        // it belongs to, then its own name — quiet, truncating, tooltipped. The
        // title here is a whole sentence the PO typed, so it gets the smallest
        // type in the app, never the loudest. It names itself once it has a
        // name; before the first turn it is simply a new session.
        <PageHeader
          icon={History}
          crumbs={[{ label: 'Sessions', onClick: (e) => openChats(navFromEvent(e)) }]}
          label={overview?.title || 'New session'}
          labelTitle={overview?.title || undefined}
          meta={overview?.lifecycle === 'unpinned' ? 'unpinned' : undefined}
        >
          <HeaderActions>
            {overview &&
              !busy &&
              !backgroundBusy &&
              (overview.lifecycle === 'active' ? (
                <HeaderAction
                  icon={PinOff}
                  label="Unpin"
                  title="Unpin: it leaves the active list (a new message reopens it)"
                  onClick={() => void setSessionLifecycle(overview.id, 'unpinned')}
                />
              ) : (
                <HeaderAction
                  icon={Pin}
                  label="Pin"
                  title="Put this session back on the active list"
                  onClick={() => void setSessionLifecycle(overview.id, 'active')}
                />
              ))}
            {onNewSession && (
              <HeaderAction icon={MessageSquarePlus} label="New session" onClick={onNewSession} />
            )}
          </HeaderActions>
        </PageHeader>
      )}

      {/* `relative` so the catch-up button can sit over the foot of the
          transcript rather than taking a row from the composer. */}
      <div className="relative min-h-0 flex-1">
        {/* `relative` so this box is the containing block for anything absolute
            inside the transcript. Without it, an `sr-only` label in a card (it
            is `position: absolute`) hangs off the wrapper instead, escapes this
            box, and adds its distance down the transcript to the height of the
            whole view — which is where the second scrollbar came from. */}
        <div ref={scrollRef} className="relative h-full overflow-y-auto px-6">
          <div ref={contentRef} className="mx-auto flex max-w-2xl flex-col gap-4 py-4">
            {messages.length === 0 && !busy && (
              <p className="mt-16 text-center text-sm text-muted-foreground">{EMPTY_HINT}</p>
            )}
            {messages.map((message, mi) => {
              const parts = message.parts as AnyPart[];
              if (message.role === 'user') {
                const text = parts
                  .filter((p) => p.type === 'text')
                  .map((p) => p.text)
                  .join('\n');
                // A skill the PM invoked from a button reads as a run, not as
                // something they said. Anything they actually typed stays a message.
                const kickoff = parseKickoff(text);
                if (kickoff) {
                  const skillMeta = skills.find((s) => s.name === kickoff.skill);
                  return (
                    <RunRow
                      key={message.id}
                      kickoff={kickoff}
                      notes={noteByPath}
                      skillTitle={skillMeta?.title ?? kickoff.skill}
                      live={mi === lastUserIdx && (busy || backgroundBusy)}
                      // The opening kickoff of a drop ran on the handed-over
                      // files; naming them here is the row's whole point.
                      sources={mi === 0 && !kickoff.targets?.length ? sources : []}
                      onOpen={openDoc}
                      onOpenFile={(path, opts) =>
                        boundSessionId && openSessionFile(boundSessionId, path, opts)
                      }
                    />
                  );
                }
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-secondary px-3.5 py-2 text-secondary-foreground">
                      <Markdown content={messageMarkdown(text)} onOpenNote={openDoc} />
                    </div>
                  </div>
                );
              }
              // The working phase (reasoning, tool calls, mid-work narration)
              // folds into an ActivityBlock; the last text renders as the
              // answer.
              //
              // A text with a parking call after it ("let me check with you
              // first", then ask_user) is the answer too. It used to fold into
              // the trail so the card could take its place, which meant a
              // paragraph the PM was reading vanished the moment the card
              // arrived. The card draws at the foot of the transcript now, so
              // the sentence leading into it keeps its spot above it.
              let answerIdx = -1;
              for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i]!.type === 'text') {
                  answerIdx = i;
                  break;
                }
              }
              // With one exception: a fenced block mid-work is not narration, it
              // is something the PM is meant to copy and run somewhere else. The
              // interview hands over a prompt for Claude Code that way, and folded
              // into the trace it read as "you never gave me anything". Anything
              // carrying a fence comes back out and renders in place.
              const handover = (p: AnyPart, i: number) =>
                p.type === 'text' && i !== answerIdx && (p.text ?? '').includes('```');
              const isLastMessage = mi === messages.length - 1;
              // Only the trail at the very end of a turn can still be running.
              const tail = parts[parts.length - 1];
              const liveTail = busy && isLastMessage && !!tail && isActivityPart(tail);

              // The turn in the order it happened. Work piles up until something
              // the PM is meant to read interrupts it — a draft panel, a handover,
              // the answer — and that flushes the pile into one folded block. One
              // block for the whole turn lost the order, so "a panel, then a
              // paragraph, then another panel" came out as neither.
              //
              // A write that landed on its own flushes with the work that made
              // it (docs/fewer-approvals.md FA-4): the folded trail, then the
              // rows for what it wrote, then whatever interrupted it. Gathering
              // the whole turn's writes into one block at the answer put a row
              // for a write that happened later above a paragraph the PM had
              // already read.
              const nodes: ReactNode[] = [];
              let pending: AnyPart[] = [];
              let pendingFrom = 0;
              const flush = (live: boolean) => {
                if (pending.length === 0) return;
                const landed = landedWrites(pending);
                nodes.push(
                  <ActivityBlock
                    key={`activity-${pendingFrom}`}
                    parts={pending}
                    live={live}
                    onOpen={openDoc}
                  />,
                );
                if (landed.length > 0)
                  nodes.push(
                    <LandedRows
                      key={`landed-${pendingFrom}`}
                      rows={landed}
                      sessionId={boundSessionId ?? null}
                      onOpen={openDoc}
                    />,
                  );
                pending = [];
              };
              parts.forEach((part, i) => {
                // A call still running, refused, or with no usable variants reads
                // as null and folds into the trail like any other step.
                const draft =
                  isToolPart(part) && toolNameOf(part) === 'draft_text'
                    ? draftTextShown(part)
                    : null;
                if (draft) {
                  flush(false);
                  nodes.push(
                    <DraftTextPanel
                      key={`draft-${i}`}
                      draft={draft}
                      voices={voices}
                      onUse={send}
                      onOpenNote={openDoc}
                      disabled={busy || backgroundBusy || askPending}
                      workspace={vault?.path ?? null}
                      panelId={`${message.id}-${i}`}
                    />,
                  );
                  return;
                }
                if (part.type === 'text' && (i === answerIdx || handover(part, i))) {
                  flush(false);
                  nodes.push(
                    <Markdown
                      key={`text-${i}`}
                      content={outsideCode(part.text ?? '', linkifyNotePaths)}
                      onOpenNote={openDoc}
                    />,
                  );
                  return;
                }
                if (isActivityPart(part) || part.type === 'text') {
                  if (pending.length === 0) pendingFrom = i;
                  pending.push(part);
                }
              });
              flush(liveTail);
              return (
                <div key={message.id} className="w-full">
                  {nodes}
                </div>
              );
            })}
            {waitingFirstToken && (
              <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <InkWriting className="shrink-0 text-brand" /> Reading the memory…
              </div>
            )}
            {/* A turn running somewhere this view can't see into. The kickoff
              row above already names the work, so this row only says that it
              is alive, for how long, and how to stop it. While the run is
              parked on a card, that card is the state and this stays quiet. */}
            {backgroundBusy && !parkedOnCard && (
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5">
                <InkWriting className="shrink-0 text-brand" />
                {/* A pile counts down here instead of saying it is busy: the
                    files land one at a time over several minutes, and this is
                    the line the PM is watching (CM-2). */}
                <p className="min-w-0 flex-1 truncate text-sm font-medium">
                  {pile && !pile.done ? progressLine(pile) : 'Still working'}
                  {backgroundClock && (
                    <span className="font-normal text-muted-foreground"> · {backgroundClock}</span>
                  )}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() =>
                    backgroundStreamId && void invoke['agent:abort'](backgroundStreamId)
                  }
                >
                  <Square className="size-3" /> Stop
                </Button>
              </div>
            )}
            {/* The provider's refusal, said in one sentence with what to do about
              it (api-errors.ts), not wrapped in a second sentence of ours. Most
              of these clear on their own (overloaded, rate limited), so the one
              thing the PM needs is the same turn again without retyping it —
              and a kickoff they never typed at all can only be retried here. */}
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                {error.message}
                <span className="block text-destructive/80">Nothing was lost.</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={busy || backgroundBusy}
                  onClick={() => void regenerate()}
                >
                  <RotateCcw className="size-3" /> Try again
                </Button>
              </div>
            )}

            {/* Where the session stands, always at the foot: the card that
              holds the run, what a pile came to, and the cards waiting for a
              yes. One place, one order, whatever the turns above did. */}
            <SessionFoot
              sessionId={boundSessionId ?? null}
              ask={(boundSessionId && askRequests[boundSessionId]) || null}
              spawn={(boundSessionId && spawnRequests[boundSessionId]) || null}
              codebase={(boundSessionId && codebaseRequests[boundSessionId]) || null}
              pileReceipt={pile?.done ? receiptLine(pile) : null}
            />
          </div>
        </div>

        {/* Scrolled up while a turn runs, the PO loses the thread of it. The
            button says so and puts them back, and it is only ever there when
            there is something below to go back to. */}
        {!isAtBottom && messages.length > 0 && (
          <button
            onClick={() => void scrollToBottom()}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-background/95 py-1.5 pr-3 pl-2.5 text-xs font-medium text-muted-foreground shadow-md backdrop-blur transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            {busy || backgroundBusy ? 'Follow along' : 'Latest'}
          </button>
        )}
      </div>

      {needsKey && (
        <div className="mx-6 mb-2">
          <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span>No API key yet, so sessions can’t answer until one is set.</span>
            <button
              className="ml-auto shrink-0 font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => openSettings('agent')}
            >
              Open Settings
            </button>
          </div>
        </div>
      )}

      <div className="px-6 pb-5">
        <div className={COMPOSER_SHELL}>
          {mentions.menu}
          <Attachments
            items={attached}
            onRemove={(i) => {
              setAttached((prev) => prev.filter((_, n) => n !== i));
              inputRef.current?.focus();
            }}
          />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              mentions.refresh();
            }}
            onKeyDown={(e) => {
              if (mentions.onKeyDown(e)) return;
              // `/` on an empty composer opens the skill menu — the same
              // keyboard vocabulary as `@` for notes and `#` for contexts.
              if (e.key === '/' && input.length === 0) {
                e.preventDefault();
                setSkillMenuOpen(true);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onClick={mentions.refresh}
            onBlur={mentions.close}
            placeholder={
              askPending
                ? 'Answer the question above to carry on…'
                : backgroundBusy
                  ? 'Waiting for the running turn to finish…'
                  : attached.length > 0
                    ? 'Anything I should know about these? (optional)'
                    : pickedSkill
                      ? `What should “${skills.find((s) => s.name === pickedSkill)?.title ?? pickedSkill}” work on?`
                      : 'Ask your product memory…'
            }
            rows={1}
            disabled={backgroundBusy || askPending}
            className={COMPOSER_INPUT}
          />
          <div className={COMPOSER_ROW}>
            <SkillPicker
              picked={pickedSkill}
              onPick={pickSkill}
              onClosed={() => inputRef.current?.focus()}
              open={skillMenuOpen}
              onOpenChange={setSkillMenuOpen}
              disabled={backgroundBusy || askPending}
            />
            {/* The stored pin wins on reopen; a pick made in this mount wins
                over that, because it hasn't been sent yet. */}
            <ModelPicker
              pinned={pickedModel ?? overview?.modelId ?? null}
              onPick={pickModel}
              onClosed={() => inputRef.current?.focus()}
              disabled={backgroundBusy || askPending}
            />
            <MentionHint
              show={!input.trim() && !backgroundBusy && !askPending && attached.length === 0}
            />
            {busy ? (
              <Button
                size="icon-sm"
                variant="outline"
                className="ml-auto"
                onClick={() => stop()}
                aria-label="Stop"
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <SendButton
                ready={(!!input.trim() || attached.length > 0) && canSend}
                onClick={submit}
                label="Send"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
