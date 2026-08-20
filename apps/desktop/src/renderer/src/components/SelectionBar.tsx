import { useMemo, useState } from 'react';
import { Check, Hash, Minus, Pin, PinOff, Trash2, X } from 'lucide-react';
import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Spinner,
} from '@qale/ui';
import { useApp } from '../state/app-state';
import { useToast } from './toast';
import type { Selection } from '../lib/selection';

/**
 * What a selection can have done to it — the strip that appears under the page
 * header the moment a row is ticked, and leaves when the last one is.
 *
 * The three actions are the ones that are the same job repeated: pin a batch to
 * the rail, file a batch into a context, throw a batch away. Anything that
 * needs judgment per note (approving, superseding, retitling) stays on the note
 * page where the judgment is made. Nothing here writes a note's body.
 *
 * Delete confirms in place, in the same words and the same red as the note
 * page's own delete, because it is the same act at scale.
 */
export function SelectionBar({ selection, total }: { selection: Selection; total: number }) {
  const { favorites, toggleFavorite, deleteNotes } = useApp();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const { paths, count } = selection;
  const allPinned = count > 0 && paths.every((p) => favorites.includes(p));
  const noun = count === 1 ? 'note' : 'notes';

  if (count === 0) return null;

  const pin = () => {
    // Uniform, not per-row: the button says one thing, so it does one thing to
    // every selected note. Rows already in that state are left alone.
    for (const p of paths) if (favorites.includes(p) === allPinned) toggleFavorite(p);
  };

  const remove = async () => {
    setBusy(true);
    const { failed } = await deleteNotes(paths);
    setBusy(false);
    setConfirmDelete(false);
    if (failed.length > 0)
      toast(`${failed.length} of ${count} ${noun} could not be deleted: ${failed.join(', ')}`);
  };

  return (
    <div className="shrink-0 border-b border-border/70 bg-brand/5 px-4 py-1.5">
      <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium tabular-nums">
          {count} selected
          {busy && <Spinner className="ml-2 inline size-3.5 align-[-2px]" />}
        </span>
        {!selection.all && (
          <button
            className="rounded px-1 text-xs font-medium text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={selection.selectAll}
          >
            Select all {total}
          </button>
        )}

        {confirmDelete ? (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Delete {count} {noun}?
            </span>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-0.5">
            <BarAction
              icon={allPinned ? PinOff : Pin}
              label={allPinned ? 'Unpin' : 'Pin'}
              title={
                allPinned
                  ? `Take these ${count} off the sidebar`
                  : `Keep these ${count} on the sidebar`
              }
              onClick={pin}
              disabled={busy}
            />
            <TagAction selection={selection} busy={busy} setBusy={setBusy} />
            <BarAction
              icon={Trash2}
              label="Delete"
              title={`Delete ${count} ${noun}`}
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              danger
            />
            <BarAction
              icon={X}
              label="Clear"
              title="Clear the selection (Esc)"
              onClick={selection.clear}
              disabled={busy}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BarAction({
  icon: Icon,
  label,
  title,
  onClick,
  disabled,
  danger,
}: {
  icon: typeof Pin;
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      className={`flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 ${
        danger
          ? 'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
    </button>
  );
}

/** A tag across a selection is on all of it, some of it, or none of it. */
type TagState = 'all' | 'some' | 'none';

/**
 * Filing the selection into a context. The menu is the app's one search-and-run
 * vocabulary again (cmdk: type to filter, ↑↓, ↵), and it stays open after a
 * pick so filing into two contexts is two keystrokes rather than two menus.
 *
 * A tag every selected note already carries reads as checked, and picking it
 * takes it off all of them: one row, both directions, the way the same chip
 * behaves everywhere else in the app.
 */
function TagAction({
  selection,
  busy,
  setBusy,
}: {
  selection: Selection;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}) {
  const { tree, tagNotes } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const picked = useMemo(() => new Set(selection.paths), [selection.paths]);

  // The vault's whole tag vocabulary, commonest first, with what the selection
  // already carries. Both come from the one tree the page is rendered from.
  const { vocabulary, state } = useMemo(() => {
    const freq = new Map<string, number>();
    const onSelected = new Map<string, number>();
    for (const g of tree?.groups ?? [])
      for (const n of g.notes)
        for (const t of n.tags ?? []) {
          freq.set(t, (freq.get(t) ?? 0) + 1);
          if (picked.has(n.path)) onSelected.set(t, (onSelected.get(t) ?? 0) + 1);
        }
    const vocab = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t);
    const st = new Map<string, TagState>();
    for (const t of vocab) {
      const on = onSelected.get(t) ?? 0;
      st.set(t, on === 0 ? 'none' : on === picked.size ? 'all' : 'some');
    }
    return { vocabulary: vocab, state: st };
  }, [tree, picked]);

  // Same shaping as the properties editor's tag field, so a tag typed here and
  // a tag typed there are the same tag.
  const typed = query.trim().toLowerCase().replace(/\s+/g, '-');
  const matches = vocabulary.filter((t) => t.includes(typed));
  const novel = typed !== '' && !vocabulary.includes(typed);

  const apply = async (tag: string) => {
    const removing = state.get(tag) === 'all';
    setBusy(true);
    const { failed } = await tagNotes(
      selection.paths,
      removing ? { remove: [tag] } : { add: [tag] },
    );
    setBusy(false);
    setQuery('');
    if (failed.length > 0)
      toast(
        `${failed.length} of ${selection.count} notes could not be ${removing ? 'untagged' : 'tagged'}: ${failed.join(', ')}`,
      );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          disabled={busy}
          title={`Put these ${selection.count} in a context`}
        >
          <Hash className="size-3.5" aria-hidden />
          Tag
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-64 overflow-hidden p-0 shadow-lg">
        <Command shouldFilter={false} className="rounded-none! bg-transparent p-0">
          <CommandInput
            bare
            placeholder="Context…"
            value={query}
            onValueChange={setQuery}
            autoFocus
          />
          <CommandList className="max-h-72 p-1.5">
            <CommandEmpty className="px-2 py-6 text-center text-sm text-muted-foreground">
              Type a name to make a context.
            </CommandEmpty>
            {novel && (
              <CommandItem
                value={`__new__${typed}`}
                onSelect={() => void apply(typed)}
                className="h-8 cursor-pointer gap-2 rounded-md px-2.5 py-0 data-[selected=true]:bg-accent"
              >
                <Hash className="size-3.5 shrink-0 text-brand" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  New context <span className="font-medium text-brand">#{typed}</span>
                </span>
              </CommandItem>
            )}
            {matches.map((t) => {
              const st = state.get(t) ?? 'none';
              return (
                <CommandItem
                  key={t}
                  value={t}
                  onSelect={() => void apply(t)}
                  className="h-8 cursor-pointer gap-2 rounded-md px-2.5 py-0 data-[selected=true]:bg-accent"
                >
                  <span className="flex size-3.5 shrink-0 items-center justify-center text-brand">
                    {st === 'all' && <Check className="size-3.5" aria-hidden />}
                    {st === 'some' && <Minus className="size-3.5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">#{t}</span>
                  {st === 'some' && (
                    <span className="shrink-0 text-xs text-muted-foreground">some</span>
                  )}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
