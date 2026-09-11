import { useEffect, useRef, useState } from 'react';
import { Button } from '@qale/ui';
import { Check, Minus } from 'lucide-react';
import type { AskAnswerDTO, AskQuestionDTO, AskRequestDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';
import { Key, useAutoGrow } from '../Composer';
import { Markdown } from '../Markdown';
import { stripWikilinks } from './shared';
import { linkifyNotePaths, outsideCode } from '../../lib/note-links';

/**
 * The agent asking the PO something mid-turn (the `ask_user` tool). Inline in
 * the session, in the same card vocabulary as the proposals — but with one
 * difference that shapes the whole component: the run is PARKED here. The turn
 * is alive, holding everything it has read, and nothing in this session
 * moves until this settles. That is why it wears the accent ring the outbound
 * card wears — the ring alone says "stopped here", so nothing repeats it in
 * words.
 *
 * **One question at a time.** A card that shows all of them at once is a form,
 * and a form is read as a chore before a single word of it is read as a
 * question. Stepping keeps each decision whole: one question, its case, its
 * options, one key to answer it. Answered steps stay above as a trail you can
 * click back into, so what you already committed to is never out of sight.
 *
 * It is built to be answered with the keyboard in under two seconds, because
 * that is the only way an interruption stays cheap: number keys pick, ↵ moves
 * on, and focus lands on the first option of each step as it appears. The card
 * rows already teach `1–9 apply`; this is the same muscle.
 *
 * A step can also be a paragraph to react to rather than a choice to make
 * (docs/iterate-in-chat.md). A question may carry a `body`: the case for an
 * idea, a few paragraphs, rendered under the question line. And a question may
 * carry no options at all: then the box is open from the start and the answer
 * is what gets written in it. ↵ is a new line in the box and ⌘↵ moves on, the
 * way the composer sends.
 *
 * Two things it refuses to be:
 * - **A modal.** Skip is on every step and skipping does not stop the run: an
 *   unanswered question tells the agent to decide it for itself and say what it
 *   assumed. Skip everything and the card settles as dismissed.
 * - **A place where typing costs you your ticks.** "Something else" adds to
 *   the answer rather than replacing it, on every kind of question — "Keep,
 *   but smaller" is one answer, not a choice between picking and typing.
 *
 * One question can arrive with its rows already ticked
 * (docs/first-look-debrief.md). That turns the step from a choice into a batch
 * to review, the same posture the follow picker takes on the connections
 * screen, and it changes two things here: the boxes start ticked, and clearing
 * every one of them is an answer ("none of these") rather than a skip.
 */
export function QuestionCard({ request }: { request: AskRequestDTO }) {
  const { resolveAsk, openDoc } = useApp();
  // A question is usually ABOUT a note, and answering it well means reading that
  // note first. So every wikilink in the card opens it, exactly as it would in
  // the chat above. The run stays parked while the PM goes and looks.
  const open = (path: string) => void openDoc(path);
  const total = request.questions.length;
  const [step, setStep] = useState(0);
  // Per question: the option labels ticked, whether the write row is open, and
  // what was typed into it. A question whose rows arrive ticked starts with
  // those rows in here, so the first render already shows what will happen.
  const [picked, setPicked] = useState<Record<number, string[]>>(() => preticked(request));
  const [writing, setWriting] = useState<Record<number, boolean>>({});
  const [written, setWritten] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const firstOption = useRef<HTMLInputElement>(null);

  // Land the focus on each step's first option as it appears: on the card
  // arriving, and on every move through it. The composer below can't carry the
  // session while the turn is parked. A written step has no option, and its
  // box takes the focus itself (see QuestionStep).
  //
  // The focus never scrolls anything itself. An option's real input is
  // `sr-only`, which is absolutely positioned, so the browser reveals it by
  // scrolling every ancestor that can scroll. The app shell is `h-screen
  // overflow-hidden`: it scrolls under that rule and then has no scrollbar to
  // scroll back, so a card sitting below the fold took the tab strip and the
  // page header off the screen for good. The card scrolls itself into view
  // instead, inside the transcript, where scrolling belongs.
  useEffect(() => {
    firstOption.current?.focus({ preventScroll: true });
    card.current?.scrollIntoView({ block: 'nearest' });
  }, [request.id, step]);

  // A second card in the same session replaces the first in place, so start it
  // clean and with its own ticks rather than on the answers to a question that
  // is no longer on screen.
  const drawn = useRef(request.id);
  useEffect(() => {
    if (drawn.current === request.id) return;
    drawn.current = request.id;
    setStep(0);
    setPicked(preticked(request));
    setWriting({});
    setWritten({});
  }, [request]);

  const boxOpen = (qi: number): boolean => isWritten(request.questions[qi]!) || !!writing[qi];

  const answerFor = (qi: number): AskAnswerDTO => {
    const text = boxOpen(qi) ? written[qi]?.trim() : '';
    return { selected: picked[qi] ?? [], ...(text ? { written: text } : {}) };
  };

  const isAnswered = (qi: number): boolean => {
    const a = answerFor(qi);
    if (a.selected.length > 0 || !!a.written) return true;
    // Clearing every box on a batch is a decision, so the confirm stays live.
    // Forcing "none of these" out through Skip would tell the agent to decide
    // for itself, which is the opposite of what they just did.
    return isBatch(request.questions[qi]!);
  };

  const question = request.questions[step]!;
  const answeredHere = isAnswered(step);
  const last = step === total - 1;

  const finish = (answers: AskAnswerDTO[]) => {
    if (busy) return;
    setBusy(true);
    // Every question skipped is a dismissal in all but name — send it as one so
    // the agent gets the clearer instruction ("decide it yourself, don't re-ask")
    // rather than a list of blanks. A card carrying a batch never dismisses that
    // way: an empty answer there says "do none of this", and that has to reach
    // the agent as an answer.
    const anything =
      answers.some((a) => a.selected.length > 0 || a.written) || request.questions.some(isBatch);
    void resolveAsk(request, anything ? answers : null);
  };

  const advance = () => {
    if (busy) return;
    if (!last) setStep((s) => s + 1);
    else finish(request.questions.map((_, i) => answerFor(i)));
  };

  // Picking and writing are independent on every kind of question: a pick
  // never shuts the box, and opening the box never clears a pick.
  const pickOption = (qi: number, label: string, multi: boolean) => {
    setPicked((prev) => {
      const current = prev[qi] ?? [];
      if (!multi) return { ...prev, [qi]: [label] };
      return {
        ...prev,
        [qi]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
      };
    });
  };

  const toggleWriting = (qi: number) => {
    setWriting((prev) => ({ ...prev, [qi]: !prev[qi] }));
  };

  return (
    <div
      ref={card}
      className="overflow-hidden rounded-xl bg-card ring-1 ring-brand/30"
      onKeyDown={(e) => {
        // ↵ moves on from anywhere in the step. Buttons handle their own Enter,
        // so leave those alone rather than firing twice. In the box ↵ is a new
        // line, and ⌘↵ is the move: these are paragraphs, not a form field.
        if (e.key !== 'Enter' || e.shiftKey) return;
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'BUTTON') return;
        if (tag === 'TEXTAREA' && !(e.metaKey || e.ctrlKey)) return;
        if (!answeredHere) return;
        e.preventDefault();
        advance();
      }}
    >
      <div className="px-3.5 py-3">
        {/* What you already said, still in view and still editable: a stepper
            that hides your earlier answers asks you to hold them in your head. */}
        {step > 0 && (
          <ul className="mb-3 flex flex-col gap-px border-b border-border pb-3">
            {request.questions.slice(0, step).map((q, qi) => (
              <TrailRow
                key={qi}
                question={q}
                answer={answerFor(qi)}
                disabled={busy}
                onRevisit={() => setStep(qi)}
              />
            ))}
          </ul>
        )}

        <QuestionStep
          key={step}
          question={question}
          onOpen={open}
          name={`ask-${request.id}-${step}`}
          firstRef={firstOption}
          disabled={busy}
          picked={picked[step] ?? []}
          writing={boxOpen(step)}
          written={written[step] ?? ''}
          onPick={(label) => pickOption(step, label, question.multiSelect)}
          onToggleWriting={() => toggleWriting(step)}
          onWrite={(value) => setWritten((prev) => ({ ...prev, [step]: value }))}
        />
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-2.5">
        {total > 1 && (
          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
            {step + 1} of {total}
          </span>
        )}
        <p className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block" aria-hidden>
          {isWritten(question) ? (
            <>
              <Key>⌘↵</Key> {last ? 'answer' : 'next'}
            </>
          ) : (
            <>
              {/* +1: "Something else" is numbered too, so the range reaches it. */}
              <Key>1</Key>–<Key>{String(question.options.length + 1)}</Key> pick · <Key>↵</Key>{' '}
              {last ? 'answer' : 'next'}
            </>
          )}
        </p>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {step > 0 && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title={
              // On a batch, clearing the boxes IS the answer, so Skip means
              // "none of these" rather than "you decide".
              isBatch(question)
                ? 'None of these: it does none of this and carries on'
                : last
                  ? 'Leave this one to the agent: it carries on and says what it assumed'
                  : 'Leave this one to the agent and move to the next question'
            }
            onClick={() => {
              if (busy) return;
              // Skipping is answering with nothing: clear whatever is half-set
              // here so the step doesn't quietly carry a stale pick forward.
              setPicked((prev) => ({ ...prev, [step]: [] }));
              setWriting((prev) => ({ ...prev, [step]: false }));
              setWritten((prev) => ({ ...prev, [step]: '' }));
              if (!last) setStep((s) => s + 1);
              else
                finish(
                  request.questions.map((_, i) => (i === step ? { selected: [] } : answerFor(i))),
                );
            }}
          >
            {isBatch(question) ? 'None of these' : 'Skip'}
          </Button>
          {/* An inactive control never wears the accent (DESIGN §6): the accent
              arrives the moment the step is answered, and that arrival is the
              only colour event in the component. */}
          <Button
            size="sm"
            variant={answeredHere ? 'default' : 'secondary'}
            disabled={busy || !answeredHere}
            onClick={advance}
          >
            {last ? 'Answer' : 'Next'}
          </Button>
        </span>
      </div>
    </div>
  );
}

/**
 * Is this question a batch to review rather than a choice to make? One ticked
 * row is enough: the agent is saying "here is what I would do", and the whole
 * step reads differently from that point on.
 */
function isBatch(question: AskQuestionDTO): boolean {
  return question.options.some((o) => o.checked);
}

/** A question with no rows: the answer is what gets written. */
function isWritten(question: AskQuestionDTO): boolean {
  return question.options.length === 0;
}

/** What each question starts with ticked, by question index. */
function preticked(request: AskRequestDTO): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  request.questions.forEach((q, qi) => {
    const on = q.options.filter((o) => o.checked).map((o) => o.label);
    if (on.length > 0) out[qi] = on;
  });
  return out;
}

