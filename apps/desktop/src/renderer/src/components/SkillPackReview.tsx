import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import type { SkillPackReviewDTO, SkillUpdateDTO } from '@qale/ipc';
import { Button } from '@qale/ui';
import { invoke } from '../lib/ipc';
import { diffLines, withContext } from '../lib/diff';

/**
 * The one place the starter pack speaks for itself.
 *
 * Skills that came with the app get better between builds, and the ones nobody
 * touched are simply brought up to date without a word. This strip exists for
 * the rest: files the PM edited, which we will never overwrite, and files that
 * stopped shipping, whose edited copies were kept instead of deleted. Quiet by
 * construction: one collapsed line, no badge, no colour, nothing blocking. It
 * is news, not a task.
 */

/** The changed lines, with a little unchanged text around each for bearings. */
function ChangedLines({ update }: { update: SkillUpdateDTO }) {
  const rows = useMemo(() => withContext(diffLines(update.yours, update.ours), 2), [update]);
  return (
    <div className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed">
      {rows.map((r, i) =>
        r.kind === 'gap' ? (
          <div key={i} className="flex items-center gap-2 py-1 select-none" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-muted-foreground">{r.text}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : (
          <div
            key={i}
            className={`rounded-sm px-1 whitespace-pre-wrap [overflow-wrap:anywhere] ${
              r.kind === 'add'
                ? 'bg-success/10 text-foreground'
                : r.kind === 'del'
                  ? 'bg-destructive/8 text-muted-foreground line-through decoration-destructive/40'
                  : 'text-muted-foreground/70'
            }`}
          >
            {r.text || ' '}
          </div>
        ),
      )}
    </div>
  );
}

export function SkillPackReview({ onChanged }: { onChanged: () => void }) {
  const [review, setReview] = useState<SkillPackReviewDTO | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void invoke['skills:review']()
      .then((r) => {
        if (live) setReview(r);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const act = useCallback(
    async (channel: 'skills:applyUpdate' | 'skills:dismissUpdate', file: string) => {
      setBusy(file);
      try {
        setReview(await invoke[channel](file));
        if (channel === 'skills:applyUpdate') onChanged();
      } catch {
        /* the row stays; the next open asks again */
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const count = (review?.updates.length ?? 0) + (review?.retired.length ?? 0);
  if (!review || count === 0) return null;

  // Named by what is actually inside, so the line never promises one thing and
  // opens onto another.
  const heading =
    review.updates.length > 0 && review.retired.length > 0
      ? 'Changes to the skills that came with the app'
      : review.updates.length > 0
        ? review.updates.length === 1
          ? 'One skill you changed has a newer version'
          : `${review.updates.length} skills you changed have newer versions`
        : review.retired.length === 1
          ? 'One skill has stopped running'
          : `${review.retired.length} skills have stopped running`;

  return (
    <section className="mb-4 overflow-hidden rounded-xl bg-card ring-1 ring-border">
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-dense text-foreground">{heading}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{open ? 'Hide' : 'Review'}</span>
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" aria-hidden />
        )}
      </button>

      {open && (
        <div className="flex flex-col divide-y divide-border border-t border-border">
          {review.updates.map((u) => (
            <div key={u.file} className="px-3 py-3">
              <p className="text-sm font-semibold text-foreground">{u.title}</p>
              <p className="mt-0.5 text-dense text-muted-foreground">
                You made this one your own, so we left it alone. Here is what moved in ours:
                highlighted lines are what the new version adds, struck lines are what it drops.
              </p>
              <ChangedLines update={u} />
              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === u.file}
                  onClick={() => void act('skills:dismissUpdate', u.file)}
                >
                  Keep mine
                </Button>
                <Button
                  size="sm"
                  disabled={busy === u.file}
                  onClick={() => void act('skills:applyUpdate', u.file)}
                >
                  Use the new version
                </Button>
                <span className="text-xs text-muted-foreground/70">
                  Using the new one replaces what you wrote.
                </span>
              </div>
            </div>
          ))}

          {review.retired.map((r) => (
            <div key={r.file} className="px-3 py-3">
              <p className="text-sm font-semibold text-foreground">{r.title}</p>
              <p className="mt-0.5 text-dense text-muted-foreground">
                We stopped shipping this one, so it no longer runs. You had changed it, so instead
                of deleting it we kept your version at{' '}
                <span className="font-mono text-foreground/80">{r.keptAt}</span>. Delete that file
                whenever you are done with it.
              </p>
              <div className="mt-2.5">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === r.file}
                  onClick={() => void act('skills:dismissUpdate', r.file)}
                >
                  Got it
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
