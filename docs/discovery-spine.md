# The discovery spine — insight, theme, ticket

**Decision + built, 2026-07-28.** Scope review triggered by the question: now
that tickets exist, do we still need `problem`, and can `insight` be reworked?

The short answer is that tickets cannot absorb problems, the flow we actually
want already contains the problem object under a different name, and the thing
making the model feel bloated is a *missing session*, not a redundant type. What
follows is the reasoning, the four changes it implied, and what got cut instead
to keep MVP surface flat.

## Why tickets can't absorb problems

`ticket` is not a workspace object. It is a read-only mirror of an upstream Jira
issue:

- `zTicket` (`packages/domain/src/notes/frontmatter.ts`) *requires* `provider`,
  `external_id`, `container`, `state`, `remote_updated`, `url`. There is no local
  ticket creation. The only path to one is `draft_jira_issue` → approval → Jira →
  sync back.
- It sits in the `raw` layer, whose contract is *never edited locally, only
  re-synced wholesale*. The librarian skill already says it out loud: "never edit
  it — re-sync overwrites local edits wholesale — the link goes in the hub page,
  never in the mirror itself."

Three consequences, each fatal to "just use tickets":

1. **A ticket cannot accrue evidence.** Anything written on it is destroyed by
   the next sync. `evidence[]` has to live on a page the workspace owns.
2. **A ticket cannot hold a stance.** Its `state` is Jira's workflow label, owned
   upstream. There is no Jira state meaning *"we believe this matters and have
   deliberately not built it."*
3. **The interesting items never become tickets at all.** Everything watching,
   exploring, or explicitly declined has no Jira row by definition. Those are
   exactly the items whose reasoning is expensive to reconstruct and which the
   memory exists to hold.

Secondary but real: the ICP has Jira (see `apps/desktop/PRODUCT.md`), but a
workspace that only becomes useful *after* a connector is configured has a much
worse first run than one that does not.

## The object was already in the flow we want

The target flow, as stated:

> analyze raw transcripts → insights from the individual interview → meta
> analysis → create tickets for the ones we want

The third step produces something durable that is not a ticket (nothing has been
committed to yet) and not an insight (it spans several interviews). A chat is
ephemeral and a plain `note` is untyped, so neither is reachable by retrieval or
by the freshness spine. That output *was* `problem`: `evidence[]` + `stance` +
evidence heat.

So the model was right and the vocabulary was wrong. "Problem" excluded the ideas
and opportunities that belong on the same shelf, which is what made it feel
narrow enough to delete.

## The four changes

### 1. `problem` → `theme`

A theme is the durable thing worth solving: a problem, a pain, an opportunity, an
idea. One shelf for all four, which "problem" refused to hold. The model now
reads as an evidence chain with provenance:

| Step | Type | Layer | Owned by |
|---|---|---|---|
| The interview | `source` | raw | upstream / immutable |
| What one interview told us | `insight` | derived | agent, human-editable |
| The durable thing worth solving | `theme` | authored | the human |
| What we're doing about it | `ticket` | raw | Jira |

`stance` carried over unchanged — and it already answered the "someday / never"
worry that prompted this review:

| Stance | Means |
|---|---|
| `exploring` | live, still gathering evidence |
| `watching` | real, not now — the *someday* bucket |
| `committed` | we're doing this; expect linked tickets |
| `wont-do` | deliberately declined, and evidence still accrues (we keep the why) |

`wont-do` accruing evidence was already in the domain and is the single strongest
argument for keeping the object: it is the one state tickets structurally cannot
represent.

*(`opportunity` was the other candidate and the original recommendation; `theme`
won on brevity. The stance field is what carries "worth solving," so the noun
does not have to.)*

### 2. The librarian coupling is cut, both directions

The schema was already permissive — `insight.theme` and `decision.theme` are both
optional. The felt requirement came from librarian copy, not types. The
`unconnected-mirrors` ping used to read:

> 2 open tickets aren't connected to any problem or customer

and its seed prompt told the agent to link each mirror "from the problem, customer
or release page it belongs under." Both now name no hub type at all:

> 2 open tickets aren't linked from anywhere in the workspace

and the seed prompt carries an explicit licence not to file: *"A ticket does not
need a hub to be legitimate: where a piece of work plainly stands on its own, say
so and leave it rather than inventing a parent for it."* The filing rules say the
same from the other side — a theme is never required to have a ticket, and a
ticket is never required to have a theme.

### 3. `insight` kept as-is

