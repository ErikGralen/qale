# Qale: a technical overview for non-engineers

## What it is

Qale is a Mac desktop app for product managers. The pitch is "product memory": everything a PM accumulates (meeting transcripts, notes, decisions, insights, people, open questions) lives as plain text files on the PM's own computer, and an embedded AI agent reads that memory, keeps it tidy, and helps act on it: preparing for meetings, chasing commitments, clustering interview findings, drafting Jira tickets and Slack messages.

The core promise is trust. The agent never silently changes your notes. Everything it wants to write arrives as a card in an approval inbox, with a diff you can read, and nothing lands until you approve it. The one deliberate exception is filing: when you hand the app a file, putting it on the right shelf is treated as carrying out your instruction, not proposing one.

The second promise is that your data stays yours. There is no Qale server and no account. The notes are ordinary markdown files in a folder you picked, readable in any text editor, and version history is kept with git (the same tool developers use to track changes to code, here used invisibly so every note has a browsable history).

## The major parts

**The vault.** The folder of markdown files that holds everything: meetings, notes, decisions, insights, themes, people, todos. Each file has a small typed header (the "frontmatter") saying what kind of thing it is, and notes link to each other with `[[double bracket]]` links. The layout follows a convention the team calls OKF, the Open Knowledge Format, which mostly means every folder has an `index.md` explaining what lives there, so both humans and agents can orient themselves. "Sources" (raw material like transcripts) are kept strictly separate from "notes" (things the PM actually wrote), because the memory must never claim you authored something you only received.

**The app shell.** An Electron app (a desktop app built with web technology) with browser-style tabs, a sidebar of pinned notes, and a Home page showing what is waiting on you. The editor is a rich text surface over the markdown: slash commands, link autocomplete, drag handles, but nothing you can do in it produces a file that plain markdown cannot express.

**The index.** A local search database (SQLite) built by scanning the vault. It powers full text search, the link graph and backlinks, and the todo lists. It is a cache: it can always be rebuilt from the files, so losing it loses nothing.

**Sessions, skills, and agents.** All AI work happens in a "session", a conversation with the agent that is itself saved as files in the vault. What the agent does in a session is defined by "skills": markdown files whose body is, verbatim, the instructions the agent follows, with a short header saying what triggers it and what it is allowed to do. Skills you invoke live in `skills/`; ones that run on their own live in `agents/`. Because they are just files, the PM can read and edit the agent's own job descriptions. Big jobs "spawn" smaller worker sessions that fan out in parallel.

**The Inbox.** The approval queue. Agent proposals appear as cards, each with a diff and a staleness check (if the underlying note changed since the draft was made, the card says so). Quieter maintenance items and the agent's open questions sit in their own section at the bottom.

**Arrival.** The team's name for how new material enters. You drop files (or paste text) into "Add material"; the bytes are saved immediately, before any AI runs, and then an arrival session reads the material, matches transcripts to meetings by content, spots duplicates, and files everything. Anything derived from the material, like a meeting summary, still goes through the Inbox.

**The librarian.** A background agent that periodically sweeps the vault for drift: stale notes, broken links, things worth consolidating. Its fixes arrive as quiet inbox rows, and its questions wait politely rather than interrupting. A scheduler runs it and other recurring sessions (for example a weekly commitment check).

**Connectors and outbound.** Two-way bridges to the outside: Jira and Confluence (with a sync engine that patches live pages), and Google Calendar (meetings flow in; events can flow out). Outbound messages, like a Slack draft or a Jira comment, always sit behind approval.

**The MCP server.** A small local server exposing the vault over MCP (Model Context Protocol, the standard that lets other AI tools plug into data sources), so an external assistant like Claude can read the same memory.

## Where the data lives and what moves

The vault folder on disk is the single source of truth. Beside it sit a rebuildable search index, app settings and inbox state in the app's private data folder, and secrets (the Anthropic API key, OAuth tokens) in the macOS keychain. Nothing is stored on a Qale server; anonymous usage telemetry goes to PostHog in the EU. What leaves the machine: session text goes to Anthropic's API to run the agent, and the connectors talk to Atlassian and Google. What comes back is always staged as cards before touching the vault.

## Constraints that shape decisions

The approval rule is the load-bearing wall: features are designed around "propose, then approve", and anything that would let the agent write silently is rejected on principle. Plain markdown honesty is another: no feature may require a proprietary format, so the vault stays usable without Qale. The slow and expensive part is the AI itself; every model call costs money and seconds, which is why filing is mechanical first, why sessions end quietly when there is nothing to say, and why big jobs are capped. The single-user, local-first design is deep in the foundations; real-time collaboration or a hosted version would be a rewrite, not a feature. On the engineering side, the packaging of the native database module inside Electron is the part nobody enjoys touching. The app currently requires the PM to bring their own Anthropic API key; whether that survives past beta is an open product question, not settled in the code.

## Names worth knowing

"Qale" (rhymes with tale) is the product; the repo is still called "pm". The "vault" is your notes folder; "arrival" is intake; the "librarian" is the maintenance agent; "cards" are agent proposals in the "Inbox"; "sessions" are agent runs, "skills" and "agents" their instruction files; "spawn" is fanning out worker sessions; "outbound" is drafts leaving for Slack or Jira; "waiting-on" is the ledger of things others owe you; "OKF" is the folder convention; and "Tavla" is the fictional company in the built-in demo vault.
