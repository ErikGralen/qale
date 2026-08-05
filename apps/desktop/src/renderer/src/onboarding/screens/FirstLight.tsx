import { Button } from '@qale/ui';
import { FileUp } from 'lucide-react';
import { requestCapture } from '../../lib/capture-event';
import { useApp } from '../../state/app-state';
import { Screen, SkipLink } from '../Opening';

/**
 * Screen 7 (ONB-7). The last screen, and not a form.
 *
 * No example week, no sample vault, no fake meetings: the workspace starts
 * empty and everything in it will be the PM's own. So this screen has exactly
 * one job — get one real piece of material in — and the payoff is their own
 * first meeting being read rather than a demo of someone else's.
 *
 * That is slower than a populated workspace and it is the only version that
 * convinces anyone. It also puts all the weight on the moment after the drop,
 * which is why the handoff line (ONB-9) exists.
 */
export function FirstLight({ onFinish }: { onFinish: () => void }) {
  const { settings } = useApp();
  /** Someone who connected a calendar is not landing on an empty app at all. */
  const hasCalendar = settings?.onboarding.connections.google === 'following';

  const dropSomething = () => {
    // Close the opening first: the capture tray is part of the app, and the
    // last thing that happens in setup should be the app doing its job.
    onFinish();
    requestCapture();
  };

  return (
    <Screen
      title="Give it something to read"
      why="A transcript from a meeting this week, or notes you took in one. It files what is there and proposes the follow-ups as cards you approve."
      footer={
        <>
          <Button data-opening-primary size="lg" onClick={dropSomething}>
            <FileUp className="size-4" aria-hidden />
            Add something now
          </Button>
          <SkipLink onClick={onFinish}>
            {hasCalendar ? 'Later, my calendar is in' : 'Start empty'}
          </SkipLink>
        </>
      }
    >
      <div className="space-y-3 text-body text-muted-foreground">
        <p>
          Your workspace is empty and everything that lands in it will be yours. There is no sample
          data to clear out later.
        </p>
        {hasCalendar ? (
          <p>
            Your week is already on its way in from the calendar you connected, so there will be
            something here either way.
          </p>
        ) : (
          <p>
            Anything readable works: a .txt, .md or .vtt export, a pasted wall of text, a
            screenshot. You can also drop files anywhere in the window later.
          </p>
        )}
      </div>
    </Screen>
  );
}
