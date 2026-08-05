import { useCallback, useEffect, useMemo, useRef } from 'react';
import { OPENING_STEPS, type OpeningStepId } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { Hello } from './screens/Hello';
import { You } from './screens/You';
import { Files } from './screens/Files';
import { ApiKey } from './screens/ApiKey';
import { Connections } from './screens/Connections';
import { Telemetry } from './screens/Telemetry';
import { FirstLight } from './screens/FirstLight';

/**
 * The opening (docs/onboarding.md ONB-2) — the app's first two minutes.
 *
 * A takeover, not a dialog: it owns the whole viewport, it renders before any
 * workspace exists, and Escape does not close it. Only the explicit skips move
 * anyone past a screen they didn't answer, which is the difference between a
 * flow that respects people and one that traps them.
 *
 * Every completed screen is written to settings as it happens, so quitting
 * halfway resumes exactly here (ONB-1). The frame holds no answers of its own;
 * each screen writes its own answer through the same settings channels the rest
 * of the app uses, and hands back only "done" or "skipped".
 */

/** Which screen a resume lands on: the first one still unanswered. */
function resumeAt(done: OpeningStepId[], skipped: string[]): OpeningStepId {
  const settled = new Set<string>([...done, ...skipped]);
  return OPENING_STEPS.find((s) => !settled.has(s)) ?? 'first-light';
}

export function Opening() {
  const { settings, patchOnboarding } = useApp();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const onboarding = settings?.onboarding;

  const step = useMemo<OpeningStepId>(() => {
    if (!onboarding) return 'hello';
    // The stored step wins while it is still ahead of what has been answered —
    // going back a screen is allowed, and a resume must not undo that.
    const resume = resumeAt(onboarding.done, onboarding.skipped);
    return OPENING_STEPS.includes(onboarding.step) ? onboarding.step : resume;
  }, [onboarding]);

  const index = OPENING_STEPS.indexOf(step);
  const nextStep = OPENING_STEPS[index + 1];

  const advance = useCallback(
    async (how: 'done' | 'skipped') => {
      await patchOnboarding({
        ...(how === 'done' ? { done: step } : { skipped: step }),
        ...(nextStep ? { step: nextStep } : { finished: true }),
      });
    },
    [patchOnboarding, step, nextStep],
  );

  const next = useCallback(() => void advance('done'), [advance]);
  const skip = useCallback(() => void advance('skipped'), [advance]);
  /** The last screen's doors both end the opening; the shell is behind it. */
  const finish = useCallback(() => {
    void patchOnboarding({ done: 'first-light', finished: true });
  }, [patchOnboarding]);

  /**
   * Enter advances, everywhere — one listener rather than seven, so no screen
   * can quietly forget it. It clicks the screen's own primary button, which
   * means the disabled rules each screen sets are obeyed for free. A textarea
   * (only First light has one within reach) keeps its own Enter.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLElement && (target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // A focused button is already Enter's business — let the browser do it,
      // or a skip link would fire the primary action instead of itself.
      if (target instanceof HTMLElement && (target.tagName === 'BUTTON' || target.tagName === 'A')) return;
      const primary = surfaceRef.current?.querySelector<HTMLButtonElement>('[data-opening-primary]');
      if (!primary || primary.disabled) return;
      e.preventDefault();
      primary.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Escape is deliberately swallowed. Everywhere else in this app Escape means
   * "put that away", and the one place it must not is the flow that is still
   * collecting the folder the whole product writes into.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  if (!onboarding) return null;

  return (
    <div
      ref={surfaceRef}
      className="fixed inset-0 z-100 flex flex-col overflow-y-auto bg-background text-foreground"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome"
    >
      {/* Clearance for the inset traffic lights, which sit over everything on
          macOS. The only chrome this screen has. */}
      <div className="h-9 shrink-0" />
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-16">
        {/* Keyed by step so each screen mounts fresh: its entrance runs, its
            fields start empty, and no state leaks across a boundary. */}
        <div
          key={step}
          className="w-full max-w-[34rem] animate-in duration-300 ease-out fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
        >
          {step === 'hello' && <Hello onNext={next} />}
          {step === 'you' && <You onNext={next} />}
          {step === 'files' && <Files onNext={next} />}
          {step === 'key' && <ApiKey onNext={next} onSkip={skip} />}
          {step === 'connections' && <Connections onNext={next} onSkip={skip} />}
          {step === 'telemetry' && <Telemetry onNext={next} />}
          {step === 'first-light' && <FirstLight onFinish={finish} />}
        </div>
      </div>
      {/* Quiet, and quiet on purpose: knowing there are seven is worth one
          line, and a progress bar would make a two-minute flow feel like a
          form to get through. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-xs text-muted-foreground/70 tabular-nums">
        {index + 1} of {OPENING_STEPS.length}
      </div>
    </div>
  );
}

/** Shared shell for a screen: the serif title, the one-line why, the body. */
export function Screen({
  lead,
  title,
  why,
  children,
  footer,
}: {
  /** Anything that belongs above the title — only the mark, on screen one. */
  lead?: React.ReactNode;
  title: string;
  /** The reason this is being asked, in one line, next to the ask itself. */
  why?: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        {lead}
        <h1 className="font-serif text-greeting leading-tight font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {why && <p className="text-body text-balance text-muted-foreground">{why}</p>}
      </div>
      {children}
      <div className="flex items-center gap-3">{footer}</div>
    </div>
  );
}

/**
 * The skip, everywhere it appears: a text link, never a button. A skip that
 * looks like the primary action is a skip people take by accident, and every
 * one of these reappears in First steps rather than being lost.
 */
export function SkipLink({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
    >
      {children}
    </button>
  );
}
