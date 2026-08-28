import { useEffect, useRef, useState } from 'react';
import { Button } from '@qale/ui';
import { ChevronDown, Code2, X } from 'lucide-react';
import type { CodebaseRequestDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';

/** Longer than this and the question folds away, so the card stays a card. */
const QUESTION_FOLD = 220;

/**
 * The codebase approval card (docs/claude-code-tickets.md CC-7): the one
 * moment the PM steers before Claude Code spends minutes reading their repo.
 * Inline in the session, same vocabulary as the fan-out card, never a modal.
 *
 * Three things it shows on purpose:
 * - **The question, in full.** It is what actually gets asked, and a badly
 *   aimed question is the whole cost. Folded when it is long, one click away.
 * - **The repo.** The answer only counts for the code it was read from.
 * - **The model, and why.** A picker on a new session, because "run it again on
 *   the strong one" should be one dropdown and a second yes. A resumed session
 *   keeps the model it started with, so there is nothing to pick: switching
 *   means the session asks again and this card comes back with the picker.
 */
export function CodebaseCard({ request }: { request: CodebaseRequestDTO }) {
  const { resolveCodebase } = useApp();
  const [modelId, setModelId] = useState(request.suggestedModelId);
  const [questionOpen, setQuestionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const runRef = useRef<HTMLButtonElement>(null);

  // Enter runs it. The approve button takes focus rather than a global key: the
  // composer is right below, and a stray Enter there must never spend anything.
  useEffect(() => {
    runRef.current?.focus();
  }, []);

  const answer = (approved: boolean) => {
    if (busy) return;
    setBusy(true);
    void resolveCodebase(
      request,
      // A resume keeps its session's model, so there is no pick to send.
      approved ? { approved: true, ...(request.resume ? {} : { modelId }) } : { approved: false },
    );
  };

  const long = request.question.length > QUESTION_FOLD;
  const shown =
    long && !questionOpen
      ? `${request.question.slice(0, QUESTION_FOLD).trimEnd()}…`
      : request.question;
  const fixedLabel =
    request.models.find((m) => m.id === request.suggestedModelId)?.label ??
    request.suggestedModelId;

  return (
    <div className="overflow-hidden rounded-xl bg-card p-3.5 ring-1 ring-brand/30">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Code2 className="size-4 text-muted-foreground" aria-hidden />
        Ask the codebase
      </div>

      <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{shown}</p>
      {long && (
        <button
          className="mt-1 flex items-center gap-1 rounded-md py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => setQuestionOpen((o) => !o)}
          aria-expanded={questionOpen}
        >
          <ChevronDown
            className={`size-3 transition-transform motion-reduce:transition-none ${questionOpen ? 'rotate-180' : '-rotate-90'}`}
          />
          {questionOpen ? 'Show less' : 'Show the whole question'}
        </button>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        In <span className="font-medium text-foreground">{request.repo}</span>
        {request.resume && ', carrying on from the last answer'}
      </p>

      <div className="mt-3 flex items-center gap-2">
        {request.resume ? (
          // No picker: this session already runs on a model and keeps it.
          <span className="text-xs text-muted-foreground">
            model <span className="font-medium text-foreground">{fixedLabel}</span>, kept from the
            first question
          </span>
        ) : (
          <>
            <label
              className="text-xs text-muted-foreground"
              htmlFor={`codebase-model-${request.id}`}
            >
              model
            </label>
            <select
              id={`codebase-model-${request.id}`}
              className="h-8 min-w-0 max-w-56 flex-1 truncate rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={busy}
            >
              {request.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => answer(false)} disabled={busy}>
            <X className="size-3.5" /> Discard
          </Button>
          <Button ref={runRef} size="sm" onClick={() => answer(true)} disabled={busy}>
            <Code2 className="size-3.5" /> Approve & run
          </Button>
        </span>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{request.why}</p>
    </div>
  );
}
