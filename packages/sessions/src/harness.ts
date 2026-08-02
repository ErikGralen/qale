import { can, type Capability, type Runnable } from './runnable.js';

/**
 * The session harness (PLAN-V2 §3.2) — what is in force right now, plus the
 * reads/writes ledger filed to `sessions/` on close. One harness per live
 * session.
 *
 * Sessions v2: a session is no longer locked to one file. Runnables ARRIVE —
 * pulled in by the agent (`use_skill`) or picked by the PO — and each arrival
 * brings its own capabilities. The harness is where "what may this session do"
 * lives, so the tools ask it rather than reading a config frozen at creation.
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
  /** Runnables that arrived mid-session, in arrival order (Sessions v2 Part 3). */
  readonly invoked: Runnable[] = [];
  private current: SessionTurn | null = null;
  private primary: string | null = null;

  constructor(
    readonly sessionId: string,
    readonly config: Runnable,
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

  /** A runnable arrived. What it may do folds into what the session may do. */
  invokeSkill(config: Runnable): void {
    this.invoked.push(config);
  }

  /** Every skill in force, base first — what the receipt records. */
  get skillNames(): string[] {
    return [...new Set([this.config.name, ...this.invoked.map((c) => c.name)])];
  }

  /**
   * The skill this session is ABOUT — the first that arrived, else the base one.
   * Memoized on first read because the receipt is named from it and rewritten
   * every turn: a skill invoked on turn five must not rename a receipt that
   * turns one to four already filed, orphaning the old path.
   */
  get primarySkillName(): string {
    this.primary ??= this.invoked[0]?.name ?? this.config.name;
    return this.primary;
  }

  /** The skill that produced whatever is being proposed right now (cards are tagged with it). */
  get activeSkillName(): string {
    return this.invoked[this.invoked.length - 1]?.name ?? this.config.name;
  }

  /**
   * Whether a capability is granted RIGHT NOW: true if any runnable in force
   * grants it. Arrival ADDS permission — pulling in a quieter skill inside an
   * outbound session must not silently strip the draft tools the PO already
   * approved into existence.
   *
   * This OR is the only thing in the system that WIDENS a permission, and it
   * widens only across files. The floors that bound it are enforced before this
   * is ever asked (the `enabled` switch, checked before a session is fired) and
   * after (the workspace's outbound connectors, checked where a capability
   * becomes a tool set), so nothing here can reach past them. The whole rule is
   * written out on `Capability` in ./runnable.ts.
   */
  grants(capability: Capability): boolean {
    return can(this.config, capability) || this.invoked.some((c) => can(c, capability));
  }

  /** Whether any runnable in force keeps working files (Sessions v2 Part 1). */
  get sessionFiles(): boolean {
    return this.grants('keep-working-files');
  }

  /** Whether the session may draft outbound right now. */
  get outbound(): boolean {
    return this.grants('draft-outbound');
  }
}
