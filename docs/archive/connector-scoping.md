# Connector scoping & onboarding — what to watch, and how the PM says so

> **Status: mostly parked.** The lean slice — four small changes — was **built 2026-07-28**;
> see [`connector-scoping-mvp.md`](./connector-scoping-mvp.md) for what shipped and why. Read
> that first. This doc is the long-form reasoning behind it and the menu of things we chose not
> to build yet.
>
> Of the model below, ring 3 (neighbours) and ring 4 (reach) now exist in reduced form: blockers
> are discovered automatically one hop out, and the agent can make a live lookup stick with
> `track_external`. Rings 1 and 2 — the personal ring and the ranked scope picker — are not
> built, and neither is the horizon bound, which the MVP doc explains we deliberately dropped.

> Design note, 2026-07-28. Follows on from `archive/jira-confluence-integration.md`, which got
> the *mechanics* right (mirror-as-note, shallow/deep tiers, draft-and-approve writes) but left
> the *scoping* model too blunt. This doc is about the question a PM at a 400-person company
> actually asks on connect day: **"I don't want all of Jira in here — but I do want the bits
> that can hurt me."** It is provider-generic on purpose; Jira/Confluence is the worked example,
> Linear/Notion/GitHub/Slack are the test of whether the abstraction holds.

## What's wrong with the model we shipped

Today there is exactly one scoping gesture: **follow a container** (a Jira project, a Confluence
space), plus automatic deep-tracking of anything a vault note links. Two failure modes, at
opposite ends:

**It's too coarse at the top.** `pullChanges` issues `project = "PAY" ORDER BY updated ASC` with
no bound. On a real instance that project has 4,000 issues going back three years, and the first
sync pulls every one of them into the shallow index. The consequences aren't just bandwidth:
`[[` autocomplete fills with 2023 bugs, the "what's in flight" surfaces have to filter noise they
shouldn't have ingested, and re-pulls after a lost high-water mark are expensive enough to
notice. The design doc said "shallow: key, status, title, assignee — enough for autocomplete and
status pills." True, but *which* items was never bounded, and the count is the thing that hurts.

**It's too coarse at the bottom.** The PM depends on Platform's infra epic. To see it they must
follow the entire `INFRA` project — 900 tickets of someone else's work — or already know the key
`INFRA-88` and type it into a note. There is no gesture for *"the slice of another team's work
that touches mine."* That's precisely the slice a PM cares about most, because it's where dates
die.

And the picker itself is a wall of undifferentiated checkboxes: every project and space on the
site, alphabetical, no signal about which ones are *theirs*. On a medium instance that's 40–80
rows and the PM guesses.

The deeper mistake: **container-follow treats "what I care about" as a property of the org's
filing system.** It isn't. It's a property of the PM's work — who they report to, what they
promised, what's blocking them this quarter. The org's filing system is a coarse proxy that
happens to be the only thing our picker can see.

## What the API actually gives us

Worth being concrete, because the design below is only as good as the signal available. Jira
Cloud and Confluence Cloud are unusually generous here — they already know a great deal about
what this user cares about, and we ask for none of it.

### Jira: the user's own footprint

| Signal | How | What it means |
|---|---|---|
| Recent projects | `GET /rest/api/3/project/recent` | Where this person actually works. Ranked, free. |
| My issues | JQL `assignee = currentUser() OR reporter = currentUser()` | The personal ring. Tens of items, not thousands. |
| Watched | JQL `issue in watchedIssues()` | Explicit "tell me about this" — already expressed, in Jira. |
| Roles | JQL `project in projectsWhereUserHasRole("Product Owner")`, `projectsLeadByUser()` | Structural membership. |
| **Saved filters** | `GET /rest/api/3/filter/my?includeFavourites=true`, then JQL `filter = 10432` | **The PM's own curation, already written.** |
| **Boards & sprints** | `GET /rest/agile/1.0/board`, `/board/{id}/sprint`, `/board/{id}/issue` | **A team's actual current work**, maintained by that team. |
| Epic / hierarchy | `parent = PAY-142`, `issuetype = Epic` | A deliverable, which is the PM's real unit. |
| Releases | `fixVersion = "2026.09"` | A date, which is the PM's other real unit. |
| Issue links | already on the `getIssue` payload we fetch (`issuelinks`) | **The dependency graph — how we reach other teams.** |
| Transitions | `GET /rest/api/3/issue/{key}/changelog` | "Since last time" without diffing snapshots. |
| Size preview | `POST /rest/api/3/search/approximate-count` | Show "≈280 tickets" *before* committing to a scope. |

