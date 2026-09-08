/**
 * Who asked for a write, answered by the runtime rather than by the model
 * (docs/fewer-approvals.md FA-5).
 *
 * `asked` on a propose_* call means "the PM asked for this in the conversation",
 * and the write policy lets a write carrying it land without a card. The model
 * sets the flag, so on its own it is a claim and not a fact: a run nobody was
 * watching can set it on every call and write in the PM's name. Nothing checked
 * it.
 *
 * The runtime checks it here, against two things it knows and cannot be talked
 * out of: whether the PM wrote into this session, and whether they answered an
 * `ask_user` question in it. A clock's run and a run the PM walked away from
 * have neither, so the flag is cleared there whatever the call says. The
 * parameter stays a hint the model writes; this decides.
 *
 * A send is not this file's business and never needs to be. The draft tools set
 * no flag, and a send waits for the PM whatever any flag says (FA-1).
 */

/** What the runtime knows about who was in this session. */
export interface AskedFacts {
  /**
   * The PM wrote into this session themselves. Sticky for the whole session:
   * their message on turn one still counts on turn five. A kickoff a skill or a
   * clock injects is not this, because those runs arrive `scheduled` or
   * `unattended`.
   */
  pmTurn: boolean;
  /** The PM answered an `ask_user` card in this session. */
  askAnswered: boolean;
}

/**
 * Read the session's facts at the moment a tool is called, never at the moment
 * the tools were built: a PM who writes into an arrival session on turn three
 * changes the answer for turn three.
 */
export type AskedReader = () => AskedFacts;

/**
 * Does the model's `asked` flag hold? It holds only when a person was in this
 * session: they wrote a turn, or they answered a question. Everything else is
 * false, whatever the call declared.
 *
 * With no facts to check against the declared flag stands. Such a caller is a
 * test or a call with no run behind it; the runtime, the only place a model
 * actually runs, always passes them.
 */
export function askedHolds(facts: AskedFacts | undefined, declared: boolean | undefined): boolean {
  if (!declared) return false;
  if (!facts) return true;
  return facts.pmTurn || facts.askAnswered;
}

/**
 * What a waiting card's result says when the runtime cleared the flag. Without
 * it the model reads the card as a landed write and tells the PM it is done.
 */
export const ASKED_CLEARED_WAITS =
  ' Nobody asked for this in this run, so the asked flag was cleared. This waits for the PM.';

/**
 * The same fact on a refusal: with nobody asking, `asked` cannot stand in for
 * sources[]. The model still has the note in front of it, so it is told what to
 * do instead.
 */
export const ASKED_CLEARED_CITE =
  ' Nobody asked for this in this run, so asked cannot stand in for sources: cite what you read, or set inference.';
