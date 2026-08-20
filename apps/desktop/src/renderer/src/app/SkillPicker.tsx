import { useEffect, useState } from 'react';
import { TriangleAlert, Wand2, X } from 'lucide-react';
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
import type { SkillDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';

/**
 * The composer's skill picker (Sessions v2 Part 3.2). Session types stopped
 * being rooms you get locked in: a skill ARRIVES, and this is the PM saying
 * which one. Picking "Find the pattern" mid-session is the same code path
 * as the agent calling `use_skill` — a different caller, nothing else.
 *
 * The pick applies to the NEXT message and then clears. A skill that stuck to
 * the composer would be a mode by another name, which is the thing we removed.
 *
 * Anchored menu, not a centered dialog: the pick is made mid-sentence, so the
 * question already in the composer stays on screen. The internals are the ⌘K
 * vocabulary (cmdk: type to filter, ↑↓, ↵) — one search-and-run instrument in
 * the app, not two.
 *
 * A row is its title (plus a flag when the file is broken). The titles ARE the
 * description ("Prep a meeting", "Write the weekly update"); a second line
 * under each only made the list ragged and slow to scan. Instead the menu ends
 * in a fixed-height strip that prints the HIGHLIGHTED skill's summary — the
 * sentence follows the keyboard cursor, so it is never hover-only. The full
 * story stays one click away in the Skills view, and nothing a skill produces
 * reaches the world without an approval card.
 */

/**
 * Only playbooks are offered here — they are the skills that exist to be run.
 * Always-on rules are already in force in every session, and reference is the
 * agent's to reach for (`use_skill`); listing either would make picking it a
 * silent no-op.
 */
export function SkillPicker({
  picked,
  onPick,
  onClosed,
  disabled,
  open,
  onOpenChange,
}: {
  /** The picked skill's invocation name, or null. */
  picked: string | null;
  onPick: (name: string | null) => void;
  /** Hand focus back to the composer when the menu closes. */
  onClosed?: () => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { skills } = useApp();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('');
  const invocable = skills
    .filter((s) => s.starts.some((x) => x.kind === 'you-run-it'))
    // Alphabetical, except a skill that needs fixing sinks — it stays offered
    // (hiding it would be the silent failure the Skills view exists to prevent)
    // but it never gets to be the second thing you read.
    .sort(
      (a, b) =>
        Number(a.errors.length > 0) - Number(b.errors.length > 0) || a.title.localeCompare(b.title),
    );

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActive('');
    }
  }, [open]);

  if (invocable.length === 0) return null;

  const pickedSkill = picked ? invocable.find((s) => s.name === picked) : undefined;
  const matches = filterSkills(invocable, query);
  const activeSkill = matches.find((s) => s.name === active) ?? matches[0];

  return (
    <Popover open={open} onOpenChange={disabled ? () => undefined : onOpenChange}>
      {/* Picked: a chip that still opens the menu (so switching is one click,
          not drop-then-reopen), with its own × to drop the skill entirely. */}
      {picked ? (
        <div className="flex h-7 shrink-0 items-center rounded-md bg-brand/10 text-brand">
          <PopoverTrigger asChild>
            <button
              className="flex h-7 min-w-0 items-center gap-1.5 rounded-l-md pr-1 pl-2 text-xs font-medium hover:bg-brand/10 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              title={`${pickedSkill?.summary ?? picked} (click to swap it)`}
              aria-label={`Skill: ${pickedSkill?.title ?? picked}. Change it`}
            >
              <Wand2 className="size-3.5 shrink-0" aria-hidden />
              <span className="max-w-40 truncate">{pickedSkill?.title ?? picked}</span>
            </button>
          </PopoverTrigger>
          <button
            className="flex h-7 items-center rounded-r-md pr-1.5 pl-0.5 opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => {
              onPick(null);
              onClosed?.();
            }}
            aria-label="Drop this skill"
            title="Drop this skill"
          >
            <X className="size-3.5 shrink-0" aria-hidden />
          </button>
        </div>
      ) : (
        <PopoverTrigger asChild>
          {/* Idle, the trigger carries its own word. A lone wand on an empty
              control strip is mystery meat, and "Skill" is the vocabulary the
              placeholder used to spend a parenthetical on. */}
          <button
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-md pr-2 pl-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
            disabled={disabled}
            aria-label="Bring in a skill"
            title="Bring in a skill (/)"
          >
            <Wand2 className="size-3.5" aria-hidden />
            Skill
          </button>
        </PopoverTrigger>
      )}

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-72 overflow-hidden p-0 shadow-lg"
        onCloseAutoFocus={(e) => {
          // Radix would send focus to the trigger; the PM was writing a
          // question, so the composer gets it back instead.
          e.preventDefault();
          onClosed?.();
        }}
      >
        <Command
          shouldFilter={false}
          className="rounded-none! bg-transparent p-0"
          value={active}
          onValueChange={setActive}
        >
          <CommandInput bare placeholder="Search skills…" value={query} onValueChange={setQuery} />
          <CommandList className="max-h-80 p-1.5">
            <CommandEmpty className="px-2 py-6 text-center text-sm text-muted-foreground">
              No skill matches “{query.trim()}”.
            </CommandEmpty>
            {matches.map((skill) => (
              <SkillItem
                key={skill.path}
                skill={skill}
                checked={skill.name === picked}
                onChoose={() => {
                  onPick(skill.name);
                  onOpenChange(false);
                }}
              />
            ))}
          </CommandList>
          {/* What the highlighted skill does, following the keyboard cursor.
              Fixed height so the menu never jumps while arrowing. */}
          <div className="flex h-12 items-center border-t border-border px-3">
            <p className="line-clamp-2 text-xs text-muted-foreground">{activeSkill?.summary}</p>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Title first, then the description — so "pattern" finds "Find the pattern". */
function filterSkills(skills: SkillDTO[], query: string): SkillDTO[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.title} ${s.summary} ${s.name}`.toLowerCase().includes(q));
}

function SkillItem({
  skill,
  checked,
  onChoose,
}: {
  skill: SkillDTO;
  checked: boolean;
  onChoose: () => void;
}) {
  const broken = skill.errors.length > 0;
  return (
    <CommandItem
      value={skill.name}
      onSelect={onChoose}
      data-checked={checked || undefined}
      // The keyboard cursor is what ↵ runs, so it steps to the hover wash rather
      // than the palette's faintest wash.
      className="h-8 cursor-pointer gap-2 rounded-md px-2.5 py-0 data-[checked=true]:text-brand data-[selected=true]:bg-accent"
    >
      <span className="min-w-0 flex-1 truncate font-medium">{skill.title}</span>
      {/* A broken skill is still offered — but never without saying so, in the
          same words (and the same red) as the Skills view. */}
      {broken && (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {skill.errors.length} issue{skill.errors.length === 1 ? '' : 's'}
        </span>
      )}
    </CommandItem>
  );
}
