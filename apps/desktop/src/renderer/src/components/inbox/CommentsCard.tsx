import { useState } from 'react';
import { Button } from '@qale/ui';
import { SquarePen } from 'lucide-react';
import type { AskRequestDTO } from '@qale/ipc';
import { useApp } from '../../state/app-state';

/**
 * The session waiting for the PM to write in a document (the `request_comments`
 * tool, docs/brainstorm-skill.md). Its sibling is the QuestionCard, and it wears
 * the same parked-run ring for the same reason: the turn is alive, holding
 * everything it has read, and nothing in this session moves until this settles.
 *
 * What it deliberately does NOT do is take the comments. Answering happens in
 * the round file, where each box sits under the paragraph it is about — that is
 * the whole point of this shape, and a card that copied the boxes up here would
 * be a form asking about text you cannot see. So the card carries one move
 * (open the document) and the exit that was always there (skip).
 */
export function CommentsCard({ request }: { request: AskRequestDTO }) {
  const { openSessionFile, resolveAsk } = useApp();
  const [busy, setBusy] = useState(false);
  const round = request.comments;
  if (!round) return null;
  const name = round.path.slice(round.path.lastIndexOf('/') + 1);
  const places = round.slots.length;

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-brand/30">
      {/* Same banner geometry as the question card: both are the moment a
          session hands control back and stops. */}
      <div className="flex items-center gap-2 border-b border-brand/20 bg-brand/6 px-3.5 py-2 text-xs">
        <SquarePen className="size-3.5 shrink-0 text-brand" aria-hidden />
        <span className="font-medium text-foreground">Waiting on you</span>
        <span className="min-w-0 truncate text-muted-foreground">
          the session is paused until you send this back
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-body leading-snug text-pretty">
          <span className="font-medium text-foreground">Fill out {name}</span>
        </p>
        <p className="mt-0.5 text-dense leading-snug text-muted-foreground">
          It left {places} place{places === 1 ? '' : 's'} for you to write in, and a box at the
          bottom for anything else. Say what you think in your own words, then send it back.
        </p>
      </div>

      <div className="flex items-center gap-2 border-t border-border/60 px-3.5 py-2.5">
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title="Leave this round to the agent: it carries on and says what it assumed"
            onClick={() => {
              if (busy) return;
              setBusy(true);
              void resolveAsk(request, null);
            }}
          >
            Skip
          </Button>
          {/* A tab of its own, in front: the session stays where it is, so
              coming back to it after Send is a click rather than a hunt. */}
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              openSessionFile(request.sessionId, round.path, { newTab: true, foreground: true })
            }
          >
            Open {name}
          </Button>
        </span>
      </div>
    </div>
  );
}
