import { useEffect, useState } from 'react';
import { Filter } from 'lucide-react';
import type { NoteRefDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { SMART_VIEWS, type SmartViewId } from '../state/smart-views';
import { NoteList } from './NoteList';

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
      <div className="flex h-9 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <Filter className="size-4" /> {view.label}
        <span className="text-xs">· {rows.length}</span>
      </div>
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-4">
        <p className="mb-3 text-sm text-muted-foreground">{view.description}</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <NoteList rows={rows} empty="Nothing matches this view." />
        )}
      </div>
    </div>
  );
}
