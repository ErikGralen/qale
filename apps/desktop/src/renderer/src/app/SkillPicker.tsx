import { useEffect, useRef, useState } from 'react';
import { Wand2, X } from 'lucide-react';
import { useApp } from '../state/app-state';

/**
 * The composer's skill picker (Sessions v2 Part 3.2). Session types stopped
 * being rooms you get locked in: a skill ARRIVES, and this is the PM saying
 * which one. Picking "Synthesis" mid-conversation is the same code path as the
 * agent calling `use_skill` — a different caller, nothing else.
 *
 * The pick applies to the NEXT message and then clears. A skill that stuck to
 * the composer would be a mode by another name, which is the thing we removed.
 */
export function SkillPicker({
  picked,
  onPick,
  disabled,
}: {
  picked: string | null;
  onPick: (name: string | null) => void;
  disabled?: boolean;
}) {
  const { skills } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const invocable = skills.filter((s) => s.kind === 'session');

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (invocable.length === 0) return null;

  const pickedSkill = picked ? invocable.find((s) => s.name === picked) : undefined;

  if (picked) {
    return (
      <button
        className="flex shrink-0 items-center gap-1 self-center rounded-md border border-border px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => onPick(null)}
        title={`${pickedSkill?.summary ?? picked} — click to drop it`}
      >
        <Wand2 className="size-3.5 shrink-0" />
        <span className="max-w-32 truncate">{picked}</span>
        <X className="size-3 shrink-0" />
      </button>
    );
  }

  return (
    <div ref={ref} className="relative shrink-0 self-center">
      <button
        className="flex items-center rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-label="Use a skill for this message"
        title="Use a skill for this message"
      >
        <Wand2 className="size-4" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1.5 max-h-72 w-80 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Bring a skill into this conversation. It takes over how the agent works from your next
            message on.
          </p>
          {invocable.map((skill) => (
            <button
              key={skill.path}
              className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => {
                onPick(skill.name);
                setOpen(false);
              }}
            >
              <span className="text-sm font-medium">{skill.name}</span>
              <span className="truncate text-xs text-muted-foreground">{skill.summary}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
