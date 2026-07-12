import { z } from 'zod';

/**
 * Frontmatter schemas — THE single source of truth for note shape (PLAN §3.1,
 * §3.5). Types are derived via `z.infer`; nothing else defines a note's fields.
 * A note is a discriminated union on `type`, which drives its layer + permissions.
 */

export const NOTE_TYPES = [
  'signal',
  'transcript',
  'meeting-summary',
  'theme',
  'decision',
  'action',
  'open-question',
  'note',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const NOTE_LAYERS = ['raw', 'derived', 'authored'] as const;
export type NoteLayer = (typeof NOTE_LAYERS)[number];

export const THEME_STANCES = ['exploring', 'watching', 'committed', 'wont-do'] as const;
export type ThemeStance = (typeof THEME_STANCES)[number];

export const SIGNAL_STATUSES = ['new', 'linked', 'discarded'] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

/** A wikilink string like "[[signals/2026-07-12-gong]]" or an external URL. */
export const zRef = z.string().min(1);

export const zSource = z.object({
  system: z.string().min(1),
  author: z.string().optional(),
  url: z.string().url().optional(),
});
export type SourceRef = z.infer<typeof zSource>;

/** Every note carries a one-line summary — the token-cheap retrieval index. */
const base = {
  summary: z.string().min(1, 'summary is mandatory — it is the retrieval index'),
};

export const zSignal = z.object({
  type: z.literal('signal'),
  ...base,
  status: z.enum(SIGNAL_STATUSES).default('new'),
  source: zSource.optional(),
  captured: z.string().optional(),
});

export const zTranscript = z.object({
  type: z.literal('transcript'),
  ...base,
  status: z.enum(SIGNAL_STATUSES).default('new'),
  source: zSource.optional(),
  captured: z.string().optional(),
  participants: z.array(z.string()).optional(),
});

export const zMeetingSummary = z.object({
  type: z.literal('meeting-summary'),
  ...base,
  sources: z.array(zRef).min(1, 'derived notes must cite their sources'),
  meeting: zRef.optional(),
  date: z.string().optional(),
});

export const zTheme = z.object({
  type: z.literal('theme'),
  ...base,
  stance: z.enum(THEME_STANCES).default('exploring'),
  evidence: z.array(zRef).default([]),
});

export const zDecision = z.object({
  type: z.literal('decision'),
  ...base,
  sources: z.array(zRef).default([]),
  date: z.string().optional(),
  deciders: z.array(z.string()).optional(),
});

export const zAction = z.object({
  type: z.literal('action'),
  ...base,
  status: z.enum(['open', 'done']).default('open'),
  sources: z.array(zRef).default([]),
  jira: z.string().optional(),
  due: z.string().optional(),
});

export const zOpenQuestion = z.object({
  type: z.literal('open-question'),
  ...base,
  status: z.enum(['open', 'answered']).default('open'),
  sources: z.array(zRef).default([]),
});

export const zNote = z.object({
  type: z.literal('note'),
  ...base,
  sources: z.array(zRef).default([]),
});

export const zFrontmatter = z.discriminatedUnion('type', [
  zSignal,
  zTranscript,
  zMeetingSummary,
  zTheme,
  zDecision,
  zAction,
  zOpenQuestion,
  zNote,
]);

export type Frontmatter = z.infer<typeof zFrontmatter>;
export type SignalFrontmatter = z.infer<typeof zSignal>;
export type TranscriptFrontmatter = z.infer<typeof zTranscript>;
export type MeetingSummaryFrontmatter = z.infer<typeof zMeetingSummary>;
export type ThemeFrontmatter = z.infer<typeof zTheme>;
export type DecisionFrontmatter = z.infer<typeof zDecision>;
export type ActionFrontmatter = z.infer<typeof zAction>;
export type OpenQuestionFrontmatter = z.infer<typeof zOpenQuestion>;
export type NoteFrontmatter = z.infer<typeof zNote>;

/** Which on-disk folder + layer a note type lives in (PLAN §3.5). */
export const NOTE_TYPE_META: Record<NoteType, { dir: string; layer: NoteLayer }> = {
  signal: { dir: 'signals', layer: 'raw' },
  transcript: { dir: 'transcripts', layer: 'raw' },
  'meeting-summary': { dir: 'meetings', layer: 'derived' },
  theme: { dir: 'themes', layer: 'authored' },
  decision: { dir: 'decisions', layer: 'authored' },
  action: { dir: 'actions', layer: 'authored' },
  'open-question': { dir: 'questions', layer: 'authored' },
  note: { dir: 'notes', layer: 'authored' },
};

export function layerForType(type: NoteType): NoteLayer {
  return NOTE_TYPE_META[type].layer;
}

export function dirForType(type: NoteType): string {
  return NOTE_TYPE_META[type].dir;
}

/** Reverse lookup: which note type a top-level vault folder maps to. */
export function typeForDir(dir: string): NoteType | null {
  const entry = (Object.keys(NOTE_TYPE_META) as NoteType[]).find(
    (t) => NOTE_TYPE_META[t].dir === dir,
  );
  return entry ?? null;
}

export interface ParseResult {
  ok: boolean;
  data?: Frontmatter;
  error?: string;
}

/** Validate an unknown frontmatter object against the schema for its `type`. */
export function parseFrontmatter(input: unknown): ParseResult {
  const result = zFrontmatter.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}
