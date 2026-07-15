import type { SkillConfig } from './skill.js';

/**
 * The session harness (PLAN-V2 §3.2) — the state machine that drives a session's
 * checkpoints, gates output behind the completion bar, and records the reads/
 * writes receipt filed to `sessions/` on close. One harness per live session.
 */
export interface SessionTurn {
  prompt: string;
  at: string;
  cardIds: string[];
}

export class SessionHarness {
  readonly reads = new Set<string>();
  readonly writes: { path: string; cardId: string; kind: string }[] = [];
  readonly turns: SessionTurn[] = [];
  private checkpointIndex = -1;
  private current: SessionTurn | null = null;

  constructor(
    readonly sessionId: string,
    readonly config: SkillConfig,
    readonly started: string,
  ) {}

  /** Begin a conversational turn (records the user's prompt for the receipt). */
  beginTurn(prompt: string, at: string): void {
    this.current = { prompt, at, cardIds: [] };
    this.turns.push(this.current);
  }

  recordRead(path: string): void {
    this.reads.add(path);
  }

  recordWrite(path: string, cardId: string, kind: string): void {
    this.writes.push({ path, cardId, kind });
    this.current?.cardIds.push(cardId);
  }

  /** Advance to a named checkpoint (idempotent, monotonic). */
  advanceCheckpoint(name: string): { ok: boolean; position: number } {
    const idx = this.config.checkpoints.indexOf(name);
    if (idx > this.checkpointIndex) this.checkpointIndex = idx;
    return { ok: idx !== -1, position: this.checkpointIndex };
  }

  get reachedCheckpoint(): string | null {
    return this.checkpointIndex >= 0 ? this.config.checkpoints[this.checkpointIndex] ?? null : null;
  }

  /**
   * Whether propose-tools are unlocked. Gated skills require at least one
   * checkpoint advance (the model must give its digest/outline before drafting);
   * un-gated skills are always open.
   */
  canPropose(): boolean {
    if (!this.config.gateOutput) return true;
    return this.checkpointIndex >= 0;
  }

  gateMessage(): string {
    return `Rejected: complete your outline first — call advance_checkpoint (e.g. "${
      this.config.checkpoints[0] ?? 'outline'
    }") after giving the digest and outline, then propose.`;
  }
}
