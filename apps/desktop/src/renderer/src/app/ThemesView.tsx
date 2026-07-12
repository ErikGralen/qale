import { Badge } from '@pm/ui';
import { Lightbulb, Radio } from 'lucide-react';
import type { ThemeStance } from '@pm/ipc';
import { useApp } from '../state/app-state';

const STANCES: ThemeStance[] = ['exploring', 'watching', 'committed', 'wont-do'];

const STANCE_STYLE: Record<ThemeStance, string> = {
  exploring: 'bg-chart-2/15 text-chart-2',
  watching: 'bg-brand/12 text-brand',
  committed: 'bg-chart-1/15 text-chart-1',
  'wont-do': 'bg-muted text-muted-foreground',
};

export function ThemesView() {
  const { themes, openNote, setThemeStance } = useApp();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 px-5 text-sm font-medium text-muted-foreground" style={{ WebkitAppRegion: 'drag' } as never}>
        <Lightbulb className="size-4" /> Themes by evidence heat
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-4">
        {themes.length === 0 ? (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            No themes yet. Run triage on your signals to build them.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {themes.map((theme) => (
              <li
                key={theme.path}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
              >
                <button className="min-w-0 flex-1 text-left" onClick={() => openNote(theme.path)}>
                  <div className="truncate font-medium">{theme.title}</div>
                  <div className="truncate text-sm text-muted-foreground">{theme.summary}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Radio className="size-3" />
                    {theme.evidenceCount} signal{theme.evidenceCount === 1 ? '' : 's'}
                    {theme.newest && <span>· newest {theme.newest.slice(0, 10)}</span>}
                  </div>
                </button>
                <select
                  value={theme.stance}
                  onChange={(e) => void setThemeStance(theme.path, e.target.value as ThemeStance)}
                  className={`rounded-md border-0 px-2 py-1 text-xs font-medium capitalize outline-none ${STANCE_STYLE[theme.stance]}`}
                >
                  {STANCES.map((s) => (
                    <option key={s} value={s} className="bg-card text-foreground">
                      {s}
                    </option>
                  ))}
                </select>
                <Badge variant="secondary" className="tabular-nums">
                  {theme.evidenceCount}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
