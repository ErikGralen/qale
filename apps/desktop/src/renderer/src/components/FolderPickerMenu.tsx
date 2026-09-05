import { useEffect, useState, type ReactNode } from 'react';
import { Folder, FolderPlus, Inbox } from 'lucide-react';
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
import type { DocumentFolder } from '../lib/documents';

/**
 * The Documents page's folder picker: an anchored cmdk menu, the SkillPicker
 * pattern. It answers one question, "where should this go?", so the rows are
 * the whole tree: "Documents" for the top level, then every folder indented by
 * depth. Type to filter, ↑↓ to move, ↵ to pick, Escape to close.
 *
 * A folder the caller excludes (the one the documents already sit in) stays
 * visible but is not pickable. Hiding it would make the tree look wrong; a
 * disabled row says "you are here".
 *
 * When `onCreate` is set and the typed text names no existing folder, the list
 * ends with a "New folder" row. That keeps making a folder inside the same
 * gesture as picking one.
 */

/** Row values the folders can never collide with: keys hold no leading "*". */
const TOP_VALUE = '*top';
const CREATE_VALUE = '*create';

export function FolderPickerMenu({
  folders,
  exclude,
  onPick,
  onCreate,
  open,
  onOpenChange,
  onClosed,
  children,
}: {
  /** Every folder, parent before child. */
  folders: DocumentFolder[];
  /** Folder keys to show but not pick. '' disables the top level. */
  exclude?: string[];
  /** '' is the top level (Documents). */
  onPick: (folderKey: string) => void;
  /** When set, typed text that names no folder offers a "New folder" row. */
  onCreate?: (name: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Hand focus somewhere useful when the menu closes. */
  onClosed?: () => void;
  /** The trigger the menu anchors to. */
  children: ReactNode;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = q ? folders.filter((f) => f.key.toLowerCase().includes(q)) : folders;
  const showTop = !q || 'documents'.includes(q);
  // Exact name or full path already taken? Then there is nothing to create.
  const taken = folders.some((f) => f.name.toLowerCase() === q || f.key.toLowerCase() === q);
  const showCreate = Boolean(onCreate) && q.length > 0 && !taken;
  const disabled = (key: string) => exclude?.includes(key) ?? false;

  const pick = (key: string) => {
    onPick(key);
    onOpenChange(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-72 overflow-hidden p-0 shadow-lg"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed?.();
        }}
      >
        <Command shouldFilter={false} className="rounded-none! bg-transparent p-0">
          <CommandInput
            bare
            placeholder="Move to folder…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-80 p-1.5">
            {!showCreate && (
              <CommandEmpty className="px-2 py-6 text-center text-sm text-muted-foreground">
                No folder matches “{query.trim()}”.
              </CommandEmpty>
            )}
            {showTop && (
              <CommandItem
                value={TOP_VALUE}
                disabled={disabled('')}
                onSelect={() => pick('')}
                className="h-8 cursor-pointer gap-2 rounded-md px-2.5 py-0 data-[selected=true]:bg-accent"
              >
                <Inbox className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium">Documents</span>
              </CommandItem>
            )}
            {matches.map((folder) => (
              <CommandItem
                key={folder.key}
                value={folder.key}
                disabled={disabled(folder.key)}
                onSelect={() => pick(folder.key)}
                className="h-8 cursor-pointer gap-2 rounded-md px-2.5 py-0 data-[selected=true]:bg-accent"
              >
                {/* The indent keeps the parent-child shape readable while
                    filtered rows still show their own name only. */}
                <span
                  className="shrink-0"
                  style={{ width: `${folder.depth * 14}px` }}
                  aria-hidden
                />
                <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              </CommandItem>
            ))}
            {showCreate && (
              <CommandItem
                value={CREATE_VALUE}
                onSelect={() => {
                  onCreate?.(query.trim());
                  onOpenChange(false);
                }}
                className="h-8 cursor-pointer gap-2 rounded-md px-2.5 py-0 data-[selected=true]:bg-accent"
              >
                <FolderPlus className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  New folder: <span className="font-medium">{query.trim()}</span>
                </span>
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
