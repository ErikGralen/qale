import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Input,
} from '@pm/ui';
import { Image as ImageIcon, Link as LinkIcon, Mic, StickyNote, X, type LucideIcon } from 'lucide-react';
import type { CaptureClassificationDTO, CaptureKind } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { useToast } from '../components/toast';
import { invoke } from '../lib/ipc';

/** A dropped/pasted payload handed to the dialog before the user confirms. */
export interface CaptureDraft {
  text?: string;
  fileName?: string;
  image?: { name: string; dataUrl: string };
}

const KIND_META: Record<CaptureKind, { label: string; icon: LucideIcon }> = {
  transcript: { label: 'Transcript', icon: Mic },
  link: { label: 'Link', icon: LinkIcon },
  screenshot: { label: 'Screenshot', icon: ImageIcon },
  note: { label: 'Note', icon: StickyNote },
};

const URL_ANYWHERE = /https?:\/\/\S+/;

/**
 * Universal capture (⇧⌘N and every drop): dump anything — a transcript, an
 * article link, a screenshot, a stray thought — and the system classifies and
 * files it. The classifier's guess shows live as an overridable chip; the
 * footer always says exactly what will happen. Nothing silent.
 */
export function CaptureDialog({
  open,
  onOpenChange,
  draft,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  draft?: CaptureDraft | null;
}) {
  const { ingestCapture, vault } = useApp();
  const toast = useToast();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [fileName, setFileName] = useState<string | undefined>();
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [override, setOverride] = useState<CaptureKind | null>(null);
  const [guess, setGuess] = useState<CaptureClassificationDTO | null>(null);
  const [external, setExternal] = useState(false);
  const [origin, setOrigin] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Consume the shell-drop draft when the dialog opens; reset fully on close.
  useEffect(() => {
    if (open) {
      setText(draft?.text ?? '');
      setFileName(draft?.fileName);
      setImage(draft?.image ?? null);
    } else {
      setText('');
      setTitle('');
      setFileName(undefined);
      setImage(null);
      setOverride(null);
      setGuess(null);
      setExternal(false);
      setOrigin('');
      setDragOver(false);
    }
  }, [open, draft]);

  // Live classification — debounced, main-side, same heuristics the pipeline uses.
  useEffect(() => {
    if (!open || image || !text.trim()) {
      setGuess(null);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      const c = await invoke['capture:classify'](text, fileName).catch(() => null);
      if (alive) setGuess(c);
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, text, fileName, image]);

  const detectedUrl = useMemo(() => guess?.url ?? URL_ANYWHERE.exec(text)?.[0], [guess, text]);
  // A link override only holds while a URL is actually present in the text.
  const validOverride = override && (override !== 'link' || detectedUrl) ? override : null;
  const kind: CaptureKind = image ? 'screenshot' : (validOverride ?? guess?.kind ?? 'note');

  const chips: CaptureKind[] = image
    ? ['screenshot']
    : detectedUrl
      ? ['note', 'transcript', 'link']
      : ['note', 'transcript'];

  const acceptFile = useCallback(async (file: File) => {
    if (file.type.startsWith('image/')) {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      setImage({ name: file.name, dataUrl });
      setOverride(null);
    } else {
      setText(await file.text());
      setFileName(file.name);
      setOverride(null);
      textareaRef.current?.focus();
    }
  }, []);

  const canSubmit =
    !!vault &&
    !busy &&
    (image
      ? text.trim().length > 0 // the caption is the claim — required, the agent can't read pixels
      : text.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await ingestCapture({
        kind,
        text: text.trim(),
        title: title.trim() || undefined,
        url: kind === 'link' ? detectedUrl : undefined,
        external: kind === 'transcript' ? external : undefined,
        origin: kind === 'transcript' && external ? origin.trim() || undefined : undefined,
        attachment: image ? { name: image.name, dataBase64: image.dataUrl.split(',')[1] ?? '' } : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      // The primary capture path must never fail silently: the dialog stays
      // open with the text intact so nothing typed is lost.
      toast(`Capture failed: ${err instanceof Error ? err.message : 'the workspace rejected the write.'}`);
    } finally {
      setBusy(false);
    }
  };

  const helper = !vault
    ? 'Open a workspace first.'
    : kind === 'transcript'
      ? external
        ? 'Filed under sources/ as signal — insights and customer updates arrive in your Inbox, never decisions.'
        : 'Lands in meetings/ — After-Meeting reviews it in the background; its cards arrive in your Inbox.'
      : kind === 'link'
        ? 'Filed in notes/ with the link — Intake connects it to your memory as cards you approve.'
        : kind === 'screenshot'
          ? 'Image kept in attachments/ as evidence — your line is the claim, and Intake connects it.'
          : 'Lands in notes/.';

  const action =
    kind === 'transcript'
      ? external
        ? 'Capture & extract signals'
        : 'Capture & review'
      : kind === 'link' || kind === 'screenshot'
        ? 'Capture & connect'
        : 'Capture';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-xl"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void acceptFile(file);
        }}
      >
        <DialogHeader>
          <DialogTitle>Capture</DialogTitle>
          <DialogDescription>
            Dump anything — a transcript, a link, a screenshot, a thought. The system files it.
          </DialogDescription>
        </DialogHeader>

        {kind === 'transcript' && !image && (
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={fileName ? `Meeting title — ${guess?.title ?? fileName}` : 'Meeting title (e.g. Nordkap QBR — 2026-07-14)'}
            aria-label="Meeting title"
          />
        )}

        {image && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-2">
            <img src={image.dataUrl} alt="" className="size-14 shrink-0 rounded-md object-cover ring-1 ring-foreground/10" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{image.name}</div>
              <div className="text-xs text-muted-foreground">Kept as evidence — the agent reads your line, not the pixels.</div>
            </div>
            <button
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setImage(null)}
              aria-label="Remove image"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
          }}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
            if (file) {
              e.preventDefault();
              void acceptFile(file);
            }
          }}
          placeholder={
            image
              ? 'One line on what this shows — filed as the claim…  (⌘↵ to capture)'
              : 'Paste a transcript, a link, a thought — or drop a file here…  (⌘↵ to capture)'
          }
          rows={image ? 3 : 7}
          disabled={!vault}
          autoFocus
          className={`w-full resize-none rounded-lg border bg-card p-3 text-[15px] leading-relaxed outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 ${
            dragOver ? 'border-brand bg-brand/4' : 'border-input'
          }`}
        />

        {(text.trim() || image) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs font-medium text-muted-foreground">Files as</span>
            {chips.map((k) => {
              const Icon = KIND_META[k].icon;
              const selected = k === kind;
              return (
                <button
                  key={k}
                  onClick={() => !image && setOverride(k === guess?.kind ? null : k)}
                  aria-pressed={selected}
                  className={`flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none ${
                    selected
                      ? 'bg-brand/10 text-brand ring-1 ring-brand/30'
                      : 'bg-muted/60 text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon className="size-3" aria-hidden />
                  {KIND_META[k].label}
                  {selected && !validOverride && !image && <span className="opacity-60">· auto</span>}
                </button>
              );
            })}
            {guess?.confidence === 'low' && !validOverride && !image && (
              <span className="text-xs text-muted-foreground">best guess — click to change</span>
            )}
          </div>
        )}

        {kind === 'transcript' && !image && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={external}
                onChange={(e) => setExternal(e.target.checked)}
              />
              Someone else's meeting — I wasn't in it; extract signals only, file as a source.
            </label>
            {external && (
              <Input
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                placeholder="Whose meeting? (e.g. Jonas Palm — sales call)"
                aria-label="Origin"
              />
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-6">
          <span className="flex-1 text-xs leading-relaxed text-muted-foreground">{helper}</span>
          <Button size="sm" className="shrink-0" onClick={submit} disabled={!canSubmit}>
            {busy ? 'Filing…' : action}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