Two of these are load-bearing and we currently use neither:

- **Saved filters and boards are curation the user (or their org) already did.** A PM who has a
  "My squad — this sprint" filter has literally already answered our onboarding question, in
  Jira's own vocabulary. Asking them to re-answer it in checkbox form is the app being obtuse.
- **Issue links let scope follow dependencies instead of org charts.** We already parse
  `issuelinks` in `fetchFull` and map them to typed edges. From a linked key we can fetch across
  project boundaries with plain `key in (INFRA-88, OPS-12)` — no exotic JQL, no extra
  permissions beyond "can this user see the issue", which is exactly the right permission model.

Notes on things it's tempting to want and can't have: **webhooks need admin or an installed
app**, so polling stays. There's no reliable personal activity-feed REST anymore. `commentedBy`
is not native Jira Cloud JQL (it comes from marketplace apps) — don't design on it;
`worklogAuthor` and `issueHistory()` are native but weak substitutes.

### Confluence: same shape, different nouns

- `favourite = currentUser()` and `contributor = currentUser()` in CQL — starred and
  edited-by-me, the personal ring.
- `GET /wiki/rest/api/user/watch/space/{key}` — spaces the user already chose to watch.
- **`ancestor = <pageId>`** — follow a *page tree*, not a space. "The Product space's Specs
  tree" is a real thing a PM wants; "all 4,000 pages in Product, including HR onboarding" is not.
- `label = "spec"` — the org's own curation again.
- `lastmodified > now("-90d")` — the active horizon.

### The pattern that generalizes

Strip the provider names and every one of these falls into three buckets, and **every system
worth integrating has all three**:

1. **Mine** — a query for "things attached to me". Jira `currentUser()`; Linear "My Issues";
   GitHub `involves:@me`; Slack "channels I'm in"; Notion "shared with me"; Calendar "my
   calendar". Zero configuration, always small, always relevant.
2. **Someone already curated this** — a named, maintained slice that isn't ours to invent. Jira
   boards + saved filters; Confluence page trees + labels; Linear teams, cycles and saved views;
   GitHub repos and Projects; Slack channels. **These are better scopes than containers because
   somebody else keeps them accurate.**
3. **Edges** — the relationships that reach outside whatever we picked. Jira issue links, epic
   parents, `fixVersion`; Linear relations; GitHub cross-repo references; Confluence page links.

That triple is the abstraction the connector interface should expose. It is not Jira-shaped.

## The model: four rings

Replace the single follow flag with concentric rings. Each ring has a different *acquisition
gesture*, a different *depth*, and a different *cost*. The PM only ever explicitly configures
ring 2 — and even then, from a ranked list with evidence, not a blank picker.

### Ring 1 — Mine (automatic, zero configuration)

On connect, resolve `currentUser()` and pull: assigned, reported, watched, in my favourite
filters; Confluence pages I created, edited or starred. Typically 20–200 items. **Deep-mirrored**
— full bodies, comments, freshness-spine participation.

This is the day-one payoff. Before the PM has picked anything, `[[` finds their own tickets,
`ask` can answer "what did I promise on SSO", and the meeting brief has real material. Onboarding
that produces value *before* the first configuration question is the whole trick.

### Ring 2 — My areas (chosen once, from a ranked proposal)

Projects, boards, filters, spaces and page trees the PM opts into. Two changes from today:

**The list is ranked and carries evidence, not alphabetical and bare.** Use
`/project/recent`, role membership and a `assignee/reporter = currentUser() AND updated > -90d`
count to sort. Pre-check the obvious ones. Show *why*:

```
  ✓ Payments (PAY)              you touched 43 issues here in 90 days     ≈180 open
  ✓ Platform board — Team Kilo  12 of your tickets link into this board   ≈40 in sprint
  ✓ Product ▸ Specs             you edited 6 pages here                   ≈24 pages
  ✓ "My squad — this sprint"    your saved filter                         ≈31
    Design System (DS)          nothing of yours here                     ≈310
    ⌄ 37 more projects, 22 more spaces
```

**A followed scope means its *active horizon*, not its entire history.** Concretely:
`statusCategory != Done OR updated > -90d` for tickets, `lastmodified > -180d` for pages, plus
the parent epics of anything in range even if the epic itself is cold. This is a one-clause JQL
change and typically cuts a 4,000-issue project to 200–400 — the difference between an index
that's useful and one that's noise. Closed-and-cold work isn't lost; it's reachable via ring 4.

