import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Spinner } from '@qale/ui';
import { BookOpen, CalendarDays, Ticket } from 'lucide-react';
import {
  connections,
  type ConnectionContainerDTO,
  type ConnectionDTO,
  type ContainerRecommendationDTO,
} from '../lib/connections';

/**
 * "These look like where you work" (docs/product-understanding.md FL-2).
 *
 * The one component both frames use, onboarding and Settings, for the question
 * that decides whether the memory reads anything at all. It replaced a flat
 * alphabetical list of every project and space on the site: somebody with forty
 * spaces cannot answer that question from memory, and the honest fix is to look
 * before asking. The survey (FL-1) says where they actually work, so the card
 * puts those on top, ticked, each with the one line that makes it checkable.
 *
 * Three rules hold the whole thing up:
 *
 * - **Every recommendation carries its reason.** A ticked box with no reason
 *   beside it is a guess wearing a checkmark.
 * - **Nothing is followed until the confirm is pressed.** Ticking is not
 *   following; the writes happen in one gesture the person made on purpose.
 * - **No survey, no recommendation.** A failed survey and a brand-new hire with
 *   no footprint both land on today's flat list, with nothing said about it.
 *   Silence is right here: "we tried to work out where you work and could not"
 *   is our problem, not theirs.
 */

/**
 * Survey answers for this app run, by connection. The survey costs real
 * requests against the person's own rate limit, and reopening the picker is not
 * new information — the catalogue moves on a weekly cadence at most (FL-3).
 */
const surveyCache = new Map<string, ContainerRecommendationDTO[]>();

export interface FollowPickerProps {
  conn: ConnectionDTO;
  /** Re-read the connection list after the follows were written. */
  onChanged: () => Promise<void>;
  /** The picker is finished with (confirmed). */
  onDone?: () => void;
}

export function FollowPicker({ conn, onChanged, onDone }: FollowPickerProps) {
  const [recommended, setRecommended] = useState<ContainerRecommendationDTO[] | null>(
    () => surveyCache.get(conn.id) ?? null,
  );
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [showRest, setShowRest] = useState(false);
  const [saving, setSaving] = useState(false);

  const containers = conn.containers;

  useEffect(() => {
    let live = true;
    const cached = surveyCache.get(conn.id);
    if (cached) {
      setRecommended(cached);
      return;
    }
    void connections.recommend(conn.id).then((rows) => {
      surveyCache.set(conn.id, rows);
      if (live) setRecommended(rows);
    });
    return () => {
      live = false;
    };
  }, [conn.id]);

  /** Recommended rows first, in the survey's order; everything else after. */
  const { top, rest } = useMemo(() => {
    const byId = new Map(containers.map((c) => [c.id, c]));
    const reasons = new Map((recommended ?? []).map((r) => [r.id, r.reason]));
    const top: { container: ConnectionContainerDTO; reason: string }[] = [];
    for (const rec of recommended ?? []) {
      const container = byId.get(rec.id);
      if (container) top.push({ container, reason: rec.reason });
    }
    return { top, rest: containers.filter((c) => !reasons.has(c.id)) };
  }, [containers, recommended]);

  /**
   * Recommended boxes start ticked, everything else starts as it is. Keyed off
   * the survey landing rather than set once, because the list arrives after the
   * first render.
   */
  useEffect(() => {
    if (recommended === null) return;
    const suggested = new Set(recommended.map((r) => r.id));
    setTicked(Object.fromEntries(containers.map((c) => [c.id, c.followed || suggested.has(c.id)])));
  }, [recommended, containers]);

  const chosen = containers.filter((c) => ticked[c.id]);

  const confirm = useCallback(async () => {
    setSaving(true);
    try {
      // Only what actually changed: re-following something already followed
      // would kick off a sync tick for nothing.
      for (const c of containers) {
        const want = !!ticked[c.id];
        if (want !== c.followed) await connections.setFollow(conn.id, c.id, want);
      }
      await onChanged();
      onDone?.();
    } finally {
      setSaving(false);
    }
  }, [containers, ticked, conn.id, onChanged, onDone]);

  if (containers.length === 0) return null;

  // The survey is a network round-trip. One quiet line rather than a spinner
  // over the list: the list is not what people are waiting for.
  if (recommended === null) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-3 text-sm text-muted-foreground">
        <Spinner className="size-3.5" /> Taking a look at where you work…
      </div>
    );
  }

  const hasRecommendations = top.length > 0;

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <span className="text-dense font-medium text-muted-foreground">
        {hasRecommendations ? 'These look like where you work' : 'Which of these should it watch?'}
      </span>
      {/* What "watch" means, said where the word is used (clarity review
          area 7). The contract in two sentences; everything else about the
          choice already sits on the rows and the confirm. */}
      <p className="mt-0.5 text-xs text-muted-foreground">
        Watched things are read on a schedule and kept current as notes in your workspace. You can
        change this list any time in Settings.
      </p>

      {hasRecommendations && (
        <ul className="mt-1.5 flex flex-col">
          {top.map(({ container, reason }) => (
            <ContainerRow
              key={container.id}
              container={container}
              reason={reason}
              checked={!!ticked[container.id]}
              onToggle={() => setTicked((t) => ({ ...t, [container.id]: !t[container.id] }))}
            />
          ))}
        </ul>
      )}

      {rest.length > 0 &&
        (showRest || !hasRecommendations ? (
          <ul className="mt-1.5 flex max-h-52 flex-col overflow-y-auto">
            {rest.map((container) => (
              <ContainerRow
                key={container.id}
                container={container}
                checked={!!ticked[container.id]}
                onToggle={() => setTicked((t) => ({ ...t, [container.id]: !t[container.id] }))}
              />
            ))}
          </ul>
        ) : (
          <button
            className="mt-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => setShowRest(true)}
          >
            {restLabel(rest)}
          </button>
        ))}

      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" disabled={saving} onClick={() => void confirm()}>
          {saving ? (
            <>
              <Spinner className="size-3.5" /> Saving…
            </>
          ) : chosen.length > 0 ? (
            'Start reading these'
          ) : (
            'Done'
          )}
        </Button>
        <span className="text-xs text-muted-foreground">
          {chosen.length === 0
            ? 'Pick at least one, or it reads nothing'
            : 'Nothing is read until you press this'}
        </span>
      </div>
    </div>
  );
}

function ContainerRow({
  container,
  reason,
  checked,
  onToggle,
}: {
  container: ConnectionContainerDTO;
  reason?: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const Icon =
    container.kind === 'ticket' ? Ticket : container.kind === 'calendar' ? CalendarDays : BookOpen;
  return (
    <li>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5 hover:bg-accent/60">
        <input type="checkbox" className="mt-1" checked={checked} onChange={onToggle} />
        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{container.name}</span>
          {reason && <span className="block truncate text-xs text-muted-foreground">{reason}</span>}
        </span>
      </label>
    </li>
  );
}

/** "14 more spaces" — named by what they are, so the line is worth clicking. */
function restLabel(rest: ConnectionContainerDTO[]): string {
  const kinds = new Set(rest.map((c) => c.kind));
  const word =
    kinds.size > 1
      ? 'others'
      : kinds.has('ticket')
        ? rest.length === 1
          ? 'project'
          : 'projects'
        : kinds.has('calendar')
          ? rest.length === 1
            ? 'calendar'
            : 'calendars'
          : rest.length === 1
            ? 'space'
            : 'spaces';
  return `${rest.length} more ${word}`;
}
