# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One product owner / product manager at a Nordic product company (30–300 people, Jira/Confluence plus Slack/Teams), adopting alone, today, with transcripts they already have. No team buy-in, no behavior change from stakeholders. They live between meetings: the app is used in the minutes after a call ends and in short bursts through the day, so every screen must respect that they are mid-task and short on time. Success from their side: the meeting is "over" only when the systems are updated, and stakeholders stop pinging them for answers.

## Product Purpose

A desktop workbench (Qale) where meeting transcripts go in and approved Jira/Confluence updates, decisions, and stakeholder answers come out. The workspace is a git-versioned directory of typed markdown files (meetings, decisions, insights, customers, themes) that the agent maintains as a librarian; every session is a packaged PO workflow (After-Meeting, Synthesis, Weekly Update, Ask). One policy grades every write by the damage it can do. Adding a page or a paragraph lands on its own; anything that rewrites existing text, records a decision, makes or closes a promise, deletes, or leaves for Jira, Confluence or a calendar is put to the PO first. What lands on its own is committed to git and listed in Activity, where one press puts it back. Success looks like week 6 being visibly better than week 1 because the memory has accreted: a source-linked log of every decision, claim, and answer that no incumbent can reconstruct retroactively.

## Positioning

The only tool where a PO's meetings become approved system updates and a readable product memory. Product truth finally has a HEAD.

## Operating Context

- **A Mac desktop app, used alone.** Single user, local-first, no Qale server and no account. The PO installs it themselves and it works on their own machine against their own files.
- **The workspace is a folder the PO picked.** Ordinary markdown files with a typed frontmatter header, `[[double bracket]]` links between them, and git history kept quietly underneath so every note has a browsable past. The folder stays readable and editable in any text editor with Qale closed.
- **Sources are separate from notes.** What the PO received (transcripts, exports, pasted text) never mixes with things they wrote. The memory must never claim they authored something they only received. A source arrives by drop or paste: "Add source" saves the bytes first, before any model runs, then an arrival session reads it, matches transcripts to meetings by content, spots duplicates, and files it. Filing never asks, because putting a file the PO handed over on the right shelf is carrying out an instruction, not proposing one.
- **The Inbox holds what needs a decision, and only that.** A write that rewrites existing text, records a decision, makes or closes a promise, deletes a page, or leaves for Jira, Confluence or a calendar arrives as a proposal with a readable diff and a staleness check that says so when the underlying note changed after the draft was made. Rewrites group by intent, so ten tickets moved to Done are one row with ten lines under it, not ten cards. Maintenance items and the agent's open questions sit quietly at the bottom.
- **Activity is the receipt for everything else.** The writes that land on their own are listed there, in the agent's own words, newest first. Every row says which page it touched and offers to put it back. It is not a page the PO visits often, and it is not hidden either.
- **Work happens in sessions, defined by files.** A session is an agent run saved into the workspace. What the agent does is written in skills (invoked by the PO) and agents (running on their own), which are markdown files whose body is verbatim the instruction the agent follows. The PO can read and edit the agent's own job descriptions. Large jobs spawn worker sessions that fan out in parallel.
- **Outside systems are two-way but gated.** Jira and Confluence (with a sync engine that patches live pages) and Google Calendar (meetings flow in, events can flow out). Anything leaving for Slack or Jira sits behind approval first.
- **Other tools can read the same memory.** A small local MCP server exposes the workspace, so an external assistant can read what Qale reads.

## Capabilities and Constraints

- **A write costs as much of the PO's attention as it can do damage.** One policy, in one file, grades every write the agent makes. Adding lands on its own. Rewriting groups into one card per intent. A promise, a delete, and anything leaving the machine always ask, every time, one card each. Features are designed against that grading, and a feature that would let a send or a delete happen quietly is rejected on principle, not weighed against convenience.
- **Nothing lands on its own unless git can take it back.** The workspace is a repo from the moment it is made, every write is a commit, and every row in Activity can be put back. That is the whole argument for the writes that do not ask. Remove it and they all have to ask again.
- **Plain markdown honesty.** No feature may require a proprietary format. The workspace has to stay fully usable without Qale, which caps what the editor is allowed to produce.
- **Model calls cost money and seconds.** This is the slow, expensive part of the product. It is why filing is mechanical before it is intelligent, why sessions end quietly when there is nothing to say, and why fan-out jobs are capped.
- **Single-user and local-first is foundational.** Real-time collaboration or a hosted version would be a rewrite, not a feature.
- **What leaves the machine:** session text goes to Anthropic's API to run the agent, and the connectors talk to Atlassian and Google. Everything that comes back is either applied and listed in Activity, or staged as a proposal, by the policy above. Secrets live in the macOS keychain.
- **The search index is a cache.** SQLite, built by scanning the workspace, powering full-text search, the link graph, backlinks, and todos. It can always be rebuilt from the files, so losing it loses nothing.
- **Undecided: how the PO gets model access.** Today they bring their own Anthropic API key. Whether that survives beta is an open product question and is not settled in the code. Future work must not assume either answer or design as though one were chosen.