Ring 2 stays **shallow** (key, title, state, assignee, links, remote_updated). Shallow is not a
consolation prize — see "the other team" below, where shallow rows are the *right* granularity.

### Ring 3 — Neighbours (automatic, derived from edges)

**This is the answer to "that other team's tickets which we depend on."** Nobody picks these.
Anything one hop from ring 1 or 2 gets pulled by key regardless of which project it lives in:

- issues linked `blocks` / `is blocked by` / `relates to` something we already watch;
- parent epics of watched issues;
- issues sharing a `fixVersion` with a release the vault references;
- pages linked from a watched page or from a vault note.

Depth: **shallow by default, deep the moment the PM references it** — the existing
deep-track-on-link rule, unchanged. So `INFRA-88` appears as a live chip on the release note the
day it starts blocking `PAY-142`, without the PM ever having heard of the INFRA project.

And then the offer, in context and *only* in context:

> Platform (INFRA) keeps showing up — 4 tickets now block yours. Watch their board?

That's the moment scope should grow: when the dependency is demonstrated, not when the PM is
staring at a checkbox list on day one trying to predict the future. This ring is also what makes
the model self-tending: reorgs, new dependencies and new teams show up on their own.

One guard: neighbours are one hop, capped (say 200 items), and never recursive. Two hops through
a big instance is the whole graph.

### Ring 4 — Reach (live query, no mirror at all)

The PM asks: *"What is Platform actually working on right now?"* — for a project nobody follows.
The mirror shouldn't have to answer this, and building scope in advance for every question the
PM might one day ask is exactly the thing they don't want.

Give the agent a `search_external(text, scope?, state?)` tool that queries the provider live,
bounded and read-only. Results render distinctly ("live from Jira, just now" vs. cited local
evidence), and carry a follow-up affordance: **"Keep an eye on this"** → promotes that board,
epic or filter into ring 2.

This is the best onboarding surface we have, because the PM is asking a question they actually
have, and the scope decision is a one-tap consequence of a real need. Configuration disguised as
an answer.

## "What is that other team working on?" — three honest answers

Worth spelling out, because it's the user's literal question and each ring answers it differently:

| Situation | Answer path | What the PM gets |
|---|---|---|
| Their work blocks mine | Ring 3, already mirrored | Live chip + drift signal on my release note; commitment-check sees the blocked epic |
| I follow their board | Ring 2 shallow rows | **A team pulse, computed with no bodies at all:** current sprint name, counts by `state_category`, what moved to Done in the last 14 days, what's blocked and for how long. Shallow rows carry state + timestamps — that *is* the answer to "what are they working on" |
| Idle curiosity, not followed | Ring 4 live query | Bounded live results, marked as live, with "keep an eye on this" |

The middle row is the important one and it justifies keeping the shallow tier. "What's team X
doing" is a *statistical* question about a set of tickets, not a *semantic* one about any single
ticket's body. We can answer it well from data we can afford to hold for several teams. Full
bodies are only needed where we *reason* — the deep ring, which stays small because it's earned
by linking.

## Onboarding, end to end

1. **Paste token** (≈60s, already good). Verify names who you are and where.
2. **"Here's what we found about you."** Ring 1 syncs immediately in the background — small, so
   it lands in seconds — while the ranked ring-2 proposal renders with pre-checks and evidence.
   The PM's job is to *deselect*, which is a much easier cognitive task than to select.
3. **Show the size before committing.** `approximate-count` on the composed scope: *"This watches
   about 280 tickets and 24 pages. You can widen or narrow this anytime."* Honesty about volume
   is what earns permission to sync at all.
4. **Done — with something already true.** Autocomplete works, chips resolve, the next meeting
   brief has delivery context. No empty state, no "come back in 20 minutes."
5. **Weeks 1–4: scope grows by offer, never by nag.** Neighbour promotions from ring 3, "keep an
   eye on this" from ring 4. Each offer appears in the surface that motivated it — never the
   Inbox (per the commitment-check stance).
6. **Narrowing is as easy as widening, and never destructive.** Unfollowing a scope drops shallow
   rows; deep mirror notes the PM linked stay, as today ("demotion is a human delete").

