# Sessions v2 — one session, skills that arrive, agents with a desk

**Status: plan, not built. 2026-07-28.**

Three changes that turn out to be one change:

1. A session can have **its own files** — a scratch folder it writes to freely, which is not the memory.
2. A session can **spawn subagents** — N independent pieces of work in parallel, over notes,
   over one document with different lenses, or (later) over things outside the vault entirely.
3. **Session types stop existing.** A session is a session; skills arrive dynamically, explicitly, or by rule.

Together these replace "add an analysis feature" with "give the agent a desk and let the
skill pack describe the work." The analysis workflows we keep almost building —
cross-interview synthesis, "review every theme's stance", "per customer, read their reported
bugs" — become prose in a skill file instead of code paths.

---

## Why

### The pain point that started this

A PM has run nine customer interviews and wants to know what they add up to. Sometimes the
question is pointed ("who wants scheduled exports?"), sometimes it's open ("read these and
tell me what's there"). They may run several different analyses over the same material, or
the same analysis again with a different prompt or model.

Nothing in the app does this today. `interview-synthesis` reads *one* transcript.
`synthesis` reads *insights*, not sources, and only rolls them into themes. Neither can
answer an arbitrary question over an arbitrary corpus, and neither generalizes past
interviews.

The naive fix — a new "Analysis" session type with its own data model — is the wrong shape.
It hardcodes one workflow, doesn't generalize to themes or customers or tickets, and adds a
type to a model we just spent a review cutting down (see `discovery-spine.md`).

### What's actually missing

Two capacities, not a feature:

- **Somewhere to put working material.** At thirty interviews no single context holds the
  corpus. The agent needs to write intermediates and read them back. Today it has nowhere to
  put them except the memory, which is exactly the clutter we don't want.
- **A way to do several pieces of work at once and read the results back.** Sometimes that's
  one pass per item over a corpus; sometimes it's three different analyses of the *same*
  document; later it may be reading three external sources that aren't in the vault at all.
  The common shape is *N independent pieces of work, then a rollup* — not *a map over a
  corpus*, which is only the most familiar case.

Both are general. Neither is about interviews.

### And one thing that's in the way

Session types force the PM to choose the shape of the work before they know it, then trap
them in that choice. You come out of a customer call, start After-Meeting, realise the
interesting question spans the last four calls — and today that's a new tab and a lost thread.

The skill pack shows the same strain from the inside. Five skills implement one routing
table, branching on what the material is and who was in the room:

| Skill | Fires on |
|---|---|
| `after-meeting` | transcript, `origin: po` |
| `external-transcript` | transcript, `origin: external` |
| `intake` | capture, `kind: link` / `kind: screenshot` |
| `process-note` | a rough dump, dynamic |
| `interview-synthesis` | a customer call (no binding at all) |

`intake`'s own red flag says: *"A capture that is actually a meeting transcript —
participation decides its path. If the PO was in the room, suggest re-filing it as a meeting
(After-Meeting). If not... suggest the External-Transcript session instead."* That is a
session type whose job includes telling you it's the wrong session type. The branch is data.
It's currently expressed as types.

---

## The model

**One session.** No `session_type` as a runtime mode. A session is a conversation with the
memory that can read, propose, spawn, and (when permitted) keep files.

**Skills arrive three ways**, and all three are wanted:

| Mode | Who decides | Example |
|---|---|---|
| `dynamic` | the agent, from the skill index | mid-chat, the PM asks what nine interviews add up to; the agent pulls in `synthesis` |
| explicit | the PM | picks "Synthesis" from a picker, or clicks **After-meeting** on a meeting page |
| `triggered` | a rule in frontmatter | a transcript lands with `origin: external` → the arrival skill runs |

**A skill brings its permissions with it.** `tier` stops meaning "this session type has draft
tools" and starts meaning "invoking me turns on draft tools." Same for `gate_output` and
checkpoints: the gate arrives with the skill rather than being fixed when the session opened.

**A session may have files.** Opt-in per skill. The files are working material, never memory.

**A session may spawn subagents.** Always with an approval card. Children read; only the
parent proposes.

### What this costs, honestly

Named sessions are the product's visible surface area. A PM learns what the app does by
reading "Weekly Update", "Before Meeting", "Synthesis" in a list. Dissolve them into a text
box and a new user sees a blinking cursor.

