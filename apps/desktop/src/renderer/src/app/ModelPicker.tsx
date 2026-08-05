import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@qale/ui';
import type { ModelInfoDTO } from '@qale/ipc';
import { invoke } from '../lib/ipc';

/**
 * The composer's model picker. Settings names the model new sessions open on;
 * this moves ONE session off it, and the choice sticks to that session, so
 * reopening it next week does not quietly put it back.
 *
 * Deliberately the quietest control on the strip: muted, small, and it earns its
 * space by saying which model you are on, which nothing else in the app did. A
 * session started from Home, the ⌘K switcher, a skill picker or a note's side
 * panel all end up in this same composer, so one control covers every door in.
 * Runs a clock started have no composer at all, and fall back to the default.
 *
 * The pick is carried by the next message (the same road the picked skill
 * takes), which is also what makes it honest: a model change cannot reach back
 * into replies that already happened, and the menu says so rather than leaving
 * the PM to guess.
 */
export function ModelPicker({
  pinned,
  onPick,
  onClosed,
  disabled,
}: {
  /** The model this session was moved to, or null when it follows Settings. */
  pinned: string | null;
  onPick: (modelId: string) => void;
  /** Hand focus back to the composer when the menu closes. */
  onClosed?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelInfoDTO[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** cmdk's highlighted row. Null until the PM moves, so the menu opens on the
   *  model in force rather than on whatever sorts first. */
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([invoke['models:list'](), invoke['settings:get']()])
      .then(([list, settings]) => {
        if (cancelled) return;
        setModels(list);
        setDefaultId(settings.modelId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive(null);
    }
  }, [open]);

  // Nothing to choose between is nothing to show.
  if (models.length < 2) return null;

  const currentId = pinned ?? defaultId;
  const current = models.find((m) => m.id === currentId);
  const matches = filterModels(models, query);

  return (
    <Popover open={open} onOpenChange={disabled ? () => undefined : setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex h-7 shrink-0 items-center gap-1 rounded-md pr-1.5 pl-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          disabled={disabled}
          title={`${current?.label ?? currentId ?? 'Model'} answers in this session. Pick another for this session on its own.`}
          aria-label={`Model: ${current?.label ?? currentId ?? 'default'}. Change it for this session`}
        >
          <span className="max-w-28 truncate">{shortLabel(current?.label ?? currentId)}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-72 overflow-hidden p-0 shadow-lg"
        onCloseAutoFocus={(e) => {
          // The PM was mid-sentence; the composer gets focus back, not the trigger.
          e.preventDefault();
          onClosed?.();
        }}
      >
        {/* Opens on the model you are already on, which is also what scrolls it
            into view: the list runs to fifteen rows and the one that matters
            would otherwise be below the fold. */}
        <Command
          shouldFilter={false}
          className="rounded-none! bg-transparent p-0"
          value={active ?? currentId ?? ''}
          onValueChange={setActive}
        >
          <CommandInput bare placeholder="Search models…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-80 p-1.5">
            <CommandEmpty className="px-2 py-6 text-center text-sm text-muted-foreground">
              No model matches “{query.trim()}”.
            </CommandEmpty>
            {matches.map((model) => (
              <CommandItem
                key={model.id}
                value={model.id}
                onSelect={() => {
                  onPick(model.id);
                  setOpen(false);
                }}
                data-checked={model.id === currentId || undefined}
                className="h-8 cursor-pointer gap-2 rounded-md px-2.5 py-0 data-[checked=true]:text-brand data-[selected=true]:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate font-medium">{model.label}</span>
                {model.id === defaultId && (
                  <span className="shrink-0 text-xs text-muted-foreground">default</span>
                )}
              </CommandItem>
            ))}
          </CommandList>
          {/* When it takes effect, said plainly. A model change cannot rewrite
              what the session already answered, and the menu is the only place
              that moment is in front of the PM. */}
          <div className="border-t border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">
              Applies to your next message. Nothing already here changes.
            </p>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Claude Opus 5" → "Opus 5". The control strip has room for the part that
 * differs and no room for the part that never does; the full name is one hover
 * (and one click) away.
 */
function shortLabel(label: string | null | undefined): string {
  if (!label) return 'Model';
  return label.replace(/^Claude\s+/i, '').replace(/\s*\(latest\)$/i, '');
}

function filterModels(models: ModelInfoDTO[], query: string): ModelInfoDTO[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter((m) => `${m.label} ${m.id}`.toLowerCase().includes(q));
}
