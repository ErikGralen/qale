import { useEffect, useMemo, useRef, useState } from 'react';
import {
  latestVerification,
  linkTypeLabel,
  parseActor,
  trustTier,
  trustTierLabel,
  TYPE_RULES,
  type Verification,
} from '@pm/domain';
import type { NoteDTO } from '@pm/ipc';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@pm/ui';
import {
  AlignLeft,
  BadgeCheck,
  Calendar,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Hash,
  Link2,
  Lock,
  List,
  Plus,
  Type,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '../state/app-state';
import { navFromEvent } from '../lib/nav';
import { invoke } from '../lib/ipc';
import { webUrl } from '../lib/urls';
import { collectContexts } from '../lib/contexts';
import { FIELDS, REF_FIELDS, SYSTEM_KEYS, type FieldSpec, type Widget } from '../state/properties-schema';
import { TagInput } from './TagInput';
import { PeopleInput } from './PeopleInput';
import { PersonChip } from './PersonChip';

/**
 * Frontmatter as a collapsible property list under the title. Every row is a
 * typed widget with a type icon; edits autosave (selects/dates/tags
 * on change, text on blur or Enter, Escape reverts). Fields come from the
 * per-type schema; ref arrays render as clickable wikilink chips (provenance
 * is a first-class citizen here, not a footnote); unknown frontmatter keys
 * surface as removable custom rows behind a `N more` fold — a synced note
 * carries a dozen of them and they'd otherwise bury the six a human reads —
 * and `+ Add property` writes new ones; the domain schema preserves keys it
 * doesn't know.
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
  readonly: Lock,
  people: Users,
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

/**
 * Ticket relationships written by sync: `parent` reads as "Part of"; `links`
 * entries group under their relationship label ("Blocks", "Blocked by") in the
 * direction the ticket sees them.
 */
function ticketRelationRows(fm: Record<string, unknown>): { label: string; targets: string[] }[] {
  const rows: { label: string; targets: string[] }[] = [];
  const parent = fm['parent'];
  if (typeof parent === 'string' && parent) rows.push({ label: 'Part of', targets: [parent] });
  const byLabel = new Map<string, string[]>();
  for (const entry of Array.isArray(fm['links']) ? fm['links'] : []) {
    const e = entry as { type?: unknown; key?: unknown; reversed?: unknown };
    if (typeof e.type !== 'string' || typeof e.key !== 'string' || !e.key) continue;
    const raw = linkTypeLabel(e.type, e.reversed === true);
    const label = raw.charAt(0).toUpperCase() + raw.slice(1);
    byLabel.set(label, [...(byLabel.get(label) ?? []), e.key]);
  }
  rows.push(...[...byLabel.entries()].map(([label, targets]) => ({ label, targets })));
  return rows;
}

/** Read a note's `verified` frontmatter into typed records, dropping malformed
 *  entries — the schema tolerates and preserves shapes we don't model, so the
 *  UI must never assume the array is well-formed. */
function coerceVerified(value: unknown): Verification[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (v && typeof v === 'object' && typeof (v as Verification).by === 'string' && typeof (v as Verification).at === 'string') {
      return [{ by: (v as Verification).by, at: (v as Verification).at }];
    }
    return [];
  });
}

/**
 * The OKF trust tier (OKF alignment, phase 2), shown next to the freshness
 * status: who last confirmed the note is still true, and when. Absence is the
 * "unverified" default and shows no row — this only appears once something has
 * actually been verified.
 */
