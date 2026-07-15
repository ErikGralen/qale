# Product Concept — Produktminnet (working name)

_The workbench where a PO's meetings become system updates — and product truth finally has a HEAD._

_2026-07-14. Built from: [takeaways-combined](takeaways-combined.md) (what 42 interviews validate), [takeaways-design](takeaways-design.md) (the Product Brain thinking), [takeaways-sources](takeaways-sources.md) (the patterns we steal). This is the concept layer; MVP scope and kill criteria stay as defined in `combined/ACTIONABLE-PAIN-POINTS-AND-MVP.md`._

---

## The one-paragraph version

A desktop workbench for POs/PMs where **meeting transcripts go in and approved Jira/Confluence updates, decisions, and stakeholder answers come out**. It looks and feels like OpenKnowledge — a left-panel workspace of plain markdown files, tabs for documents *and* chat sessions, a chat beside every document — but it is not a note tool: every file is a typed PM object (meeting, decision, insight, customer, release), every session is a packaged PO workflow (After-Meeting, Sprint Review, Weekly Update, Ask), and **nothing writes anywhere — not the workspace, not Jira, not Slack — without an approval card the PO clicks**. The memory it accretes (a source-linked log of every decision, claim, and answer) is what makes week 6 visibly better than week 1, and what no incumbent can reconstruct retroactively.

**The core loop:**

```
transcript / 60-sec debrief
        │
        ▼
  AFTER-MEETING SESSION            "the meeting isn't over until
        │                           the systems are updated"
        ▼
  truth delta ─ decisions · actions+owners · open questions ·
                not-doings · who-needs-to-know
        │
        ▼
  APPROVAL CARDS  (approve / edit / discard — nothing silent)
        │
        ├──▶ Jira drafts · Confluence rows · release notes ·
        │    per-audience notes (CS / sales / exec)
        │
        └──▶ the memory grows: decision log, insights, customer pages
                    │
                    ▼
        ASK — any question answered with source + date,
              or "I don't know". Approved answers become
              golden answers. Stakeholders stop pinging the PO.
```

---

## Who it's for

One PO/PM at a Nordic product company (30–300 people, Jira/Confluence + Slack/Teams), adopting **alone, today**, with transcripts they already have. No team buy-in, no behavior change from stakeholders, value on the first processed meeting. (Adoption physics from the corpus: every documented tool failure was multi-player; W2 is single-player — see takeaways-combined.)

---

## Three ideas the product stands on

### 1. A product memory you can read

The workspace is a **git-versioned directory of plain markdown files** with typed frontmatter (OKF-conformant). Not a database you trust, files you can open — inspectable, diffable, portable, editable by us, by the PO, and by *any* agent via MCP. The agent does the librarian work (filing, linking, indexing, freshness-flagging) so the wiki that every human abandons stays maintained.

```
workspace/
├── meetings/          # immutable transcripts + their approved truth deltas
├── decisions/         # THE SPINE: what/why/who/when, supersedes-chains
├── insights/          # claims with evidence links, confidence, freshness
├── customers/         # accounts: commitments, signals, what they were told
├── problems/          # durable problem/epic pages (hub pages)
├── releases/          # what shipped, notes per audience
├── people/            # stakeholders: what they care about, last told
├── sessions/          # replayable session transcripts (the audit trail)
└── skills/            # session types, voice guides, filing rules — as files
```

- **Frontmatter, never hand-written:** rendered as a properties form (type, tags, confidence, freshness, sources). Per-folder schema so each folder teaches its own discipline.
- **Decisions are the atomic unit.** Jira has tickets, Notion has docs, Productboard has features — nobody has decisions. Ours are versioned, cited, and superseded rather than edited: "why did we drop the X integration?" is a two-second lookup with the original evidence attached.
- **Freshness is first-class.** Claims decay on type-appropriate clocks; a nightly sweep flags what's stale. A document's health score is the closest thing product work gets to a failing test.

### 2. Work happens in sessions

A **session is a persistent, typed chat** — it lives in a tab exactly like a document, can be reopened, and its transcript is a file. Untyped chat exists, but the product's center of gravity is **predefined session types**: the PO's recurring workflows packaged as guided, checkpointed conversations with good defaults.

| Session type | Kicks off when | Reads | Produces | Then |
|---|---|---|---|---|
| **After-Meeting** ⭐ | transcript dropped, or 60-sec voice/typed debrief | transcript + related memory (customer, problem, prior decisions) | the truth delta | approval cards → Jira/Confluence drafts, tailored outbound, decision-log entries |
| **Sprint Review** | end of sprint / on demand | Jira sprint delta + the sprint's meetings + decisions | walkthrough of shipped/slipped/why + release notes per audience | drafts to Confluence + Slack, release page updated |
| **Weekly Update** | Friday 15:00 (scheduled) | the week's deltas across memory + Jira | per-audience update, every claim cited | held for approval, sent where stakeholders live |
| **Interview Synthesis** | customer-call transcript | transcript + customer page + problems | signals & insights, contradictions with existing beliefs flagged | cards → customer/insight pages |
| **Ask** | anytime, anywhere (⌘K or the composer) | whole memory + live Jira/Confluence | a cited, dated answer — or "vet inte" | *Save as golden answer* / *Send as view* (approved) |
| **Spec Review** | epic linked | the epic + every meeting/thread/decision that touched it | requirements draft + gap list + open questions, every line cited | cards → epic comment drafts |

