/**
 * What the chat needs from a `draft_text` call (docs/draft-text.md). The panel
 * renders straight from the tool part's input, live and on replay, so nothing
 * here is stored and nothing here is trusted: a call that is still streaming
 * has half an input, and a malformed one has whatever the model wrote. Both
 * read as null, and the caller folds them into the activity trail like any
 * other step.
 */

export interface DraftVariant {
  /** What the tab says. Two or three words. */
  label: string;
  /** The whole text, as markdown. */
  body: string;
}

/**
 * A question the panel asks once a tab has been copied or used: one sentence,
 * one to three answers (docs/learning-how-you-work.md, ticket 10). The weekly
 * update's first panel carries "Write updates this way from now on?", and the
 * answer is what turns three styles into one.
 */
export interface DraftAsk {
  text: string;
  options: string[];
}

export interface DraftText {
  title?: string;
  voice?: string;
  variants: DraftVariant[];
  /** The agent's own button and the sentence it adds to the sent message. */
  action?: { label?: string; message?: string };
  /** Shown under the footer after Copy or Use this. Absent on an ordinary panel. */
  ask?: DraftAsk;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The ask as the tool accepted it, or nothing when it is missing or malformed. */
function askOf(raw: unknown): DraftAsk | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const ask = raw as Record<string, unknown>;
  const askText = str(ask.text)?.trim();
  if (!askText || !Array.isArray(ask.options)) return undefined;
  const options = ask.options
    .map((o) => (typeof o === 'string' ? o.trim() : ''))
    .filter((o) => o.length > 0);
  if (options.length === 0 || options.length > 3) return undefined;
  return { text: askText, options };
}

/**
 * The panel for a `draft_text` call, or null while there is nothing to draw.
 *
 * A call has to come back before it draws anything. The tool refuses a draft
 * that names a voice this session has not read, and that refusal carries the
 * variants it was called with: drawing them would put text on screen that the
 * agent is at that moment rewriting, and the rewrite would land beside it as a
 * second panel saying the same thing in a different tone. Waiting for the
 * result also spares the person a panel that assembles itself a tab at a time
 * while the call streams.
 *
 * A refusal is an ordinary result whose text opens with "Rejected:", the same
 * word every tool in the workspace refuses with.
 */
export function draftTextShown(call: {
  state?: string;
  output?: unknown;
  input?: unknown;
}): DraftText | null {
  if (call.state !== 'output-available') return null;
  if (typeof call.output === 'string' && call.output.startsWith('Rejected:')) return null;
  return draftTextOf(call.input);
}

/** The panel's reading of a tool input, or null when there is nothing to show. */
export function draftTextOf(input: unknown): DraftText | null {
  if (typeof input !== 'object' || input === null) return null;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.variants)) return null;
  const variants: DraftVariant[] = [];
  for (const item of raw.variants) {
    if (typeof item !== 'object' || item === null) continue;
    const v = item as Record<string, unknown>;
    const body = str(v.body);
    if (body === undefined) continue;
    // A variant is a tab, and a tab with no name cannot be picked or named in
    // the message the Use button sends. Number it rather than drop the text.
    variants.push({ label: str(v.label) ?? `Version ${variants.length + 1}`, body });
  }
  if (variants.length === 0) return null;
  const action =
    typeof raw.action === 'object' && raw.action !== null
      ? (raw.action as Record<string, unknown>)
      : undefined;
  const ask = askOf(raw.ask);
  return {
    title: str(raw.title),
    voice: str(raw.voice),
    variants,
    ...(action ? { action: { label: str(action.label), message: str(action.message) } } : {}),
    ...(ask ? { ask } : {}),
  };
}

/**
 * What answering the panel's question sends, as the person. It names the tab
 * they copied and the option they clicked, so the agent knows both the style
 * and what to do with it: `I copied "One paragraph" and answered "For exec".`
 */
export function draftAnswerMessage(label: string, answer: string): string {
  return `I copied "${label}" and answered "${answer}".`;
}

/**
 * What a second copy of the same style, with no answer in between, sends. Two
 * copies count as the pick (docs/learning-how-you-work.md): the person has shown
 * what they want twice, and a third panel asking the same question would be the
 * form the doc refuses.
 */
