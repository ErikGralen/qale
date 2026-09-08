# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One product owner / product manager at a Nordic product company (30–300 people, Jira/Confluence plus Slack/Teams), adopting alone, today, with transcripts they already have. No team buy-in, no behavior change from stakeholders. They live between meetings: the app is used in the minutes after a call ends and in short bursts through the day, so every screen must respect that they are mid-task and short on time. Success from their side: the meeting is "over" only when the systems are updated, and stakeholders stop pinging them for answers.

## Product Purpose

A desktop workbench (Qale) where meeting transcripts go in and approved Jira/Confluence updates, decisions, and stakeholder answers come out. The workspace is a git-versioned directory of typed markdown files (meetings, decisions, insights, research, customers, people) that the agent maintains as a librarian; every session is a packaged PO workflow (After-Meeting, Synthesis, Weekly Update, Ask). One policy says which writes wait for the PO, and it reads what a write does, not where the file sits. A rewrite of prose the PO typed waits, and so does anything Qale had to assume. A send and a delete wait everywhere. Everything else lands: a meeting page from a transcript, a todo, an append, a new document, and all of Qale's memory. What lands on its own is committed to git and listed in Activity, where one press puts it back. Success looks like week 6 being visibly better than week 1 because the memory has accreted: a source-linked log of every decision, claim, and answer that no incumbent can reconstruct retroactively.

## Positioning

The only tool where a PO's meetings become approved system updates and a readable product memory. Product truth finally has a HEAD.

## Operating Context

- **A Mac desktop app, used alone.** Single user, local-first, no Qale server and no account. The PO installs it themselves and it works on their own machine against their own files.
- **The workspace is a folder the PO picked.** Ordinary markdown files with a typed frontmatter header, `[[double bracket]]` links between them, and git history kept quietly underneath so every note has a browsable past. The folder stays readable and editable in any text editor with Qale closed.
- **Sources are separate from notes.** What the PO received (transcripts, exports, pasted text) never mixes with things they wrote. The memory must never claim they authored something they only received. A source arrives by drop or paste: "Add source" saves the bytes first, before any model runs, then an arrival session reads it, matches transcripts to meetings by content, spots duplicates, and files it. Filing never asks, because putting a file the PO handed over on the right shelf is carrying out an instruction, not proposing one.
- **A session holds what needs a decision, and only that.** A write that rewrites prose the PO typed, deletes a page, leaves for Jira, Confluence or a calendar, or rests on something the agent assumed arrives as a proposal with a readable diff and a staleness check that says so when the underlying note changed after the draft was made. Rewrites group by intent, so ten tickets moved to Done are one row with ten lines under it, not ten cards.
- **Activity is the receipt for everything else.** The writes that land on their own are listed there, in the agent's own words, newest first. Every row says which page it touched and offers to put it back. It is not a page the PO visits often, and it is not hidden either.
- **Work happens in sessions, defined by files.** A session is an agent run saved into the workspace. What the agent does is written in skills (invoked by the PO) and agents (running on their own), which are markdown files whose body is verbatim the instruction the agent follows. The PO can read and edit the agent's own job descriptions. Large jobs spawn worker sessions that fan out in parallel.
- **Outside systems are two-way but gated.** Jira and Confluence (with a sync engine that patches live pages) and Google Calendar (meetings flow in, events can flow out). Anything leaving for Slack or Jira sits behind approval first.
- **Other tools can read the same memory.** A small local MCP server exposes the workspace, so an external assistant can read what Qale reads.

## Capabilities and Constraints

