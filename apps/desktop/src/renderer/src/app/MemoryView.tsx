import { useMemo } from 'react';
import {
  dirForType,
  isFolderIndex,
  isHandCreatable,
  layerForType,
  noteTypeLabel,
  readOnlyReason,
  type HandCreatableType,
} from '@qale/domain';
import { Button } from '@qale/ui';
import { ChevronRight, FileUp, Inbox, Library, Mic, Plus } from 'lucide-react';
import type { NoteRefDTO, NoteType, VaultTreeGroupDTO } from '@qale/ipc';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { useNewNote } from '../lib/new-note';
import { requestCapture } from '../lib/capture-event';
import { PageHeader } from '../components/PageHeader';
import { noteTypeIcon } from '../lib/note-icons';
import { isUnprocessedSource, needsReview } from '../lib/note-status';

/**
 * The shelves, in one flat list — a wall of typed shelves reads fine once it
 * is not also carrying four invented category names. Notes sits alone on top
 * as the desk. Every shelf renders from day one, empty or not: Memory is the
 * map of what the workspace can hold, so nothing is drip-fed. The sidebar is
 * the part that stays small — a type only gets a rail section once one of its
 * notes is pinned.
 *
 * Ticket and Wikipage keep a group of their own: they are the two types Qale
 * never writes, only mirrors, and that is worth a label.
 *
 * Sessions are deliberately absent: a session receipt is a record the user
 * never authors, and it already has a home in the Sessions rail. It stays
 * addressable ([[sessions/…]] links resolve, backlinks work) without costing
 * a shelf here.
 */
const FLAT_SHELVES: readonly NoteType[] = [
  'meeting',
  'source',
  'decision',
  'insight',
  'theme',
  'customer',
  'person',
];

const SYNCED_SHELVES: { label: string; subtitle: string; types: readonly NoteType[] } = {
  label: 'Synced',
  subtitle: 'Mirrored from your tracker and wiki. Qale never edits them.',
  types: ['ticket', 'wikipage'],
};

/**
 * What each shelf holds — the whole subtitle: note titles here read as bloat,
 * and the row truncates, so one clause is the budget. The two mirror shelves
 * lead with the domain's own sentence (@qale/domain readOnlyReason) so the shelf
 * and the note page name the source the same way.
 */
const TYPE_DESC: Partial<Record<NoteType, string>> = {
  meeting: 'Meetings, with what each one changed. The recordings live in sources.',
  decision: 'The decision spine: active calls, and the chain of what they superseded.',
  theme: 'The durable things worth solving, accreting evidence.',
  source: 'Dumped material, analyzed but never rewritten.',
  insight: 'Claims extracted from meetings, each citing its evidence.',
  customer: 'Accounts the memory knows, prospect to churned.',
  person: 'Stakeholders: what they care about, what they were last told.',
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
  const { openFolder } = useApp();
  const { create, busy } = useNewNote();
  const notes = useMemo(() => group.notes.filter((n) => !isFolderIndex(n.path)), [group]);
  const Icon = noteTypeIcon(group.type);
  const attention = attentionFor(group.type, notes);
  // Only the four the PM writes from scratch get a "+". A shelf without one is
  // not locked: it is filled by material arriving or a card being approved, and
  // an empty page there would have nothing to stand on (see HAND_CREATABLE_TYPES).
  const startable = isHandCreatable(group.type);
  const what = noteTypeLabel(group.type).toLowerCase();
  return (
    <li className="flex items-center gap-0.5">
      <button
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={(e) => openFolder(group.dir, navFromEvent(e))}
        title={`Browse all ${group.dir}`}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-medium capitalize">{group.dir}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{notes.length}</span>
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
      {/* Quiet but always there: hiding the one action a shelf offers until the
          pointer finds it is how a feature goes unused for six weeks. */}
      {startable && (
        <button
          className="shrink-0 rounded-lg p-2 text-muted-foreground/50 transition-colors duration-150 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
          onClick={(e) => void create(group.type as HandCreatableType, navFromEvent(e))}
          disabled={busy}
          title={`New ${what}: a blank page, named as you type`}
          aria-label={`New ${what}`}
        >
          <Plus className="size-4" aria-hidden />
        </button>
      )}
    </li>
  );
}

/**
 * Day one, before anything is filed: the shelves alone can't say how anything
 * gets onto them, so the loop leads — in, approve, accrete — with one action.
 * The shelves stand under it, empty, and this block drops away once the memory
 * holds something.
 */
function FirstRun() {
  const steps = [
    {
      icon: Mic,
      title: 'A transcript goes in',
      desc: 'Any meeting you already have. Drop the file anywhere, or paste it with ⇧⌘N.',
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
        The shelves below are what it fills in: decisions, insights, customers, themes, and the
        rest.
      </p>
    </div>
  );
}

/**
 * The whole memory, one shelf per note type, in a flat list with one group at
 * the end for the two synced types. Each row: what the shelf holds, how much,
 * and anything on it waiting for the PO — never individual note titles, which
 * read as inventory bloat. Week 6 reads fuller than week 1 through the counts,
 * not through rows that appear out of nowhere.
 */
export function MemoryView() {
  const { tree } = useApp();
  const byType = useMemo(() => {
    const m = new Map<NoteType, VaultTreeGroupDTO>();
    for (const g of tree?.groups ?? []) m.set(g.type, g);
    return m;
  }, [tree]);
  // Every shelf renders, empty or not — synthesized when the memory holds none
  // of that type yet.
  const groupFor = (t: NoteType): VaultTreeGroupDTO =>
    byType.get(t) ?? { dir: dirForType(t), type: t, layer: layerForType(t), notes: [] };

  // The header count has to match what the shelves add up to, so the types
  // with homes of their own (Skills, Todos, Sessions) stay out of it.
  const total = [...byType.values()]
    .filter(
      (g) => g.type !== 'skill' && g.type !== 'agent' && g.type !== 'todo' && g.type !== 'session',
    )
    .reduce((sum, g) => sum + g.notes.filter((n) => !isFolderIndex(n.path)).length, 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader icon={Library} label="Memory" meta={total} />

      <div className="flex-1 overflow-y-auto px-8 py-4">
        <div className="mx-auto w-full max-w-2xl">
          {/* An empty memory gets the loop above the shelves, not instead of
              them: the whole ceiling is visible from the first launch. */}
          {total === 0 && <FirstRun />}
          {/* The desk — the scratch pad rides on top, then the rest of the
              flat list. */}
          <ul className={`flex flex-col gap-0.5 ${total === 0 ? 'mt-8' : ''}`}>
            <ShelfRow group={groupFor('note')} />
            {FLAT_SHELVES.map((t) => (
              <ShelfRow key={t} group={groupFor(t)} />
            ))}
          </ul>
          {/* The one remaining group: types Qale mirrors, never authors. */}
          <section className="mt-5">
            <h2 className="px-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase">
              {SYNCED_SHELVES.label}
            </h2>
            <p className="px-3 pb-1 text-xs text-muted-foreground/70">
              {SYNCED_SHELVES.subtitle}
            </p>
            <ul className="flex flex-col gap-0.5">
              {SYNCED_SHELVES.types.map((t) => (
                <ShelfRow key={t} group={groupFor(t)} />
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
