import type { ReactNode } from 'react';
import { TITLE_GUTTER } from './FileRow';

/**
 * A heading over one run of file rows: what the run is, and how many rows are
 * in it.
 *
 * The label starts where the titles start, past the row's padding and glyph
 * (see {@link TITLE_GUTTER}), so the heading and the rows under it read as one
 * table. That offset is the row's, which is why it is a constant and not a
 * padding class copied onto every page that groups its rows.
 */
export function ListSection({
  label,
  count,
  children,
}: {
  label: string;
  /** How many rows the section holds. Left out when the count says nothing. */
  count?: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div className={`mb-1 flex items-baseline gap-2 ${TITLE_GUTTER}`}>
        <h2 className="text-xs font-medium text-muted-foreground">{label}</h2>
        {count !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}
