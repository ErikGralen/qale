import { useEffect, useState } from 'react';
import { Filter } from 'lucide-react';
import type { NoteRefDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { SMART_VIEWS, type SmartViewId } from '../state/smart-views';
import { NoteList } from './NoteList';

/** What an empty view means — teach the mechanism, don't just say "nothing". */
const EMPTY_TEACH: Record<SmartViewId, string> = {
  'this-week': 'Nothing touched in the last 7 days yet. Process a meeting and this fills up.',
  decisions:
    'No active decisions yet. Approve a decision card from a meeting and the spine starts here — superseded ones drop off automatically.',
};

/** A smart view — the saved query rendered as a listing (PLAN-V2 §3.3). */
export function SmartViewPage({ viewId }: { viewId: SmartViewId }) {
  const { query } = useApp();
  const [rows, setRows] = useState<NoteRefDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const view = SMART_VIEWS[viewId];

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void query(view.query).then((r) => {
      if (alive) {
        setRows(r);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [query, view]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <Filter className="size-4" /> {view.label}
        {!loading && <span className="text-xs">· {rows.length}</span>}
      </div>
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-4">
        <p className="mb-3 text-sm text-muted-foreground">{view.description}</p>
        {loading ? (
          <ul className="flex flex-col divide-y divide-border/70" aria-hidden>
            {[0, 1, 2].map((i) => (
              <li key={i} className="px-2 py-2">
                <div className="mb-1.5 h-4 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted/70" />
              </li>
            ))}
          </ul>
        ) : (
          <NoteList rows={rows} empty={EMPTY_TEACH[viewId]} showType />
        )}
      </div>
    </div>
  );
}
