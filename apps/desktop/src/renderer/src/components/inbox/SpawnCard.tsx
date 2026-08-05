import { useEffect, useRef, useState } from 'react';
import { Button } from '@qale/ui';
import { ChevronDown, Users } from 'lucide-react';
import type { SpawnRequestDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';

/**
 * The fan-out approval card (Sessions v2 Part 2) — the only moment the PM steers
 * before money is spent. Inline in the session, same vocabulary as the other
 * approval cards, deliberately **not a modal**: a fan-out is a cheap yes, and a
 * modal would teach the PM to dread it.
 *
 * Three things it gets right on purpose:
 * - **It lists the work, not a target count.** A batch can be heterogeneous, so
 *   "9 targets" is a lie the moment two entries do different things.
 * - **The model picker lives here.** That delivers "run it again with a different
 *   model" as a consequence of the design: re-running is approving a second
 *   spawn with a different pick.
 * - **The brief is expandable, and matters more than the count.** Approving
 *   *what they'll be asked* is the real quality lever, so it is one click away
 *   rather than in your face.
 */
export function SpawnCard({ request }: { request: SpawnRequestDTO }) {
  const { resolveSpawn } = useApp();
  const [modelId, setModelId] = useState(request.defaultModelId);
  const [briefOpen, setBriefOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const approveRef = useRef<HTMLButtonElement>(null);

  // Enter approves, so cheap stays cheap. Focus the approve button rather than
  // binding a global key: the composer is right below, and a stray Enter there
  // must never spend money.
  useEffect(() => {
    approveRef.current?.focus();
  }, []);

  const answer = (approved: boolean) => {
    if (busy) return;
    setBusy(true);
    void resolveSpawn(request, approved ? { approved: true, modelId } : { approved: false });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Users className="size-4 text-muted-foreground" aria-hidden />
        Spawn {request.total} subagent{request.total === 1 ? '' : 's'}?
      </div>

      <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted-foreground">
        {request.entries.map((entry, i) => (
          <li key={i} className="flex gap-1.5">
            <span className="shrink-0 tabular-nums">{entry.count} ×</span>
            <span>{entry.label}</span>
          </li>
        ))}
      </ul>

      {request.brief !== null && (
        <div className="mt-2">
          <button
            className="flex items-center gap-1 rounded-md py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setBriefOpen((o) => !o)}
            aria-expanded={briefOpen}
          >
            <ChevronDown
              className={`size-3 transition-transform motion-reduce:transition-none ${briefOpen ? 'rotate-180' : '-rotate-90'}`}
            />
            brief.md: what they’ll all be told
          </button>
          {briefOpen && (
            <pre className="mt-1 max-h-56 overflow-y-auto rounded-md bg-muted/40 px-2.5 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {request.brief}
            </pre>
          )}
        </div>
      )}
      {request.brief === null && (
        <p className="mt-2 text-xs text-warning">
          No brief.md yet. Each child will read its item with no idea what you already believe, so none
          of them can flag a contradiction. Cancel and ask for a brief first if that matters here.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <label className="text-xs text-muted-foreground" htmlFor={`spawn-model-${request.id}`}>
          model
        </label>
        <select
          id={`spawn-model-${request.id}`}
          className="h-8 min-w-0 max-w-56 flex-1 truncate rounded-md border border-input bg-card px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          disabled={busy || request.models.length === 0}
        >
          {request.models.length === 0 && <option value="">default</option>}
          {request.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => answer(false)} disabled={busy}>
            Cancel
          </Button>
          <Button ref={approveRef} size="sm" onClick={() => answer(true)} disabled={busy}>
            Approve
          </Button>
        </span>
      </div>
    </div>
  );
}