**Session anatomy** (the discipline that makes them trustworthy, borrowed from pm-superpowers + pm-brain-for-cursor):

- Defined in plain-English **When / Read / Produce / Then** grammar — legible like a sentence, precise like a form.
- **Checkpointed:** one round at a time; outline before draft; synthesize-back before advancing.
- **Guardrailed:** stopping conditions, red flags the agent must push back on, completion bars gating output.
- **Dry-runnable:** before enabling a scheduled session, preview what it *would have produced last week* from real data.
- **Taught, not configured:** the system watches how the PO edits its third weekly update, offers to distill the pattern, and shows the changed skill back as an editable sentence.

Crucially, **a session type is a markdown skill file in `skills/`** — edited like any document, versioned, shareable. New session types are content, not releases. Ship ~6 excellent defaults; everything is forkable.

### 3. Nothing writes silently

The single rule that generates the whole trust model: **autonomy scales with reversibility.**

| Tier | What | Approval |
|---|---|---|
| Observe | read, index, link, flag staleness, prep drafts overnight | never asks |
| Suggest | every write to the memory | approval card (default) |
| Auto-apply | per session type, opt-in, offered by the product after track record ("accepted 47 of 49 — auto-apply internally with a change log?") | earned, revocable, internal only |
| Outbound | anything addressed to a human or an external system — Jira, Confluence, Slack, email | **draft-and-approve, forever** |

- **Cite or decline, enforced in the write path:** the agent's propose-tool rejects any asserted sentence without an evidence link unless flagged as inference (styled differently). It *cannot* state what it cannot cite.
- **Approval cards carry** a diff, a one-line *because*, and receipts — judged in seconds. The **Inbox** (not a dashboard) is home: "here is what needs *you*," with a reachable zero.
- **Safe-space mode:** any meeting can be flagged private — capture off, nothing formalized. Not every conversation should become a record.
- **Selective undo + session replay:** every agent edit is individually revertible; every session is a stored transcript you can open when trust needs checking.
- Anti-rubber-stamping: accept-rate and edit-distance telemetry per session type; spot-audit prompts after long batch-accept streaks.

---

## The interface

