import { AlertTriangle } from 'lucide-react';
import type { NoteRefDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';

/** Shared note listing used by smart views and folder pages. */
export function NoteList({ rows, empty }: { rows: NoteRefDTO[]; empty: string }) {
  const { openDoc } = useApp();
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {rows.map((n) => (
        <li key={n.path}>
          <button
            className="flex w-full items-start gap-2 rounded-lg border border-border bg-card p-3 text-left hover:border-border/80 hover:bg-accent/40"
            onClick={() => openDoc(n.path)}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{n.title}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground/70 uppercase">{n.type}</span>
                {n.stale && <AlertTriangle className="size-3 shrink-0 text-chart-4" />}
              </div>
              <div className="truncate text-sm text-muted-foreground">{n.summary}</div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
