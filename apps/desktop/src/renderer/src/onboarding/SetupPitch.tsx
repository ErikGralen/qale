import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { CalendarClock, ChevronRight, CircleHelp, Layers, ListTodo, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { FirstSteps } from './FirstSteps';
import { setupPitch, type PitchPlan } from './setup-pitch';

/**
 * "Here's what I plan to do" (docs/easier-tickets.md E-24).
 *
 * The checklist it replaces taught our words and asked for work before it had
 * given anything. This card gives first: once the agent has seen a month of
 * meetings, from a connected calendar or from a backlog somebody dropped in, it
 * says what it found and what it has set itself up to do about it. Nothing is
 * asked. There is no next step, no primary button, and no tour.
 *
 * It sits on Home rather than in the Inbox or in a session. The Inbox is the
 * queue of things that need a decision and this needs none; a session would be
 * a conversation the PM has to start, which is the ask this card exists to
 * remove. Home is the page everybody lands on, and this is the slot day-one
 * orientation already had.
 *
 * Every line is a promise, so `setup-pitch.ts` builds them from what the
 * workspace actually holds and returns nothing when it would have to guess.
 * Until then, the checklist stands: it still holds the API key row and the
 * connect rows, which are the moves that get the agent to the point of having
 * something to say.
 */

/**
 * Whether this workspace has read the pitch, per workspace:
 * `qale.setupPitch.v1:<workspace path>` → 'seen'.
 *
 * Local, like the Home notices beside it. "I have read this" is a fact about
 * this person on this machine, not about the memory, so it never goes near the
 * workspace.
 */
const PITCH_KEY = 'qale.setupPitch.v1';

function putAwayAlready(vaultPath: string): boolean {
  try {
    return localStorage.getItem(`${PITCH_KEY}:${vaultPath}`) === 'seen';
  } catch {
    return false;
  }
}

function rememberPutAway(vaultPath: string): void {
  try {
    localStorage.setItem(`${PITCH_KEY}:${vaultPath}`, 'seen');
  } catch {
    /* ignore quota */
  }
}

/** One glyph per promise, from the vocabulary the rest of the app uses. */
const PLAN_ICON: Record<string, LucideIcon> = {
  'meeting-prep': CalendarClock,
  'commitment-check': ListTodo,
  librarian: Layers,
  arrival: CircleHelp,
};

/**
 * What the "do it differently" link puts in the composer. It opens the
 * sentence and stops: the PM finishes it in their own words, the way every
 * other starter on Home works, and a standing rule lands on the file the rule
 * is about.
 */
const CHANGE_IT = "I'd rather you ";

export function SetupPitch({ onChange }: { onChange: (text: string) => void }) {
  const { vault, tree, skills, agents, settings, openDoc, patchOnboarding } = useApp();
  const path = vault?.path ?? '';
  const [away, setAway] = useState(() => (path ? putAwayAlready(path) : false));
  useEffect(() => setAway(path ? putAwayAlready(path) : false), [path]);

  /**
   * Read once per mount rather than on a clock. The sentence is about a month,
   * so it cannot go stale while somebody reads it, and a card that rewrites
   * itself under the cursor is worse than one that is a minute old.
   */
  const mountedAt = useMemo(() => Date.now(), []);
  const pitch = useMemo(
    () => setupPitch(tree, skills, agents, mountedAt),
    [tree, skills, agents, mountedAt],
  );

  /**
   * No key, no pitch. Nothing on this card can happen without one, and a plan
   * the workspace cannot start on is the exact promise this ticket exists to
   * stop making.
   */
  const ready = !!settings?.hasApiKey;

  if (away || !ready || !pitch) return <FirstSteps />;

  /**
   * Putting the pitch away puts the checklist away with it. They are one
   * moment, and a card that returns the thing it replaced when you close it is
   * a card that cannot be closed.
   */
  const putAway = () => {
    setAway(true);
    if (path) rememberPutAway(path);
    void patchOnboarding({ dismissed: true });
  };

  const open = (plan: PitchPlan, e: MouseEvent<HTMLElement>) =>
    void openDoc(plan.path, navFromEvent(e));

  return (
    <div className="rounded-xl bg-card p-1.5 ring-1 ring-border">
      <div className="flex items-start gap-2 px-2.5 pt-1.5 pb-1">
        <div className="min-w-0 flex-1">
          <h2 className="text-dense font-semibold">Here's what I plan to do</h2>
          <p className="mt-1 text-sm text-muted-foreground">{pitch.found}</p>
        </div>
        <button
          className="-mt-0.5 -mr-1 shrink-0 rounded-md p-1 text-muted-foreground/50 transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
          onClick={putAway}
          aria-label="Put this away"
          title="Put this away"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <ul className="mt-1">
        {pitch.plans.map((plan) => {
          const Icon = PLAN_ICON[plan.id] ?? CircleHelp;
          return (
            <li key={plan.id}>
              <button
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
                onClick={(e) => open(plan, e)}
                onAuxClick={(e: MouseEvent<HTMLButtonElement>) => e.button === 1 && open(plan, e)}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 text-sm">{plan.line}</span>
                <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {/* The readable half, said once instead of a word on every row: the lines
          above are files, and telling it to work differently is a sentence, not
          a settings page. */}
      <p className="px-2.5 pt-1 pb-2 text-xs text-muted-foreground">
        I wrote each of those down for myself. Open one to read it, or{' '}
        <button
          className="rounded-sm font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => onChange(CHANGE_IT)}
        >
          tell me to do it differently
        </button>
        .
      </p>
    </div>
  );
}