OpenKnowledge's geometry, PM-native content. One window, four elements:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ⌘K Search   │ ▸ After-Meeting: Acme sync ⏺ │ 📄 acme-co │ 📄 D-041 │ +   │ ← tabs: sessions
├─────────────┴───────────────────────────────────────────┬────────────────┤   and docs alike
│ 📥 Inbox (7)                    │  # Acme Co             │  CHAT ▸ this   │
│ ─────────────                   │  customer · fresh 2d   │  document      │
│ ▾ 📂 Views                      │                        │                │
│    Today · Needs review         │  ## Commitments        │  "did SSO      │
│    Stale claims · By customer   │  - SCIM by Nov →[D-041]│   slip?"       │
│ ▾ 🗓 Meetings        (this wk 4)│  ## Open questions     │                │
│ ▾ ⚖ Decisions              (82)│  - pricing tier?       │  → cited       │
│ ▸ 💡 Insights                   │  ## Meetings (12) ▸    │    answer      │
│ ▾ 🏢 Customers                  │                        │    + save as   │
│    ▸ acme-co ●                  │                        │    golden      │
│ ▸ 🚢 Releases                   ├────────────────────────┴────────────────┤
│ ▸ 👤 People                     │ 🗂 customers/acme-co                     │
│ ─────────────                   │  Ask anything…                [Ask ▾]   │ ← scoped composer
│ ⚙ Skills (session types)        │                                         │   (as in screenshot)
└─────────────────────────────────┴──────────────────────────────────────────┘
```

- **Tabs hold sessions and documents interchangeably.** A running After-Meeting session sits next to the customer page it's updating. Sessions persist across restarts.
- **Every document can open a side chat**, scoped to that doc (plus whatever the PO @-mentions). Selection is the command line: highlight anything → contextual verbs (*Verify · Find evidence · Rewrite for [audience] · Turn into ticket · Ask*).
- **Folder pages** work like the screenshot: properties + template + listing + a docked Ask composer scoped to that folder.
- **The Inbox is pinned at the top of the left panel** — the approval queue is a first-class navigation destination, not a notification tray.

### Navigating 1,000+ notes (the left panel at scale)

The tree shows **structure, not inventory**:

1. **Hubs, not files.** You navigate to `acme-co` or a problem page; its meetings, decisions, and signals are linked *from* it. Meetings collapse by month; nobody scrolls a 900-item folder.
2. **Smart views** — saved queries over frontmatter ("Needs review", "Stale", "This week", "Decisions about checkout") — pinned above the tree. Views are how you navigate; the tree is how you orient.
3. **Search-first**: ⌘K with keyword + semantic + `type:` / `tag:` filters. At scale, search is the door and the tree is the map.
4. **Authored indexes**: every folder carries a generated `index.md` (title + one-liner per entry) — progressive disclosure for humans and agents alike, no vector-DB second copy to drift.
5. **The agent is the librarian**: filing rules (`skills/_filing-rules.md`), link repair, dedup, and orphan-adoption run as maintenance — the reason the panel stays navigable at n=5,000 is that nobody human has to tidy it.

---

## Integrations & the AI posture (the forward-looking part)

**We never record, transcribe, or replace.** Transcripts come from wherever they already exist (Teams/Copilot, Klang, Granola/Fireflies via MCP, file drop) — plus the 60-second debrief for the no-recording world. Jira/Confluence/Slack stay the systems of record; we read them natively (navigation over search, live state — never a stale mirror) and write to them only as approved drafts. Links to external systems are built deterministically from API data, never composed by the model.

**The workspace is an MCP server, not just an MCP client.** `ask_product`, `log_decision`, `draft_writeback` — so a Claude-forward team's *existing* AI can query the same verified memory and file drafts through the same approval cards. This flips the biggest competitor (they build it themselves) into a channel: they keep their beloved Claude; we own what it knows. The memory outlives any single interface — bot today, whatever agents look like in 2028 tomorrow.

**Skills are the growth surface.** Session types, voice guides (per-audience style files with banned phrases — changed by edit, not by drift), and filing rules are all files in the workspace. Teams share them; a marketplace of session types ("Bank-PO After-Meeting", "SAFe PI-planning prep") is the long-run distribution play. The harness is model-agnostic and swappable — every model generation lifts every session type with zero rework. The moat is never the model: it's the accumulated, PO-approved memory.

**Ambient work happens overnight.** Scheduled sessions (Weekly Update), freshness sweeps, contradiction detection, and Monday-brief prep run headless and land in the Inbox. The PO is never held hostage by a spinner.

---

## Why this isn't OpenKnowledge (or Copilot, or Productboard)

| | They | Us |
|---|---|---|
| **OpenKnowledge** | generic knowledge editor; unit = the document; agents *edit docs* | PM-typed objects; unit = the **decision / approval card**; sessions built around the PO's week; closes the loop into Jira/Confluence/Slack |
| **Copilot / notetakers** | capture and summarize; "the notes just end up there" | act in the systems, with approval — the validated unsolved step |
| **Productboard / Aha** | request machine: feedback → features, faster | understanding machine: meetings → decisions + why → pushed to where people already work; no new SaaS to log into |
| **Atlassian Intelligence / Glean** | answer the already-licensed, inside their own walls | seats-free truth: per-PO pricing, **unlimited free readers** — attack the seat, not the tool |
| **DIY on Claude + MCP** | zero maintenance budget, no memory discipline | we *are* their memory via MCP; they keep their interface |

---

## Non-goals (v1, some forever)

No recording/transcription. No Jira/Confluence/Notion replacement. No autonomous outbound, ever. No cross-tool search platform, prioritization engine, or personal to-do manager. No on-prem/regulated-enterprise deployments in v1 (a wall today, a moat later). Not a generic AI workspace — if a feature neither reads from nor writes to the typed objects, it doesn't ship.

---

## Sequencing (unchanged from the MVP decision — this concept is its skin)

1. **Now:** priced concierge (idea 10) + skill-pack funnel (idea 3) — test payment and extraction quality before building.
2. **MVP1 — After-Meeting** (W2): the workbench + After-Meeting session + Jira/Confluence drafts + decision log. Single-player. Kill criteria live: approval rate <40% or time-to-approve >24h by week 4.
3. **MVP2 — Answer drafting** (W1 as Svarsutkastaren): the bot drafts answers *to the PO* in the Slack/Teams thread where the question landed; golden answers accrue. Flip to stakeholder-facing self-serve + seats-free share links only after observed correctness (or a passed Wizard-of-Oz).
4. **Then:** MCP server for Claude-forward pilots; Sprint Review / Spec Review / Interview Synthesis sessions; team memory + governance; skills marketplace.

**North-star metric: verification cost** — minutes of PO attention per accepted unit of work, trending down at stable accuracy. Supporting: % of meeting actions that reach the systems, questions answered that never reach the PO, correction rate <5%, non-licensed readers served.

---

## Open questions

- **Name.** "Produktminnet" is the placeholder from the portfolio doc.
- **Whose memory?** Single-PO first, but governance when five POs share a product area is a design surface, not an edge case — decide before the team phase.
- **Desktop-first vs web-first.** OpenKnowledge proves local+files+git works and sells trust; the Slack/Teams surfaces exist either way. Lean desktop-local for MVP (ICP is AI-tolerant, data-sensitive).
- **How much Jira state to mirror** into the memory vs merely link out to (freshness vs noise).
- **Scenario branches** (git makes "what if we cut SSO?" nearly free) — killer demo or scope creep? Park until a pilot asks.
