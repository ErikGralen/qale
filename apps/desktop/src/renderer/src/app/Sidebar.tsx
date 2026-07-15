import { useState } from 'react';
import { Logo, Button } from '@pm/ui';
import {
  FolderOpen,
  ChevronRight,
  Target,
  GitBranch,
  Sparkles,
  Building2,
  Rocket,
  User,
  History,
  Wand2,
  StickyNote,
  Mic,
  Settings,
  Inbox,
  FileUp,
  Filter,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../state/app-state';
import { SMART_VIEW_ORDER, SMART_VIEWS } from '../state/smart-views';
import type { NoteType, NoteRefDTO } from '@pm/ipc';

const TYPE_ICON: Record<string, LucideIcon> = {
  meeting: Mic,
  decision: GitBranch,
  insight: Sparkles,
  customer: Building2,
  problem: Target,
  release: Rocket,
  person: User,
  session: History,
  skill: Wand2,
  note: StickyNote,
};

function Group({
  dir,
  type,
  notes,
  defaultOpen,
}: {
  dir: string;
  type: NoteType;
  notes: NoteRefDTO[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const { openDoc, openFolder, activeTab } = useApp();
  const Icon = TYPE_ICON[type] ?? StickyNote;
  return (
    <div>
      <div className="flex w-full items-center gap-1 rounded-md pr-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground">
        <button className="p-1" onClick={() => setOpen((o) => !o)} title={open ? 'Collapse' : 'Expand'}>
          <ChevronRight className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <button className="flex flex-1 items-center gap-1.5 py-1 text-left" onClick={() => openFolder(dir)}>
          <Icon className="size-3.5" />
          <span className="flex-1">{dir}</span>
          <span className="text-[10px] opacity-70">{notes.length}</span>
        </button>
      </div>
      {open && (
        <ul className="mb-1 flex flex-col">
          {notes.map((n) => {
            const active = activeTab?.kind === 'doc' && activeTab.path === n.path;
            return (
              <li key={n.path}>
                <button
                  className={`flex w-full items-center gap-1.5 truncate rounded-md py-1 pr-2 pl-7 text-left text-[13px] transition-colors hover:bg-sidebar-accent ${
                    active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground'
                  }`}
                  onClick={() => openDoc(n.path)}
                  title={n.title}
                >
                  <span className="truncate">{n.title}</span>
                  {n.stale && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-chart-4" title="stale" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HealthBar() {
  const { health } = useApp();
  if (!health || health.total === 0) return null;
  const pct = Math.round(health.score * 100);
  return (
    <div className="px-3.5 pb-1.5 pt-0.5">
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>workspace health</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      {(health.stale > 0 || health.unverified > 0) && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {health.stale} stale · {health.unverified} unverified
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const {
    vault,
    tree,
    openVaultDialog,
    openSession,
    openSettings,
    openInbox,
    openSmartView,
    openMeetingDrop,
    openFolder,
    pendingCount,
  } = useApp();

  const skillsGroup = tree?.groups.find((g) => g.type === 'skill');

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 px-3.5" style={{ WebkitAppRegion: 'drag' } as never}>
        <div className="flex items-center gap-2">
          <Logo className="size-5 text-brand" />
          <span className="font-serif text-[15px] font-semibold tracking-tight">Produktminnet</span>
        </div>
        <button
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as never}
          onClick={openSettings}
          title="Settings"
        >
          <Settings className="size-4" />
        </button>
      </div>

      {vault && (
        <div className="flex flex-col gap-0.5 px-2 pb-1">
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={openInbox}
          >
            <Inbox className="size-4 text-brand" />
            Inbox
            {pendingCount > 0 && (
              <span className="ml-auto rounded-full bg-brand/15 px-1.5 text-xs font-semibold text-brand">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => openSession('ask')}
          >
            <Sparkles className="size-4 text-muted-foreground" />
            Ask
            <span className="ml-auto text-[11px] text-muted-foreground">⌘↵</span>
          </button>
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={openMeetingDrop}
          >
            <FileUp className="size-4 text-muted-foreground" />
            After-Meeting
          </button>
        </div>
      )}

      {!vault ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <FolderOpen className="size-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">No workspace open.</p>
          <Button variant="outline" size="sm" onClick={openVaultDialog}>
            Open workspace…
          </Button>
        </div>
      ) : (
        <>
          <HealthBar />

          {/* Smart views — how you navigate; the tree is how you orient. */}
          <div className="px-2 pb-1">
            <div className="px-2 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground/70 uppercase">
              Views
            </div>
            {SMART_VIEW_ORDER.map((id) => (
              <button
                key={id}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[13px] text-sidebar-foreground hover:bg-sidebar-accent"
                onClick={() => openSmartView(id)}
                title={SMART_VIEWS[id].description}
              >
                <Filter className="size-3.5 text-muted-foreground" />
                {SMART_VIEWS[id].label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-2 pt-1">
            {tree && tree.groups.length > 0 ? (
              tree.groups
                .filter((g) => g.type !== 'skill')
                .map((g) => (
                  <Group
                    key={g.dir}
                    dir={g.dir}
                    type={g.type}
                    notes={g.notes}
                    defaultOpen={g.type !== 'meeting' && g.type !== 'session'}
                  />
                ))
            ) : (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                Empty workspace — drop a meeting or capture a note (⌘N).
              </p>
            )}
          </div>

          <button
            className="flex items-center gap-2 border-t border-sidebar-border px-3.5 py-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => openFolder(skillsGroup?.dir ?? 'skills')}
          >
            <Wand2 className="size-3.5" /> Skills{skillsGroup ? ` (${skillsGroup.notes.length})` : ''}
          </button>
        </>
      )}
    </div>
  );
}
