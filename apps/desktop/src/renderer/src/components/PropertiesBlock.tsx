import { useEffect, useMemo, useRef, useState } from 'react';
import type { NoteDTO } from '@pm/ipc';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@pm/ui';
import {
  AlignLeft,
  Calendar,
  ChevronRight,
  CircleDot,
  Hash,
  Link2,
  List,
  Plus,
  Type,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../state/app-state';
import { invoke } from '../lib/ipc';
import { collectContexts } from '../lib/contexts';
import { FIELDS, REF_FIELDS, SYSTEM_KEYS, type FieldSpec, type Widget } from '../state/properties-schema';
import { TagInput } from './TagInput';

/**
 * Frontmatter as a collapsible property list under the title. Every row is a
 * typed widget with a type icon; edits autosave (selects/dates/tags
 * on change, text on blur or Enter, Escape reverts). Fields come from the
 * per-type schema; ref arrays render as clickable wikilink chips (provenance
 * is a first-class citizen here, not a footnote); unknown frontmatter keys
 * surface as removable custom rows, and `+ Add property` writes new ones —
 * the domain schema preserves keys it doesn't know.
 */

/** Borderless until hovered/focused — values read as text, edit on approach. */
const quietInput =
  'w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm transition-colors hover:border-input focus-visible:border-input focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none placeholder:text-muted-foreground/50';

const WIDGET_ICON: Record<Widget, LucideIcon> = {
  text: Type,
  textarea: AlignLeft,
  select: CircleDot,
  tags: List,
  date: Calendar,
};

/** `superseded_by` → `Superseded by` for keys without a schema label. */
function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Custom rows edit through a text input, but the file's type is truth: a row
 * that held a boolean/number parses the input back into that type ('true' →
 * true, '42' → 42); input that doesn't parse commits as the typed string
 * rather than being dropped.
 */
function coerceScalar(input: string, original: unknown): unknown {
  if (typeof original === 'boolean') {
    if (input === 'true') return true;
    if (input === 'false') return false;
  } else if (typeof original === 'number') {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return input;
}

const COLLAPSE_KEY = 'pm.properties.collapsed';

export function PropertiesBlock({ note, onDirty }: { note: NoteDTO; onDirty?: () => void }) {
  const { saveFrontmatter, loadDoc, tree, openContext, openDoc } = useApp();
  const tagSuggestions = useMemo(() => collectContexts(tree), [tree]);
  const [open, setOpen] = useState(() => localStorage.getItem(COLLAPSE_KEY) !== '1');

  // Later commits build on the latest local state, not stale props; the queue
  // serializes saves so rapid edits can't interleave (last write wins).
  const fmRef = useRef(note.frontmatter);
  useEffect(() => {
    fmRef.current = note.frontmatter;
  }, [note.frontmatter]);
  const queue = useRef(Promise.resolve());

  const commit = (key: string, value: unknown) => {
    const next = { ...fmRef.current };
    if (value === '' || value === undefined || (Array.isArray(value) && value.length === 0)) delete next[key];
    else next[key] = value;
    fmRef.current = next;
    onDirty?.();
    queue.current = queue.current
      .then(() => saveFrontmatter(note.path, { ...next, type: note.type }))
      .catch(async () => {
        // Schema reject main-side → resync UI to file truth.
        await loadDoc(note.path);
      });
  };

  const specs = (FIELDS[note.type] ?? FIELDS.note).filter((s) => s.key !== 'summary');
  const refs = REF_FIELDS.flatMap((key) => {
    const v = note.frontmatter[key];
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    const targets = arr.map((r) => String(r).replace(/^\[\[/, '').replace(/\]\]$/, ''));
    return targets.length > 0 ? [{ key, targets }] : [];
  });
  const known = new Set<string>([
    'type',
    'title',
    'summary',
    ...specs.map((s) => s.key),
    ...REF_FIELDS,
  ]);
  const customKeys = Object.keys(note.frontmatter).filter((k) => !known.has(k));
  const filledCount =
    specs.filter((s) => note.frontmatter[s.key] !== undefined).length + customKeys.length + refs.length;

  const openRef = (target: string) => {
    void invoke['note:resolveLink'](target).then((path) => {
      if (path) void openDoc(path);
    });
  };

  return (
    <div className="mb-4">
      <SummaryEditor value={note.summary} title={note.title} onCommit={(v) => commit('summary', v)} />
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          localStorage.setItem(COLLAPSE_KEY, next ? '0' : '1');
        }}
      >
        <CollapsibleTrigger className="group flex h-6 items-center gap-1 rounded-md pr-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          <ChevronRight
            className="size-3.5 transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none"
            aria-hidden
          />
          Properties
          {!open && filledCount > 0 && (
            <span className="font-normal text-muted-foreground/70">· {filledCount} set</span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 flex flex-col">
            {specs.map((spec) => (
              <PropertyRow key={spec.key} icon={spec.key === 'tags' ? Hash : WIDGET_ICON[spec.widget]} label={spec.label}>
                <PropertyValue
                  spec={spec}
                  value={note.frontmatter[spec.key]}
                  onCommit={(v) => commit(spec.key, v)}
                  tagSuggestions={spec.key === 'tags' ? tagSuggestions : undefined}
                  onTagClick={spec.key === 'tags' ? openContext : undefined}
                />
              </PropertyRow>
            ))}

            {refs.map(({ key, targets }) => (
              <PropertyRow key={key} icon={Link2} label={humanize(key)}>
                <div className="flex min-h-[26px] flex-wrap items-center gap-1 px-1.5 py-0.5">
                  {targets.map((target) => (
                    <button
                      key={target}
                      className="note-link text-xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      onClick={() => openRef(target)}
                      title={`Open ${target}`}
                    >
                      {target}
                    </button>
                  ))}
                </div>
              </PropertyRow>
            ))}

            {customKeys.map((key) => {
              const value = note.frontmatter[key];
              return (
                <PropertyRow
                  key={key}
                  icon={Type}
                  label={humanize(key)}
                  // Harness-written keys stay visible but lose the hover-X — a
                  // stray click must not delete part of a receipt or the spine.
                  onRemove={SYSTEM_KEYS.has(key) ? undefined : () => commit(key, undefined)}
                >
                  {typeof value === 'object' ? (
                    // Arrays/objects don't survive a text-input round trip
                    // (they'd come back as strings) — show them read-only.
                    <p
                      className="min-h-[26px] truncate px-1.5 py-0.5 text-sm text-muted-foreground"
                      title={JSON.stringify(value)}
                    >
                      {JSON.stringify(value)}
                    </p>
                  ) : (
                    <TextValue
                      value={typeof value === 'string' ? value : String(value)}
                      onCommit={(v) => commit(key, typeof v === 'string' ? coerceScalar(v, value) : v)}
                    />
                  )}
                </PropertyRow>
              );
            })}

            <AddPropertyRow
              reserved={new Set([...known, ...customKeys])}
              onAdd={(key, value) => commit(key, value)}
            />

            <p className="mt-1.5 px-1.5 text-xs text-muted-foreground/70">
              Modified {new Date(note.mtime).toLocaleString()}
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function PropertyRow({
  icon: Icon,
  label,
  onRemove,
  children,
}: {
  icon: LucideIcon;
  label: string;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="group/row -mx-1.5 flex items-start gap-1 rounded-md px-1.5 transition-colors hover:bg-accent/40">
      <span className="flex h-[26px] w-32 shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
        <span className="truncate" title={label}>
          {label}
        </span>
      </span>
      <div className="min-w-0 flex-1">{children}</div>
      {onRemove && (
        <button
          className="mt-1 rounded-sm p-0.5 text-muted-foreground/0 transition-colors group-hover/row:text-muted-foreground/60 hover:!text-destructive focus-visible:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          title={`Remove ${label}`}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * The note's deck: reads as the subtitle, click to edit in place. A summary
 * that just mirrors the title (capture keeps them in sync until authored) is
 * noise under the h1 — render it as the empty affordance instead, so only one
 * line on the page ever claims to be the note's name.
 */
function SummaryEditor({
  value,
  title,
  onCommit,
}: {
  value: string;
  title: string;
  onCommit: (v: string | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const norm = value.trim().toLowerCase();
  const echo = !norm || norm === title.trim().toLowerCase() || norm === 'untitled';

  if (draft === null) {
    return (
      <p
        className="mb-4 cursor-text rounded-md text-[15px] text-muted-foreground transition-colors hover:bg-accent/40"
        onClick={() => setDraft(echo ? '' : value)}
        title="Click to edit summary"
      >
        {echo ? <span className="text-muted-foreground/50">Add a summary…</span> : value}
      </p>
    );
  }
  return (
    <textarea
      className="mb-4 w-full field-sizing-content resize-none rounded-md border border-input bg-card px-2 py-1 text-[15px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        // Baseline is what editing started from — a click into the echo state
        // then away must not silently rewrite the mirrored summary.
        if (!cancelled.current && draft.trim() !== (echo ? '' : value)) onCommit(draft.trim() || undefined);
        cancelled.current = false;
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function PropertyValue({
  spec,
  value,
  onCommit,
  tagSuggestions,
  onTagClick,
}: {
  spec: FieldSpec;
  value: unknown;
  onCommit: (v: unknown) => void;
  tagSuggestions?: { tag: string; count: number }[];
  onTagClick?: (tag: string) => void;
}) {
  if (spec.widget === 'select') {
    const current = (value as string) ?? '';
    return (
      <select
        className={`${quietInput} ${current ? '' : 'text-muted-foreground/50'}`}
        value={current}
        onChange={(e) => onCommit(e.target.value || undefined)}
      >
        <option value="">Empty</option>
        {spec.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (spec.widget === 'date') {
    const current = (value as string) ?? '';
    return (
      <input
        type="date"
        className={`${quietInput} ${current ? '' : 'text-muted-foreground/50'}`}
        value={current}
        onChange={(e) => onCommit(e.target.value || undefined)}
      />
    );
  }
  if (spec.widget === 'tags') {
    const arr = Array.isArray(value) ? (value as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    return (
      <TagInput
        value={arr}
        onChange={(next) => onCommit(next.length > 0 ? next : undefined)}
        suggestions={tagSuggestions}
        normalize={
          onTagClick
            ? (raw) =>
                raw
                  .trim()
                  .toLowerCase()
                  .replace(/\s+/g, '-')
            : undefined
        }
        onTagClick={onTagClick}
        placeholder="Empty"
      />
    );
  }
  // 'text' (and any future free-text widget): draft while focused, Enter
  // commits (via blur), Escape reverts.
  return <TextValue value={(value as string) ?? ''} onCommit={onCommit} />;
}

function TextValue({ value, onCommit }: { value: string; onCommit: (v: unknown) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return (
    <input
      className={quietInput}
      value={draft ?? value}
      placeholder="Empty"
      onFocus={() => setDraft(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (!cancelled.current && draft !== null && draft.trim() !== value) onCommit(draft.trim() || undefined);
        cancelled.current = false;
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * `+ Add property` → an inline draft row (name, then value). Enter or blur on
 * the value commits; Escape cancels. Keys the schema owns are rejected — the
 * typed widgets above are their only writers.
 */
function AddPropertyRow({
  reserved,
  onAdd,
}: {
  reserved: Set<string>;
  onAdd: (key: string, value: string) => void;
}) {
  const [draft, setDraft] = useState<{ key: string; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef<HTMLInputElement>(null);

  if (draft === null) {
    return (
      <button
        className="-mx-1.5 mt-px flex h-[26px] items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => {
          setDraft({ key: '', value: '' });
          setError(null);
        }}
      >
        <Plus className="size-3.5" aria-hidden />
        Add property
      </button>
    );
  }

  const normKey = draft.key.trim().toLowerCase().replace(/\s+/g, '_');
  const commit = () => {
    if (!normKey) {
      setError('Name the property first.');
      return;
    }
    if (reserved.has(normKey)) {
      setError(`“${normKey}” already exists on this note.`);
      return;
    }
    if (!draft.value.trim()) {
      setError('Give it a value — empty properties aren’t saved.');
      return;
    }
    onAdd(normKey, draft.value.trim());
    setDraft(null);
    setError(null);
  };
  const cancel = () => {
    setDraft(null);
    setError(null);
  };

  return (
    <div className="-mx-1.5 rounded-md bg-accent/40 px-1.5 py-0.5">
      <div className="flex items-start gap-1">
        <span className="flex h-[26px] w-32 shrink-0 items-center gap-1.5">
          <Type className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
          <input
            className="w-full rounded-sm border border-transparent bg-transparent px-0.5 py-0.5 text-xs font-medium text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:border-input focus-visible:bg-card focus-visible:outline-none"
            placeholder="Property name"
            value={draft.key}
            autoFocus
            onChange={(e) => {
              setDraft({ ...draft, key: e.target.value });
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                valueRef.current?.focus();
              }
              if (e.key === 'Escape') cancel();
            }}
            aria-label="Property name"
          />
        </span>
        <input
          ref={valueRef}
          className={quietInput}
          placeholder="Value"
          value={draft.value}
          onChange={(e) => {
            setDraft({ ...draft, value: e.target.value });
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') cancel();
          }}
          onBlur={(e) => {
            // Moving between the two draft inputs isn't leaving the row.
            if (e.relatedTarget && e.currentTarget.parentElement?.parentElement?.contains(e.relatedTarget as Node)) return;
            if (draft.key.trim() || draft.value.trim()) commit();
            else cancel();
          }}
          aria-label="Property value"
        />
      </div>
      {error && <p className="px-1.5 pb-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
