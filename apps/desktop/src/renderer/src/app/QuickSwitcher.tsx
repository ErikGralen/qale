import { useEffect, useState } from 'react';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@pm/ui';
import type { SearchHitDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';

/** ⌘K quick switcher — backed by the FTS5 index over IPC (no second search engine). */
export function QuickSwitcher({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { search, openNote } = useApp();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHitDTO[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const results = await search(query);
      if (alive) setHits(results);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, search]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search the vault…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{query ? 'No matches.' : 'Type to search notes.'}</CommandEmpty>
          {hits.length > 0 && (
            <CommandGroup heading="Notes">
              {hits.map((h) => (
                <CommandItem
                  key={h.path}
                  value={h.path}
                  onSelect={() => {
                    onOpenChange(false);
                    void openNote(h.path);
                  }}
                >
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{h.title}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {h.type} · {h.summary}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
