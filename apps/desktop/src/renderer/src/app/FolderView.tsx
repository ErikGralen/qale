import { useState } from 'react';
import { Button } from '@pm/ui';
import { Folder, Sparkles } from 'lucide-react';
import { useApp } from '../state/app-state';
import { NoteList } from './NoteList';

/**
 * A folder page (PLAN-V2 §3.3): the folder's listing + a docked Ask composer
 * scoped to that folder. Reads the tree group for this dir — the generated
 * index.md is refreshed by the librarian (Phase 6).
 */
export function FolderView({ dir }: { dir: string }) {
  const { tree, openSession } = useApp();
  const [ask, setAsk] = useState('');
  const group = tree?.groups.find((g) => g.dir === dir);
  const notes = (group?.notes ?? []).filter((n) => !n.path.endsWith('/index.md'));

  const runAsk = () => {
    const q = ask.trim();
    if (!q) return;
    setAsk('');
    openSession('ask', {
      title: `Ask · ${dir}`,
      initialPrompt: `Scoped to the ${dir}/ folder. ${q}`,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <Folder className="size-4" /> {dir}
        <span className="text-xs">· {notes.length}</span>
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-4">
        <NoteList rows={notes} empty={`No notes in ${dir}/ yet.`} />
      </div>

      <div className="px-6 pb-5">
        <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-sm">
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
            placeholder={`Ask about ${dir}…`}
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
