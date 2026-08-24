import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Spinner,
  cn,
} from '@qale/ui';
import {
  ChevronRight,
  FileText,
  Image as ImageIcon,
  Plus,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import type { ArrivalCheckDTO, ArrivalHandoffDTO, ArrivalItemInputDTO } from '@qale/ipc';
import { readableAs } from '@qale/domain';
import { pathForFile } from '../lib/ipc';
import { isBulkPaste } from '../lib/capture-event';
import { aimLabel, aimSentence, type MaterialAim } from '../lib/material-aim';
import { useApp } from '../state/app-state';
import { useToast } from '../components/toast';

/** Material handed to the tray before it opens (a drop, a paste from Home). */
export interface MaterialDraft {
  text?: string;
  fileName?: string;
  files?: ArrivalItemInputDTO[];
  /**
   * Where the drop was aimed (docs/arrival-agentic.md, rung 2). Dropping on a
   * meeting page or a folder says something the agent would otherwise have to
   * work out, so it rides along as a sentence rather than a second code path.
   */
  aim?: MaterialAim;
}

/** "2 files · 12,400 words" — what is in the tray, without opening anything. */
function countWords(s: string): number {
  let n = 0;
  let inWord = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const space = c === 32 || c === 9 || c === 10 || c === 13;
    if (space) inWord = false;
    else if (!inWord) {
      inWord = true;
      n++;
    }
  }
  return n;
}

/** A row's own name, for the list and for the remove button's label. */
function rowName(item: ArrivalItemInputDTO): string {
  return item.name ?? PASTED;
}

const PASTED = 'Pasted text.md';

/**
 * What a paste is called. It is a file like any other once it is in the tray —
 * it has a name and a size and it can be taken back out — so it is named like
 * one, and two pastes in the same tray are told apart by a number. What the
 * material actually IS stays the agent's to say once it has read it.
 */
function pastedName(items: ArrivalItemInputDTO[]): string {
  const taken = items.filter(
    (i) => i.name === PASTED || /^Pasted text \d+\.md$/.test(i.name ?? ''),
  ).length;
  return taken === 0 ? PASTED : `Pasted text ${taken + 1}.md`;
}

/**
 * The first line with something in it. A wall of text has no business being
 * shown in full — it is material, not a message — but one line of it is what
 * lets the PM see they pasted the right thing.
 */
function firstLine(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t) return t.length > 200 ? `${t.slice(0, 200)}…` : t;
  }
  return '';
}

/**
 * Add material — the visible front door (docs/arrival-agentic.md).
 *
 * A tray, and now barely that: rows with an X each, one text field, one button.
 * Everything that used to sit here was a guess made before anything had read
 * the material — what each file was, where it would land, whether it was old
 * enough to skip reading, which meeting the clock said it belonged to — and
 * every one of those guesses is now the agent's to make out loud, in a session,
 * where a correction is a sentence rather than a radio button.
 *
 * What stays is what bytes alone can answer: this file cannot be read, this one
 * is empty, this is an image. No model is needed to say "that is a zip", and
 * the PM has to see it before they press the button.
 *
 * The text field is always an instruction ("these are old interviews, just file
 * them"). It is the power-user rung of the ladder: one sentence that skips every
 * question the agent would otherwise ask. Material never goes in it — pasting
 * anywhere else in the tray adds a row, so the two can never be confused.
 */
