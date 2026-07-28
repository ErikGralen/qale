# Product

## Register

product

## Platform

web

## Users

One product owner / product manager at a Nordic product company (30–300 people, Jira/Confluence plus Slack/Teams), adopting alone, today, with transcripts they already have. No team buy-in, no behavior change from stakeholders. They live between meetings: the app is used in the minutes after a call ends and in short bursts through the day, so every screen must respect that they are mid-task and short on time. Success from their side: the meeting is "over" only when the systems are updated, and stakeholders stop pinging them for answers.

## Product Purpose

A desktop workbench (Produktminnet) where meeting transcripts go in and approved Jira/Confluence updates, decisions, and stakeholder answers come out. The workspace is a git-versioned directory of typed markdown files (meetings, decisions, insights, customers, themes) that the agent maintains as a librarian; every session is a packaged PO workflow (After-Meeting, Synthesis, Weekly Update, Ask). Nothing writes anywhere — not the workspace, not Jira, not Slack — without an approval card the PO clicks. Success looks like week 6 being visibly better than week 1 because the memory has accreted: a source-linked log of every decision, claim, and answer that no incumbent can reconstruct retroactively.

## Positioning

The only tool where a PO's meetings become approved system updates and a readable product memory — product truth finally has a HEAD.

## Brand Personality

Crisp, fast, operator-grade. The energy of Linear or Raycast: keyboard-first precision, immediate response, tight density where the work is dense. The app should feel like a professional instrument the PO drives, not an assistant that performs for them. Emotionally it should produce confidence and momentum — the calm of knowing everything is filed and nothing was written silently — rather than warmth or delight for its own sake.

## Anti-references

- The generic AI-SaaS dashboard: gradient accents, hero metrics, identical card grids, purple-on-dark "AI product" styling.
- Enterprise Jira grey: dense grey chrome, cramped tables, form-heavy screens with no character.

## Design Principles

- **Nothing silent.** Every agent action surfaces as something the PO can read, approve, edit, or discard. The UI's job is to make provenance and pending writes impossible to miss.
- **Cite or decline.** Claims carry their source and date on the surface, not buried in a detail view. An answer without evidence looks visibly different from one with it.
- **The tool disappears into the task.** Earned familiarity over invention: standard affordances, one consistent component vocabulary, keyboard paths for everything the PO does more than once a day.
- **Speed is trust.** Reachable inbox-zero, instant transitions, no choreography. A PO between meetings gives the app ninety seconds; the design must make those seconds count.
- **Show the memory growing.** Freshness, decision supersedes-chains, and accumulating history are the product's proof of value — the interface should make week 6 look different from week 1.

## Accessibility & Inclusion

WCAG AA: ≥4.5:1 body-text contrast, visible focus states on every interactive element, full keyboard operability, and `prefers-reduced-motion` alternatives for all animation.