## Brand Commitments

- **The name is Qale**, and it rhymes with "tale". The repository is still called `pm`; that is a leftover, never the product name.
- **Plain language, always.** Product copy uses plain, human wording. No jargon, no AI slop, and never em dashes. Simple is not the same as dumbed down, and this rule binds every string a PO can read, not just marketing. The house style is Simplified Technical English (ASD-STE100) plus Zinsser's four principles (simplicity, brevity, clarity, humanity): one term per thing reused every time, short active sentences, condition before instruction, and humanity as a rule rather than a footnote. Reasoning and the full rule in `docs/writing-style.md`.
- **The screen speaks the PO's language, not ours.** The code and the files keep precise words (vault, arrival, librarian, outbound, OKF, spawn) because the agent needs them. None of those words go on screen: the folder is a **workspace** everywhere a PO can read it, and the code calls it a vault. What a PO reads is seven places (Home, Inbox, Calendar, Todos, Sessions, Documents, Memory), one receipt (Activity), and two nouns: a **source** is something they received, a **proposal** is a change waiting for their answer. The test for any new string: would a product manager who has never read our docs know what it means on first read? If a word only works once you know our model, it does not ship.
- **One word for one thing.** Pick a term and use it every time, in copy and in prompts, and never vary it for elegance. Two words for one thing read as two things.

## Evidence on Hand

- **The Tavla demo workspace** (`vault-dev/`, refreshed into `.vault-dev/`): a complete fictional workspace with its own cast (Nordkap, Kranelund, Bergman & Falk) and deliberately staged states such as stale notes, unverified claims, and won't-do decisions. This is a real, shippable demonstration asset and the honest thing to show.
- **A live Atlassian demo site**, seeded and reset by `pnpm reset-atlassian`, that the Jira and Confluence connectors genuinely write to. Connector behavior can be demonstrated, not just described.
- **Anonymous usage telemetry to PostHog EU**: a real, disclosed data flow, and the only thing the product reports about itself.
- **No customers, no testimonials, no case studies, no benchmarks, no pricing.** None of these exist. Future work must not fabricate a user quote, an adoption number, a performance claim, or a price.

## Product Principles

- **Nothing lands unseen.** The PO's trust is the product. Anything that rewrites, promises, sends or deletes is something they saw, could edit, and chose. Everything else is written down where they can find it, and one press puts it back. A feature that hides a write from both is not a faster feature, it is a different product.
- **The files outlive the app.** The workspace is the deliverable. Qale is a good way to work on it, never a condition for reading it.
- **Received is not written.** Provenance is structural, not decorative. What the PO said, what someone else said, and what the agent inferred stay visibly different things forever.
- **Spend the model where it earns its cost.** Mechanical work stays mechanical. The agent runs when it has something worth saying and stops when it doesn't.
- **The memory has to visibly accrue.** Value shows up as week 6 being better than week 1. Anything that makes the workspace harder to accumulate into is working against the point.

## Accessibility & Inclusion

WCAG AA: ≥4.5:1 body-text contrast, visible focus states on every interactive element, full keyboard operability, and `prefers-reduced-motion` alternatives for all animation.

## Brand Personality

Crisp, fast, operator-grade. The energy of Linear or Raycast: keyboard-first precision, immediate response, tight density where the work is dense. The app should feel like a professional instrument the PO drives, not an assistant that performs for them. Emotionally it should produce confidence and momentum, the calm of knowing everything is filed and nothing happened that cannot be seen or put back, rather than warmth or delight for its own sake.

## Anti-references

- The generic AI-SaaS dashboard: gradient accents, hero metrics, identical card grids, purple-on-dark "AI product" styling.
- Enterprise Jira grey: dense grey chrome, cramped tables, form-heavy screens with no character.

## Design Principles

- **Nothing hidden.** Every agent action ends up somewhere the PO can read it: a card they approve, edit or discard, or a row in Activity they can put back. The UI's job is to make provenance, pending writes and finished ones impossible to miss.
- **Cite or decline.** Claims carry their source and date on the surface, not buried in a detail view. An answer without evidence looks visibly different from one with it.
- **The tool disappears into the task.** Earned familiarity over invention: standard affordances, one consistent component vocabulary, keyboard paths for everything the PO does more than once a day.
- **Speed is trust.** Reachable inbox-zero, instant transitions, no choreography. A PO between meetings gives the app ninety seconds; the design must make those seconds count.
- **Show the memory growing.** Freshness, decision supersedes-chains, and accumulating history are the product's proof of value, so the interface should make week 6 look different from week 1.