- **A write waits for the PO when it changes their words or cannot be taken back.** One policy, in one file, answers for every write the agent makes, and it reads what the write does rather than which folder it lands in. Four things wait, one card each: a send, a delete, a patch over prose the PO typed (a document body, or the `## Notes` on a meeting page), and any write whose rationale says the agent assumed something. Everything else lands: a meeting page written from a transcript, a todo made, closed or moved, text added at the end of a page, a new document, and everything Qale keeps in its own memory. A rewrite the PO asked for in the chat lands too, because the card would ask them to confirm their own instruction. Features are designed against that policy, and a feature that would let a send or a delete happen quietly is rejected on principle, not weighed against convenience.
- **Nothing lands on its own unless git can take it back.** The workspace is a repo from the moment it is made, every write is a commit, and every row in Activity can be put back. That is the whole argument for the writes that do not ask. Remove it and they all have to ask again.
- **Plain markdown honesty.** No feature may require a proprietary format. The workspace has to stay fully usable without Qale, which caps what the editor is allowed to produce.
- **Model calls cost money and seconds.** This is the slow, expensive part of the product. It is why filing is mechanical before it is intelligent, why sessions end quietly when there is nothing to say, and why fan-out jobs are capped.
- **Single-user and local-first is foundational.** Real-time collaboration or a hosted version would be a rewrite, not a feature.
- **What leaves the machine:** session text goes to Anthropic's API to run the agent, and the connectors talk to Atlassian and Google. Everything that comes back is either applied and listed in Activity, or staged as a proposal, by the policy above. Secrets live in the macOS keychain.
- **The search index is a cache.** SQLite, built by scanning the workspace, powering full-text search, the link graph, backlinks, and todos. It can always be rebuilt from the files, so losing it loses nothing.
- **Undecided: how the PO gets model access.** Today they bring their own Anthropic API key. Whether that survives beta is an open product question and is not settled in the code. Future work must not assume either answer or design as though one were chosen.

## Brand Commitments

- **The name is Qale**, and it rhymes with "tale". The repository is still called `pm`; that is a leftover, never the product name.
- **Plain language, always.** Product copy uses plain, human wording. No jargon, no AI slop, and never em dashes. Simple is not the same as dumbed down, and this rule binds every string a PO can read, not just marketing. The house style is Simplified Technical English (ASD-STE100) plus Zinsser's four principles (simplicity, brevity, clarity, humanity): one term per thing reused every time, short active sentences, condition before instruction, and humanity as a rule rather than a footnote. The agent writes on a hidden plain-speech baseline (lead with the answer, say it literally, ordinary words, no coined terms); a voice changes tone on top of it and never lifts it. Reasoning and the full rule in `docs/writing-style.md`.
- **The screen speaks the PO's language, not ours.** The code and the files keep precise words (vault, arrival, librarian, outbound, OKF, spawn) because the agent needs them. None of those words go on screen: the folder is a **workspace** everywhere a PO can read it, and the code calls it a vault. What a PO reads is five places on the rail (Home, Calendar, Todos, Sessions, Documents), one row per connected system (Jira, Confluence, shown once that system is connected), Memory in the footer beside Activity, one receipt (Activity), and two nouns: a **source** is something they received, a **proposal** is a change waiting for their answer. The test for any new string: would a product manager who has never read our docs know what it means on first read? If a word only works once you know our model, it does not ship.
- **One word for one thing.** Pick a term and use it every time, in copy and in prompts, and never vary it for elegance. Two words for one thing read as two things.

## Evidence on Hand

- **The Rota demo workspace** (`vault-dev/`, refreshed into `.vault-dev/`): a complete fictional workspace for Rota, a staff-scheduling product for restaurant and retail chains, where the PO owns two teams, Scheduling and Staff App. The cast is the people around that job: Åsa the CPO, Rebecca the tech lead, Marcus in sales, and four accounts (Café Nord, Bruno's Burgers, Fjord Sports, Kaffekopp). Three promises run through it: Marcus told Café Nord shift swaps would land "before September", Fjord Sports was told Q4 for payroll export, and a Bruno's Burgers manager asked for shift swaps in a support thread that never reached product. It ships with deliberately staged states such as stale notes, unverified claims, and won't-do decisions. This is a real, shippable demonstration asset and the honest thing to show.
- **A live Atlassian demo site**, seeded and reset by `pnpm reset-atlassian`, that the Jira and Confluence connectors genuinely write to. Connector behavior can be demonstrated, not just described.
- **Anonymous usage telemetry to PostHog EU**: a real, disclosed data flow, and the only thing the product reports about itself.
- **No customers, no testimonials, no case studies, no benchmarks, no pricing.** None of these exist. Future work must not fabricate a user quote, an adoption number, a performance claim, or a price.

## Product Principles

- **Nothing lands unseen.** The PO's trust is the product. Anything that sends, deletes, rewrites what they wrote, or rests on a guess is something they saw, could edit, and chose. Everything else is written down where they can find it, and one press puts it back. A feature that hides a write from both is not a faster feature, it is a different product.
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
- **Speed is trust.** A reachable zero, instant transitions, no choreography. A PO between meetings gives the app ninety seconds; the design must make those seconds count.
- **Show the memory growing.** Freshness, decision supersedes-chains, and accumulating history are the product's proof of value, so the interface should make week 6 look different from week 1.
