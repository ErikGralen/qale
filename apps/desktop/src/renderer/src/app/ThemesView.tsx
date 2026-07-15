import { Badge } from '@pm/ui';
import { Target, Sparkles } from 'lucide-react';
import type { ProblemStance } from '@pm/ipc';
import { useApp } from '../state/app-state';

const STANCES: ProblemStance[] = ['exploring', 'watching', 'committed', 'wont-do'];

const STANCE_STYLE: Record<ProblemStance, string> = {
  exploring: 'bg-chart-2/15 text-chart-2',
  watching: 'bg-brand/12 text-brand',
  committed: 'bg-chart-1/15 text-chart-1',
  'wont-do': 'bg-muted text-muted-foreground',
};

export function ThemesView() {
  const { problems, openNote, setProblemStance } = useApp();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 px-5 text-sm font-medium text-muted-foreground" style={{ WebkitAppRegion: 'drag' } as never}>
        <Target className="size-4" /> Problems by evidence heat
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-4">
        {problems.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            No problems yet. After-Meeting sessions build them from insights.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {problems.map((problem) => (
              <li
                key={problem.path}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => openNote(problem.path)}>
                  <div className="truncate font-medium">{problem.title}</div>
                  <div className="truncate text-sm text-muted-foreground">{problem.summary}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="size-3" />
                    {problem.evidenceCount} insight{problem.evidenceCount === 1 ? '' : 's'}
                    {problem.newest && <span>· newest {problem.newest.slice(0, 10)}</span>}
                  </div>
                </button>
                <select
                  value={problem.stance}
                  onChange={(e) => void setProblemStance(problem.path, e.target.value as ProblemStance)}
                  className={`rounded-md border-0 px-2 py-1 text-xs font-medium capitalize outline-none ${STANCE_STYLE[problem.stance]}`}
                >
                  {STANCES.map((s) => (
                    <option key={s} value={s} className="bg-card text-foreground">
                      {s}
                    </option>
                  ))}
                </select>
                <Badge variant="secondary" className="tabular-nums">
                  {problem.evidenceCount}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