So the entry points do not change. The button on a meeting, the Skills view, the Landing tiles
all stay exactly where they are. They stop meaning *enter this mode* and start meaning *start
a session and invoke this skill*. Same clicks, same names — but the skill is now something
that arrives, not a room you're locked in, and a second one can arrive after it.

---

## Invariants

These are the rules that make the rest safe. Breaking any one of them degrades the memory
silently, which is the worst failure mode this product has.

1. **Session files are not the memory.** Never indexed, never returned by `search_vault`,
   never retrieved for Ask, never a wikilink target, never counted in freshness, never
   committed to git. The product's claim is that everything in the memory is cited and
   trustworthy; half-finished intermediates being retrievable dilutes that claim with exactly
   the least reliable material in the system.

2. **Citations pass through session files, never terminate in them.** A subagent reads
   `sources/2026-06-12-kranelund.md` and writes `per-item/kranelund.md`. The per-item file
   must carry the original path **and the verbatim quote** forward, and the card the parent
   proposes cites *those*. Enforced at the propose tools: reject any `evidence` entry
   resolving inside the session-files root. This fails silently otherwise — you get a memory
   full of insights whose evidence points at deleted scratch, and nothing complains until
   someone follows a link months later.

3. **Permissions attach to the material and the skill, never to the session.** A colleague's
   sales call cannot create product truth because of *what it is*, not because of which mode
   was opened. `external-transcript`'s "never propose a decision" rule must survive the merge
   into one arrival skill.

4. **Read scope is structural, not instructional.** The pi file tools take injectable
   `ReadOperations` / `WriteOperations`; root them at the session's folder and the model
   cannot express a path outside it. A rule the agent is told can be forgotten; a root it is
   given cannot be escaped. A session reads its own files or the general memory — never
   another session's files.

5. **Only the parent proposes.** Children get vault read + write inside their assigned path.
   No `propose_*`, no `draft_*`, no outbound, ever. The approval spine stays exactly as narrow
   as it is today.

6. **Spend is always approved.** Every fan-out gets a card before it runs. Cheap approval, but
   never absent.

---

## Part 1 — Session files

### Where they live

`sessions/.files/<session-id>/`

Verified: `packages/vault/src/fs-vault.ts:149` skips any entry whose name starts with `.`, at
every level. So a dot-folder under `sessions/` is invisible to the indexer with **zero
indexer changes**. Add it to the vault's seeded `.gitignore` (`packages/vault/src/git.ts:48`).

The location is deliberate: `sessions/2026-07-28-synthesis-a1b2c3.md` is the session's
git-tracked, indexed *face*; `sessions/.files/a1b2c3/` is its untracked *body*. The
relationship is legible from the filesystem alone.

**Name.** "Session files" in the UI. Not "workspace" — `PRODUCT.md` already uses that for the
vault itself, and the collision would be head-on.

### Capability, not default

New frontmatter key on skills: `session_files: true`, alongside `tier` / `checkpoints` /
`gate_output` in `SkillConfig` (`packages/sessions/src/skill.ts`).

- `ask` — **off.** It's the cited-answer session; it should stay read-only and fast.
- `chat` — **on.** "Analyse these nine transcripts" most naturally starts in a plain chat, not
  by picking a mode first.
- Analysis skills (`synthesis` and successors) — **on.**

Capability and spend are separate gates. Collapsing them means either every session can
scatter files, or you can't do ad-hoc analysis without first choosing a mode. Both are worse.

### Tools

`@earendil-works/pi-coding-agent` (already a dependency, 0.80.6) exports
`createReadToolDefinition`, `createWriteToolDefinition`, `createEditToolDefinition`,
`createLsToolDefinition`, `createGrepToolDefinition`, `createFindToolDefinition` — all with
injectable operations. Scoping them to the session folder is configuration, not new tools.

Registered in `toolNamesFor()` (`packages/agent/src/runtime.ts:295`) when the active skill
declares `session_files: true`.

### Layout

Agent-chosen. Not enforced, not validated. A *suggested* convention lives in the skill pack
prose (`brief.md` / `per-item/*.md` / `meta.md`) so the common case reads consistently, but a
skill that wants a different shape just writes a different shape.

### Lifecycle

**No sweeping.** Files persist. The session receipt (`packages/sessions/src/receipt.ts`)
gains a `files:` count line so a session that spawned thirty children leaves a trace in the
git-tracked record even after nobody remembers running it.

Known debt, accepted for now: unbounded growth with no visibility. Revisit with a size
readout in Settings if it becomes real.

