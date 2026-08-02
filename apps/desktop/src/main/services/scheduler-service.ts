import type { UseCaseContext } from '@pm/application';
import { buildKickoff } from '@pm/sessions';
import { MAINTENANCE_TICK_MS } from '../agents.js';
import type { SettingsService } from './settings-service.js';

/**
 * The app-open scheduler (PLAN-V2 §3.5): fires scheduled sessions on their weekly
 * slot while the app runs, catching up missed slots on launch, and drives the two
 * per-tick sweeps (maintenance, before-meeting prep). Nothing here applies a card:
 * every proposal still goes through the Inbox. A desktop scheduler only runs while
 * the app is open — catch-up-on-launch is the honest v1 (no "overnight" promise).
 */
export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly getContext: () => UseCaseContext | null,
    private readonly settings: SettingsService,
    private readonly fireSession: (
      skill: string,
      prompt: string,
      opts?: { scheduled?: boolean },
    ) => Promise<void>,
    private readonly onChanged: () => void,
    /** Maintenance pass (connector sync, then the librarian sweep) — runs each
     *  tick, errors swallowed. */
    private readonly maintenance?: () => void,
    /** Before-meeting auto-prep (the `meeting-prep` agent): synced meetings
     *  starting within its lead window get their brief prepared on the meeting
     *  page. Runs each tick, errors swallowed. */
    private readonly beforeMeetingSweep?: () => Promise<void> | void,
  ) {}

  start(): void {
    if (this.timer) return; // idempotent
    void this.tick(); // catch-up on launch
    // The same constant the librarian's `interval` trigger shows the PM — the
    // clock and its description are one number, in agents.ts.
    this.timer = setInterval(() => void this.tick(), MAINTENANCE_TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Fire a session immediately (dry-run / run-now). Deliberately NOT marked
   * scheduled: the PM pressed a button and is watching for something to happen,
   * so this run owes them a receipt and a row even if it found nothing.
   */
  async runNow(skill: string): Promise<void> {
    await this.fireSession(skill, defaultPrompt(skill));
    this.onChanged();
  }

  private async tick(): Promise<void> {
    const ctx = this.getContext();
    if (!ctx) return;
    const now = new Date();
    for (const s of this.settings.get().schedules) {
      if (!s.enabled) continue;
      const slot = mostRecentSlot(now, s.dayOfWeek, s.hour);
      if (!s.lastRun || new Date(s.lastRun) < slot) {
        await this.settings.setSchedule(s.skill, { lastRun: now.toISOString() });
        // The clock started this one, so it is allowed to end with nothing (QM
        // ticket 2): a weekly pass with no new material leaves no receipt, no
        // Sessions row and no badge, only a line on the agent's own page.
        await this.fireSession(s.skill, defaultPrompt(s.skill), { scheduled: true }).catch((err) =>
          console.error('[pm] scheduled session failed:', err),
        );
      }
    }
    // Overdue todos are handled on demand now, not on a timer: the PO picks a
    // slipped commitment and asks the memory to help (the `commitment-check`
    // session, fired per-todo from the Todos view / the todo page). An interval
    // sweep piled up duplicate, un-actioned cards, so it's gone.

    try {
      this.maintenance?.();
    } catch (err) {
      console.error('[pm] maintenance pass failed:', err);
    }

    // Time-aware auto-prep: reads the (previous tick's) shallow event index and
    // prepares the brief for meetings an hour out. Independent of sync latency —
    // a meeting an hour away tolerates being one tick behind on the mirror.
    try {
      await this.beforeMeetingSweep?.();
    } catch (err) {
      console.error('[pm] before-meeting sweep failed:', err);
    }
  }
}

/** The most recent Date <= now matching (dayOfWeek, hour) — this week's slot. */
export function mostRecentSlot(now: Date, dayOfWeek: number, hour: number): Date {
  const slot = new Date(now);
  slot.setHours(hour, 0, 0, 0);
  let deltaDays = (now.getDay() - dayOfWeek + 7) % 7;
  // If today is the slot day but the hour hasn't arrived, use last week's slot.
  if (deltaDays === 0 && now < slot) deltaDays = 7;
  slot.setDate(slot.getDate() - deltaDays);
  return slot;
}

function defaultPrompt(skill: string): string {
  const instruction =
    skill === 'weekly-update'
      ? 'produce this week\'s update. Read the week\'s deltas (the "This week" scope) and draft per-audience updates (exec, CS, team) as approval cards, every claim cited. If nothing material changed, end quietly rather than writing an update that says so.'
      : '';
  return buildKickoff({ skill, instruction });
}
