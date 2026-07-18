import { skillsForEvent, type UseCaseContext } from '@pm/application';
import type { SettingsService } from './settings-service.js';

/** Local "YYYY-MM-DD" for overdue-todo detection. */
function todayIso(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * The app-open scheduler (PLAN-V2 §3.5): fires scheduled sessions on their weekly
 * slot while the app runs, catching up missed slots on launch. It also runs the
 * earned auto-apply pass each tick. A desktop scheduler only runs while the app is
 * open — catch-up-on-launch is the honest v1 (no "overnight" promise).
 */
export class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly getContext: () => UseCaseContext | null,
    private readonly settings: SettingsService,
    private readonly fireSession: (sessionType: string, prompt: string) => Promise<void>,
    private readonly onChanged: () => void,
    /** Librarian maintenance pass (ping sweep) — runs each tick, errors swallowed. */
    private readonly maintenance?: () => void,
  ) {}

  start(): void {
    if (this.timer) return; // idempotent
    void this.tick(); // catch-up on launch
    this.timer = setInterval(() => void this.tick(), 5 * 60 * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Fire a session immediately (dry-run / run-now). */
  async runNow(sessionType: string): Promise<void> {
    await this.fireSession(sessionType, defaultPrompt(sessionType));
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
        await this.settings.setSchedule(s.sessionType, { lastRun: now.toISOString() });
        await this.fireSession(s.sessionType, defaultPrompt(s.sessionType)).catch((err) =>
          console.error('[pm] scheduled session failed:', err),
        );
      }
    }
    // Triggered reactions (Skills v2): a slipped commitment fires any skill bound
    // to `todo.overdue`, which produces approval cards. Depth-1 loop guard — only
    // this scheduler-origin event dispatches; the reaction's own writes never
    // re-trigger.
    await this.fireOverdueReactions(ctx, now).catch((err) =>
      console.error('[pm] overdue reaction failed:', err),
    );

    try {
      this.maintenance?.();
    } catch (err) {
      console.error('[pm] ping sweep failed:', err);
    }
  }

  /** Once per day at most: if any of the PO's own todos have slipped, fire the reactions bound to `todo.overdue`. */
  private lastOverdueSweep: string | null = null;
  private async fireOverdueReactions(ctx: UseCaseContext, now: Date): Promise<void> {
    const today = todayIso(now);
    if (this.lastOverdueSweep === today) return;
    const overdue = ctx.index
      .listByType('todo')
      .some((n) => {
        const fm = n.frontmatter as Record<string, unknown>;
        return (fm['status'] ?? 'open') === 'open' && !fm['owner'] && typeof fm['due'] === 'string' && fm['due'] < today;
      });
    if (!overdue) return;
    this.lastOverdueSweep = today;
    const skills = await skillsForEvent(ctx, 'todo.overdue', { date: today });
    for (const s of skills) {
      await this.fireSession(
        s.sessionType,
        `A commitment has slipped overdue as of ${today}. Review the overdue todos and propose how to handle each (reschedule, close, or draft a nudge) as approval cards.`,
      ).catch((err) => console.error('[pm] reaction session failed:', err));
    }
    if (skills.length > 0) this.onChanged();
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

function defaultPrompt(sessionType: string): string {
  if (sessionType === 'weekly-update') {
    return 'Produce this week\'s update. Read the week\'s deltas (the "This week" scope) and draft per-audience updates (exec, CS, team) as approval cards, every claim cited. If nothing material changed, say so and produce nothing.';
  }
  return `Run the ${sessionType} session.`;
}
