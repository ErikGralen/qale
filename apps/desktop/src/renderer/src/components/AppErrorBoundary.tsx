import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@qale/ui';

/** Open tabs, restored on the next launch. Cleared by "Start with fresh tabs". */
const TABS_KEY = 'qale.tabs.v3';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * The last stop for a renderer error. Without one, React unmounts the whole
 * tree and the window goes white with nothing on it: no message, no way back,
 * and no clue for the person looking at it. Worse, the tabs are restored from
 * localStorage, so a tab that throws throws again on every launch and the app
 * looks dead for good.
 *
 * So this page says what happened and offers the two ways out: reload, or
 * reload with the open tabs dropped. Dropping the tabs costs a few open pages
 * and nothing else, because tabs are view state — the notes are files on disk.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[qale] renderer error', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen items-center justify-center bg-background p-8">
        <div className="max-w-md">
          <h1 className="mb-2 font-serif text-2xl font-semibold tracking-tight">
            Something broke on this page
          </h1>
          <p className="mb-4 text-sm text-muted-foreground">
            Your notes are safe. They are files on disk, and nothing here writes to them. Reload to
            try again. If the same page keeps breaking, reload without the open tabs.
          </p>
          <pre className="mb-5 max-h-40 overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {error.message || String(error)}
          </pre>
          <div className="flex items-center gap-2">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button
              variant="secondary"
              onClick={() => {
                try {
                  localStorage.removeItem(TABS_KEY);
                } catch {
                  /* reload anyway — a blocked write is not a reason to stay stuck */
                }
                window.location.reload();
              }}
            >
              Start with fresh tabs
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
