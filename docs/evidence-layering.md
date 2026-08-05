# Evidence layering: themes argue, insights quote

Status: v1 built 2026-08-04, v2 still deferred. Came out of dogfooding the
same day: generated theme notes are mostly stacked transcript quotes, and no
synthesis run has ever proposed an insight. Reviewed same day; v1 cut down to
skill copy only, the three open questions settled inline below. What shipped
and how it differs from this plan is at the end, under "What shipped".

## The problem

A theme built over ten interviews currently arrives as a collage of block
quotes. The quotes prove the model read the material, but the note fails at its
actual job: saying what the theme is, how it shows up, and why it matters, in
one voice. And this is not a themes problem. The same skills write every note
type, so whatever rule fixes themes has to be the general rule for how the
system writes.

The failure is in the skill copy, not the model:

- Arrival demands grounding with no rule about form: "Every claim quotes the
  document or cites existing memory. Nothing uncited"
  (`vault-dev/skills/arrival/SKILL.md:75`). Pasting the quote is the only way
  the model can currently satisfy that line, so pasting becomes the style.
- Synthesis defines insights as the residue: "where a single account said
  something worth keeping **on its own**"
  (`vault-dev/skills/synthesis/SKILL.md:47-48`). Insight and theme are written
  as mutually exclusive outcomes. Synthesis exists to find clusters, so nearly
  everything joins a cluster and almost nothing is left "on its own". The
  definition guarantees insights are rare exactly when synthesis runs.
- Arrival never proposes insights at all. Its Produce list is decisions,
  todos, the meeting summary, and hub updates. The only birthplace of insights
  is the one session told they are for orphans.
- The synthesis per-item pass already writes insight-shaped files (one file
  per source, claims with verbatim quotes,
  `vault-dev/skills/synthesis/SKILL.md:34-35`) and then deletes them as
  session files. The atomic evidence layer gets built on every run and thrown
  away.

Net result: zero insights, and themes that carry all the quotes themselves
because there is nowhere else for a quote to live.

## The principle

**Evidence supports the note's job. It is never the content.**

A note says what we believe, in its own voice. A quote can play two roles and
the system currently confuses them:

- As *evidence* it answers "why should I believe this?". For that job a
  pointer is enough; the verbatim text already sits untouched in `sources/`.
- As *content* it is the finding itself: the customer's exact wording reveals
  their mental model, or the phrase is the one you will repeat in a roadmap
  discussion.

Almost every quote in a generated theme today is evidence wearing a content
costume. The form rule that follows: **a note quotes inline only when the
exact wording carries information a paraphrase would lose.** Everything else
is a citation.

## The design: insight is the atomic unit of evidence

An insight is **one claim**, stated in the note's own voice, with its evidence
accumulated inside it: each backing account contributes a quote, `customer`
and `evidence` list the accounts, `confidence` and the `theme` backlink do
what they already do. A second account confirming the claim extends that
insight's evidence. Only a genuinely new claim files a new insight.
Convergence across *different* claims stays the theme's job.

Why accumulate instead of one-insight-per-account: "how many distinct accounts
back this claim" becomes a countable frontmatter fact, not a clustering
exercise over near-duplicate insights on every run. It is also the same move
the dedup rule already wants: extend an existing insight rather than file a
near-copy. (This settles the old open question about second accounts.)

Themes become arguments over insights. The evidence chain gets a hop instead
of a dump: theme cites insight, insight quotes transcript, each hop one click.

A theme body then reads like this:

> Field staff keep hitting the dashboard from phones even though we never
> built for it. It shows up as workarounds, not requests: six of nine accounts
> described some version of screenshotting the dashboard into WhatsApp
> ([[insights/dashboard-reached-by-phone-workarounds]]). Nobody has made it a
> purchase condition.

Claim in the note's own voice, the count as the unit of strength, the link as
the proof. The counting rule synthesis already has ("six of nine accounts",
`SKILL.md:68-69`) is the right evidence unit for a theme; with accumulated
insights the count is read straight off the insight's frontmatter.

### Line-level traceability comes free

Citations point at whole documents, but the verbatim quote inside the insight
is itself the anchor: recovering "which line in this 90-minute transcript
backs this claim" is a text search for the quote in the source. No
link-plus-anchor schema is needed as long as the form rule keeps quotes
verbatim. (This settles the old traceability question.)

### Birthplace in v1: synthesis promotes instead of discarding

The per-item findings that end up load-bearing for a cluster become insight
proposals rather than deleted session files: a new insight where the claim is
new, an evidence extension where an insight already makes the claim. The
theme card cites them.

Volume stays small this way, a handful of insights per cluster, so they ride
along as plain individual approval cards next to the cluster's card. No
bundling machinery, no change to the approval contract. (This settles the old
auto-file question: ride-along, and revisit only if friction shows up.)

### Birthplace in v2: arrival extracts (deferred)

Arrival reads every document anyway, fresh, one at a time, which makes it the
cheapest moment to capture "Elin said security reviews run six weeks" as a
note. But the pain we actually observed is synthesis-side, and arrival
extraction drags three costs with it, so it waits:

- It is the sole source of the card flood (ten transcripts times three to
  five insights each), which is the sole reason bundling machinery would need
  to exist. Build that then, not now.
- It sits awkwardly against arrival's own ethos ("extraction, not analysis");
  the junk-drawer bar below is a judgment call, and arrival is told not to
  make judgment calls.
