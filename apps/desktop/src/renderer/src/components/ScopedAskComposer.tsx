import { useId, useRef, useState } from 'react';
import { Folder, Hash } from 'lucide-react';
import { useApp } from '../state/app-state';
import { useChatMentions } from '../app/ChatMentions';
import { SkillPicker } from '../app/SkillPicker';
import { COMPOSER_INPUT, COMPOSER_ROW, COMPOSER_SHELL, SendButton, useAutoGrow } from './Composer';

/**
 * Half-written questions survive a tab switch. Module-level and keyed by scope,
 * so leaving #pricing for a note and coming back finds the draft intact.
 */
const drafts = new Map<string, string>();

export interface AskScope {
  kind: 'context' | 'folder';
  /** The tag (without `#`) or the folder name. */
  label: string;
}

/**
 * The docked Ask composer shared by the browse pages (folder, context): one
 * line that grows with the question, `@`/`#` autocomplete like the session
 * composer, and Enter to send. The question opens an Ask session pinned to the
 * page's scope via the prompt prefix — the chip on the left is that scope made
 * visible, so it stays legible once the placeholder is typed over.
 *
 * No canned openers here. Suggesting what to ask is Home's job, where the PO
 * has nothing in front of them yet; on a browse page the notes above the bar
 * are the prompt, and a row of guesses only competed with them.
 */
export function ScopedAskComposer({
  scope,
  sessionTitle,
  scopePrefix,
  placeholder = 'Ask the memory…',
}: {
  scope: AskScope;
  /** Tab title for the Ask session, e.g. "Ask · decisions". */
  sessionTitle: string;
  /** Prepended to the question so the agent knows the scope. */
  scopePrefix: string;
  placeholder?: string;
}) {
  const { tree, skills, openSession } = useApp();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();
  const [pickedSkill, setPickedSkill] = useState<string | null>(null);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);

  const scopeKey = `${scope.kind}:${scope.label}`;
  const [ask, setAsk] = useState(() => drafts.get(scopeKey) ?? '');
  // Navigating from one context page to the next reuses this instance: swap in
  // that scope's own draft instead of carrying the previous page's question.
  const [lastKey, setLastKey] = useState(scopeKey);
  if (lastKey !== scopeKey) {
    setLastKey(scopeKey);
    setAsk(drafts.get(scopeKey) ?? '');
  }

  const update = (v: string) => {
    setAsk(v);
    if (v) drafts.set(scopeKey, v);
    else drafts.delete(scopeKey);
  };

  const mentions = useChatMentions(tree, inputRef, ask, update);
  useAutoGrow(inputRef, ask);

  // The icon carries the `#` for contexts, the way the page header does.
  const ScopeIcon = scope.kind === 'context' ? Hash : Folder;
  // A context wears its `#`; a folder is named plainly. The trailing slash it
  // used to carry said "this is a directory", which is exactly the thing the
  // reader never has to think about.
  const scopeName = scope.kind === 'context' ? `#${scope.label}` : scope.label;

  const skill = pickedSkill ? skills.find((s) => s.name === pickedSkill) : undefined;

  const runAsk = () => {
    const q = ask.trim();
    if (!q) return;
    update('');
    // One start, not a mode — the pick is spent on the session it opens.
    setPickedSkill(null);
    // A picked skill takes the session's name too, so the tab says what it is
    // rather than calling everything "Ask".
    const title = skill
      ? `${skill.title} · ${scope.kind === 'context' ? scopeName : scope.label}`
      : sessionTitle;
    openSession(pickedSkill ?? 'ask', { title, initialPrompt: `${scopePrefix} ${q}` });
  };

  return (
    <div className="shrink-0 px-6 pt-2 pb-5">
      <div className="mx-auto w-full max-w-2xl">
        <div className={COMPOSER_SHELL}>
          {mentions.menu}
          <textarea
            ref={inputRef}
            value={ask}
            onChange={(e) => {
              update(e.target.value);
              mentions.refresh();
            }}
            onKeyDown={(e) => {
              if (mentions.onKeyDown(e)) return;
              // `/` on an empty composer opens the skill menu — the same
              // keyboard vocabulary as `@` for notes and `#` for contexts.
              if (e.key === '/' && ask.length === 0) {
                e.preventDefault();
                setSkillMenuOpen(true);
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                runAsk();
              } else if (e.key === 'Escape' && ask) {
                // First Escape clears the draft; the page keeps the second one.
                e.stopPropagation();
                update('');
              }
            }}
            onClick={mentions.refresh}
            onBlur={mentions.close}
            placeholder={skill ? `What should “${skill.title}” work on?` : placeholder}
            aria-label={`Ask about ${scopeName}`}
            aria-describedby={hintId}
            rows={1}
            className={COMPOSER_INPUT}
          />
          <div className={COMPOSER_ROW}>
            {/* Same first position on the strip as the session composer's, so the
                skill picker is in one place in the app rather than three. The
                scope chip follows it, and the pair reads as the sentence the
                send will run: this skill, over this scope. */}
            <SkillPicker
              picked={pickedSkill}
              onPick={setPickedSkill}
              onClosed={() => inputRef.current?.focus()}
              open={skillMenuOpen}
              onOpenChange={setSkillMenuOpen}
            />
            <span
              className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-brand/8 pr-2 pl-1.5 text-xs font-medium text-brand"
              title={scopePrefix}
            >
              <ScopeIcon className="size-3.5" aria-hidden />
              <span className="max-w-40 truncate">{scope.label}</span>
            </span>
            <SendButton ready={!!ask.trim()} onClick={() => runAsk()} />
          </div>
        </div>
        <p id={hintId} className="sr-only">
          Enter asks, Shift+Enter starts a new line. Type @ to reference a note, # for a context, /
          to bring in a skill. The answer opens in a new session scoped to {scopeName}.
        </p>
      </div>
    </div>
  );
}