---

## Part 2 — Fan-out

### Three reasons to fan out, not one

Getting this list right matters, because it determines the shape of the primitive.

1. **Context budget.** At thirty interviews no single context holds the corpus.
2. **Honest counting.** Every item gets a pass and a silent item is recorded as silent, so
   "six of nine accounts" is a fact rather than an impression.
3. **Independence.** Three analyses of the *same* document, run in parallel, are not the same
   as asking one agent for three things. A single agent asked for a pain-point read and then a
   pricing read will let the first colour the second. Separate children cannot contaminate
   each other.

Reason 3 is the one that breaks "one child per item." Fan-out is worth doing at a single
target, and the axis of variation is sometimes the prompt rather than the material.

### The primitive: a list of work, not a map over a corpus

```
spawn(work: [
  { prompt: "…", over: ["sources/a.md", "sources/b.md"], write_to: "per-item/{target}.md" },
  { prompt: "…", read: ["sources/a.md"],                 write_to: "pricing-read.md" },
  { prompt: "…", read: ["sources/a.md"],                 write_to: "commitment-sweep.md" },
])
```

One tool, one call, a list of entries. An entry with `over` is a **template** that expands to
one child per target (`{target}` interpolates into the path); an entry without it is a single
child. That covers every shape without a union type in the schema:

| Shape | How it's expressed |
|---|---|
| One pass per item in a corpus | one entry with `over` |
| Three different analyses of one document | three entries, same `read`, different `prompt` |
| A mixed batch — a per-item sweep *and* two standalone reads | all of the above in one call |
| Future: read three URLs and summarize | three entries whose input is a URL, not a vault path |

Still batched, never looped: parallel by default, one cancel, one progress block, one cost
number, one place to cap concurrency. N separate tool calls would mean N chances for the model
to drift and a chat transcript that reads like a stack trace.

Children are throwaway `createAgentSession()` instances with `SessionManager.inMemory()` —
the pi SDK docs name "build custom tools that spawn sub-agents" as a supported use case.

### The brief

The parent writes `brief.md` **first**, and every child reads it before starting: what we
currently believe, the relevant themes and their stances, what a good answer looks like.

Without this, fan-out makes the work *dumber* than one big read — a child handed one
transcript in isolation cannot flag a contradiction, which is the single most valuable thing
`interview-synthesis` does today. One write, N smarter readers.

Note what the brief is and isn't. It is **what every child needs to know**, not *the
question* — because in a prompt-varying fan there is no single question. In a per-item sweep
the brief carries the shared question; in a three-lens fan over one document it carries only
the shared context, and each entry's `prompt` carries its own lens.

### Child privileges

