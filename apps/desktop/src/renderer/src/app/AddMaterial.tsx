import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Button,
  Spinner,
} from '@pm/ui';
import {
  ArrowRight,
  Check,
  Image as ImageIcon,
  Link as LinkIcon,
  Mic,
  Plus,
  StickyNote,
  TriangleAlert,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import type {
  ArrivalAmbitionDTO,
  ArrivalItemInputDTO,
  ArrivalPlanDTO,
  ArrivalResultDTO,
  CaptureKind,
} from '@pm/ipc';
import { readableAs } from '@pm/domain';
import { useApp } from '../state/app-state';
import { useToast } from '../components/toast';

/** Material handed to the tray before it opens (a drop, a paste from Home). */
export interface MaterialDraft {
  text?: string;
  fileName?: string;
  image?: { name: string; dataUrl: string };
  files?: ArrivalItemInputDTO[];
}

const KIND_ICON: Record<CaptureKind, LucideIcon> = {
  transcript: Mic,
  link: LinkIcon,
  screenshot: ImageIcon,
  note: StickyNote,
};

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

/**
 * Add material — the visible front door (docs/vision/arrival.md §7).
 *
 * A tray, not a classification form. It holds 1..N pieces of material and says
 * one thing about the whole batch: where it lands and what will run. The old
 * capture dialog asked the PO to answer "what is this?" in our vocabulary
 * before anything could happen; the type of a file is something we can work out
 * and, when we get it wrong, something one click on the receipt corrects.
 *
 * It is also where dropping is *advertised*. A drop target nobody can see is a
 * trick, not a door — so the empty tray leads with a real drop zone next to the
 * OS picker, and once the PO has seen it here they know they can drop anywhere.
 */
export function AddMaterial({
  open,
  onOpenChange,
  draft,
  onArrived,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  draft?: MaterialDraft | null;
  /** Hands the batch to its receipt — the tray closes, the way back stays. */
  onArrived: (result: ArrivalResultDTO) => void;
}) {
  const { vault, pickMaterial, inspectArrival, ingestArrival, openSession } = useApp();
  const toast = useToast();
  const [items, setItems] = useState<ArrivalItemInputDTO[]>([]);
  const [text, setText] = useState('');
  const [ambition, setAmbition] = useState<ArrivalAmbitionDTO | undefined>();
  const [plan, setPlan] = useState<ArrivalPlanDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setItems(draft?.files ?? (draft?.image ? [imageItem(draft.image)] : []));
      setText(draft?.text ?? '');
    } else {
      setItems([]);
      setText('');
      setAmbition(undefined);
      setPlan(null);
      setDragOver(false);
      setBusy(false);
    }
  }, [open, draft]);

  /**
   * With files in the tray the text is an instruction *about* them; with an
   * empty tray it is the material itself. Inferable from what is there, so it
   * needs no toggle — only a placeholder that says which one it currently is.
   */
  const asMaterial = items.length === 0;
  const material = useMemo(
    () => (asMaterial && text.trim() ? [...items, { text: text.trim() }] : items),
    [items, text, asMaterial],
  );
  const instruction = asMaterial ? '' : text.trim();

  // The outcome line is the plan itself, computed by the code that will run it.
  useEffect(() => {
    if (!open || material.length === 0) {
      setPlan(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      inspectArrival(material, ambition)
        .then((p) => alive && setPlan(p))
        .catch(() => alive && setPlan(null));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, material, ambition, inspectArrival]);

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const next: ArrivalItemInputDTO[] = [];
    for (const file of Array.from(files)) {
      // Name-only: main turns this into a legible refusal rather than us
      // decoding a zip as UTF-8 and filing the result.
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
    if (material.length === 0 || busy || !vault) return;
    setBusy(true);
    try {
      const result = await ingestArrival(material, ambition);
      // An instruction turns the batch into an errand: the material is already
      // filed and cited by path, so the session reads what landed rather than a
      // copy of it.
      const paths = result.items.filter((i) => i.path).map((i) => i.path!);
      if (instruction && paths.length > 0) {
        openSession('ask', {
          title: `Ask · ${paths.length} new file${paths.length === 1 ? '' : 's'}`,
          initialPrompt: `I just added these to the workspace:\n${paths.map((p) => `- ${p}`).join('\n')}\n\n${instruction}`,
        });
      }
      onArrived(result);
      onOpenChange(false);
    } catch (err) {
      // The front door must never fail silently — the tray stays open with the
      // material intact so nothing the PO gathered is lost.
      toast(`Could not add material: ${err instanceof Error ? err.message : 'the workspace rejected the write.'}`);
    } finally {
      setBusy(false);
    }
  };

  const words = useMemo(
    () => items.reduce((n, i) => n + countWords(i.text ?? ''), 0) + countWords(text),
    [items, text],
  );
  const meta = [
    items.length > 0 ? `${items.length} file${items.length === 1 ? '' : 's'}` : null,
    words >= 25 ? `${words.toLocaleString()} words` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const good = plan?.items.filter((i) => !i.error) ?? [];
  const bad = plan?.items.filter((i) => i.error) ?? [];
  /** `meetings/ ×2 · sources/ ×1` — the destination, aggregated. Keyed off the
   *  plan itself, not off a filtered copy that is new on every render. */
  const destinations = useMemo(() => {
    const byDir = new Map<string, number>();
    for (const i of plan?.items ?? []) if (!i.error) byDir.set(i.dir, (byDir.get(i.dir) ?? 0) + 1);
    return [...byDir.entries()].map(([dir, n]) => ({ dir, n }));
  }, [plan]);

  const catchup = plan?.ambition === 'catchup';
  // A tray holding only files we cannot read has nothing to add: the button
  // would file an empty note and call it success.
  const nothingReadable = !!plan && good.length === 0;
  const canSubmit = !!vault && !busy && material.length > 0 && !nothingReadable;

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
            Drop files, choose them, or paste a transcript. The tray says where everything lands and
            what will run before you add it.
          </DialogDescription>
          {meta && (
            <span className="ml-auto truncate font-mono text-xs text-muted-foreground">{meta}</span>
          )}
        </div>

        <div className={`flex flex-col ${dragOver ? 'bg-brand/5' : ''}`}>
          {items.length === 0 ? (
            /* The empty tray leads with the drop zone: this is where the PO
               learns that dropping works at all. */
            <div className="px-4 pt-4">
              <button
                type="button"
                onClick={choose}
                className={`flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none ${
                  dragOver
                    ? 'border-brand/60 bg-brand/5 text-brand'
                    : 'border-border text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                }`}
              >
                <Upload className="size-5" aria-hidden />
                <span className="text-sm font-medium">Drop files here</span>
                <span className="text-xs">or click to choose them</span>
              </button>
            </div>
          ) : (
            <div className="flex max-h-56 flex-col gap-px overflow-y-auto px-2 pt-2">
              {items.map((item, i) => {
                const planned = plan?.items[i];
                const Icon = KIND_ICON[planned?.kind ?? 'note'];
                const failed = planned?.error;
                return (
                  <div
                    key={`${item.name ?? 'pasted'}-${i}`}
                    className="group flex h-8 shrink-0 items-center gap-2 rounded-md px-2 hover:bg-accent/60"
                  >
                    <Icon
                      className={`size-3.5 shrink-0 ${failed ? 'text-destructive' : 'text-muted-foreground'}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80">
                      {item.name ?? 'Pasted text'}
                    </span>
                    {failed ? (
                      <span className="shrink-0 text-xs text-destructive">{failed}</span>
                    ) : (
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {planned?.dir}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((_, n) => n !== i))}
                      aria-label={`Remove ${item.name ?? 'pasted text'}`}
                      /* Quiet but always present: a control you can only find
                         by hovering is a control most people never find. */
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
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
              if (file) {
                e.preventDefault();
                void addFiles([file]);
              }
            }}
            placeholder={
              asMaterial
                ? '…or paste a transcript, a link, an email thread'
                : 'Anything I should do with these? (optional)'
            }
            rows={1}
            disabled={!vault}
            autoFocus
            aria-label={asMaterial ? 'Paste material' : 'What to do with this material'}
            /* Material sets at reading size; an instruction about material is
               chrome, and setting both at 15px made the optional field read as
               the main event. */
            className={`w-full resize-none bg-transparent px-4 outline-none placeholder:text-foreground/70 disabled:opacity-50 ${
              asMaterial ? 'h-28 py-3 text-body leading-relaxed' : 'h-14 py-2.5 text-sm'
            }`}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-border bg-muted/40 px-4 py-3">
          {/*
            The one thing in this tray that isn't just filing: whether an agent
            gets to work on the material. It names the skill that will actually
            run and how many items it takes, because "2 reviews open" told the
            PO that something would happen without saying what — and it switches
            both ways, where the old copy could only turn extraction on.
           */}
          {plan && !nothingReadable && (
            <button
              type="button"
              role="switch"
              aria-checked={!catchup}
              onClick={() => setAmbition(catchup ? 'capture' : 'catchup')}
              className="group flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:transition-none"
            >
              <span
                className={`grid size-3.5 shrink-0 place-items-center rounded-[4px] border transition-colors duration-150 motion-reduce:transition-none ${
                  catchup ? 'border-input' : 'border-brand bg-brand text-brand-foreground'
                }`}
              >
                {!catchup && <Check className="size-2.5" strokeWidth={3} aria-hidden />}
              </span>
              {catchup ? (
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  <span className="font-medium text-foreground/80">Just file them</span>
                  {plan.ambitionAuto && plan.reason ? ` · ${plan.reason}` : ''}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs text-foreground/80">
                  {plan.runs.length > 0 ? (
                    plan.runs.map((r, i) => (
                      <span key={r.skill + r.verb}>
                        {i > 0 && <span className="text-muted-foreground"> · </span>}
                        <span className="font-medium">{r.title}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          {r.verb} {r.count === 1 ? 'it' : `all ${r.count}`}
                        </span>
                      </span>
                    ))
                  ) : (
                    <span className="text-muted-foreground">Nothing to run over these</span>
                  )}
                </span>
              )}
              {/* Amber only where the SYSTEM decided, not where the PO did —
                  an inference always says so (DESIGN §2). */}
              {catchup && plan.ambitionAuto && (
                <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden />
              )}
            </button>
          )}
          {!catchup && plan?.match && (
            <div className="flex items-center gap-2 text-xs">
              <Mic className="size-3.5 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-foreground/80">
                Attaches to <span className="font-medium">{plan.match.title}</span>
                <span className="text-muted-foreground"> · already on your calendar</span>
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            {nothingReadable ? (
              /* No destination to state, so state the problem instead of an
                 arrow pointing at an empty folder name. */
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="size-3 shrink-0 text-warning" aria-hidden />
                {bad.length === 1
                  ? 'This file can’t be read yet — try a .txt, .md or .vtt export.'
                  : 'None of these can be read yet — try .txt, .md or .vtt exports.'}
              </p>
            ) : material.length > 0 ? (
              <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-mono text-foreground/80">
                  {destinations.map((d) => `${d.dir}${d.n > 1 ? ` ×${d.n}` : ''}`).join('  ')}
                </span>
                {bad.length > 0 && (
                  <span className="shrink-0 text-destructive">
                    · {bad.length} unreadable
                  </span>
                )}
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

/** A pasted or dropped image, already read by whoever opened the tray. */
function imageItem(image: { name: string; dataUrl: string }): ArrivalItemInputDTO {
  return { name: image.name, dataBase64: image.dataUrl.split(',')[1] ?? '' };
}
