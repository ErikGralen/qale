import { useMemo, useState } from 'react';
import { Button } from '@pm/ui';
import { Hash, Sparkles } from 'lucide-react';
import type { NoteRefDTO, NoteType } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { NoteList } from './NoteList';
import { notesInContext, refDate, SPINE_ORDER } from '../lib/contexts';

/** Section labels in spine order — how a context page reads. */
const SECTION_LABEL: Record<NoteType, string> = {
  decision: 'Decisions',
  problem: 'Problems',
  insight: 'Insights',
  release: 'Releases',
  todo: 'Todos',
  customer: 'Customers',
  person: 'People',
  meeting: 'Meetings',
  note: 'Notes',
  source: 'Sources',
  session: 'Sessions',
  skill: 'Skills',
};

/** Long sections truncate to this; the folder browse page has the full list. */
const SECTION_LIMIT = 8;

/**
 * A context page — everything the memory holds about one project, product, or
 * area, across note types. Reads in spine order: what we decided, what we're
 * working on, what we learned, what shipped, then the surrounding cast. This
 * is the page behind every #chip in the app.
 */
export function ContextView({ tag }: { tag: string }) {
  const { tree, openSession, openFolder } = useApp();
  const [ask, setAsk] = useState('');

  const notes = useMemo(() => notesInContext(tree, tag), [tree, tag]);

  const sections = useMemo(() => {
    const byType = new Map<NoteType, NoteRefDTO[]>();
    for (const n of notes) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);
    return SPINE_ORDER.filter((t) => byType.has(t)).map((t) => ({
      type: t,
      rows: (byType.get(t) ?? []).sort((a, b) => refDate(b).getTime() - refDate(a).getTime()),
    }));
  }, [notes]);

  const runAsk = () => {
    const q = ask.trim();
    if (!q) return;
    setAsk('');
    openSession('ask', {
      title: `Ask · #${tag}`,
      initialPrompt: `Scoped to notes tagged "${tag}". ${q}`,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <Hash className="size-4 text-brand" /> {tag}
        <span className="text-xs tabular-nums">· {notes.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        <div className="mx-auto w-full max-w-2xl">
          {notes.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              Nothing tagged #{tag} yet. The librarian suggests contexts when filing — approve a card carrying this
              tag and it fills up.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {sections.map((s) => {
                const dirName = `${SECTION_LABEL[s.type].toLowerCase()}`;
                const truncated = s.rows.length > SECTION_LIMIT;
                return (
                  <section key={s.type}>
                    <div className="mb-0.5 flex items-baseline gap-2 px-2">
                      <h2 className="text-xs font-medium text-muted-foreground">{SECTION_LABEL[s.type]}</h2>
                      <span className="text-xs text-muted-foreground tabular-nums">{s.rows.length}</span>
                    </div>
                    <NoteList rows={truncated ? s.rows.slice(0, SECTION_LIMIT) : s.rows} empty="" omitTag={tag} />
                    {truncated && (
                      <button
                        className="mt-1 rounded px-2 text-xs font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                        onClick={() => openFolder(dirName)}
                      >
                        See all {s.rows.length} in {dirName} →
                      </button>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>

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
            placeholder={`Ask about #${tag}…`}
            rows={1}
            className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1 text-[15px] outline-none"
          />
          <Button size="sm" onClick={runAsk} disabled={!ask.trim()}>
            Ask
          </Button>
        </div>
      </div>
    </div>
  );
}
