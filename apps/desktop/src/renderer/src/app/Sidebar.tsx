import { Logo } from '@pm/ui';
import { Inbox, Radio, Library, Clock, Sparkles } from 'lucide-react';

const NAV = [
  { icon: Clock, label: 'Now', hint: 'waiting on you' },
  { icon: Radio, label: 'Streams', hint: 'signals & themes' },
  { icon: Library, label: 'Library', hint: 'the product brain' },
];

function NavRow({
  icon: Icon,
  label,
  hint,
  badge,
}: {
  icon: typeof Inbox;
  label: string;
  hint?: string;
  badge?: number;
}) {
  return (
    <button className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-sidebar-accent">
      <Icon className="size-4 text-muted-foreground group-hover:text-sidebar-accent-foreground" />
      <span className="flex-1 font-medium text-sidebar-foreground">{label}</span>
      {badge ? (
        <span className="rounded-full bg-brand/15 px-1.5 text-xs font-semibold text-brand">
          {badge}
        </span>
      ) : hint ? (
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      ) : null}
    </button>
  );
}

export function Sidebar() {
  return (
    <div className="flex h-full flex-col">
      {/* drag region for the frameless title bar */}
      <div className="flex h-11 items-center gap-2 px-3.5" style={{ WebkitAppRegion: 'drag' } as never}>
        <Logo className="size-5 text-brand" />
        <span className="font-serif text-[15px] font-semibold tracking-tight">product brain</span>
      </div>

      <nav className="flex flex-col gap-0.5 px-2 pt-2">
        <NavRow icon={Inbox} label="Inbox" hint="review queue" badge={0} />
        {NAV.map((n) => (
          <NavRow key={n.label} icon={n.icon} label={n.label} hint={n.hint} />
        ))}
      </nav>

      <div className="mt-6 px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Themes
      </div>
      <div className="mt-1 flex flex-1 flex-col gap-0.5 px-2">
        <div className="flex items-center gap-2 rounded-md px-2.5 py-6 text-sm text-muted-foreground">
          <Sparkles className="size-4 opacity-60" />
          <span>Open a vault to begin.</span>
        </div>
      </div>

      <div className="border-t border-sidebar-border px-3.5 py-2.5 text-[11px] text-muted-foreground">
        proposes · you dispose
      </div>
    </div>
  );
}
