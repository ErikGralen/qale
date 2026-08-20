import { z } from 'zod';
import { refToSlug } from '../notes/decisions.js';
import { isSessionFile } from '../notes/slug.js';

/** The "what will happen" line an outbound card carries above its rationale. */
export { outboundEffect, type OutboundEffectFacts } from './effect.js';

/** When a calendar card lands, said the same way everywhere it is shown. */
export { describeEventWhen, rsvpAnswer, type EventWhen } from './event-time.js';

/** Whether a card repeats one already waiting on the PM. */
export {
  contentTokens,
  findDuplicate,
  titleOverlap,
  DUPLICATE_THRESHOLD,
  type ProposalIdentity,
} from './duplicate.js';

/**
 * Proposals (approval cards) are the ONLY write path for the agent (PLAN-V2 §3.3).
 * The trust mechanic — evidence must resolve, or the card says what it rests on
 * instead — is validated structurally here (domain), then enforced at the tool layer. Card kinds
 * grow per phase: note/update now, decision/outbound land in Phases 3 & 5.
 */

export const PROPOSAL_KINDS = ['note', 'update', 'decision', 'outbound'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * Where an outbound draft is addressed. Provider-shaped ('jira', 'confluence')
 * because that's honest data — but every consumer branches on the generic
 * `action`, so a new provider is an entry here, never a new code path upstream.
 * 'message' is the human "provider": drafts saved to the workspace, not sent.
 */
export const OUTBOUND_PROVIDERS = ['jira', 'confluence', 'message', 'google-calendar'] as const;
export type OutboundProvider = (typeof OUTBOUND_PROVIDERS)[number];

/** @deprecated legacy name for {@link OUTBOUND_PROVIDERS} (`system` era). */
export const OUTBOUND_SYSTEMS = OUTBOUND_PROVIDERS;
/** @deprecated legacy name for {@link OutboundProvider}. */
export type OutboundSystem = OutboundProvider;

/**
 * Provider-generic outbound vocabulary (ticket/wikipage, not issue/page — the
 * same genericization as the mirror note types). `update_ticket` is deliberately
 * absent until an executor exists — advertising an action that always fails at
 * approval would let agents file cards the PM can only watch break.
 */
export const OUTBOUND_ACTIONS = [
  'create_ticket',
  'comment_ticket',
  'update_page',
  'send_message',
  // Calendar writes. Each has an
  // executor in the google-calendar connector — the "never advertise an action
  // without an executor" rule holds.
  'create_event',
  'update_event',
  'respond_to_event',
] as const;
export type OutboundAction = (typeof OUTBOUND_ACTIONS)[number];

/** Pre-genericization action names, as they exist in persisted proposal rows. */
const LEGACY_OUTBOUND_ACTIONS: Record<string, OutboundAction> = {
  create_issue: 'create_ticket',
  add_comment: 'comment_ticket',
  update_page: 'update_page',
  message: 'send_message',
};

/**
 * Outbound card (PLAN-V2 §3.4) — a draft addressed to an external system or a
 * human. This tier is draft-and-approve forever: there is no auto-apply path. The
 * exact payload is stored; the resulting link is built from the API response only.
 *
 * Legacy compat: proposal rows persist the payload as raw JSON and are only
 * validated here at read/accept time, so pre-genericization records
 * (`system: 'jira'`, `action: 'create_issue'`) are normalized by the preprocess
 * step — no data migration. The parsed output always carries BOTH `provider`
 * (canonical) and `system` (deprecated mirror) so existing readers keep working.
 */
export const zOutboundSearchReplace = z.object({ search: z.string().min(1), replace: z.string() });

export const zOutboundPayload = z.preprocess(
  (val) => {
    if (!val || typeof val !== 'object') return val;
    const rec = { ...(val as Record<string, unknown>) };
    // `provider` is canonical: when both are present it wins outright, so a
    // conflicting legacy `system` can never leak a different value to readers.
    if (rec['provider'] == null && typeof rec['system'] === 'string')
      rec['provider'] = rec['system'];
    if (typeof rec['provider'] === 'string') rec['system'] = rec['provider'];
    if (typeof rec['action'] === 'string' && rec['action'] in LEGACY_OUTBOUND_ACTIONS) {
      rec['action'] = LEGACY_OUTBOUND_ACTIONS[rec['action']];
    }
    return rec;
  },
  z
    .object({
      provider: z.enum(OUTBOUND_PROVIDERS),
      /** @deprecated mirror of `provider`, kept so pre-genericization readers still resolve. */
      system: z.enum(OUTBOUND_PROVIDERS),
      action: z.enum(OUTBOUND_ACTIONS),
      projectKey: z.string().optional(),
      issueType: z.string().optional(),
      issueKey: z.string().optional(),
      pageId: z.string().optional(),
      /** Ticket summary / message subject. */
      title: z.string().optional(),
      /** The drafted body (markdown), shown verbatim in the card preview. */
      body: z.string().min(1),
      /**
       * For `update_page`: the localized edit as search/replace on the page's
       * live text. When present the connector patches the page in place
       * (replace semantics); absent, the body is appended as a new section.
       */
      patch: zOutboundSearchReplace.optional(),
      /** One canonical provenance line ("Source: <origin>, <date>") appended to the pushed content. */
      provenance: z.string().optional(),
      /**
       * Drafted-against snapshot: the mirror's `remote_updated` (and `version`
       * for pages) at draft time. Accept compares these to the mirror and
       * refuses with `stale` when the upstream item moved since drafting.
       */
      remote_updated: z.string().optional(),
      version: z.number().int().nonnegative().optional(),
      audience: z.string().optional(),
      // Calendar-event fields (provider 'google-calendar'). calendarId defaults
      // to 'primary' in the connector when omitted; times are RFC3339.
      calendarId: z.string().optional(),
      eventId: z.string().optional(),
      /** Event start/end, RFC3339 with offset (create_event, reschedule). */
      start: z.string().optional(),
      end: z.string().optional(),
      /** Invitee emails for a new event. */
      attendees: z.array(z.string()).optional(),
      /** respond_to_event: which attendee is answering (the connected account). */
      attendeeEmail: z.string().optional(),
      responseStatus: z.enum(['accepted', 'declined', 'tentative']).optional(),
      /** Workspace note to append the resulting deterministic link back to. */
      linkBackPath: z.string().optional(),
      rationale: z.string().min(1),
    })
    // Required target per action, enforced at FILING time — a card missing its
    // target must be rejected where the agent can react, not at approval.
    .superRefine((p, refCtx) => {
      const need = (
        field:
          'projectKey' | 'issueKey' | 'pageId' | 'eventId' | 'title' | 'start' | 'attendeeEmail',
      ): void => {
        if (!p[field]?.toString().trim()) {
          refCtx.addIssue({
            code: 'custom',
            path: [field],
            message: `${p.action} requires ${field}`,
          });
        }
      };
      if (p.action === 'create_ticket') need('projectKey');
      if (p.action === 'comment_ticket') need('issueKey');
      if (p.action === 'update_page') need('pageId');
      if (p.action === 'create_event') {
        need('title'); // the event summary
        need('start');
      }
      if (p.action === 'update_event') need('eventId');
      if (p.action === 'respond_to_event') {
        need('eventId');
        need('attendeeEmail');
        if (!p.responseStatus) {
          refCtx.addIssue({
            code: 'custom',
            path: ['responseStatus'],
            message: 'respond_to_event requires responseStatus',
          });
        }
      }
    }),
);
export type OutboundPayload = z.infer<typeof zOutboundPayload>;

export const zSearchReplace = z.object({ search: z.string().min(1), replace: z.string() });

export const zNotePayload = z.object({
  path: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string(),
  rationale: z.string().min(1),
});
export type NotePayload = z.infer<typeof zNotePayload>;

export const zUpdatePayload = z
  .object({
    path: z.string().min(1),
    /** Body search/replace blocks. Optional: a card may change only frontmatter. */
    patch: z.array(zSearchReplace).optional(),
    /**
     * Text added at the end of the body on approval. Search/replace has nothing
     * to bite on in an empty body, and the notes that most need writing on start
     * empty — a meeting page mirrored from the calendar is frontmatter and
     * nothing else — so a card needs a lever that cannot miss its anchor.
     */
    append: z.string().optional(),
    /**
     * Frontmatter keys to set on approval (shallow-merged over the note's current
     * frontmatter) — the only way a card edits metadata like a todo's
     * `due`/`commitment`, a meeting's `processing`, or a person's `last_told`.
     * Body-only edits omit it.
     */
    frontmatter: z.record(z.string(), z.unknown()).optional(),
    rationale: z.string().min(1),
    /** Retitle applied on approval via rename semantics (Process-Note names a dump). */
    title: z.string().optional(),
  })
  // A no-op card is meaningless: require at least one real change.
  .refine(
    (d) =>
      (d.patch?.length ?? 0) > 0 ||
      !!d.append?.trim() ||
      Object.keys(d.frontmatter ?? {}).length > 0,
    {
      message: 'an update must change the body (patch or append) or the frontmatter',
      path: ['patch'],
    },
  );
export type UpdatePayload = z.infer<typeof zUpdatePayload>;

/** A decision card carries the new decision plus an optional supersede target. */
export const zDecisionPayload = z.object({
  path: z.string().min(1),
  frontmatter: z.record(z.string(), z.unknown()),
  body: z.string(),
  rationale: z.string().min(1),
  /** Slug of an existing decision this one supersedes (flips its standing). */
  supersedes: z.string().optional(),
});
export type DecisionPayload = z.infer<typeof zDecisionPayload>;

export interface EvidenceValidation {
  ok: boolean;
  reason?: string;
}

/**
 * What a card rests on when it names no sources. Two different things, and the
 * card says which:
 *
 * - `asked` — the PM said it themselves, in the conversation. There is no note
 *   to cite because the source is a chat message, and a message is not a note.
 *   The best-sourced kind of card there is.
 * - `inference` — the agent worked it out and nothing in the workspace says it.
 *   The claim to double-check.
 *
 * Collapsing the two was the bug: a note the PM dictated word for word came back
 * flagged "the agent inferred this without citing a source", because `inference`
 * was the only way past an empty sources[].
 */
export interface EvidenceBasis {
  inference?: boolean;
  asked?: boolean;
}

/**
 * Evidence must be present and resolvable unless the card declares a basis that
 * stands in for sources (see `EvidenceBasis`). `resolve` reports whether a given
 * wikilink/URL target exists in the index or a tool result from this session
 * (PLAN-V2 §3.3 — cite or decline).
 */
export function validateEvidence(
  sources: string[],
  resolve: (ref: string) => boolean,
  basis: EvidenceBasis = {},
): EvidenceValidation {
  // Sessions v2 invariant 2: citations pass THROUGH session files, never
  // terminate in them. A subagent reads sources/2026-06-12-kranelund.md and
  // writes per-item/kranelund.md; the card must cite the former. Checked whatever
  // the card's basis is, and before the empty check, because this is the failure
  // that stays silent: you get a memory full of insights whose evidence points
  // at deleted scratch, and nothing complains until someone follows a link.
  const scratch = sources.filter((s) => isSessionFile(refToSlug(s) ?? s));
  if (scratch.length > 0) {
    return {
      ok: false,
      reason:
        `evidence cannot cite session files (${scratch.join(', ')}) — they are working material and get deleted. ` +
        'Cite the original source the file was written from; that path is carried inside the file.',
    };
  }
  if (basis.asked || basis.inference) return { ok: true };
  if (sources.length === 0) {
    return {
      ok: false,
      reason:
        'proposal has no sources[]; set asked:true if the PM asked for this in the conversation, ' +
        'or inference:true if you worked it out yourself',
    };
  }
  const unresolved = sources.filter((s) => !isUrl(s) && !resolve(s));
  if (unresolved.length > 0) {
    return { ok: false, reason: `unresolved evidence targets: ${unresolved.join(', ')}` };
  }
  return { ok: true };
}

export function isUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}