Insight is the load-bearing atom, not the overhead. `evidence[]` is *required* on
it, and that requirement is what makes Ask's promise — a cited, dated answer or
"vet inte" — true rather than aspirational. Delete insights and the citation
spine degrades to prose.

The proposal also called for removing hand-creation of insights. **No code change
was needed: the app already behaves that way.** ⌘N creates `type: note`, `type`
is not an editable property in `PropertiesBlock`, and QuickSwitcher has no create
path. Insights only ever arrive as `propose_note` cards.

### 4. The synthesis session — the actual gap

There was no cross-interview synthesis session. `interview-synthesis` reads *one*
transcript ("A customer-call transcript is dropped") and emits insights. Nothing
in the skill pack performed step 3 of the flow above.

That absence is why the model felt like it carried a redundant object: we were
looking at a type nobody filled. The new `synthesis` session
(`packages/sessions/src/defaults.ts`, `tier: outbound`, `mode: dynamic`):

- **When** — the PM points at a scope (a context tag, a customer, an existing
  theme) and asks what the interviews add up to.
- **Read** — every insight in scope, the themes that already exist there and
  their stance, the decisions that touched them, and the ticket mirrors where a
  theme links tracked work.
- **Produce** — clusters as approval cards, each stating **how many distinct
  accounts back it**: a new theme where insights converge; evidence added to an
  existing theme; a stance re-reading where the evidence genuinely moved; the
  dissent as its own card where insights disagree; and an explicit list of what
  is still thin.
- **Then** — `draft_jira_issue` only for themes that are *already* `committed`.
  A theme in any other stance produces no ticket.

Four red flags encode the failure modes: a theme built on one account is a signal
not a pattern; flipping to `committed` is a decision with a decider, not a
synthesis output; never invent a theme so an existing ticket has a parent; never
drop a contradicting insight to make a cluster clean.

`interview-synthesis` now ends by handing off explicitly: "One interview is one
account. Turning several of these into a pattern is the Synthesis session's job."

## What got cut

| Cut | Why |
|---|---|
| `release` type | A release is a decision plus some tickets. It carried its own type, folder, status enum, properties row, Memory shelf slot and icon for very little. |
| `sprint-review` skill | Thin, Jira-heavy, overlapped `weekly-update`. |
| `spec-review` skill | Same, plus it presumed an epic-centric workflow we haven't validated. |

Net: 14 types → 12, 13 skills → 12 (two cut, one added).

**`wikipage` / Confluence was deliberately kept.** It was on the proposed cut
list, but it is built, live-verified and expensive to undo; deleting a working
integration to reduce a count is the wrong trade. `wikipage-drift` now pairs
pages with **theme hubs and decisions** (the `release` linker branch is gone).

## Migration notes

Demo vault: `vault-dev/problems/` → `vault-dev/themes/`, every `[[problems/…]]`
wikilink and `problem:` frontmatter key rewritten, `vault-dev/releases/` deleted
with its ten inbound references repointed at the decision or ticket that carries
the same fact (`[[releases/2026-06-audit-log]]` → `[[tickets/PAY-156]]`,
`[[releases/2026-07-sso-saml]]` → `[[tickets/PAY-142]]`, and so on — which is the
"a release is a decision plus some tickets" claim actually holding up under a
rewrite). The workspace skill copies under `vault-dev/skills/` were regenerated
from the new defaults; the demo-only skills (`discovery-guide`, `broken-demo`,
`supersede-sweep`) were left alone.

`pnpm refresh-demo` reports **93 notes validate; all wikilinks resolve**, which
is the end-to-end check that no dangling `[[releases/…]]` survived and that
`type: theme` parses.

An existing user workspace would need the same one-time migration (rename the
folder, rewrite `type:` and the `problem:` ref key, rewrite `[[problems/…]]`
wikilinks). Doing this before external users exist is what made it cheap.

## Verification

`pnpm check-types` clean across all 11 packages, `pnpm test` green (8/8 suites),
`pnpm lint` 0 errors (18 pre-existing warnings unrelated to this work).

## Still open

- **Should `insight` roll up at all?** Keeping `insight.theme` optional is
  correct, but if synthesis is the only thing that ever sets it, the field may
  belong on the theme's `evidence[]` alone — one direction instead of two.
- **Does `customer` stay a hub or become a facet?** Out of scope here, but the
  same "does this need its own type" question applies to it next.
- **Synthesis has never run against a live model.** Its prompt is written and
  registered but unexercised; the clustering quality and the "distinct accounts"
  discipline are unverified.
