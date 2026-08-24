import { useEffect, useId, useRef, useState } from 'react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@qale/ui';
import { Check, ChevronDown, Copy, PenLine } from 'lucide-react';
import {
  draftUseMessage,
  draftVoiceMessage,
  draftWordCount,
  type DraftText,
} from '../lib/draft-text';
import { Markdown } from './Markdown';
import type { NavOpts } from '../lib/nav';

/** One voice the workspace holds, as the footer's picker needs it. */
export interface DraftVoice {
  /** The invocation name, which is the filename the tool passed. */
  name: string;
  /** What a person calls it ("Exec voice"). */
  title: string;
  summary: string;
}

/**
 * Text the agent wrote, in the chat where it was asked for (docs/draft-text.md).
 *
 * Nothing here is pending, so nothing here asks for a decision: no approve, no
 * discard, no edit. The panel knows about text and tabs and stops there. Copy
 * hands the open version to whatever the person is pasting into, and Use this
 * sends an ordinary turn naming that version, which is how every destination
 * stays the agent's problem and gets the real card it already has.
 *
 * The voice picker is the same trick a third time. It changes nothing here: it
 * sends "Rewrite every version of X. Use the Exec voice." as the person, and
 * the next draft arrives as its own panel. So the panel still holds no state
 * the model has to be told about, and a draft the PM liked is never overwritten
 * by asking to hear another take on it.
 *
 * It is the one control here that is about the whole panel rather than the open
 * tab. A voice is how the draft sounds, and the tabs are takes on one draft: a
 * voice applied to a single tab would leave a set that no longer compares.
 *
 * It is drawn as a sheet — card surface, hairline ring, a rail above and a rail
 * below — because it is the one thing in a session that is finished writing.
 * Everything else in the chat is somebody talking; this is an artifact, meant
 * to leave. A wash of muted grey said the opposite: it read as a quoted aside
 * behind the conversation rather than the thing the turn was asked for.
 *
 * The ring is the neutral one on purpose. An accent ring is the vocabulary of a
 * card that is waiting on you, and this one never waits: taking the ink would
 * make a panel that decides nothing look like the one that parks the session.
 *
 * Which tab is open is local state. It is never written down and never told to
 * the model, because the message the Use button sends says it out loud.
 */