export function AddMaterial({
  open,
  onOpenChange,
  draft,
  onHandoff,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  draft?: MaterialDraft | null;
  /** The material is in a session and (usually) being read — go and see it. */
  onHandoff: (result: ArrivalHandoffDTO) => void;
}) {
  const { vault, pickMaterial, checkArrival, ingestArrival } = useApp();
  const toast = useToast();
  const [items, setItems] = useState<ArrivalItemInputDTO[]>([]);
  const [instruction, setInstruction] = useState('');
  const [check, setCheck] = useState<ArrivalCheckDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const instructionRef = useRef<HTMLTextAreaElement>(null);
  /** Whether the caret has been put somewhere sensible for this opening. */
  const settled = useRef(false);
  const aim = draft?.aim;

  /**
   * Once there are rows there is no drop zone left to hold the focus, and the
   * dialog hands it to the first row's remove button — where Enter throws the
   * material away. The instruction field is the only thing here anyone types
   * into, so the caret goes there the moment the first material lands, and
   * stays wherever it is put after that.
   */
  useEffect(() => {
    if (!open) {
      settled.current = false;
      return;
    }
    if (items.length === 0 || settled.current) return;
    settled.current = true;
    instructionRef.current?.focus();
  }, [open, items.length]);

  /**
   * Anything the tray was handed, as rows. A pasted transcript from Home is
   * material like any file (AR-5): it arrives as a row, and the text field below
   * it keeps meaning the one thing it always means.
   */
  useEffect(() => {
    if (!open) {
      setItems([]);
      setInstruction('');
      setCheck(null);
      setDragOver(false);
      setBusy(false);
      return;
    }
    // Merged, not replaced: a second drop while the tray is open used to throw
    // away everything already gathered (AR-12).
    setItems((prev) => {
      const next = [...prev, ...(draft?.files ?? [])];
      if (draft?.text?.trim())
        next.push({ name: draft.fileName ?? pastedName(next), text: draft.text });
      return next;
    });
  }, [open, draft]);

  // The one guess left, made by the code that will do the reading.
  useEffect(() => {
    if (!open || items.length === 0) {
      setCheck(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      checkArrival(items)
        .then((c) => alive && setCheck(c))
        .catch(() => alive && setCheck(null));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, items, checkArrival]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const next: ArrivalItemInputDTO[] = [];
    for (const file of Array.from(files)) {
      // The real path where there is one: it is the only way a dropped FOLDER
      // can be walked at all (AR-14), and it keeps fifty files off the wire.
      const path = pathForFile(file);
      if (path) {
        next.push({ path, name: file.name, lastModified: file.lastModified });
        continue;
      }
      // Dragged out of a browser: no path, so the bytes ride along.
      if (readableAs(file.name) === null) {
        next.push({ name: file.name, lastModified: file.lastModified });
        continue;
      }
      if (file.type.startsWith('image/')) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(file);
        });
        next.push({
          name: file.name,
          dataBase64: dataUrl.split(',')[1] ?? '',
          lastModified: file.lastModified,
        });
      } else {
        next.push({ name: file.name, text: await file.text(), lastModified: file.lastModified });
      }
    }
    setItems((prev) => [...prev, ...next]);
  }, []);

  const choose = useCallback(async () => {
    const picked = await pickMaterial().catch(() => []);
    if (picked.length > 0) setItems((prev) => [...prev, ...picked]);
  }, [pickMaterial]);

  const submit = async () => {
    if (items.length === 0 || busy || !vault) return;
    setBusy(true);
    try {
      // The aim goes first and the PM's own sentence last, because where they
      // disagree the sentence they typed wins.
      const said = [aim ? aimSentence(aim) : '', instruction.trim()].filter(Boolean).join(' ');
      const result = await ingestArrival(items, said || undefined);
      // The material landed but nothing is reading it (no API key, or the skill
      // is switched off). The session tab will look idle and say nothing about
      // why, so the reason is the one thing that still has to be spoken.
      if (!result.started) {
        toast(
          result.reason
            ? `Your material is safe, but nothing is reading it: ${result.reason}`
            : 'Your material is safe, but nothing is reading it.',
        );
      }
      onHandoff(result);
      onOpenChange(false);
    } catch (err) {
      // The front door must never fail silently — the tray stays open with the
      // material intact so nothing the PM gathered is lost.
      toast(
        `Could not add material: ${err instanceof Error ? err.message : 'the workspace rejected the write.'}`,
      );
    } finally {
      setBusy(false);
    }
  };

  // Just the count: how much there is now sits on the rows themselves, where it
  // says which piece is the big one rather than only that something is.
  const meta = items.length > 0 ? `${items.length} file${items.length === 1 ? '' : 's'}` : '';

  const refused = check?.items.filter((i) => i.error) ?? [];
  const nothingReadable = !!check?.empty;
  const canSubmit = !!vault && !busy && items.length > 0 && !nothingReadable;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`top-[9vh] max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-2xl ${
          dragOver ? 'ring-brand/50' : ''
        }`}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            void submit();
          }
        }}
        onPaste={(e) => {
          // Pasted material is a row like any file, wherever in the tray it was
          // pasted. An image has nowhere else to go, and a wall of text pasted
          // into the instruction field is a transcript that would have been sent
          // as a prompt and the material itself thrown away (AR-5). Only a
          // sentence is left to the field it was aimed at.
          const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
          if (file) {
            e.preventDefault();
            void addFiles([file]);
            return;
          }
          const text = e.clipboardData.getData('text/plain');
          if (!text.trim()) return;
          if (e.target instanceof HTMLTextAreaElement && !isBulkPaste(text)) return;
          e.preventDefault();
          setItems((prev) => [...prev, { name: pastedName(prev), text }]);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
        }}
      >
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border pr-9 pl-4">
          <DialogTitle className="font-sans text-xs font-medium text-foreground/80">
            Add material
          </DialogTitle>
          <DialogDescription className="sr-only">
            Drop files or a folder, choose them, or paste. Whatever you add is filed and read for
            you; the field below is for anything you want to say about it.
          </DialogDescription>
          {meta && (
            <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{meta}</span>
          )}
        </div>

        <div className={`flex flex-col ${dragOver ? 'bg-brand/5' : ''}`}>
          {items.length === 0 ? (
            /* The empty tray leads with the drop zone: this is where the PM
               learns that dropping works at all. It also takes focus, so ⌘V
               lands here as material rather than in the instruction field. */
            <div className="px-4 pt-4">
              <button
                type="button"
                autoFocus
                onClick={choose}
                className={`flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none ${
                  dragOver
                    ? 'border-brand/60 bg-brand/5 text-brand'
                    : 'border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
              >
                <Upload className="size-5" aria-hidden />
                <span className="text-sm font-medium">Drop files or a folder here</span>
                <span className="text-xs">or click to choose them, or paste</span>
              </button>
              <TranscriptHelp />
            </div>
          ) : (
            <div className="flex max-h-56 flex-col gap-px overflow-y-auto px-2 pt-2">
              {items.map((item, i) => {
                const name = rowName(item);
                const failed = check?.items[i]?.error;
                const Icon = readableAs(name) === 'image' ? ImageIcon : FileText;
                // What the tray holds in its own hands it can describe: the
                // opening line and how much there is. A paste is a wall of text
                // nobody wants read back to them, but one line of it is how the
                // PM knows they pasted the right thing.
                const preview = item.text ? firstLine(item.text) : '';
                const size = item.text ? countWords(item.text) : 0;
                return (
                  <div
                    key={`${name}-${i}`}
                    className="group flex h-8 shrink-0 items-center gap-2 rounded-md px-2 hover:bg-accent/60"
                  >
                    <Icon
                      className={`size-3.5 shrink-0 ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
                      aria-hidden
                    />
                    <span
                      className={`truncate font-mono text-xs text-foreground/80 ${
                        preview ? 'max-w-[45%] shrink-0' : 'min-w-0 flex-1'
                      }`}
                    >
                      {name}
                    </span>
                    {preview && (
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
                        {preview}
                      </span>
                    )}
                    {/* Only a refusal earns text here. Where a file lands is the
                        agent's to work out and to say once it has read it. */}
                    {failed ? (
                      <span className="shrink-0 text-xs text-destructive">{failed}</span>
                    ) : (
                      size >= 25 && (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground/70 tabular-nums">
                          {size.toLocaleString()} words
                        </span>
                      )
                    )}
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((_, n) => n !== i))}
                      aria-label={`Remove ${name}`}
                      /* Quiet but always present: a control you can only find by
                         hovering is a control most people never find. */
                      className="rounded p-0.5 text-muted-foreground/45 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none group-hover:text-muted-foreground motion-reduce:transition-none"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {/* Outside the scroller — inside it, a seventh file pushed this half
              out of view and it read as a clipped row rather than a button. */}
          {items.length > 0 && (
            <button
              type="button"
              onClick={choose}
              className="mx-2 mt-0.5 flex h-7 shrink-0 items-center gap-1.5 self-start rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
            >
              <Plus className="size-3.5" aria-hidden />
              Add more
            </button>
          )}

          <textarea
            value={instruction}
            ref={instructionRef}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Anything I should know, or want done with these? (optional)"
            rows={1}
            disabled={!vault}
            aria-label="What to do with this material"
            className="h-14 w-full resize-none bg-transparent px-4 py-2.5 text-sm outline-none placeholder:text-foreground/70 disabled:opacity-50"
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-border bg-muted/40 px-4 py-3">
          {/* Where the drop was aimed, said back before it counts for anything.
              The agent is told the same sentence. */}
          {aim && (
            <p className="truncate text-xs text-foreground/80">
              Goes to <span className="font-medium">{aimLabel(aim)}</span>
            </p>
          )}
          <div className="flex items-center gap-3">
            {nothingReadable ? (
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="size-3 shrink-0 text-warning" aria-hidden />
                {items.length === 1
                  ? 'This one can’t be read. Try a .txt, .md or .vtt export.'
                  : 'None of these can be read. Try .txt, .md or .vtt exports.'}
              </p>
            ) : refused.length > 0 ? (
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="size-3 shrink-0 text-warning" aria-hidden />
                <span className="truncate">
                  {refused.length === 1
                    ? '1 file can’t be read'
                    : `${refused.length} files can’t be read`}
                  , the rest will be added
                </span>
              </p>
            ) : (
              <span className="flex-1" />
            )}
            <Button
              size="sm"
              variant={canSubmit ? 'default' : 'secondary'}
              className="shrink-0 disabled:opacity-100"
              onClick={submit}
              disabled={!canSubmit}
            >
              {busy ? (
                <>
                  <Spinner className="size-3.5" />
                  Adding…
                </>
              ) : (
                <>
                  {items.length > 1 ? `Add ${items.length} files` : 'Add material'}
                  <kbd className="ml-0.5 font-sans text-micro opacity-60" aria-hidden>
                    ⌘↵
                  </kbd>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Where a transcript even comes from, folded under the empty drop zone
 * (clarity review area 9). "Drop a transcript" is the First step that unblocks
 * most of the others, and it assumed everyone had exported one before. Paste
 * leads: it is the one path that works no matter which tool ran the meeting.
 */
function TranscriptHelp() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1 rounded text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none">
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform motion-reduce:transition-none',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        Where do I find a meeting transcript?
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-1 rounded-lg bg-accent/40 px-3 py-2 text-xs text-muted-foreground">
          <p>The simplest way: copy the text of any notes or transcript and paste it here.</p>
          <p>
            To export a file instead: Teams keeps the transcript on the meeting’s recap tab, Zoom
            under Recordings on zoom.us, and Meet attaches a Doc to the calendar event in Drive.
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