/** The first line of what was written: a trail row is one line, and a
 *  paragraph folded into it would be unreadable anyway. */
function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((l) => l.trim())
      ?.trim() ?? ''
  );
}

/**
 * One answered (or skipped) question, above the one being asked. Clicking it
 * steps back to that question with its answer intact — cheaper than a Back
 * button, and it doubles as the record of what you have committed to.
 */
function TrailRow({
  question,
  answer,
  disabled,
  onRevisit,
}: {
  question: AskQuestionDTO;
  answer: AskAnswerDTO;
  disabled: boolean;
  onRevisit: () => void;
}) {
  const parts = [...answer.selected, ...(answer.written ? [firstLine(answer.written)] : [])].map(
    stripWikilinks,
  );
  // A check on a skipped question would read as "done"; a dash says "passed on
  // it", which is what actually happened.
  const Glyph = parts.length ? Check : Minus;
  return (
    <li>
      <button
        className="flex w-full items-baseline gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:hover:bg-transparent"
        onClick={onRevisit}
        disabled={disabled}
        title={`${stripWikilinks(question.question)}: click to change your answer`}
      >
        <Glyph
          className={`size-3 shrink-0 self-center ${parts.length ? 'text-brand' : 'text-muted-foreground/50'}`}
          aria-hidden
        />
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {question.header}
        </span>
        <span
          className={`min-w-0 flex-1 truncate text-sm ${parts.length ? 'text-foreground/80' : 'text-muted-foreground italic'}`}
        >
          {parts.length ? parts.join(', ') : 'skipped'}
        </span>
      </button>
    </li>
  );
}

