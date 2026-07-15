import { useEffect, useState } from 'react';
import { Badge, Button, Separator } from '@pm/ui';
import { Pencil, Link2, FileText, Save, X } from 'lucide-react';
import { useApp } from '../state/app-state';
import { Markdown } from '../components/Markdown';

export function NoteView() {
  const { currentNote, backlinks, openNote, saveNote } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setEditing(false);
    setDraft(currentNote?.body ?? '');
  }, [currentNote?.path, currentNote?.body]);

  if (!currentNote) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Note not found.
      </div>
    );
  }

  const editable = currentNote.bodyEditable;
  const stance = currentNote.frontmatter['stance'] as string | undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 items-center gap-2 px-5" style={{ WebkitAppRegion: 'drag' } as never}>
        <FileText className="size-4 text-muted-foreground" />
        <span className="truncate font-mono text-xs text-muted-foreground">{currentNote.path}</span>
        <div className="ml-auto flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as never}>
          {editable && !editing && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-2">
        <div className="mx-auto max-w-2xl">
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="secondary" className="capitalize">
              {currentNote.type}
            </Badge>
            {stance && <Badge className="capitalize">{stance}</Badge>}
          </div>
          <h1 className="mb-1 font-serif text-2xl font-semibold tracking-tight">
            {currentNote.title}
          </h1>
          <p className="mb-4 text-[15px] text-muted-foreground">{currentNote.summary}</p>

          {editing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-80 w-full resize-y rounded-md border border-input bg-card p-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                autoFocus
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={async () => {
                    await saveNote(currentNote.path, draft);
                    setEditing(false);
                  }}
                >
                  <Save className="size-3.5" /> Save
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  <X className="size-3.5" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Markdown content={currentNote.body} onOpenNote={openNote} />
          )}

          <Separator className="my-6" />

          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <Link2 className="size-3.5" /> Linked from ({backlinks.length})
          </div>
          {backlinks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No backlinks yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {backlinks.map((b) => (
                <li key={b.from.path}>
                  <button
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => openNote(b.from.path)}
                  >
                    <span className="font-medium">{b.from.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{b.from.summary}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
