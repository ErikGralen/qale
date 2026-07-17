import { useApp } from '../state/app-state';

/**
 * A context chip — the same visual vocabulary as a wikilink (`.note-link`),
 * because a context is memory fiber too. One component everywhere: note
 * headers, list rows, browse facets. Click opens the context page.
 */
export function TagChip({
  tag,
  active,
  onToggle,
}: {
  tag: string;
  /** Facet mode: render as a toggle instead of navigation. */
  active?: boolean;
  onToggle?: () => void;
}) {
  const { openContext } = useApp();
  if (onToggle) {
    return (
      <button
        className={`rounded-sm px-1 py-px text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
          active ? 'bg-brand text-brand-foreground' : 'bg-brand/8 text-brand hover:bg-brand/15'
        }`}
        onClick={onToggle}
        aria-pressed={active}
      >
        #{tag}
      </button>
    );
  }
  return (
    <button
      className="note-link text-xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      onClick={(e) => {
        e.stopPropagation();
        openContext(tag);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        openContext(tag, { preview: false });
      }}
      title={`Open #${tag}`}
    >
      #{tag}
    </button>
  );
}
