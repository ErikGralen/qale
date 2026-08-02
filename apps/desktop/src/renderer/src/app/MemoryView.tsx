import { useMemo } from 'react';
import { dirForType, isFolderIndex, layerForType, readOnlyReason } from '@pm/domain';
import { Button } from '@pm/ui';
import { ChevronRight, FileUp, Inbox, Library, Mic } from 'lucide-react';
import type { NoteRefDTO, NoteType, VaultTreeGroupDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { requestCapture } from '../lib/capture-event';
import { PageHeader } from '../components/PageHeader';
import { noteTypeIcon } from '../lib/note-icons';
import { isUnprocessedSource, needsReview } from '../lib/note-status';

/**
 * The shelves, clustered by what they are to the PO — four plain groups keep
 * the full ceiling scannable where a flat wall of twelve types read as bloat.
 * Notes sits alone on top as the desk. A type only renders once *revealed*
 * (the memory has ever held one); a shelf with no revealed types doesn't
 * render at all, so week one shows two rows and week six shows the instrument.
 *
 * Sessions are deliberately absent: a session receipt is a record the user
 * never authors, and it already has a home in the Sessions rail. It stays
 * addressable ([[sessions/…]] links resolve, backlinks work) without costing
 * a shelf here.
 */
const SHELVES: readonly { label: string; types: readonly NoteType[] }[] = [
  { label: 'Record', types: ['meeting', 'source'] },
  { label: 'Judgment', types: ['decision', 'insight', 'theme'] },
  { label: 'People', types: ['customer', 'person'] },
  { label: 'Delivery', types: ['ticket', 'wikipage'] },
];

/**
 * What each shelf holds — the whole subtitle: note titles here read as bloat,
 * and the row truncates, so one clause is the budget. The two mirror shelves
 * lead with the domain's own sentence (@pm/domain readOnlyReason) so the shelf
 * and the note page name the source the same way.
 */
const TYPE_DESC: Partial<Record<NoteType, string>> = {
  meeting: 'Meetings and their After-Meeting reviews — transcripts live in sources.',
  decision: 'The decision spine — active calls, and the chain of what they superseded.',
  theme: 'The durable things worth solving, accreting evidence.',
  source: 'Dumped material, analyzed but never rewritten.',
  insight: 'Claims extracted from meetings, each citing its evidence.',
  customer: 'Accounts the memory knows, prospect to churned.',
  person: 'Stakeholders — what they care about, what they were last told.',
  note: 'Untyped notes and quick captures.',
  ticket: `${readOnlyReason('ticket')} The work your notes link against.`,
  wikipage: `${readOnlyReason('wikipage')} The pages your updates land on.`,
};

/** The one number per shelf that means "waiting on you", in the flag voice. */
function attentionFor(type: NoteType, notes: NoteRefDTO[]): string | null {
  if (type === 'meeting') {
    const n = notes.filter((note) => needsReview(note)).length;
    return n > 0 ? `${n} to review` : null;
  }
  if (type === 'source') {
    const n = notes.filter(isUnprocessedSource).length;
    return n > 0 ? `${n} unprocessed` : null;
  }
  return null;
}

function ShelfRow({ group }: { group: VaultTreeGroupDTO }) {
  const { openFolder, revealNew, markRevealSeen } = useApp();
  const notes = useMemo(() => group.notes.filter((n) => !isFolderIndex(n.path)), [group]);
  const Icon = noteTypeIcon(group.type);
  const attention = attentionFor(group.type, notes);
  // Freshly earned: the memory just filed its first of this type. The word (not
  // color alone) carries it; visiting the shelf clears it.
  const isNew = revealNew.has(group.type);
  return (
    <li>
      <button
        className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={(e) => {
          if (isNew) markRevealSeen(group.type);
          openFolder(group.dir, navFromEvent(e));
        }}
        title={`Browse all ${group.dir}`}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-medium capitalize">{group.dir}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{notes.length}</span>
            {isNew && (
              <span className="flex items-center gap-1 text-xs font-medium text-brand">
                <span className="size-1.5 rounded-full bg-brand" aria-hidden />
                New
              </span>
            )}
            {attention && <span className="text-xs font-medium text-warning">{attention}</span>}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {TYPE_DESC[group.type] ?? `No ${group.dir} yet.`}
          </span>
        </span>
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors duration-150 group-hover:text-muted-foreground/60"
          aria-hidden
        />
      </button>
    </li>
  );
}

/** One quiet sentence teaching the ceiling — what the memory hasn't grown yet. */
function GrowthFooter({ unrevealed }: { unrevealed: readonly NoteType[] }) {
  if (unrevealed.length === 0) return null;
  return (
    <p className="px-3 pt-4 text-xs text-muted-foreground/80">
      As the memory grows: {unrevealed.map((t) => dirForType(t)).join(', ')}.
    </p>
  );
}

/**
 * Day one, before anything is filed: the Memory page teaches the loop instead
 * of showing a wall of empty shelves. One real sequence — in, approve, accrete
 * — and one action. The shelves replace this the moment the first note lands.
 */
function FirstRun() {
  const steps = [
    {
      icon: Mic,
      title: 'A transcript goes in',
      desc: 'Any meeting you already have — drop the file anywhere, or paste it with ⇧⌘N.',
    },
    {
      icon: Inbox,
      title: 'You approve what it finds',
      desc: 'Decisions, actions, and drafts arrive as cards. Nothing is written silently.',
    },
    {
      icon: Library,
      title: 'The memory accretes',
      desc: 'Every claim files with its source. Week six answers what week one couldn’t.',
    },
  ];
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 pt-10">
      <h1 className="font-serif text-2xl font-semibold tracking-tight text-balance">
        The memory starts with a meeting.
      </h1>
      <ol className="flex flex-col gap-4">
        {steps.map((s) => (
          <li key={s.title} className="flex items-start gap-3">
            <s.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{s.title}</span>
              <span className="block text-sm text-muted-foreground">{s.desc}</span>
            </span>
          </li>
        ))}
      </ol>
      <div>
        <Button size="sm" onClick={() => requestCapture()}>
          <FileUp className="size-3.5" /> Drop a transcript
        </Button>
      </div>
      <p className="text-xs text-muted-foreground/80">
        Shelves appear here as it grows — decisions, insights, customers, themes, and the rest.
      </p>
    </div>
  );
}

