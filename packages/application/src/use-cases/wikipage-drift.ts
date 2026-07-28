import {
  buildChain,
  refToSlug,
  type DecisionFrontmatter,
  type DecisionNode,
  type WikipageFrontmatter,
} from '@pm/domain';
import type { IndexedNote, UseCaseContext } from '../ports.js';
import { applyPatch, createProposal, logError } from './proposals.js';

/**
 * Wikipage stewardship (Area F, integration plan phase 4): the decision spine
 * vs. mirrored pages. The vault holds what was decided; Confluence pages rot
 * after every decision. This module notices the divergence and prepares the
 * reconciliation — a redline `update_page` card when the contradiction is
 * explicit and localizable, a judgment-call ping when it's real but diffuse.
 *
 * Quality isolation: everything the LLM touches (prompt, verdict shape, the
 * confidence gate) lives HERE, pure and fixture-testable. The sweep entry
 * point is the only function with I/O, and it keeps the LLM out of the loop
 * until a deterministic candidate pair exists AND the pair changed since the
 * last recorded judgment.
 */

/** The librarian's quiet window — pings.ts imports THIS constant, so the two
 *  sweeps can't drift apart (they must match for dedupe to behave). */
export const REDEDUPE_MS = 7 * 24 * 60 * 60 * 1000;

/** Hard per-tick spend cap: a first sweep over a big vault must not turn into
 *  N sequential LLM calls in one tick — the rest wait for the next one. */
const MAX_JUDGMENTS_PER_TICK = 6;

/** Alias of the package's globalThis-guarded logger (proposals.ts) — sweep
 *  failure paths must be diagnosable, never silent. */
export const logSweepError = logError;

// ---------------------------------------------------------------------------
// Candidate selection — deterministic, no I/O, no LLM
// ---------------------------------------------------------------------------

export interface DriftPair {
  page: {
    path: string;
    slug: string;
    title: string;
    externalId: string;
    provider: string;
    url: string;
    /** Drafted-against snapshot for the card (mirror state at pairing time). */
    version?: number;
    remoteUpdated?: string;
  };
  decision: { path: string; slug: string; title: string; summary: string };
  /** The supersedes-chain the decision heads, oldest → newest (head last). */
  chain: { slug: string; title: string; summary: string; status: string; date?: string }[];
  /** How the page entered the decision's orbit — the hub/decision that links it. */
  via: string;
  /**
   * Deterministic change marker: the head decision's mtime × the page's
   * provider version. Equal revision ⇒ nothing to re-judge; a supersede flips
   * the head (new pair key), a re-sync bumps the version.
   */
  revision: string;
  /** Stable finding key — `page-drift:<pageSlug>:<decisionSlug>`. */
  key: string;
}

/**
 * Pair every deep-tracked wikipage with the ACTIVE decisions in its orbit.
 * A page qualifies only when a theme hub or a decision links it
 * (linking IS the tracking gesture — same rule as deep-track mirroring); the
 * decisions paired with it are those linked from the same hub, pointing at the
 * same hub, or linking the page directly. Superseded decisions never head a
 * pair — they appear only as chain context. Output order is deterministic.
 */
