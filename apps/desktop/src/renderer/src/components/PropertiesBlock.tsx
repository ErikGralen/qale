import { useEffect, useMemo, useRef, useState } from 'react';
import type { NoteDTO } from '@pm/ipc';
import { useApp } from '../state/app-state';
import { collectContexts } from '../lib/contexts';
import { FIELDS, REF_FIELDS, type FieldSpec } from '../state/properties-schema';
import { TagInput } from './TagInput';

/**
 * Frontmatter as inline-editable rows at the top of the document (the
 * OpenKnowledge property-panel idea, barebones). Every edit autosaves:
 * selects/dates/checkboxes/tags commit on change, text on blur or Enter
 * (Escape reverts) — consistent with the body editor's autosave. Fields come
 * from the per-type schema; unknown frontmatter keys are always preserved.
 */

/** Borderless until hovered/focused — values read as text, edit on approach. */
const quietInput =
  'w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm transition-colors hover:border-input focus-visible:border-input focus-visible:bg-card focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none';

export function PropertiesBlock({ note, onDirty }: { note: NoteDTO; onDirty?: () => void }) {
  const { saveFrontmatter, loadDoc, tree, openContext } = useApp();
  const tagSuggestions = useMemo(() => collectContexts(tree), [tree]);

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
  const refs = REF_FIELDS.flatMap((k) => {
    const v = note.frontmatter[k];
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    return arr.map((r) => ({ key: k, ref: String(r) }));
  });

  return (
    <div className="mb-4">
      <SummaryEditor value={note.summary} title={note.title} onCommit={(v) => commit('summary', v)} />
      <div className="grid grid-cols-[7.5rem_1fr] items-center gap-x-2 gap-y-px">
        {specs.map((spec) => (
          <PropertyRow
            key={spec.key}
            spec={spec}
            value={note.frontmatter[spec.key]}
            onCommit={(v) => commit(spec.key, v)}
            tagSuggestions={spec.key === 'tags' ? tagSuggestions : undefined}
            onTagClick={spec.key === 'tags' ? openContext : undefined}
          />
        ))}
      </div>
      {refs.length > 0 && (
        <div className="mt-2 flex flex-wrap items-baseline gap-1">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Links</span>
          {refs.map((r) => (
            <span
              key={`${r.key}:${r.ref}`}
              className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
            >
              {r.key}: {r.ref.replace(/^\[\[/, '').replace(/\]\]$/, '')}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 text-xs text-muted-foreground/70">
        Modified {new Date(note.mtime).toLocaleString()}
      </div>
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

function PropertyRow({
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
  return (
    <>
      <span className="text-xs font-medium text-muted-foreground">{spec.label}</span>
      <PropertyValue spec={spec} value={value} onCommit={onCommit} tagSuggestions={tagSuggestions} onTagClick={onTagClick} />
    </>
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
  if (spec.widget === 'bool') {
    return (
      <label className="flex h-6 items-center px-1">
        <input type="checkbox" checked={value === true} onChange={(e) => onCommit(e.target.checked || undefined)} />
      </label>
    );
  }
  if (spec.widget === 'select') {
    return (
      <select className={quietInput} value={(value as string) ?? ''} onChange={(e) => onCommit(e.target.value || undefined)}>
        <option value="">—</option>
        {spec.options?.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  if (spec.widget === 'date') {
    return (
      <input
        type="date"
        className={quietInput}
        value={(value as string) ?? ''}
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
        placeholder={onTagClick ? 'Add tag…' : 'Add…'}
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
      placeholder="—"
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
