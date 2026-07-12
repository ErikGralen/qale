import { useState } from 'react';
import { Logo, Button } from '@pm/ui';
import {
  FolderOpen,
  ChevronRight,
  Radio,
  Lightbulb,
  GitBranch,
  CheckSquare,
  HelpCircle,
  FileText,
  StickyNote,
  Mic,
  Sparkles,
  Settings,
  Inbox,
  Wand2,
  FileUp,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../state/app-state';
import type { NoteType } from '@pm/ipc';

const TYPE_ICON: Record<string, LucideIcon> = {
  signal: Radio,
  transcript: Mic,
  'meeting-summary': FileText,
  theme: Lightbulb,
  decision: GitBranch,
  action: CheckSquare,
  'open-question': HelpCircle,
  note: StickyNote,
};

function Group({ dir, type, notes }: { dir: string; type: NoteType; notes: { path: string; title: string }[] }) {
  const [open, setOpen] = useState(true);
  const { openNote, view } = useApp();
  const Icon = TYPE_ICON[type] ?? StickyNote;
  return (
    <div>
      <button
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight className={`size-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Icon className="size-3.5" />
        <span className="flex-1">{dir}</span>
        <span className="text-[10px] opacity-70">{notes.length}</span>
      </button>
      {open && (
        <ul className="mb-1 flex flex-col">
          {notes.map((n) => {
            const active = view.kind === 'note' && view.path === n.path;
            return (
              <li key={n.path}>
                <button
                  className={`w-full truncate rounded-md py-1 pr-2 pl-7 text-left text-[13px] transition-colors hover:bg-sidebar-accent ${
                    active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground'
                  }`}
                  onClick={() => openNote(n.path)}
                  title={n.title}
                >
                  {n.title}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Sidebar() {
  const {
    vault,
    tree,
    openVaultDialog,
    showLanding,
    showChat,
    showSettings,
    showReview,
    showThemes,
    showIngest,
    startTriage,
    pendingCount,
  } = useApp();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 px-3.5" style={{ WebkitAppRegion: 'drag' } as never}>
        <button className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as never} onClick={showLanding}>
          <Logo className="size-5 text-brand" />
          <span className="font-serif text-[15px] font-semibold tracking-tight">product brain</span>
        </button>
        <button
          className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as never}
          onClick={showSettings}
          title="Settings"
        >
          <Settings className="size-4" />
        </button>
      </div>

      {vault && (
        <div className="flex flex-col gap-0.5 px-2 pb-1">
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={() => showChat('ask')}
          >
            <Sparkles className="size-4 text-brand" />
            Ask the brain
            <span className="ml-auto text-[11px] text-muted-foreground">⌘↵</span>
          </button>
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={showReview}
          >
            <Inbox className="size-4 text-muted-foreground" />
            Inbox
            {pendingCount > 0 && (
              <span className="ml-auto rounded-full bg-brand/15 px-1.5 text-xs font-semibold text-brand">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={showThemes}
          >
            <Lightbulb className="size-4 text-muted-foreground" />
            Themes
          </button>
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={startTriage}
          >
            <Wand2 className="size-4 text-muted-foreground" />
            Triage new signals
          </button>
          <button
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent"
            onClick={showIngest}
          >
            <FileUp className="size-4 text-muted-foreground" />
            Ingest transcript
          </button>
        </div>
      )}

      {!vault ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <FolderOpen className="size-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">No vault open.</p>
          <Button variant="outline" size="sm" onClick={openVaultDialog}>
            Open vault…
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-3.5 pb-1 text-[11px] text-muted-foreground">
            <span className="truncate font-medium">{vault.name}</span>
            <span className="opacity-60">· {vault.noteCount}</span>
            {vault.git && <GitBranch className="size-3 opacity-60" />}
          </div>
          <div className="flex-1 overflow-y-auto px-2 pt-1">
            {tree && tree.groups.length > 0 ? (
              tree.groups.map((g) => (
                <Group key={g.dir} dir={g.dir} type={g.type} notes={g.notes} />
              ))
            ) : (
              <p className="px-2 py-4 text-sm text-muted-foreground">Empty vault — capture a signal (⌘N).</p>
            )}
          </div>
        </>
      )}

      <div className="border-t border-sidebar-border px-3.5 py-2 text-[11px] text-muted-foreground">
        ⌘K search · ⌘N capture
      </div>
    </div>
  );
}