/**
 * The whole memory, one shelf per *revealed* note type, clustered so the eye
 * chunks the ceiling instead of scrolling a wall. Each row: what the shelf
 * holds, how much, and anything on it waiting for the PO — never individual
 * note titles, which read as inventory bloat. Week 6 should read fuller than
 * week 1 through the shelves themselves, not just the counts.
 */
export function MemoryView() {
  const { tree, revealed } = useApp();
  const byType = useMemo(() => {
    const m = new Map<NoteType, VaultTreeGroupDTO>();
    for (const g of tree?.groups ?? []) m.set(g.type, g);
    return m;
  }, [tree]);
  // Earned stays earned: a revealed shelf renders even at zero, synthesized
  // empty if the memory currently holds none.
  const groupFor = (t: NoteType): VaultTreeGroupDTO =>
    byType.get(t) ?? { dir: dirForType(t), type: t, layer: layerForType(t), notes: [] };
  const shelves = SHELVES.map((s) => ({
    label: s.label,
    groups: s.types.filter((t) => revealed.has(t)).map(groupFor),
  })).filter((s) => s.groups.length > 0);
  const unrevealed = SHELVES.flatMap((s) => s.types).filter((t) => !revealed.has(t));

  // The header count has to match what the shelves add up to, so the types
  // with homes of their own (Skills, Todos, Sessions) stay out of it.
  const total = [...byType.values()]
    .filter((g) => g.type !== 'skill' && g.type !== 'agent' && g.type !== 'todo' && g.type !== 'session')
    .reduce((sum, g) => sum + g.notes.filter((n) => !isFolderIndex(n.path)).length, 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={Library} label="Memory" meta={total} />

      <div className="flex-1 overflow-y-auto px-8 py-4">
        <div className="mx-auto w-full max-w-2xl">
          {total === 0 ? (
            <FirstRun />
          ) : (
            <>
              {/* The desk — the scratch pad rides on top, ungrouped. */}
              <ul className="flex flex-col gap-0.5">
                <ShelfRow group={groupFor('note')} />
              </ul>
              {shelves.map((s) => (
                <section key={s.label} className="mt-5">
                  <h2 className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase">
                    {s.label}
                  </h2>
                  <ul className="flex flex-col gap-0.5">
                    {s.groups.map((g) => (
                      <ShelfRow key={g.dir} group={g} />
                    ))}
                  </ul>
                </section>
              ))}
              <GrowthFooter unrevealed={unrevealed} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
