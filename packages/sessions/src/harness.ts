import { TIER_RANK, type SkillConfig, type SkillTier } from './skill.js';

/**
 * The session harness (PLAN-V2 §3.2) — the state machine that drives a session's
 * checkpoints, gates output behind the completion bar, and records the reads/
 * writes receipt filed to `sessions/` on close. One harness per live session.
 *
 * Sessions v2: a session is no longer locked to one skill. Skills ARRIVE — pulled
 * in by the agent (`use_skill` on a `dynamic` binding) or picked by the PO — and
 * each arrival brings its own tier, checkpoints and gate. The harness is where
 * "what is in force right now" lives, so the tools ask it rather than reading a
 * config frozen at session creation.
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
  /** Skills that arrived mid-session, in arrival order (Sessions v2 Part 3). */
  readonly invoked: SkillConfig[] = [];
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

  /**
   * A skill arrived. Its tier folds into what the session may do; its checkpoint
   * plan replaces the one in force. The checkpoint counter resets with the plan —
   * a digest recorded against the old plan must not unlock a newly arrived gate.
   */
  invokeSkill(config: SkillConfig): void {
    this.invoked.push(config);
    if (config.checkpoints.length > 0) this.checkpointIndex = -1;
  }

  /** Every skill in force, base first — what the receipt records. */
  get skillNames(): string[] {
    return [...new Set([this.config.name, ...this.invoked.map((c) => c.name)])];
  }

  /** The skill that produced whatever is being proposed right now (cards are tagged with it). */
  get activeSkillName(): string {
    return this.invoked[this.invoked.length - 1]?.name ?? this.config.name;
  }

  /** The most recent arrival that declares a checkpoint plan, else the base skill. */
  private planSource(): SkillConfig {
    for (let i = this.invoked.length - 1; i >= 0; i--) {
      const c = this.invoked[i]!;
      if (c.checkpoints.length > 0) return c;
    }
    return this.config;
  }

  /** The checkpoint plan in force. */
  get checkpoints(): string[] {
    return this.planSource().checkpoints;
  }

  /** Whether output is gated behind a checkpoint right now. */
  get gateOutput(): boolean {
    const src = this.planSource();
    return src.gateOutput && src.checkpoints.length > 0;
  }

  /** Whether any skill in force keeps working files (Sessions v2 Part 1). */
  get sessionFiles(): boolean {
    return this.config.sessionFiles || this.invoked.some((c) => c.sessionFiles);
  }

  /**
   * The tool tier in force: the highest any active skill grants. Arrival ADDS
   * permissions — invoking a read-only skill inside an outbound session must not
   * silently strip the draft tools the PO already approved into existence.
   */
  get tier(): SkillTier {
    let best = this.config.tier;
    for (const c of this.invoked) if (TIER_RANK[c.tier] > TIER_RANK[best]) best = c.tier;
    return best;
  }

  /** Advance to a named checkpoint (idempotent, monotonic within the active plan). */
  advanceCheckpoint(name: string): { ok: boolean; position: number } {
    const idx = this.checkpoints.indexOf(name);
    if (idx > this.checkpointIndex) this.checkpointIndex = idx;
    return { ok: idx !== -1, position: this.checkpointIndex };
  }

  get reachedCheckpoint(): string | null {
    return this.checkpointIndex >= 0 ? this.checkpoints[this.checkpointIndex] ?? null : null;
  }

  /**
   * Whether propose-tools are unlocked. Gated skills require at least one
   * checkpoint advance (the model must give its digest/outline before drafting);
   * un-gated skills are always open. A gate with no checkpoints is meaningless —
   * the advance_checkpoint tool would have nothing to advance to — so it never locks.
   */
  canPropose(): boolean {
    if (!this.gateOutput) return true;
    return this.checkpointIndex >= 0;
  }

  gateMessage(): string {
    const first = this.checkpoints[0] ?? 'digest';
    return `Rejected: give your ${first} first and record it with advance_checkpoint("${first}") — proposing unlocks after your first checkpoint.`;
  }
}
