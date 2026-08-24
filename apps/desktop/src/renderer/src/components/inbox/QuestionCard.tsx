import { useEffect, useRef, useState } from 'react';
import { Button } from '@qale/ui';
import { Check, MessageCircleQuestion, Minus } from 'lucide-react';
import type { AskAnswerDTO, AskQuestionDTO, AskRequestDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';
import { Key } from '../Composer';
import { stripWikilinks, WikiText } from './shared';

/**
 * The agent asking the PO something mid-turn (the `ask_user` tool). Inline in
 * the session, in the same card vocabulary as the proposals — but with one
 * difference that shapes the whole component: the run is PARKED here. The turn
 * is alive, holding everything it has read, and nothing in this session
 * moves until this settles. That is why it wears the accent ring the outbound
 * card wears, and why it says so in words at the top.
 *
 * **One question at a time.** A card that shows all four at once is a form, and
 * a form is read as a chore before a single word of it is read as a question.
 * Stepping keeps each decision whole: one question, its options, one key to
 * answer it. Answered steps stay above as a trail you can click back into, so
 * what you already committed to is never out of sight.
 *
 * It is built to be answered with the keyboard in under two seconds, because
 * that is the only way an interruption stays cheap: number keys pick, ↵ moves
 * on, and focus lands on the first option of each step as it appears. The Inbox
 * already teaches `1–9 apply`; this is the same muscle.
 *
 * Two things it refuses to be:
 * - **A modal.** Skip is on every step and skipping does not stop the run: an
 *   unanswered question tells the agent to decide it for itself and say what it
 *   assumed. Skip everything and the card settles as dismissed.
 * - **A place where typing costs you your ticks.** On a multi-select question
 *   "Something else" adds to the answer rather than replacing it — "Åsa, the
 *   PAY channel, and also Henrik" is one answer, not a choice between ticking
 *   and typing.
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
  // what was typed into it.
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [writing, setWriting] = useState<Record<number, boolean>>({});
  const [written, setWritten] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const firstOption = useRef<HTMLInputElement>(null);

  // Land the focus on each step's first option as it appears: on the card
  // arriving, and on every move through it. The composer below can't carry the
  // session while the turn is parked.
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

  const answerFor = (qi: number): AskAnswerDTO => {
    const text = writing[qi] ? written[qi]?.trim() : '';
    return { selected: picked[qi] ?? [], ...(text ? { written: text } : {}) };
  };

  const isAnswered = (qi: number): boolean => {
    const a = answerFor(qi);
    return a.selected.length > 0 || !!a.written;
  };

  const question = request.questions[step]!;
  const answeredHere = isAnswered(step);
  const last = step === total - 1;

  const finish = (answers: AskAnswerDTO[]) => {
    if (busy) return;
    setBusy(true);
    // Every question skipped is a dismissal in all but name — send it as one so
    // the agent gets the clearer instruction ("decide it yourself, don't re-ask")
    // rather than a list of blanks.
    const anything = answers.some((a) => a.selected.length > 0 || a.written);
    void resolveAsk(request, anything ? answers : null);
  };

  const advance = () => {
    if (busy) return;
    if (!last) setStep((s) => s + 1);
    else finish(request.questions.map((_, i) => answerFor(i)));
  };

  const pickOption = (qi: number, label: string, multi: boolean) => {
    setPicked((prev) => {
      const current = prev[qi] ?? [];
      if (!multi) return { ...prev, [qi]: [label] };
      return {
        ...prev,
        [qi]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
      };
    });
    // On a single-choice question an option and a written answer are
    // alternatives; on a multi-select they add up, so the write row stays.
    if (!multi) setWriting((prev) => (prev[qi] ? { ...prev, [qi]: false } : prev));
  };

  const toggleWriting = (qi: number, multi: boolean) => {
    setWriting((prev) => ({ ...prev, [qi]: !prev[qi] }));
    if (!multi) setPicked((prev) => (prev[qi]?.length ? { ...prev, [qi]: [] } : prev));
  };

  return (
    <div
      ref={card}
      className="overflow-hidden rounded-xl bg-card ring-1 ring-brand/30"
      onKeyDown={(e) => {
        // ↵ moves on from anywhere in the step. Buttons handle their own Enter,
        // so leave those alone rather than firing twice.
        if (e.key !== 'Enter' || e.shiftKey) return;
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        if (!answeredHere) return;
        e.preventDefault();
        advance();
      }}
    >
      {/* Why everything stopped, said once, in the accent that means "the agent
          touched this". Same banner geometry as an outbound card: both are
          moments the session hands control back. */}
      <div className="flex items-center gap-2 border-b border-brand/20 bg-brand/6 px-3.5 py-2 text-xs">
        <MessageCircleQuestion className="size-3.5 shrink-0 text-brand" aria-hidden />
        <span className="font-medium text-foreground">Waiting on you</span>
        <span className="min-w-0 truncate text-muted-foreground">
          the session is paused until you answer
        </span>
        {total > 1 && (
          <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
            {step + 1} of {total}
          </span>
        )}
      </div>

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
          writing={!!writing[step]}
          written={written[step] ?? ''}
          onPick={(label) => pickOption(step, label, question.multiSelect)}
          onToggleWriting={() => toggleWriting(step, question.multiSelect)}
          onWrite={(value) => setWritten((prev) => ({ ...prev, [step]: value }))}
        />
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-2.5">
        <p className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block" aria-hidden>
          {/* +1: "Something else" is numbered too, so the range reaches it. */}
          <Key>1</Key>–<Key>{String(question.options.length + 1)}</Key> pick · <Key>↵</Key>{' '}
          {last ? 'answer' : 'next'}
        </p>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title={
              last
                ? 'Leave this one to the agent: it carries on and says what it assumed'
                : 'Leave this one to the agent and move to the next question'
            }
            onClick={() => {
              if (busy) return;
              // Skipping is answering with nothing: clear whatever is half-set
              // here so the step doesn't quietly carry a stale pick forward.
              setPicked((prev) => ({ ...prev, [step]: [] }));
              setWriting((prev) => ({ ...prev, [step]: false }));
              if (!last) setStep((s) => s + 1);
              else
                finish(
                  request.questions.map((_, i) => (i === step ? { selected: [] } : answerFor(i))),
                );
            }}
          >
            Skip
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
  const parts = [...answer.selected, ...(answer.written ? [answer.written] : [])].map(
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
 * line you read, then its options as rows. Native inputs do the semantics
 * (arrow keys, groups, screen readers) while the row does the looks — this app
 * has no other form-control vocabulary, and a bare radio button would read as a
 * different product.
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
  const writeRef = useRef<HTMLInputElement>(null);
  const rows = question.options.length + 1; // + "Something else"
  const labelId = `${name}-label`;

  // Opening the write row moves the caret there — picking it IS the intent to
  // type, so a second click to focus would be a wasted step.
  useEffect(() => {
    if (writing) writeRef.current?.focus();
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
        // Number keys pick, the way the Inbox's suggestions do. Ignored inside
        // the write field, where digits are just text.
        if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;
        if (!/^[1-9]$/.test(e.key)) return;
        const index = Number(e.key) - 1;
        if (index >= rows) return;
        e.preventDefault();
        if (index === question.options.length) onToggleWriting();
        else onPick(question.options[index]!.label);
      }}
    >
      <p id={labelId} className="mb-1.5 text-body leading-snug text-pretty">
        <span className="mr-1.5 rounded-md bg-muted px-1.5 py-0.5 align-[0.08em] text-xs font-medium text-muted-foreground">
          {question.header}
        </span>
        <span className="font-medium text-foreground">
          <WikiText text={question.question} onOpen={onOpen} />
        </span>
        {question.multiSelect && (
          <span className="ml-1.5 text-xs text-muted-foreground">pick any</span>
        )}
      </p>

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
            onSelect={() => onPick(opt.label)}
          />
        ))}

        {/* Always last, always available: the options are the agent's guess at
            the shape of the answer, and being wrong about that shape is normal.
            On a multi-select it adds to the ticks rather than clearing them. */}
        <OptionRow
          index={question.options.length}
          name={name}
          // Always a checkbox: it toggles a field open and shut, and on a
          // single-choice question the radios it sits with already clear it.
          multi
          checked={writing}
          disabled={disabled}
          label={
            question.multiSelect && picked.length > 0 ? 'Add something else' : 'Something else'
          }
          onSelect={onToggleWriting}
        />
        {writing && (
          <input
            ref={writeRef}
            type="text"
            value={written}
            disabled={disabled}
            placeholder="Your answer…"
            aria-label={`Your own answer to: ${stripWikilinks(question.question)}`}
            className="mt-1 ml-8 h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
      {/* An option's text is stripped of its link syntax rather than rendered as
          links: the whole row is one hit target, and a link inside it would be a
          second thing to click on the control you are trying to pick. The note
          the question is about is named in the question, which does link. */}
      <span className="min-w-0">
        <span className="block text-sm leading-snug break-words text-foreground">
          {stripWikilinks(label)}
        </span>
        {description && (
          <span className="mt-0.5 block text-xs leading-snug break-words text-muted-foreground">
            {stripWikilinks(description)}
          </span>
        )}
      </span>
    </label>
  );
}