Two invariants that must survive all of this: **reads never ask and never notify**; **ring 2/3
shallow rows never participate in the freshness spine.** Only deep-mirrored items reset
`status: new` and cascade staleness — otherwise following one busy board would mark half the
vault stale by Tuesday. The current code already gets this right by only calling `writeMirror`
for deep items; the rule needs to stay explicit as the promotion criteria widen.

## What this asks of the connector interface

`ExternalContainer` (id + name + kind) is too thin. The generalization, matching the three
buckets above:

```ts
type ScopeKind = 'personal' | 'container' | 'view' | 'subtree' | 'derived';
//  personal  — currentUser() queries; no id needed
//  container — Jira project, Confluence space, Linear team, GitHub repo
//  view      — Jira board/filter, Linear saved view, Confluence label  ← someone else's curation
//  subtree   — Confluence page tree, Jira epic, GitHub milestone
//  derived   — neighbours; never user-picked

interface Scope {
  kind: ScopeKind;
  id: string;
  name: string;
  itemKind: ContainerKind;            // ticket | wikipage | calendar
}

interface ScopeSuggestion extends Scope {
  rationale: string;                  // "you touched 43 issues here in 90 days"
  strength: number;                   // ranking signal, provider-computed
  approximateSize?: number;
  recommended: boolean;               // drives pre-check
}

interface Connector {
  suggestScopes(): Promise<ScopeSuggestion[]>;              // ring 1 + ranked ring 2
  pullScope(scope: Scope, since: string | null): Promise<PullResult>;   // horizon-bounded
  resolveNeighbours(ids: string[]): Promise<ShallowChange[]>;           // ring 3, one hop
  searchLive(query: string, scope?: Scope): Promise<ShallowChange[]>;   // ring 4
  // fetchFull / execute / mapStateCategory / verifyAuth unchanged
}
```

The renderer never learns a provider noun: it renders suggestions with their rationale strings
and a kind icon. A Linear connector fills `personal` with My Issues, `view` with saved views and
cycles, `derived` with issue relations — and gets the identical onboarding screen for free.
That's the test the abstraction has to pass, and it does.

## Consequences for the current code

Roughly ordered by value per unit of work:

1. **Bound the horizon** in `AtlassianConnector.pullChanges` — add `AND (statusCategory != Done
   OR updated > -90d)` for tickets, an equivalent for pages. One clause; largest single
   improvement; no model change.
2. **Ring 1 on connect** — a `personal` scope followed by default, deep-mirrored. Makes the
   connect flow produce value before any picking.
3. **Rank the picker** with `/project/recent` + per-project touch counts + evidence strings, and
   pre-check the recommended ones. `ConnectionsSettings.tsx` renders `rationale` generically.
4. **Ring 3 neighbours** — we already parse `issuelinks` in `fetchFull`; feed those keys back as
   a `key in (...)` pull, capped and one hop. Plus the in-context "watch their board?" offer.
5. **Boards and saved filters as scopes** — `/rest/agile/1.0/board` and `/filter/my` into
   `suggestScopes`; `pullScope` for a view is `filter = <id>` / `board/{id}/issue`. This is the
   feature that makes "the other team" a first-class, PM-legible noun.
6. **Confluence page trees** via `ancestor =`, so "Product ▸ Specs" beats "all of Product".
7. **`search_external` + "keep an eye on this"** — ring 4, and the best organic growth path.
8. Generalize `SyncStore`'s `sync_containers` to `sync_scopes` (add `kind`, keep the id/high-water
   columns). Straight migration; follow flags survive.

## Open questions

- **Horizon length.** 90 days is a guess. It should probably differ per scope kind (a board's
  active sprint needs no date bound at all; a project does) and possibly adapt to instance size.
- **Approximate-count availability.** `POST /rest/api/3/search/approximate-count` needs verifying
  against a real site before the picker's size preview depends on it; fall back to "we'll tell
  you after the first sync" rather than showing a wrong number.
- **Ring 1 for a PM who lives in Confluence.** `contributor = currentUser()` can be large for a
  heavy writer; may need the same horizon treatment as tickets.
- **Multi-site / multi-provider ranking.** Once a PM has two Jira sites and a Linear workspace,
  `suggestScopes` results need merging into one ranked list without the UI learning who's who.
- **Does the neighbour cap need to be visible?** Silent truncation of a dependency set is exactly
  the kind of quiet incompleteness that erodes trust in the drift signal. Probably a quiet line
  on the connection card rather than nothing.