export function DraftTextPanel({
  draft,
  voices,
  onUse,
  onOpenNote,
  disabled,
}: {
  draft: DraftText;
  /** Every voice the workspace holds. Empty hides the picker. */
  voices?: DraftVoice[];
  /** Sends the text as a message from the person. */
  onUse: (text: string) => void;
  onOpenNote?: (path: string, opts?: NavOpts) => void;
  /** A turn is running, or the session is parked on a question. */
  disabled?: boolean;
}) {
  const id = useId();
  const [active, setActive] = useState(0);
  const [flash, setFlash] = useState<'idle' | 'copied' | 'failed'>('idle');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // A revision is a new panel, so the set never changes under an open one —
  // except while the first call is still streaming, where a tab can arrive
  // after the person has already moved off the first.
  const index = Math.min(active, draft.variants.length - 1);
  const open = draft.variants[index]!;
  const tabbed = draft.variants.length > 1;
  const words = draftWordCount(open.body);

  // The tool passes a voice by its filename ("exec"), which is an address and
  // not a name anybody uses. Resolve it to the title the Skills page shows, and
  // fall back to the raw name only for a voice the workspace no longer holds.
  const roster = voices ?? [];
  const inForce = draft.voice
    ? (roster.find((v) => v.name.toLowerCase() === draft.voice!.toLowerCase()) ??
      roster.find((v) => v.title.toLowerCase() === draft.voice!.toLowerCase()) ??
      null)
    : null;
  const voiceLabel = inForce?.title ?? (draft.voice ? `${draft.voice} voice` : 'Pick a voice');
  const others = roster.filter((v) => v.name !== inForce?.name);

  const pick = (next: number) => {
    if (next === index) return;
    setActive(next);
    setFlash('idle');
  };

  // The markdown as written. This text is going into Slack, an email or a
  // ticket, where the line breaks and the lists are the point; handing over the
  // rendered version would run three paragraphs into one.
  //
  // A clipboard write can be refused, and this is the main way text leaves the
  // app: a refusal that says nothing leaves the person pasting an old buffer
  // into a stakeholder thread.
  const copy = () => {
    void navigator.clipboard.writeText(open.body).then(
      () => setFlash('copied'),
      () => setFlash('failed'),
    );
  };

  useEffect(() => {
    if (flash === 'idle') return;
    const t = setTimeout(() => setFlash('idle'), 2000);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <div className="my-2 overflow-hidden rounded-xl bg-card ring-1 ring-border">
      {/* One rail, two jobs: what this text is, and which version you are
          reading. Splitting them into two rows put a tab bar under a title bar
          on an object whose whole content is four lines of prose. The voice
          belongs downstairs with the word count: it is a fact about the text,
          and up here it stole the room the title needs on a narrow window. */}
      {(draft.title || tabbed) && (
        <div className="flex h-9 items-center gap-2 border-b border-border px-3.5">
          {draft.title && (
            <>
              <PenLine className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span
                className="min-w-0 truncate text-dense font-semibold text-foreground"
                title={draft.title}
              >
                {draft.title}
              </span>
            </>
          )}

          {tabbed && (
            <div
              role="tablist"
              aria-label="Versions"
              className={`flex h-full shrink-0 items-stretch gap-3 ${
                draft.title ? 'ml-auto pl-2' : ''
              }`}
              onKeyDown={(e) => {
                // A tablist is steered with the arrow keys, the way a screen
                // reader announces it. Tab still steps out of the row to the
                // buttons below.
                const last = draft.variants.length - 1;
                const next =
                  e.key === 'ArrowRight'
                    ? (index + 1) % draft.variants.length
                    : e.key === 'ArrowLeft'
                      ? (index + last) % draft.variants.length
                      : e.key === 'Home'
                        ? 0
                        : e.key === 'End'
                          ? last
                          : -1;
                if (next < 0) return;
                e.preventDefault();
                pick(next);
                tabRefs.current[next]?.focus();
              }}
            >
              {draft.variants.map((variant, i) => (
                <button
                  key={`${variant.label}-${i}`}
                  type="button"
                  role="tab"
                  id={`${id}-tab-${i}`}
                  aria-controls={`${id}-body`}
                  aria-selected={i === index}
                  tabIndex={i === index ? 0 : -1}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  // The underline lands on the rail's own hairline, and the
                  // weight never changes with it: a tab row that re-measures
                  // itself on every pick nudges its neighbours sideways.
                  className={`relative text-dense font-medium transition-colors after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none ${
                    i === index
                      ? 'text-foreground after:bg-brand'
                      : 'text-muted-foreground after:bg-transparent hover:text-foreground'
                  }`}
                  onClick={() => pick(i)}
                >
                  {variant.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div
        id={`${id}-body`}
        className="px-3.5 py-3"
        {...(tabbed ? { role: 'tabpanel', 'aria-labelledby': `${id}-tab-${index}` } : {})}
      >
        <Markdown content={open.body} onOpenNote={onOpenNote} />
      </div>

      {/* How it sounds and how long it is, then the two ways out, together on
          the right. The buttons used to sit at opposite ends of the card, which
          read as two unrelated controls on one object rather than a choice
          between them. */}
      <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {/* The voice is the one thing on the panel that can be changed, and
              changing it is the same move as Use this: no state here moves, a
              message goes out as the person, and the agent drafts again into a
              new panel. This one is never rewritten under them. */}
          {roster.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  title={
                    tabbed
                      ? 'Ask for every version again in another voice'
                      : 'Ask for this text again in another voice'
                  }
                  className="-ml-1.5 flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground aria-expanded:bg-accent aria-expanded:text-foreground"
                >
                  <span className="truncate">{voiceLabel}</span>
                  <ChevronDown className="size-3 shrink-0" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" sideOffset={6} className="w-64">
                {/* Says the scope out loud: a voice is how the whole draft
                    sounds, so picking one asks for every version again, not
                    the tab that happens to be open. */}
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  {tabbed
                    ? 'Write every version again in another voice'
                    : 'Write it again in another voice'}
                </DropdownMenuLabel>
                {others.map((v) => (
                  <DropdownMenuItem
                    key={v.name}
                    className="px-2 py-1.5"
                    disabled={disabled}
                    onClick={() => onUse(draftVoiceMessage(draft, v.title))}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{v.title}</span>
                      {v.summary && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {v.summary}
                        </span>
                      )}
                    </span>
                  </DropdownMenuItem>
                ))}
                {/* Off draft.voice, not the resolved one: a draft written in a
                    voice the workspace has since lost is still a draft in a
                    voice, and "write it plainly" is still the way out of it. */}
                {draft.voice && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="px-2 py-1.5 text-sm"
                      disabled={disabled}
                      onClick={() => onUse(draftVoiceMessage(draft, null))}
                    >
                      Plain, no voice
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <span className="shrink-0 tabular-nums">
            {roster.length > 0 && '· '}
            {words} {words === 1 ? 'word' : 'words'}
          </span>
        </span>
        <span role="status" className="sr-only">
          {flash === 'copied' ? 'Copied' : flash === 'failed' ? 'Could not copy' : ''}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* Fixed width so the label can change under the pointer without the
              button growing and shifting the one beside it. */}
          <Button
            size="sm"
            variant="ghost"
            className={`min-w-24 ${flash === 'copied' ? 'text-brand' : ''} ${
              flash === 'failed' ? 'text-destructive' : ''
            }`}
            title={
              flash === 'failed'
                ? 'The clipboard refused it. Click to try again.'
                : 'Copy the text as markdown'
            }
            onClick={copy}
          >
            {flash === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {flash === 'copied' ? 'Copied' : flash === 'failed' ? 'Failed' : 'Copy'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            title={draft.action?.label ? undefined : 'Tell the agent to use this version'}
            onClick={() => onUse(draftUseMessage(open.label, draft.action?.message))}
          >
            {draft.action?.label ?? 'Use this'}
          </Button>
        </span>
      </div>
    </div>
  );
}
