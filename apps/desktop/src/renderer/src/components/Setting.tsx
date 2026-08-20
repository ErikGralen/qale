import type { ReactNode } from 'react';

/**
 * The three pieces every Settings tab is built from. They live here rather than
 * inside SettingsView because Connections is its own file and has to set in the
 * same rhythm as the panels beside it — one vocabulary, wherever a setting is
 * shown.
 */

/** A tab's contents: settings stacked, each divided from the next by a hairline. */
export function SettingPanel({ children }: { children: ReactNode }) {
  return <div className="flex flex-col divide-y divide-border">{children}</div>;
}

/**
 * One setting. Its name and what it does on the left, and the control either
 * beside the name (`control`, for the small ones that fit on a line) or under
 * the copy (`children`, for the ones that don't).
 *
 * The description is a paragraph, not a footnote: this app's settings decide
 * what leaves the machine, so the sentence that says so gets read at body size
 * and capped at a readable measure.
 */
export function Setting({
  title,
  description,
  badge,
  control,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** State the title carries with it: "set", "running", the version number. */
  badge?: ReactNode;
  /** A control small enough to sit on the title's line. */
  control?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="space-y-3 py-5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">{title}</h2>
            {badge}
          </div>
          {description && (
            <div className="max-w-[68ch] space-y-1.5 text-sm text-muted-foreground">
              {typeof description === 'string' ? <p>{description}</p> : description}
            </div>
          )}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children}
    </section>
  );
}

/** The amber voice: something here is not right, said in words, never in colour alone. */
export function SettingNotice({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-warning/10 px-2.5 py-2 text-sm text-warning">{children}</p>;
}
