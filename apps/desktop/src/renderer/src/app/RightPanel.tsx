import { PanelRight } from 'lucide-react';
import { useApp } from '../state/app-state';

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-sm break-words">{value}</span>
    </div>
  );
}

export function RightPanel() {
  const { view, currentNote, backlinks } = useApp();

  if (view.kind !== 'note' || !currentNote) {
    return (
      <div className="flex h-full flex-col border-l border-border bg-card/40">
        <div className="flex h-11 items-center px-4 text-sm font-medium text-muted-foreground">Context</div>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <PanelRight className="size-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            The note or proposal a session references shows up here.
          </p>
        </div>
      </div>
    );
  }

  const fm = currentNote.frontmatter;
  const source = fm['source'] as { system?: string; author?: string; url?: string } | undefined;
  const captured = fm['captured'] as string | undefined;
  const evidence = Array.isArray(fm['evidence']) ? (fm['evidence'] as string[]) : [];
  const sources = Array.isArray(fm['sources']) ? (fm['sources'] as string[]) : [];

  return (
    <div className="flex h-full flex-col border-l border-border bg-card/40">
      <div className="flex h-11 items-center px-4 text-sm font-medium text-muted-foreground" style={{ WebkitAppRegion: 'drag' } as never}>
        Context
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
        <Field label="Type" value={currentNote.type} />
        <Field label="Layer" value={currentNote.layer} />
        {source && (
          <Field
            label="Source"
            value={[source.system, source.author].filter(Boolean).join(' · ') || 'unknown'}
          />
        )}
        {captured && <Field label="Captured" value={new Date(captured).toLocaleString()} />}
        {evidence.length > 0 && <Field label="Evidence" value={`${evidence.length} linked`} />}
        {sources.length > 0 && <Field label="Sources" value={`${sources.length} cited`} />}
        <Field label="Backlinks" value={`${backlinks.length}`} />
        <Field label="Modified" value={new Date(currentNote.mtime).toLocaleString()} />
      </div>
    </div>
  );
}
