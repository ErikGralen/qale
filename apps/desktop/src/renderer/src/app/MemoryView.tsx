import { useMemo } from 'react';
import {
  Building2,
  ChevronRight,
  FileInput,
  GitBranch,
  History,
  Library,
  Mic,
  Rocket,
  Sparkles,
  StickyNote,
  Target,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { NoteRefDTO, NoteType, VaultTreeGroupDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { isUnprocessedSource, needsReview } from '../lib/note-status';

const TYPE_ICON: Record<string, LucideIcon> = {
  source: FileInput,
  meeting: Mic,
  decision: GitBranch,
  insight: Sparkles,
  customer: Building2,
  problem: Target,
  release: Rocket,
  person: User,
  session: History,
  note: StickyNote,
};

/** Page order: the working set first, then the reference shelves. */
const TYPE_ORDER: readonly NoteType[] = [
  'meeting',
  'decision',
  'problem',
  'release',
  'source',
  'insight',
  'customer',
  'person',
  'session',
  'note',
];

/** What each shelf holds — the whole subtitle: note titles here read as bloat. */
const TYPE_DESC: Partial<Record<NoteType, string>> = {
  meeting: 'Transcripts and their After-Meeting reviews.',
  decision: 'The decision spine — active calls, and the chain of what they superseded.',
  problem: 'Durable problem statements, accreting evidence.',
  release: 'What is planned and what shipped.',
  source: 'Raw dumped material — analyzed, never edited.',
  insight: 'Claims extracted from meetings, each citing its evidence.',
  customer: 'Accounts the memory knows, prospect to churned.',
  person: 'Stakeholders — what they care about, what they were last told.',
  session: 'Filed conversation logs.',
  note: 'Untyped notes and quick captures.',
};

/** The one number per shelf that means "waiting on you", in the flag voice. */
function attentionFor(type: NoteType, notes: NoteRefDTO[]): string | null {
  if (type === 'meeting') {
    const n = notes.filter(needsReview).length;
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
  const notes = useMemo(() => group.notes.filter((n) => !n.path.endsWith('/index.md')), [group]);
  const Icon = TYPE_ICON[group.type] ?? StickyNote;
  const attention = attentionFor(group.type, notes);
  return (
    <li>
      <button
        className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => openFolder(group.dir)}
        onDoubleClick={() => openFolder(group.dir, { preview: false })}
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
    </li>
  );
}

/**
 * The whole memory, one shelf per note type (the sidebar rail carries only the
 * working set — meetings, decisions, problems, releases). Each row: what the
 * shelf holds, how much, and anything on it waiting for the PO — never
 * individual note titles, which read as inventory bloat. Week 6 should still
 * read fuller than week 1 through the counts.
 */
export function MemoryView() {
  const { tree } = useApp();
  const groups = useMemo(() => {
    const content = (tree?.groups ?? []).filter((g) => g.type !== 'skill' && g.type !== 'todo');
    const rank = (g: VaultTreeGroupDTO): number => {
      const i = TYPE_ORDER.indexOf(g.type);
      return i === -1 ? TYPE_ORDER.length : i;
    };
    return [...content].sort((a, b) => rank(a) - rank(b) || a.dir.localeCompare(b.dir));
  }, [tree]);
  const total = groups.reduce((sum, g) => sum + g.notes.filter((n) => !n.path.endsWith('/index.md')).length, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-5 text-sm font-medium text-muted-foreground">
        <Library className="size-4" /> Memory
        <span className="text-xs tabular-nums">· {total}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-4">
        <div className="mx-auto w-full max-w-2xl">
          {groups.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Nothing filed yet — drop a transcript or capture anything with ⇧⌘N and the memory starts here.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {groups.map((g) => (
                <ShelfRow key={g.dir} group={g} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