/**
 * The question being asked: the header as a quiet chip, the question as the
 * line you read, the body under it when there is one, then its options as
 * rows and the box. Native inputs do the semantics (arrow keys, groups, screen
 * readers) while the row does the looks — this app has no other form-control
 * vocabulary, and a bare radio button would read as a different product.
 */
function QuestionStep({
  question,
  onOpen,
  name,
  firstRef,
  disabled,
  picked,
  writing,
  written,
  onPick,
  onToggleWriting,
  onWrite,
}: {
  question: AskQuestionDTO;
  onOpen: (path: string) => void;
  name: string;
  firstRef: React.RefObject<HTMLInputElement | null>;
  disabled: boolean;
  picked: string[];
  writing: boolean;
  written: string;
  onPick: (label: string) => void;
  onToggleWriting: () => void;
  onWrite: (value: string) => void;
}) {
  const writeRef = useRef<HTMLTextAreaElement>(null);
  const rows = question.options.length + 1; // + "Something else"
  const labelId = `${name}-label`;
  const writtenOnly = isWritten(question);
  useAutoGrow(writeRef, written, 240);

  // Opening the box moves the caret there — picking it IS the intent to type,
  // so a second click to focus would be a wasted step. On a written step the
  // box is open from the start, so the step lands in it.
  useEffect(() => {
    if (writing) writeRef.current?.focus({ preventScroll: true });
  }, [writing]);

  return (
    // A labelled group rather than fieldset/legend: a <legend> renders *over*
    // its fieldset's top border, which swallows any seam drawn above it. The
    // shared input `name` is what actually groups the radios.
    <div
      role="group"
      aria-labelledby={labelId}
      className="min-w-0"
      onKeyDown={(e) => {
        // Number keys pick, the way the card rows do. Ignored inside
        // the box, where digits are just text.
        if (e.target instanceof HTMLTextAreaElement) return;
        if (writtenOnly || !/^[1-9]$/.test(e.key)) return;
        const index = Number(e.key) - 1;
        if (index >= rows) return;
        e.preventDefault();
        if (index === question.options.length) onToggleWriting();
        else onPick(question.options[index]!.label);
      }}
    >
      <p id={labelId} className="mb-1.5 text-body leading-snug text-pretty">
        <span className="mr-1.5 rounded-md bg-muted px-1.5 py-0.5 align-[0.08em] text-xs font-medium text-muted-foreground">
          <Markdown inline content={linkifyNotePaths(question.header)} onOpenNote={onOpen} />
        </span>
        {/* The same renderer the body uses, so one wikilink cannot read two
            ways in one card: the chip says the note's name, and a ticket key
            is the live chip with its state on it. */}
        <span className="font-medium text-foreground">
          <Markdown inline content={linkifyNotePaths(question.question)} onOpenNote={onOpen} />
        </span>
        {question.multiSelect && (
          <span className="ml-1.5 text-xs text-muted-foreground">
            {isBatch(question) ? 'untick anything you do not want' : 'pick any'}
          </span>
        )}
      </p>

      {/* The case for it, when the question makes one: an idea in a round is
          argued here, cost and all, so the PM reads it where they answer it
          rather than scrolling up to find it. Bounded above, so the step is a
          few paragraphs at most and never a document. */}
      {question.body && (
        <div className="mb-3 max-w-[64ch]">
          <Markdown
            content={outsideCode(question.body, linkifyNotePaths)}
            onOpenNote={(p) => onOpen(p)}
          />
        </div>
      )}

      <div className="flex flex-col gap-px">
        {question.options.map((opt, oi) => (
          <OptionRow
            key={oi}
            index={oi}
            name={name}
            multi={question.multiSelect}
            checked={picked.includes(opt.label)}
            disabled={disabled}
            inputRef={oi === 0 ? firstRef : undefined}
            label={opt.label}
            description={opt.description}
            onOpen={onOpen}
            onSelect={() => onPick(opt.label)}
          />
        ))}

        {/* Always last, always available: the options are the agent's guess at
            the shape of the answer, and being wrong about that shape is normal.
            It adds to the ticks rather than clearing them. A written step has
            no rows, so the box stands on its own. */}
        {!writtenOnly && (
          <OptionRow
            index={question.options.length}
            name={name}
            // Always a checkbox: it toggles a field open and shut, and it never
            // competes with the radios it sits under.
            multi
            checked={writing}
            disabled={disabled}
            label={picked.length > 0 ? 'Add a comment' : 'Something else'}
            onOpen={onOpen}
            onSelect={onToggleWriting}
          />
        )}
        {writing && (
          <textarea
            ref={writeRef}
            value={written}
            disabled={disabled}
            rows={writtenOnly ? 3 : 1}
            placeholder={writtenOnly ? 'Write your answer…' : 'Your answer…'}
            aria-label={`Your own answer to: ${stripWikilinks(question.question)}`}
            className={`mt-1 w-full resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
              writtenOnly ? '' : 'ml-8 w-[calc(100%-2rem)]'
            }`}
            onChange={(e) => onWrite(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One choice. The leading badge carries the keyboard number at rest and becomes
 * an ink-blue check when picked, so selection reads by shape as well as by
 * colour — the whole row is the hit target and the label is the accessible name.
 */
function OptionRow({
  index,
  name,
  multi,
  checked,
  disabled,
  inputRef,
  label,
  description,
  onOpen,
  onSelect,
}: {
  index: number;
  name: string;
  multi: boolean;
  checked: boolean;
  disabled: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  label: string;
  description?: string;
  onOpen: (path: string) => void;
  onSelect: () => void;
}) {
  return (
    // `relative` does work here. The input below is `sr-only`, so it is
    // absolutely positioned and lands in the nearest positioned ancestor.
    // Without a positioned row that ancestor is the app shell, and the input
    // then sits outside the transcript that is supposed to clip it.
    <label
      className={`relative flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 ${
        checked ? 'bg-brand/8' : 'hover:bg-accent'
      } ${disabled ? 'cursor-default opacity-60' : ''}`}
    >
      <input
        ref={inputRef}
        type={multi ? 'checkbox' : 'radio'}
        name={name}
        checked={checked}
        disabled={disabled}
        className="sr-only"
        onChange={onSelect}
      />
      <span
        className={`mt-px flex size-4 shrink-0 items-center justify-center rounded border text-xs leading-none font-semibold tabular-nums transition-colors ${
          checked
            ? 'border-brand/40 bg-brand/15 text-brand'
            : 'border-border bg-card text-muted-foreground'
        }`}
        aria-hidden
      >
        {checked ? <Check className="size-3" strokeWidth={3} /> : index + 1}
      </span>
      {/* An option names notes and tickets as often as the question does, so it
          reads them the same way: the body's renderer, the note's name in the
          chip. The row stays the hit target — a chip is interactive content,
          which the browser never counts as a click on the label. */}
      <span className="min-w-0">
        <span className="block text-sm leading-snug break-words text-foreground">
          <Markdown inline content={linkifyNotePaths(label)} onOpenNote={onOpen} />
        </span>
        {description && (
          <span className="mt-0.5 block text-xs leading-snug break-words text-muted-foreground">
            <Markdown inline content={linkifyNotePaths(description)} onOpenNote={onOpen} />
          </span>
        )}
      </span>
    </label>
  );
}