Read over the whole session folder (so a second wave can build on the first wave's output),
write only into their own assigned path, vault read-only, no propose/draft. Sibling reads
being allowed buys multi-stage fan-out for free — pass one per transcript, pass two per
cluster — without new machinery. Pure map is the special case, not the constraint.

**Children inherit a subset of the parent's tools, never a superset.** This is what makes the
future non-vault cases safe by construction rather than by a decision nobody remembers making:
the day a fetch tool exists, children may have it *iff* the parent does — and they still never
propose, draft, or write outside their own path.

### The spawn card

The only moment the PM steers before money is spent. Inline in the chat, same vocabulary as
the existing approval cards (`components/inbox/SessionReview.tsx`) — **not a modal**.

```
  ┌─ Spawn 11 subagents? ─────────────────────────────┐
  │  9 × one pass per insight in #enterprise-onboard… │
  │  1 × pricing read of the Nordkap QBR              │
  │  1 × commitment sweep of the Nordkap QBR          │
  │  ▸ brief.md — what they'll all be told            │
  │                                                   │
  │  model  [ Sonnet 5      ⌄ ]                       │
  │                                                   │
  │        [ Cancel ]        [ Approve ⏎ ]            │
  └───────────────────────────────────────────────────┘
```

- **It lists the work, not a target count.** Because a batch can be heterogeneous, "9 targets"
  would be a lie the moment two entries do different things. One line per entry, expanded
  counts for the `over` templates.
- **The model picker lives here.** That delivers "run it again with a different model" as a
  consequence of the design rather than a separate feature: re-running is approving a second
  spawn with a different pick.
- **The brief is expandable, and matters more than the count.** Approving *what they'll be
  asked* is the real quality lever. One click away, not in your face.
- **Per fan-out, not per session.** A skill running two waves asks twice. Enter approves, so
  cheap stays cheap.
- Cap concurrency; show the target count before it spends.

### Watching it run

Files landing in the tree one at a time as parallel children finish. This is the signature
interaction — honest progress, and visible proof the thing read each item rather than skimming
a blob. Hide it behind a spinner and the feature feels like the agent wandered off with your
machine.

---

## Part 3 — Skills arrive three ways

### What already exists

- **`triggered` works.** `bindingMatches()` (`skill.ts:209`) is called from
  `packages/application/src/use-cases/skills.ts:89`, and `capture:ingest`
  (`apps/desktop/src/main/handlers.ts:548`) fires the matched sessions.
- **`dynamic` is declared, described, and inert for session skills.** `guideIndex()`
  (`runtime.ts:339`) and `createUseSkillTool()` (`tools.ts`) both filter
  `skill_kind === 'guide'`. `synthesis.md` and `process-note.md` declare `mode: dynamic` with
  `skill_kind: session` — listed nowhere, loadable by nothing. Meanwhile `describeBinding()`
  renders *"Available on demand — the agent loads it when it is relevant"* into the Skills
  view. **The UI promises a behaviour the runtime does not implement**, which is exactly the
  failure `skill.ts:38` warns about in its own comment about never-fired events.
- **Explicit invocation does not exist.** A session skill is reachable only by creating a
  session with its `session_type`.

### The work

1. **Make `dynamic` real.** Widen `guideIndex()` and `createUseSkillTool()` from
   `skill_kind === 'guide'` to *any skill with a `dynamic` binding*. Loading a session skill
   this way must also apply its tier, checkpoints and guardrails — not just paste its body.
   This is the change that makes the Skills view stop lying, and it is independently
   shippable ahead of everything else here.
2. **Add explicit invocation.** A picker in the composer (and the existing entry-point
   buttons) that invokes a named skill into the current session. Same code path as (1), just a
   different caller.
3. **Keep `triggered` as-is**, with the arrival changes in Part 5.

### The one hard technical change

`toolNamesFor()` computes the tool set at session creation, and `disposeSessions()` assumes
config is fixed for a session's life (`runtime.ts:135–175`). Tools and gates activating on
mid-conversation skill invocation is the real delta. Contained, but it touches the centre of
the runtime and should be done deliberately rather than as a side effect of Part 4.

---

## Part 4 — Session types dissolve

A session type is only four things today. Each has somewhere better to go:

| What it does now | Where it goes |
|---|---|
| `tier` gates which tools register | Follows the invoked skill |
| `gate_output` + checkpoints | Arrives with the skill, mid-session |
| `completion_bar` / `red_flags` / body | Unchanged — already just the skill |
| Names the tab, drives the entry point | Stays in the UI, as an invocation |

Changes:

- `session_type` in frontmatter becomes the skill's **name**, not a mode key.
- `DEFAULT_SKILL_BY_TYPE` (`defaults.ts:650`) becomes a skill registry, not a type map.
- `resolveSkill()` (`runtime.ts`) resolves *invocations*, not session creation.
- The session receipt records **which skills were invoked** instead of a single
  `session_type`. Arguably richer than what it records today.
- One tab kind for sessions. `ChatView`'s `sessionType` prop becomes an optional
  *initial invocation* rather than a mode.

`ask` and `chat` stop being types. `ask`'s read-only, citation-strict character becomes a
skill you can invoke — which is better, because it means you can ask for a cited answer in the
middle of any conversation instead of opening a different kind of tab.

---

## Part 5 — Arrival: extraction vs analysis

### The distinction

Two different things happen to a dropped transcript, and `interview-synthesis` conflates them:

**Extraction.** What is mechanically in this document that needs to become an object?
Commitments made ("I'll send the SOC 2 report" → todo), dates, decisions stated with a decider,
people, the meeting record, and — cheap and high-value — anything contradicting a live
decision. One document. No corpus. No question needed.

**Analysis.** What does this mean in light of everything else we know? Needs a corpus, a
question, and a brief.

### Kill `interview-synthesis`

It fires on arrival and produces **insights** — an analytical judgment about one document read
in isolation, with nothing to weigh it against. By everything above, that's the weakest
artifact the system can produce, and it's the one produced automatically. Today the memory's
automatic intake is its lowest-quality content while its highest-quality content requires a
human to go ask for it. That is backwards.

Deleting it makes the memory better by writing less to it. Insights arrive later, from a
session with a question and nine transcripts to weigh one against.

### The `process` toggle

On import: *anything to act on?* — yes/no. Extraction only, never analysis.

Not labelled "process this?", which sounds like consent for something opaque. It asks whether
there is anything in here that needs to happen.

**Default keys off recency, not preference.** Extraction is time-sensitive; analysis isn't.
You process this morning's call because it contains commitments that have to happen this week.
A transcript from four months ago has nothing left to extract — whatever was going to happen
already did or didn't.

- Single fresh drop → **on**.
- Bulk historical import → **off**. Forty transcripts × extraction is an unusable inbox, and
  it buys nothing: an analysis session reads unprocessed sources perfectly well.

Lands in `CaptureDialog.tsx` and the `capture:ingest` handler (`handlers.ts:548`), which
already branches on `followUp` / `extras`.

### Merge the arrival skills

`after-meeting`, `external-transcript`, `intake`, `interview-synthesis` collapse into one
extraction skill that branches on `origin` and `kind` — both already in the capture payload
and matched by `bindingMatches`. `process-note` folds in too, or stays as the explicitly
invoked "work this dump properly" skill.

Invariant 3 governs the merge: `after-meeting` is `tier: outbound` with gates while
`external-transcript` is `tier: suggest` with a hard *never propose a decision* rule. That
difference is real and must survive — as a property of the material, not of the session.

---

## Phasing

Ordered so each phase is shippable and the risky one is isolated.

| Phase | What | Depends on |
|---|---|---|
| **0** | Make `dynamic` real (Part 3.1). Fixes a live UI lie; small, self-contained. | — |
| **1** | Session files: `session_files` frontmatter, rooted pi file tools, `.gitignore`, tree in the right panel, read-only viewer, receipt `files:` line. | — |
| **2** | Fan-out: `spawn_over`, child sessions, `brief.md` convention, the spawn card, live tree. | 1 |
| **3** | Explicit invocation + mid-session tool/gate activation (Part 3.2 and the hard change). | 0 |
| **4** | Dissolve session types (Part 4). | 3 |
| **5** | Arrival rework: process toggle, merge the arrival skills, delete `interview-synthesis` (Part 5). | 3, 4 |
| **6** | Rewrite `synthesis` as prose over the new primitives; delete its session-type registration. | 2, 4 |

Phase 0 is worth doing this week regardless of whether the rest proceeds.

---

## UI surfaces

**Session files tree.** Right panel. Verified free: `RightPanel.tsx:14` only renders for
`kind === 'doc'` — on a session tab it currently shows a bare "Context" header and nothing
else. Generic folder/file tree, filling live as children finish. Footer: `12 files · 340 KB`.

**Session file viewer.** Opens as a tab, **read-only**, visibly not a note. Muted strip:
*Session file · not part of your memory · from `sources/2026-06-12-kranelund.md`*. If a session
file opens looking like a note, the PM will edit it and reasonably expect that to mean
something.

**Spawn card.** Inline in the chat (Part 2). Follows `DESIGN.md`: hairline ring, no resting
shadow, terracotta only on the approve action, 32px controls.

**Skill invocation.** A picker in the composer. Existing entry-point buttons unchanged in
appearance, rewired to invoke rather than to open a mode.

**Nothing-silent compliance.** The agent now writes files without an approval card, so the
principle is honoured differently: by **visibility and disposability** rather than by
approval. That trade is only acceptable if the tree is genuinely live and every file is one
click from being read.

---

## Open questions

- **How does the model choose well among many dynamic skills?** The guide index is a list of
  names and summaries. At six skills that's fine; at twenty it's a retrieval problem, and a
  wrong pick is worse than no pick.
- **Can a session's files be read by a later session?** Currently no (invariant 4). "Compare
  my three pain-point analyses" is the obvious ask and the fastest route to a hall of mirrors.
  Position: if it was worth comparing, it was worth keeping into the memory first.
- **What happens to a fan-out when the app quits mid-run?** Children are in-memory sessions;
  their written files survive, their in-flight work doesn't. Resume, or restart, or mark the
  gap in the tree?
- **Cost ceiling.** Where is the concurrency cap, and does the PM see a number they understand
  before approving thirty children?
- **Does `process-note` survive the arrival merge**, or does "work this dump properly" become
  an explicit invocation on the note page?
- **Unbounded session files.** No sweeping is right for now; there's no plan for when it isn't.