export function draftRepeatMessage(label: string, voice: string): string {
  return `I copied "${label}" again without answering, so treat it as the pick for ${voice}.`;
}

/**
 * Where the last unanswered copy is kept, per workspace and voice. A per-viewer
 * convenience: the pick itself lands in the voice file, and losing this only
 * means the question is asked once more.
 */
export interface CopyMemory {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function copyMemoryKey(workspace: string | null | undefined, voice: string): string {
  return `qale.draftCopy.v1:${workspace ?? ''}:${voice.toLowerCase()}`;
}

/**
 * `localStorage` behind {@link CopyMemory}. Every call is wrapped: a private
 * window, cleared site data or a blocked store all read as "nothing remembered",
 * and a failed write is not worth a broken Copy button.
 */
export function localCopyMemory(): CopyMemory {
  return {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* nothing to do: the question is asked once more next time */
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* same */
      }
    },
  };
}

/**
 * Record a copy that got no answer, and say whether it repeats an earlier one.
 *
 * The earlier copy has to come from another panel: copying the same tab twice
 * from one panel is a person making sure the clipboard took it, not a pick. A
 * repeat clears the memory, because the message it triggers is the answer.
 */
export function rememberCopy(
  store: CopyMemory,
  key: string,
  label: string,
  panelId: string,
): { repeat: boolean } {
  let earlier: { label?: unknown; panel?: unknown } | null = null;
  try {
    const raw = store.get(key);
    earlier = raw ? (JSON.parse(raw) as { label?: unknown; panel?: unknown }) : null;
  } catch {
    earlier = null;
  }
  if (earlier && earlier.label === label && earlier.panel !== panelId) {
    store.remove(key);
    return { repeat: true };
  }
  store.set(key, JSON.stringify({ label, panel: panelId }));
  return { repeat: false };
}

/** An answer was sent, or the voice holds one style now: nothing to remember. */
export function forgetCopy(store: CopyMemory, key: string): void {
  store.remove(key);
}

/**
 * How long the open version is, for the footer. The one fact the panel can
 * state about text that is on its way to Slack, a mail or a ticket, where
 * length is the first thing that decides whether it fits.
 *
 * Markdown is scaffolding, not prose: a bullet's dash and a heading's hashes
 * are not words, and a fenced block is not text anyone counts. Strip them and
 * count what is left.
 */
export function draftWordCount(body: string): number {
  const prose = body
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/[*_`~>|]/g, ' ');
  return prose.match(/\S+/g)?.length ?? 0;
}

/**
 * What the Use button sends, as the person: the open tab by name, then the
 * agent's own sentence when the call carried one. The panel keeps no state the
 * model can read, so this sentence is the only thing that says which version
 * they picked.
 */
export function draftUseMessage(label: string, actionMessage?: string): string {
  const picked = `Use the "${label}" version.`;
  return actionMessage ? `${picked} ${actionMessage}` : picked;
}

/**
 * What picking a voice sends, as the person. Same move as the Use button: the
 * panel changes nothing and asks for nothing, it says out loud what the person
 * wants and the agent drafts again. A new panel arrives; this one stays.
 *
 * It asks for the WHOLE panel, never the open tab. A voice is how the draft
 * sounds, and the variants are takes on the same draft: rewriting one of them
 * in another voice would leave a panel whose tabs no longer compare, which is
 * the one thing tabs are for.
 *
 * The voice is named by its title, which is the name the person reads on the
 * Skills page and the one `resolveVoice` matches on. Two short sentences, so
 * the draft and the voice are each one instruction.
 */
export function draftVoiceMessage(draft: DraftText, voiceTitle: string | null): string {
  const subject = draft.title ? `"${draft.title}"` : 'that draft';
  const again =
    draft.variants.length > 1 ? `Rewrite every version of ${subject}.` : `Rewrite ${subject}.`;
  if (!voiceTitle) return `${again} Write it plainly, with no voice.`;
  // Most voices are titled "Exec voice" already. One titled "Boardroom" would
  // read as a place rather than a voice, so the word is added when it is missing.
  const named = /voice/i.test(voiceTitle) ? voiceTitle : `${voiceTitle} voice`;
  return `${again} Use the ${named}.`;
}