function TrustRow({ verifications }: { verifications: Verification[] }) {
  const tier = trustTier(verifications);
  const latest = latestVerification(verifications);
  const who = latest ? parseActor(latest.by) : null;
  const when = latest && /^\d{4}-\d{2}-\d{2}/.test(latest.at) ? latest.at.slice(0, 10) : latest?.at;
  const detail = who ? `${who.id}${when ? ` · ${when}` : ''}` : null;
  return (
    <PropertyRow icon={BadgeCheck} label="Trust">
      <div className="flex min-h-[26px] flex-wrap items-center gap-1.5 px-1.5 py-0.5 text-sm">
        <span
          className={
            tier === 'human'
              ? 'rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400'
              : 'rounded-full bg-sky-500/15 px-1.5 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400'
          }
        >
          {trustTierLabel(tier)}
        </span>
        {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      </div>
    </PropertyRow>
  );
}

const COLLAPSE_KEY = 'pm.properties.collapsed';
const SHOW_ALL_KEY = 'pm.properties.showAll';

export function PropertiesBlock({ note, onDirty }: { note: NoteDTO; onDirty?: () => void }) {
  const { saveFrontmatter, loadDoc, tree, openContext, openDoc } = useApp();
  const tagSuggestions = useMemo(() => collectContexts(tree), [tree]);
  const [open, setOpen] = useState(() => localStorage.getItem(COLLAPSE_KEY) !== '1');
  // Whether the machine-written tail is unfolded. A preference, not per-note
  // state: someone who wants to see `external_id` wants to see it everywhere.
  const [showAll, setShowAll] = useState(() => localStorage.getItem(SHOW_ALL_KEY) === '1');

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
  // What this note type actually lets a human change (@pm/domain TYPE_RULES —
  // a meeting's provenance is immutable, a decision is append-only). Main
  // rejects the rest, so offering an editable widget for them was a lie the UI
  // told and the file quietly refused: those rows read as values, not inputs.
  const mutable = TYPE_RULES[note.type]?.mutableFields ?? 'all';
  const canEdit = (key: string): boolean => mutable === 'all' || mutable.includes(key);
  const refs = REF_FIELDS.flatMap((key) => {
    const v = note.frontmatter[key];
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
    const targets = arr.map((r) => String(r).replace(/^\[\[/, '').replace(/\]\]$/, ''));
    return targets.length > 0 ? [{ key, targets }] : [];
  });
  // Ticket relationships written by sync: `parent` reads
  // as "Part of"; `links` entries group under their relationship label. They
  // render as the same ref chips — synced, so no remove affordance.
  const relationRows =
    note.type === 'ticket' ? ticketRelationRows(note.frontmatter) : [];
  // `verified` renders as the derived Trust row below, not as a raw-JSON custom
  // row — so it's "known" for the purpose of custom-key detection.
  const verifications = coerceVerified(note.frontmatter['verified']);
  const known = new Set<string>([
    'type',
    'title',
    'summary',
    'parent',
    'links',
    'verified',
    ...specs.map((s) => s.key),
    ...REF_FIELDS,
  ]);
  const customKeys = Object.keys(note.frontmatter).filter((k) => !known.has(k));
  // The type's own schema is what a human came here to read; everything else is
  // sync provenance (`provider`, `external_id`, `calendar`, `event_status`…) —
  // true, worth keeping, but not worth a row until asked for. The exception is
  // a link out: a mirror's `url` is the one machine-written key someone
  // actually clicks, so it stays with the schema rows.
  const linkOutKeys = customKeys.filter((k) => webUrl(note.frontmatter[k]));
  const tailKeys = customKeys.filter((k) => !webUrl(note.frontmatter[k]));
  const filledCount =
    specs.filter((s) => note.frontmatter[s.key] !== undefined).length +
    customKeys.length +
    refs.length +
    relationRows.length +
    (verifications.length > 0 ? 1 : 0);

  const openRef = (target: string, e?: React.MouseEvent) => {
    const opts = e && navFromEvent(e);
    void invoke['note:resolveLink'](target).then((path) => {
      if (path) void openDoc(path, opts);
    });
  };

  return (
    <div className="mb-4">
      <SummaryEditor
        value={note.summary}
        title={note.title}
        readOnly={!canEdit('summary')}
        onCommit={(v) => commit('summary', v)}
      />
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
                  readOnly={!canEdit(spec.key)}
                  onCommit={(v) => commit(spec.key, v)}
                  tagSuggestions={spec.key === 'tags' ? tagSuggestions : undefined}
                  onTagClick={spec.key === 'tags' ? openContext : undefined}
                />
              </PropertyRow>
            ))}

            {verifications.length > 0 && <TrustRow verifications={verifications} />}

            {refs.map(({ key, targets }) => (
              <PropertyRow key={key} icon={Link2} label={humanize(key)}>
                <div className="flex min-h-[26px] flex-wrap items-center gap-1 px-1.5 py-0.5">
                  {targets.map((target) => (
                    <button
                      key={target}
                      className="note-link text-xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      onClick={(e) => openRef(target, e)}
                      title={`Open ${target}`}
                    >
                      {target}
                    </button>
                  ))}
                </div>
              </PropertyRow>
            ))}

            {relationRows.map(({ label, targets }) => (
              <PropertyRow key={label} icon={Link2} label={label}>
                <div className="flex min-h-[26px] flex-wrap items-center gap-1 px-1.5 py-0.5">
                  {targets.map((target) => (
                    <button
                      key={target}
                      className="note-link text-xs focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      onClick={(e) => openRef(target, e)}
                      title={`Open ${target}`}
                    >
                      {target}
                    </button>
                  ))}
                </div>
              </PropertyRow>
            ))}

            {linkOutKeys.map((key) => (
              <CustomRow
                key={key}
                propKey={key}
                value={note.frontmatter[key]}
                locked={!canEdit(key)}
                onCommit={commit}
              />
            ))}

            {showAll &&
              tailKeys.map((key) => (
                <CustomRow
                  key={key}
                  propKey={key}
                  value={note.frontmatter[key]}
                  locked={!canEdit(key)}
                  onCommit={commit}
                />
              ))}

            {tailKeys.length > 0 && (
              <button
                className="group/more -mx-1.5 mt-px flex h-[26px] items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-muted-foreground/70 transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                onClick={() => {
                  setShowAll(!showAll);
                  localStorage.setItem(SHOW_ALL_KEY, showAll ? '0' : '1');
                }}
              >
                <ChevronRight
                  className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${showAll ? 'rotate-90' : ''}`}
                  aria-hidden
                />
                {showAll ? 'Show less' : `${tailKeys.length} more`}
              </button>
            )}

            {/* A type with frozen frontmatter has no room for new keys either —
                main rejects them, so the affordance doesn't appear. */}
            {mutable === 'all' && (
              <AddPropertyRow
                reserved={new Set([...known, ...customKeys])}
                onAdd={(key, value) => commit(key, value)}
              />
            )}

            <p className="mt-1.5 px-1.5 text-xs text-muted-foreground/70">
              Modified {new Date(note.mtime).toLocaleString()}
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/**
 * A frontmatter key the type's schema doesn't know: rendered from the value's
 * own shape rather than a widget spec.
 */
function CustomRow({
  propKey,
  value,
  locked,
  onCommit,
}: {
  propKey: string;
  value: unknown;
  /** The type's invariant freezes this field (sync owns it). */
  locked: boolean;
  onCommit: (key: string, value: unknown) => void;
}) {
  // A frozen field is still a link: a mirror's `url` is sync-owned
  // (uneditable) but is exactly the row a human wants to click, so the link
  // test comes before the read-only fallback.
  const href = webUrl(value);
  return (
    <PropertyRow
      icon={href ? Link2 : Type}
      label={humanize(propKey)}
      // Harness-written keys stay visible but lose the hover-X — a stray click
      // must not delete part of a receipt or the spine. Same for anything the
      // type's invariant freezes.
      onRemove={SYSTEM_KEYS.has(propKey) || locked ? undefined : () => onCommit(propKey, undefined)}
    >
      {href ? (
        <UrlValue
          value={value as string}
          href={href}
          readOnly={locked}
          onCommit={(v) => onCommit(propKey, v)}
        />
      ) : locked || typeof value === 'object' ? (
        // Arrays/objects don't survive a text-input round trip (they'd come
        // back as strings) — show them read-only.
        <p
          className="min-h-[26px] truncate px-1.5 py-0.5 text-sm text-muted-foreground"
          title={typeof value === 'object' ? JSON.stringify(value) : String(value)}
        >
          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
        </p>
      ) : (
        <TextValue
          value={typeof value === 'string' ? value : String(value)}
          onCommit={(v) => onCommit(propKey, typeof v === 'string' ? coerceScalar(v, value) : v)}
        />
      )}
    </PropertyRow>
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
  readOnly,
  onCommit,
}: {
  value: string;
  title: string;
  /** Receipts (sessions) freeze their summary too — don't offer the cursor. */
  readOnly?: boolean;
  onCommit: (v: string | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const norm = value.trim().toLowerCase();
  const echo = !norm || norm === title.trim().toLowerCase() || norm === 'untitled';

  if (readOnly) {
    return echo ? null : <p className="mb-4 text-body text-muted-foreground">{value}</p>;
  }
  if (draft === null) {
    return (
      <p
        className="mb-4 cursor-text rounded-md text-body text-muted-foreground transition-colors hover:bg-accent/40"
        onClick={() => setDraft(echo ? '' : value)}
        title="Click to edit summary"
      >
        {echo ? <span className="text-muted-foreground/50">Add a summary…</span> : value}
      </p>
    );
  }
  return (
    <textarea
      className="mb-4 w-full field-sizing-content resize-none rounded-md border border-input bg-card px-2 py-1 text-body text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
  readOnly,
  onCommit,
  tagSuggestions,
  onTagClick,
}: {
  spec: FieldSpec;
  value: unknown;
  /** The type's invariant forbids changing this field (immutable provenance). */
  readOnly?: boolean;
  onCommit: (v: unknown) => void;
  tagSuggestions?: { tag: string; count: number }[];
  onTagClick?: (tag: string) => void;
}) {
  if (spec.widget === 'people') {
    const arr = Array.isArray(value) ? (value as unknown[]).filter((t): t is string => typeof t === 'string') : [];
    // Who was in the room is provenance — readable, clickable, not editable.
    if (readOnly) {
      return (
        <div className="flex min-h-[26px] flex-wrap items-center gap-1 px-1.5 py-0.5">
          {arr.length === 0 ? (
            <span className="text-sm text-muted-foreground/50">Empty</span>
          ) : (
            arr.map((raw, i) => <PersonChip key={`${raw}-${i}`} value={raw} />)
          )}
        </div>
      );
    }
    return (
      <PeopleInput
        value={arr}
        onChange={(next) => onCommit(next.length > 0 ? next : undefined)}
        placeholder="Empty"
      />
    );
  }
  if (spec.widget === 'readonly' || readOnly) {
    // Sync-owned facts (a mirror's state, assignee, upstream timestamp)
    // display but never edit — re-sync is their only writer, and main rejects
    // any other. Timestamps read as local time, not raw ISO, and an enum-valued
    // row reads as its label ("In progress"), never its token.
    const text =
      value === undefined || value === null || value === ''
        ? '—'
        : Array.isArray(value)
          ? value.join(', ')
          : (spec.options?.find((o) => o.value === value)?.label ?? String(value));
    const asDate =
      typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value))
        ? new Date(value).toLocaleString()
        : null;
    return (
      <p className="min-h-[26px] truncate px-1.5 py-0.5 text-sm text-muted-foreground" title={text}>
        {asDate ?? text}
      </p>
    );
  }
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
          <option key={o.value} value={o.value}>
            {o.label}
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
 * A URL property reads as its link and opens the page on click (routed to the
 * OS browser via the window's open handler) — the mirror's back-reference to
 * Jira/Confluence is one click, not a select-and-copy. Still editable where the
 * type allows it: the trailing pencil-free affordance is a focusable input
 * revealed on hover, so the value can be corrected without losing the
 * click-to-open default. `readOnly` (sync owns the address) drops the Edit
 * affordance only — the link itself stays live.
 */
function UrlValue({
  value,
  href,
  readOnly,
  onCommit,
}: {
  value: string;
  href: string;
  readOnly?: boolean;
  onCommit: (v: unknown) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  if (draft !== null) {
    return (
      <input
        className={quietInput}
        value={draft}
        autoFocus
        placeholder="Empty"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!cancelled.current && draft.trim() !== value) onCommit(draft.trim() || undefined);
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
  return (
    <div className="group/url flex min-h-[26px] items-center gap-1">
      <a
        href={href}
        onClick={(e) => {
          e.preventDefault();
          window.open(href);
        }}
        className="min-w-0 flex-1 truncate rounded-md px-1.5 py-0.5 text-sm text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
        title={`Open ${href}`}
      >
        {value}
      </a>
      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />
      {!readOnly && (
        <button
          className="shrink-0 rounded-sm px-1 py-0.5 text-xs text-muted-foreground/0 transition-colors group-hover/url:text-muted-foreground/60 hover:!text-foreground focus-visible:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => setDraft(value)}
          title="Edit URL"
          aria-label="Edit URL"
        >
          Edit
        </button>
      )}
    </div>
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
