import { X, Plus, Inbox, FileText, MessageSquare, Filter, Folder, FileUp, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useApp, type Tab } from '../state/app-state';

function iconFor(tab: Tab): LucideIcon {
  switch (tab.kind) {
    case 'doc':
      return FileText;
    case 'session':
      return MessageSquare;
    case 'inbox':
      return Inbox;
    case 'smartview':
      return Filter;
    case 'folder':
      return Folder;
    case 'meeting-drop':
      return FileUp;
    case 'settings':
      return Settings;
    default:
      return FileText;
  }
}

/** The tab strip — documents and sessions interchangeably (PLAN-V2 §3.3). */
export function TabStrip() {
  const { tabs, activeTabId, setActiveTab, closeTab, openSession } = useApp();

  return (
    <div
      className="flex h-9 items-center gap-0.5 overflow-x-auto border-b border-border bg-background/60 px-1.5"
      style={{ WebkitAppRegion: 'drag' } as never}
    >
      {tabs.map((tab) => {
        const Icon = iconFor(tab);
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`group flex h-7 max-w-52 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] ${
              active ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:bg-card/60'
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as never}
            onClick={() => setActiveTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(tab.id);
            }}
            role="tab"
          >
            <Icon className="size-3.5 shrink-0 opacity-70" />
            <span className="truncate">{tab.title}</span>
            <button
              className="ml-0.5 shrink-0 rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-70"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title="Close tab"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      <button
        className="ml-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-card/60"
        style={{ WebkitAppRegion: 'no-drag' } as never}
        onClick={() => openSession('chat', { fresh: true })}
        title="New chat"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
