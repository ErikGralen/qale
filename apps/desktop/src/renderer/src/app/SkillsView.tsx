import { useMemo } from 'react';
import {
  Wand2,
  Lock,
  Sparkles,
  BookOpen,
  TriangleAlert,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import type { SkillDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { relativeTime } from '../lib/dates';
import { PageHeader } from '../components/PageHeader';
import { StartChips, CanChips } from '../components/RunnableConfig';

/**
 * The Skills view — what the agent works with when work happens, made legible.
 * Grouped by what starts a file: playbooks you run, rules always in force,
 * reference it reads when relevant. (What starts ITSELF lives on the Agents
 * page.) The grouping and the chips both read `starts`, so a file cannot sit
 * under one heading while its config says another. The row is a door: clicking
 * it opens the file, which is the editor.
 */

/** The shelves, in reading order, each claiming files by what starts them. */
type Shelf = 'playbook' | 'always' | 'reference';

const SHELF_ORDER: Shelf[] = ['playbook', 'always', 'reference'];

const SHELF_META: Record<Shelf, { label: string; icon: LucideIcon; blurb: string }> = {
  playbook: { label: 'Playbooks', icon: Wand2, blurb: 'Work you hand over from the composer.' },
  always: { label: 'Always on', icon: Lock, blurb: 'Rules the agent follows in everything it does here.' },
  reference: { label: 'Reference', icon: BookOpen, blurb: 'The agent reads these when they become relevant.' },
};

/**
 * Which shelf a file belongs on. An always-on rule is one wherever else it can
 * be reached from; otherwise anything that governs is a playbook, and what is
 * left is material.
 */
function shelfOf(skill: SkillDTO): Shelf {
  if (skill.starts.some((s) => s.kind === 'always')) return 'always';
  if (skill.starts.some((s) => s.kind === 'you-run-it' || s.kind === 'model-picks-it-up'))
    return 'playbook';
  return 'reference';
}

function SkillRow({ skill }: { skill: SkillDTO }) {
  const { openDoc } = useApp();
  const hasErrors = skill.errors.length > 0;
  // The shelf heading already says "Always on"; only the audience scope adds
  // anything the group doesn't already carry.
  const scoped = skill.starts.filter((s) => s.kind === 'always' && s.audience);

  return (
    <li>
      <button
        className="group flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none"
        onClick={(e) => void openDoc(skill.path, navFromEvent(e))}
        title={`Open ${skill.path}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{skill.title}</span>
            {!skill.enabled && (
              <span className="shrink-0 text-xs text-muted-foreground">switched off</span>
            )}
            {hasErrors && (
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-destructive">
                <TriangleAlert className="size-3" aria-hidden />
                {skill.errors.length} issue{skill.errors.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-dense text-muted-foreground">{skill.summary}</p>

          {/* Config, never prose: the same chips the Agents page shows. The
              shelf already says the broad answer, so only the parts it doesn't
              cover earn a chip here — an audience scope, a capability. Then the
              one fact no chip can carry: whether anything ever reaches for it. */}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {scoped.length > 0 && <StartChips starts={scoped} />}
            <CanChips can={skill.can} />
            <span className="text-xs text-muted-foreground/70">
              {skill.lastUsedMs ? `Used ${relativeTime(skill.lastUsedMs)}` : 'Not used yet'}
            </span>
          </div>

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
  const { skills, openSession, openAgents } = useApp();

  const groups = useMemo(() => {
    const byShelf = new Map<Shelf, SkillDTO[]>();
    for (const s of skills) {
      const shelf = shelfOf(s);
      const list = byShelf.get(shelf) ?? [];
      list.push(s);
      byShelf.set(shelf, list);
    }
    for (const list of byShelf.values()) list.sort((a, b) => a.title.localeCompare(b.title));
    return SHELF_ORDER.map((shelf) => ({ shelf, skills: byShelf.get(shelf) ?? [] })).filter(
      (g) => g.skills.length > 0,
    );
  }, [skills]);

  const errorCount = skills.reduce((n, s) => n + (s.errors.length > 0 ? 1 : 0), 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={Wand2} label="Skills" meta={skills.length > 0 ? skills.length : undefined}>
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-xs font-medium text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            {errorCount} to fix
          </span>
        )}
      </PageHeader>

      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-8 py-5">
        {/* The one sentence that defines the noun — the sibling of the Agents
            page's opening line, with the door to that page in it. */}
        <p className="mb-3 px-1 text-dense text-muted-foreground">
          Skills are how work you hand over gets done — playbooks you run, rules that are always
          in force, and reference the agent reads when relevant. What starts by itself lives on
          the{' '}
          <button
            className="rounded font-medium text-brand underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={(e) => openAgents(navFromEvent(e))}
          >
            Agents
          </button>{' '}
          page.
        </p>

        {skills.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-brand/10">
              <Wand2 className="size-6 text-brand" aria-hidden />
            </div>
            <h2 className="text-lg font-semibold">No skills yet</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Ask the librarian to draft one, or add a folder under{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-dense">skills/</code> with a{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-dense">SKILL.md</code> in it.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-7">
            {groups.map(({ shelf, skills: rows }) => {
              const meta = SHELF_META[shelf];
              const Icon = meta.icon;
              return (
                <section key={shelf}>
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