export function selectDriftPairs(
  notes: IndexedNote[],
  resolve: (target: string) => string | null,
): DriftPair[] {
  const byPath = new Map(notes.map((n) => [n.path, n]));
  // `resolve` hits live SQLite; pages × decisions × links would re-query the
  // same targets every 5 minutes. One cached resolution per target per sweep.
  const resolveCache = new Map<string, string | null>();
  const resolveOnce = (target: string): string | null => {
    let hit = resolveCache.get(target);
    if (hit === undefined) {
      hit = resolve(target);
      resolveCache.set(target, hit);
    }
    return hit;
  };
  const linkPathsCache = new Map<IndexedNote, string[]>();
  const linkPaths = (n: IndexedNote): string[] => {
    let paths = linkPathsCache.get(n);
    if (!paths) {
      paths = n.links.map((l) => resolveOnce(l.target)).filter((p): p is string => !!p);
      linkPathsCache.set(n, paths);
    }
    return paths;
  };

  const decisions = notes.filter((n) => n.type === 'decision');

  const resolveNode = (slug: string): DecisionNode | null => {
    const path = resolveOnce(slug);
    const note = path ? byPath.get(path) : undefined;
    if (!note || note.type !== 'decision') return null;
    return { slug: note.slug, frontmatter: note.frontmatter as unknown as DecisionFrontmatter };
  };

  const isActive = (d: IndexedNote): boolean => {
    const fm = d.frontmatter as Record<string, unknown>;
    return fm['status'] !== 'superseded' && !fm['superseded_by'];
  };

  const pairs = new Map<string, DriftPair>();
  for (const page of notes) {
    if (page.type !== 'wikipage') continue;
    const fm = page.frontmatter as unknown as WikipageFrontmatter;
    if (!fm.external_id) continue;

    // Who links this page? Only spine-adjacent linkers count.
    const linkers = notes.filter(
      (n) =>
        (n.type === 'theme' || n.type === 'decision') &&
        linkPaths(n).includes(page.path),
    );
    if (linkers.length === 0) continue;

    const paired = new Map<string, { decision: IndexedNote; via: string }>();
    for (const linker of linkers) {
      if (linker.type === 'decision') {
        paired.set(linker.path, { decision: linker, via: linker.path });
        continue;
      }
      // Hub → every decision in the hub's orbit.
      for (const d of decisions) {
        const dLinks = linkPaths(d);
        const themeRef = refToSlug((d.frontmatter as Record<string, unknown>)['theme'] as string | undefined);
        const inOrbit =
          linkPaths(linker).includes(d.path) ||
          dLinks.includes(linker.path) ||
          (themeRef !== null && resolveOnce(themeRef) === linker.path);
        if (inOrbit && !paired.has(d.path)) paired.set(d.path, { decision: d, via: linker.path });
      }
    }
    // Hubs also cite superseded decisions; only chain heads get judged. A
    // superseded DIRECT linker still counts as orbit — "the page still matches
    // the old decision" is the flagship drift case, so the pair heads at the
    // active end of that decision's chain instead of being dropped.
    for (const entry of paired.values()) {
      const { via } = entry;
      let decision = entry.decision;
      if (!isActive(decision)) {
        const headSlug = buildChain(decision.slug, resolveNode).chain.at(-1)?.slug;
        const headPath = headSlug ? resolveOnce(headSlug) : null;
        const head = headPath ? byPath.get(headPath) : undefined;
        if (!head || head.type !== 'decision' || !isActive(head)) continue;
        decision = head;
      }
      const { chain } = buildChain(decision.slug, resolveNode);
      const chainMeta = chain.map((node) => {
        const note = byPath.get(resolve(node.slug) ?? '') ?? null;
        return {
          slug: node.slug,
          title: note?.title ?? node.slug,
          summary: note?.summary ?? node.frontmatter.summary,
          status: node.frontmatter.status ?? 'active',
          ...(node.frontmatter.date ? { date: node.frontmatter.date } : {}),
        };
      });
      const key = `page-drift:${page.slug}:${decision.slug}`;
      if (pairs.has(key)) continue;
      pairs.set(key, {
        page: {
          path: page.path,
          slug: page.slug,
          title: page.title,
          externalId: fm.external_id,
          provider: fm.provider,
          url: fm.url,
          ...(typeof fm.version === 'number' ? { version: fm.version } : {}),
          ...(fm.remote_updated ? { remoteUpdated: fm.remote_updated } : {}),
        },
        decision: {
          path: decision.path,
          slug: decision.slug,
          title: decision.title,
          summary: decision.summary,
        },
        chain: chainMeta,
        via,
        revision: `d:${decision.mtime}|p:${fm.version ?? page.mtime}`,
        key,
      });
    }
  }
  return [...pairs.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ---------------------------------------------------------------------------
// Judgment — prompt, verdict, confidence gate (pure; the LLM call is injected)
// ---------------------------------------------------------------------------

export interface ContradictionVerdict {
  contradicts: boolean;
  confidence: 'high' | 'medium' | 'low';
  /** The page's contradicting claim, verbatim — the redline anchor. */
  passage: string | null;
  /** The passage rewritten to agree with the decision. */
  replacement: string | null;
  /** False when the rewrite needed facts the decision doesn't state (→ Unverified). */
  grounded: boolean;
  explanation: string;
}

export interface ContradictionInput {
  decision: { title: string; date?: string; summary: string; body: string };
  /** Older links of the supersedes-chain, oldest first (head excluded). */
  chain: { title: string; summary: string; status: string; date?: string }[];
  page: { title: string; body: string };
}

export function buildContradictionPrompt(input: ContradictionInput): { system: string; prompt: string } {
  const system = [
    "You are the librarian of a product team's memory. The team's decision notes are",
    'the source of truth about intent; mirrored wiki pages go stale after decisions',
    'change. Compare ONE current decision against ONE page and judge whether the page',
    'contradicts the decision as it stands today.',
    '',
    'Reply with ONLY a JSON object — no prose, no code fences:',
    '{"contradicts": true|false, "confidence": "high"|"medium"|"low",',
    ' "passage": string|null, "replacement": string|null, "grounded": true|false,',
    ' "explanation": string}',
    '',
    'Rules:',
    '- "passage": the contradicting claim copied VERBATIM from the page — one',
    '  contiguous excerpt, long enough to be unique. null when the contradiction is',
    '  diffuse or spread across the page.',
    '- "replacement": the passage rewritten to agree with the decision, keeping the',
    "  page's tone and formatting. Change no more than the contradiction requires.",
    '  null when you cannot rewrite it confidently.',
    '- "grounded": true only when every claim in the replacement is stated by the',
    '  decision or already on the page; false when you had to infer or hedge.',
    '- "confidence": "high" only when the page explicitly states something the',
    '  current decision rules out. A page that merely omits the decision, or covers',
    '  a different topic, does NOT contradict it.',
    '- Superseded decisions are listed as history: a page that still matches an OLD,',
    '  superseded decision but conflicts with the CURRENT one contradicts it.',
    '- "explanation": one or two plain sentences a busy product manager can act on.',
  ].join('\n');

  const chain =
    input.chain.length > 0
      ? `\n\nEarlier decisions this one replaced (history, no longer true):\n${input.chain
          .map((c) => `- [${c.status}${c.date ? `, ${c.date}` : ''}] ${c.title} — ${c.summary}`)
          .join('\n')}`
      : '';

  const prompt = [
    `## Current decision: ${input.decision.title}`,
    input.decision.date ? `Decided: ${input.decision.date}` : '',
    `Summary: ${input.decision.summary}`,
    '',
    input.decision.body.trim(),
    chain,
    '',
    `## Page: ${input.page.title}`,
    '',
    input.page.body.trim(),
  ]
    .filter((l) => l !== '')
    .join('\n');

  return { system, prompt };
}

/** Tolerant parse of the model's reply — fenced or bare JSON; null when unusable. */
export function parseContradictionVerdict(raw: string): ContradictionVerdict | null {
  const stripped = raw.replace(/```(?:json)?/gi, '').trim();
  const match = /\{[\s\S]*\}/.exec(stripped);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const rec = parsed as Record<string, unknown>;
  if (typeof rec['contradicts'] !== 'boolean') return null;
  const confidence = rec['confidence'];
  if (confidence !== 'high' && confidence !== 'medium' && confidence !== 'low') return null;
  return {
    contradicts: rec['contradicts'],
    confidence,
    passage: typeof rec['passage'] === 'string' && rec['passage'].trim() ? rec['passage'] : null,
    replacement:
      typeof rec['replacement'] === 'string' && rec['replacement'].trim() ? rec['replacement'] : null,
    grounded: rec['grounded'] !== false,
    explanation: typeof rec['explanation'] === 'string' ? rec['explanation'] : '',
  };
}

export type DriftResolution =
  | {
      kind: 'fix';
      body: string;
      inference: boolean;
      /** The localized edit itself — the accept path patches the LIVE page with
       *  this (replace semantics), never with the round-tripped full body. */
      patch: { search: string; replace: string };
    }
  | { kind: 'ping' }
  | { kind: 'none' };

/**
 * The confidence gate: a prepared fix must be high-confidence AND localizable —
 * the verbatim passage has to anchor in the page's actual text (whitespace-
 * tolerant, refuses ambiguity — same contract as update cards). Everything
 * else that still contradicts becomes a judgment call, never a guessed edit.
 * An ungrounded rewrite keeps prepared-fix status but is flagged inference,
 * so the card renders Unverified.
 */
export function resolveVerdict(verdict: ContradictionVerdict, pageBody: string): DriftResolution {
  if (!verdict.contradicts) return { kind: 'none' };
  if (
    verdict.confidence === 'high' &&
    verdict.passage &&
    verdict.replacement &&
    verdict.passage.trim() !== verdict.replacement.trim()
  ) {
    const applied = applyPatch(pageBody, [{ search: verdict.passage, replace: verdict.replacement }]);
    if (applied !== null && applied !== pageBody) {
      return {
        kind: 'fix',
        body: applied,
        inference: !verdict.grounded,
        patch: { search: verdict.passage, replace: verdict.replacement },
      };
    }
  }
  return { kind: 'ping' };
}

// ---------------------------------------------------------------------------
// The sweep step — called from the librarian maintenance pass
// ---------------------------------------------------------------------------

/** Structural match for the librarian sweep's ping candidates (pings.ts). */
export interface DriftPingCandidate {
  key: string;
  title: string;
  body: string;
  evidence: { ref: string; label?: string; resolved: boolean }[];
  sessionType: string;
  seedPrompt: string;
  targetPath: string | null;
  payload?: null;
}

/**
 * One tick of wikipage stewardship. Deterministic gates run first — check
 * ledger (unchanged pair ⇒ never re-judged, so a dismissal stays quiet until
 * the decision or page actually changes), pending/recent dedupe, the shared
 * prepared-fix budget — and only a pair that clears them all costs an LLM
 * call. Per-pair errors are swallowed and the pair stays unrecorded, so a
 * transport hiccup just retries next tick; an unparseable verdict IS recorded
 * (retrying the same confusion every five minutes is spend, not quality).
 */
export async function sweepWikipageDrift(
  ctx: UseCaseContext,
  budget: { pending: number },
  maxPendingFixes: number,
  now: number,
  /**
   * Free ping slots this tick (the caller's MAX_PENDING_PINGS minus pending).
   * Checked BEFORE a ping-bound finding is ledgered: a judgment the queue can't
   * hold is deferred unrecorded — same pattern as the fix budget — so a capped
   * finding is re-raised when a slot frees instead of being silently lost.
   */
  pingBudget: { slots: number } = { slots: Number.POSITIVE_INFINITY },
): Promise<{ fixes: number; candidates: DriftPingCandidate[] }> {
  const none = { fixes: 0, candidates: [] as DriftPingCandidate[] };
  // No ledger would mean re-judging every unchanged pair each tick; no
  // completions means nothing can judge. Either way: quietly not our tick.
  if (!ctx.checks || !ctx.completions) return none;
  const { checks, completions } = ctx;

  const pairs = selectDriftPairs(ctx.index.all(), (t) => ctx.index.resolve(t));
  if (pairs.length === 0) return none;

  // Drift cards already on the table — matched by the sweep's own driftKey
  // marker, pageId as fallback.
  const driftCards = ctx.proposals
    .list()
    .filter((p) => p.sessionId === 'librarian' && p.kind === 'outbound')
    .map((p) => ({
      status: p.status,
      resolved: p.resolved,
      payload: p.payload as { action?: string; pageId?: string; driftKey?: string } | null,
    }))
    .filter((p) => p.payload?.action === 'update_page');
  // The post-resolve quiet week applies only to THIS finding (driftKey). A
  // same-page match blocks only while its card is still PENDING — an accepted
  // card re-syncs the page (new revision) and must not mute every other pair
  // on that page for 7 days.
  const cardBlocks = (pair: DriftPair): boolean =>
    driftCards.some(
      (c) =>
        (c.payload?.driftKey === pair.key &&
          (c.status === 'pending' || (c.resolved ?? 0) > now - REDEDUPE_MS)) ||
        (c.payload?.pageId === pair.page.externalId && c.status === 'pending'),
    );

  let fixes = 0;
  let judged = 0;
  const candidates: DriftPingCandidate[] = [];
  /** Pages that got a redline THIS tick — one pending rewrite per page, ever.
   * Later pairs for the same page aren't judged (or recorded): the page body
   * they'd redline is about to change, so they wait for the card to resolve. */
  const cardedPages = new Set<string>();
  for (const pair of pairs) {
    try {
      if (cardedPages.has(pair.page.externalId)) continue;
      if (checks.get(pair.key) === pair.revision) continue;
      if (cardBlocks(pair)) continue;
      if (ctx.pings?.hasRecent(pair.key, now - REDEDUPE_MS)) continue;
      if (budget.pending >= maxPendingFixes) continue;
      if (judged >= MAX_JUDGMENTS_PER_TICK) {
        logSweepError(`[pm] drift sweep: judgment cap (${MAX_JUDGMENTS_PER_TICK}) reached — remaining pairs wait for the next tick`);
        break;
      }

      const page = await ctx.vault.readNote(pair.page.path);
      const decision = await ctx.vault.readNote(pair.decision.path);
      if (!page || !decision) continue;

      const decisionDate = (decision.frontmatter as Record<string, unknown>)['date'];
      const { system, prompt } = buildContradictionPrompt({
        decision: {
          title: pair.decision.title,
          ...(typeof decisionDate === 'string' ? { date: decisionDate } : {}),
          summary: pair.decision.summary,
          body: decision.body,
        },
        chain: pair.chain.filter((c) => c.slug !== pair.decision.slug),
        page: { title: pair.page.title, body: page.body },
      });

      judged++;
      const raw = await completions.complete({ system, prompt });
      // An empty reply is transport-shaped (a failed call that still resolved),
      // not a model opinion: skip unrecorded so the pair retries next tick.
      if (!raw.trim()) continue;
      const verdict = parseContradictionVerdict(raw);
      if (!verdict) {
        checks.set(pair.key, pair.revision, now);
        continue;
      }

      const resolution = resolveVerdict(verdict, page.body);
      const evidence = [
        { ref: `[[${pair.decision.slug}]]`, resolved: true },
        { ref: `[[${pair.page.slug}]]`, resolved: true },
      ];
      if (resolution.kind === 'fix') {
        const rationale =
          verdict.explanation.trim() ||
          `The page still disagrees with "${pair.decision.title}".`;
        const decisionDateStr = typeof decisionDate === 'string' ? decisionDate : undefined;
        createProposal(ctx, {
          kind: 'outbound',
          sessionId: 'librarian',
          sessionType: 'librarian',
          targetPath: pair.page.path,
          baseHash: null,
          payload: {
            provider: pair.page.provider,
            system: pair.page.provider,
            action: 'update_page',
            pageId: pair.page.externalId,
            title: pair.page.title,
            // Full redlined page for the card PREVIEW; the accept path pushes
            // only the localized `patch` (replace-in-place on the live page).
            body: resolution.body,
            patch: resolution.patch,
            // Canonical provenance shape everywhere: "Source: <origin>, <date>".
            provenance: `Source: ${pair.decision.title}${decisionDateStr ? `, ${decisionDateStr}` : ''}`,
            // Drafted-against snapshot — accept refuses when the mirror moved.
            ...(pair.page.remoteUpdated ? { remote_updated: pair.page.remoteUpdated } : {}),
            ...(pair.page.version !== undefined ? { version: pair.page.version } : {}),
            rationale,
            headline: `Fix "${pair.page.title}" — it contradicts ${pair.decision.title}.`,
            // Sweep-internal dedupe marker; zOutboundPayload drops it at accept time.
            driftKey: pair.key,
          },
          rationale,
          evidence,
          inference: resolution.inference,
        });
        budget.pending++;
        fixes++;
        cardedPages.add(pair.page.externalId);
      } else if (resolution.kind === 'ping') {
        // No free ping slot ⇒ defer UNRECORDED — the finding is re-raised when
        // the queue drains, instead of being ledgered as judged and lost.
        if (pingBudget.slots <= 0) continue;
        pingBudget.slots--;
        candidates.push({
          key: pair.key,
          title: `"${pair.page.title}" may contradict ${pair.decision.title}`,
          body: `${verdict.explanation.trim() || 'The page and the decision seem to disagree.'} The mismatch is too diffuse for a prepared edit — worth a look.`,
          evidence,
          sessionType: 'librarian',
          seedPrompt: `The mirrored page [[${pair.page.slug}]] may contradict the decision [[${pair.decision.slug}]].\n\nModel's read: ${verdict.explanation.trim() || '(none)'}\n\nRead both (and the decision's supersedes-chain, if any), confirm with me whether the page really disagrees with the decision as it stands, and if it does, draft the page update as an approval card with the decision as evidence. If it doesn't, say plainly why not.`,
          targetPath: pair.page.path,
          payload: null,
        });
      }
      checks.set(pair.key, pair.revision, now);
    } catch (err) {
      // Transport/API failure — leave the pair unrecorded; next tick retries.
      // Logged so a permanently-failing pair (page over the context window,
      // auth broken) is diagnosable instead of reading as "no drift".
      logSweepError(
        `[pm] wikipage drift check failed (${pair.key}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { fixes, candidates };
}
