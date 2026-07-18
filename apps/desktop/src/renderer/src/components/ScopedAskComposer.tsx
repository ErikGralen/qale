import { useState } from 'react';
import { Button } from '@pm/ui';
import { Sparkles } from 'lucide-react';
import { useApp } from '../state/app-state';

/**
 * The docked Ask composer shared by the browse pages (folder, context): one
 * line, Enter sends, and the question opens an Ask session pinned to the
 * page's scope via the prompt prefix.
 */
export function ScopedAskComposer({
  placeholder,
  sessionTitle,
  scopePrefix,
}: {
  placeholder: string;
  /** Tab title for the Ask session, e.g. "Ask · decisions". */
  sessionTitle: string;
  /** Prepended to the question so the agent knows the scope. */
  scopePrefix: string;
}) {
  const { openSession } = useApp();
  const [ask, setAsk] = useState('');

  const runAsk = () => {
    const q = ask.trim();
    if (!q) return;
    setAsk('');
    openSession('ask', {
      title: sessionTitle,
      initialPrompt: `${scopePrefix} ${q}`,
    });
  };

  return (
    <div className="shrink-0 px-6 pb-5">
      <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-xl border border-border bg-card p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
        <Sparkles className="mb-1.5 ml-1 size-4 shrink-0 text-brand" />
        <textarea
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              runAsk();
            }
          }}
          placeholder={placeholder}
          rows={1}
          className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-[15px] outline-none"
        />
        <Button size="sm" onClick={runAsk} disabled={!ask.trim()}>
          Ask
        </Button>
      </div>
    </div>
  );
}