- Arrival already has a home for this material: "customer signals worth
  keeping, onto the customer hub". Insight extraction creates two homes for
  the same fact. Before shipping v2, the copy must say which channel wins.

Trigger for v2: synthesis-born insights turn out too sparse to matter.

## Why this also performs better

- *Model behavior.* Give the model a citable unit and the hard form rule
  "a theme never quotes a transcript directly; if a quote is worth using, it
  is worth keeping as an insight first", and the safe path becomes the path
  we want. Grounding stays fully intact; "cite" stops defaulting to "paste".
- *Reuse.* Three themes lean on the same insight without three copies of the
  quote.
- *Contradiction tripwires.* Arrival already flags claims that contradict a
  live insight (`arrival/SKILL.md:76`). Every insight filed is a new tripwire.
- *Scale and cost, eventually.* To be honest about v1: synthesis keeps its
  per-document pass, because the counting rules require every document in
  scope to get a pass and the silent ones to be named, and silence and
  contradictions are the session's best findings. So the first runs cost the
  same as today. The win arrives later: pointed questions answerable from
  `insights/` alone read dozens of half-page notes instead of hours of
  transcript, and the account count is frontmatter, not a re-read.

## Guardrails

**The junk drawer.** If every observation becomes an insight, `insights/`
turns to noise and synthesis drowns in its own evidence layer. The bar: an
insight is a claim someone could act on or a future theme could rest on, not a
summary line. Plus the dedup rule todos already have: check existing insights
first, and extend an existing insight's `evidence` rather than filing a
near-duplicate.

**Silence still needs sources.** "Which documents said nothing about this"
cannot be answered from `insights/`. When the question demands completeness,
synthesis keeps its per-document pass, but that pass reads for gaps and
contradictions, not for quotes to paste.

## Lifecycle: insights can be wrong

Themes lean on insights as their evidence, so a wrong insight silently props
up themes unless it can visibly die. Insights join the existing trust and
freshness machinery like any other note. When arrival flags a contradiction
and the PM sides against the insight, the insight gets marked disputed or
superseded, never silently edited, and a theme citing it now visibly rests on
disputed evidence. No new machinery; just the rule that resolution touches
the insight's status, not its body.

## Migration

Existing quote-collage themes stay as they are. The next synthesis run that
touches a theme decomposes its load-bearing quotes into insights as part of
its normal proposals. No backfill sweep.

## What changes where

Everything in v1 is skill copy. It lives in two places that must move
together:

- `vault-dev/skills/{arrival,synthesis}/SKILL.md` (the demo vault)
- `packages/sessions/src/defaults.ts` (the shipped pack; existing vaults pick
  edits up through the skill-pack review flow, `reviewSkillPack` /
  `applyShippedSkill`)

The v1 edits:

1. **Synthesis, insight definition** (`defaults.ts:488-489` and the vault-dev
   mirror): from "a single account said something worth keeping on its own"
   to the accumulating one-claim unit above. Insights and themes stop being
   mutually exclusive; a theme's claims decompose into insights.
2. **Synthesis, Produce:** themes cite insights, never transcripts directly.
   Promote load-bearing per-item findings to insight proposals, extend-first,
   before session files are deleted. Insights ride along as plain cards.
3. **The form rule, inline in both skills:** claims in the note's own voice,
   counts as strength, citations as proof, inline quotes only when the
   wording itself is the finding. Arrival's verbatim commitment quotes pass
   this rule unchanged: the exact wording of a promise is the finding.
   Promote the rule to a `_writing` always-on skill only when a third writer
   needs it.
4. **Synthesis and lifecycle copy:** contradiction resolution marks the
   losing insight disputed or superseded; migration-by-touch as above.

Deferred to v2: arrival extraction (with the channel decision), bundling
under parent cards if the flood materializes, auto-filing without approval if
ride-along ever proves too much friction.

## What shipped

All four v1 edits landed in `packages/sessions/src/defaults.ts` and the
vault-dev mirror, with new fingerprints appended in `shipped-versions.ts`.
Three things came out different from the plan above, all forced by what the
code actually does:

- **No `disputed` state, so superseding is the whole mechanism.** Insights
  carry `processing` (new / processed / stale) and nothing else; only decisions
  have `standing: superseded`. So a contradicted insight is corrected by a new
  insight carrying `[[supersedes::insights/<slug>]]`, which is a real link type
  against an insight target and renders as a "Superseded by" backlink on the
  old note. Note what this does *not* do: nothing renders on a theme citing the
  old insight, so "a theme visibly rests on disputed evidence" is not true yet.
  Making it true means a lifecycle field on insights, which is more than copy.
- **`sources` and `evidence` are two different channels, and the copy now says
  so.** A card's `sources` argument is resolution-checked and rejects anything
  not already on disk, so a theme card cannot cite an insight the same run only
  proposed. The insights go in the note's `evidence` frontmatter, which is not
  resolution-checked and self-heals once the insight is approved.
- **Extending an insight restates the whole list.** `acceptUpdate` shallow
  merges, so a `propose_update` carrying one new ref replaces `evidence`
  instead of appending to it. Since that array is now the account count, a
  silent truncation would destroy the exact fact this design rests on. The copy
  makes restating the full list explicit.

One behaviour change worth watching: `markCitedSourcesProcessed` flips every
cited source or meeting to `processed` on approval. Now that transcripts are
cited by the insight rather than the theme, approving one insight can flip a
stack of transcripts (one commit each) with no card explaining it.
