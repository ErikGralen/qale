import { useMemo } from 'react';
import {
  Wand2,
  Lock,
  Zap,
  Sparkles,
  BookOpen,
  FolderTree,
  Mic,
  History,
  TriangleAlert,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import type { SkillDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';

/**
 * The Skills view (Skills v2) — how the agent behaves, made legible. Skills group
 * by kind; each row reads its bindings as plain sentences and pins any frontmatter
 * error in the flag voice. The row is a door: clicking it opens the skill file,
 * which is the editor.
 */

type SkillKind = SkillDTO['kind'];

const KIND_ORDER: SkillKind[] = ['session', 'reaction', 'voice', 'guide', 'filing'];

const KIND_META: Record<SkillKind, { label: string; icon: LucideIcon; blurb: string }> = {
  session: { label: 'Playbooks', icon: History, blurb: 'Packaged workflows you run, or that fire on a trigger.' },
  reaction: { label: 'Reactions', icon: Zap, blurb: 'Small sessions that fire automatically on a workspace event.' },
  voice: { label: 'Voices', icon: Mic, blurb: 'Writing registers forced into outbound drafts.' },
  guide: { label: 'Guides', icon: BookOpen, blurb: 'Reference the agent pulls in on demand while it works.' },
  filing: { label: 'Filing', icon: FolderTree, blurb: "The librarian's rules for where each note lives." },
};

const BINDING_ICON: Record<SkillDTO['bindings'][number]['mode'], LucideIcon> = {
  forced: Lock,
  triggered: Zap,
  dynamic: Sparkles,
};

/** Prettify a skill name for display: "after-meeting" → "After meeting". Voice/
 *  guide skills carry no session_type, so the name falls back to the folder-
 *  qualified slug ("skills/voice-cs") — strip the folder before prettifying. */
function prettyName(s: SkillDTO): string {
  const last = (s.name || s.slug).split('/').pop() ?? s.slug;
  const base = last.replace(/-/g, ' ');
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function SkillRow({ skill }: { skill: SkillDTO }) {
  const { openDoc } = useApp();
  const hasErrors = skill.errors.length > 0;

  return (
    <li>
      <button
        className="group flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
        onClick={() => void openDoc(skill.path)}
        onDoubleClick={() => void openDoc(skill.path, { preview: false })}
        title={`Open ${skill.path}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{prettyName(skill)}</span>
            {skill.tier === 'outbound' && (
              <span className="shrink-0 text-xs text-muted-foreground">drafts outbound</span>
            )}
            {hasErrors && (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-destructive">
                <TriangleAlert className="size-3" aria-hidden />
                {skill.errors.length} issue{skill.errors.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{skill.summary}</p>

          {/* Bindings — how this skill attaches, as plain sentences. */}
          {skill.bindings.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {skill.bindings.map((b, i) => {
                const Icon = BINDING_ICON[b.mode];
                return (
                  <li key={i} className="flex items-start gap-1.5 text-[13px] text-foreground/80">
                    <Icon
                      className={`mt-0.5 size-3.5 shrink-0 ${b.mode === 'triggered' ? 'text-brand' : 'text-muted-foreground'}`}
                      aria-hidden
                    />
                    <span>{b.sentence}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[13px] text-muted-foreground/80">Not attached — the agent uses it only when you ask.</p>
          )}

          {/* Parse errors — pinned, the flag voice, never quiet. */}
          {hasErrors && (
            <ul className="mt-2 flex flex-col gap-1 rounded-md bg-destructive/8 px-2.5 py-1.5">
              {skill.errors.map((e, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-destructive">
                  <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

export function SkillsView() {
  const { skills, openSession } = useApp();

  const groups = useMemo(() => {
    const byKind = new Map<SkillKind, SkillDTO[]>();
    for (const s of skills) {
      const list = byKind.get(s.kind) ?? [];
      list.push(s);
      byKind.set(s.kind, list);
    }
    for (const list of byKind.values()) list.sort((a, b) => prettyName(a).localeCompare(prettyName(b)));
    return KIND_ORDER.map((kind) => ({ kind, skills: byKind.get(kind) ?? [] })).filter((g) => g.skills.length > 0);
  }, [skills]);

  const errorCount = skills.reduce((n, s) => n + (s.errors.length > 0 ? 1 : 0), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <Wand2 className="size-4" aria-hidden /> Skills
        {skills.length > 0 && <span className="text-xs">· {skills.length}</span>}
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
            <TriangleAlert className="size-3" aria-hidden />
            {errorCount} to fix
          </span>
        )}
      </div>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-5">
        {skills.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-brand/10">
              <Wand2 className="size-6 text-brand" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold">No skills yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Skills are markdown files in <code className="rounded bg-muted px-1 py-0.5 text-[13px]">skills/</code>.
              They set the agent's voices, playbooks, and triggers. Ask the librarian to draft one, or add a
              file yourself.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-7">
            {groups.map(({ kind, skills: rows }) => {
              const meta = KIND_META[kind];
              const Icon = meta.icon;
              return (
                <section key={kind}>
                  <div className="mb-2 flex items-baseline gap-2 px-1">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
                      <Icon className="size-3.5 self-center text-muted-foreground/70" aria-hidden />
                      {meta.label}
                      <span className="tabular-nums">{rows.length}</span>
                    </h3>
                    <p className="truncate text-xs text-muted-foreground/70">{meta.blurb}</p>
                  </div>
                  <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl bg-card ring-1 ring-border">
                    {rows.map((s) => (
                      <SkillRow key={s.path} skill={s} />
                    ))}
                  </ul>
                </section>
              );
            })}

            <p className="flex items-center gap-1.5 px-1 pb-4 text-xs text-muted-foreground/70">
              <Sparkles className="size-3" aria-hidden />
              Every skill is a file you can read and edit. Ask the{' '}
              <button
                className="rounded font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => openSession('librarian', { initialPrompt: 'Help me write or adjust a skill.' })}
              >
                librarian
              </button>{' '}
              to draft one for you.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
