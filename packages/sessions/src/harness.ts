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

  /**
   * A card was taken back, so the ledger forgets it. The receipt is what the PM
   * reads to see what a session did, and a withdrawn card did nothing: it never
   * reached the queue's far end and no note was ever written for it. This is
   * also what keeps `ranSilent` honest — a run that proposed and then retracted
   * has produced nothing, and should settle as quietly as one that never
   * proposed at all.
   */
  dropWrite(cardId: string): void {
    const at = this.writes.findIndex((w) => w.cardId === cardId);
    if (at !== -1) this.writes.splice(at, 1);
    for (const turn of this.turns) {
      const i = turn.cardIds.indexOf(cardId);
      if (i !== -1) turn.cardIds.splice(i, 1);
    }
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

  /** The same list by the names a person reads — what the receipt body prints. */
  get skillTitles(): string[] {
    const seen = new Set<string>();
    return [this.config, ...this.invoked]
      .filter((r) => !seen.has(r.name) && seen.add(r.name))
      .map((r) => r.title);
  }

  /**
   * The same skill, by the name a person reads. The receipt is titled from this:
   * without a title it would fall back to its filename, and the filename ends in
   * a session id.
   */
  get primarySkillTitle(): string {
    const name = this.primarySkillName;
    return [this.config, ...this.invoked].find((r) => r.name === name)?.title ?? name;
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

  /**
   * Whether the session may draft calendar work: an event, a move, an RSVP.
   * Its own answer, not a corner of {@link outbound}: putting a time in other
   * people's days is a different act from answering a ticket, and only the
   * skill that books meetings carries the tools for it.
   */
  get draftCalendar(): boolean {
    return this.grants('draft-calendar');
  }

  /** Whether the session may file arrived material into the vault, and refile it. */
  get fileMaterial(): boolean {
    return this.grants('file-material');
  }

  /**
   * Whether the session may start watching an external item, or record an
   * answer about a whole project or space. Reading Jira and Confluence is not
   * this: reads ride on the connection, and every session has them.
   */
  get trackExternal(): boolean {
    return this.grants('track-external');
  }
}
