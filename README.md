# pm — a workspace OS for product managers

An Electron desktop app that turns a plain-markdown vault (notes, meetings, decisions, people, problems, insights) into a product memory with an embedded AI agent. Everything the agent wants to change arrives as a **proposal card** in an approval inbox — nothing is written to your notes without review. The vault is git-backed for history, indexed into SQLite for search/links, and exposed over MCP so external agents can read it too.

## Features

- **Markdown vault** — plain `.md` files with typed frontmatter (meeting, decision, insight, problem, person, …), wikilinks, backlinks, and a live SQLite index.
- **Editor** — TipTap-based: selection toolbar, `/` block commands, `[[` wikilink autocomplete, drag block handles, structured properties block.
- **Agent sessions** — skill-file driven (frontmatter + `## When / ## Produce / ## Then` sections) chat/ask/after-meeting/weekly sessions over the Anthropic API.
- **Inbox** — the approval queue for agent proposals (with diffs and staleness checks) plus librarian housekeeping pings.
- **Todos & commitments** — own todos and waiting-on ledger, parsed from notes plus quick-add.
- **Scheduler** — recurring sessions (e.g. weekly commitment check).
- **Outbound** — Slack/Jira drafts behind an approval floor.
- **MCP server** — local HTTP server exposing the vault to external MCP clients.

## Repo layout

```
apps/desktop        Electron app (main process, preload, React renderer)
packages/domain     Note types, frontmatter schemas, invariants (pure)
packages/application  Use-cases wiring domain to ports (notes, proposals, pings, todos)
packages/vault      Filesystem vault, SQLite index, watcher, git adapter, stores
packages/sessions   Skill-file session engine (parse skills, build prompts, receipts)
packages/agent      Agent runtime, tools, chat history (Anthropic API)
packages/ipc        IPC contract shared by main/preload/renderer
packages/markdown   remark pipeline + wikilink syntax
packages/atlassian  Jira/Confluence client + ADF
packages/ui         Shared shadcn/ui components + global styles
vault-dev           Demo vault (Tavla scenario) used as dev fixtures
```

## Development

```sh
pnpm install
pnpm desktop        # run the Electron app in dev (turbo dev --filter=@pm/desktop)
pnpm test           # workspace tests (node:test via tsx)
pnpm check-types    # tsc across all packages
pnpm lint
```

Dev vault: `scripts/seed-demo.ts` seeds the Tavla demo scenario. An Anthropic API key (Settings → API key) is required for agent sessions; the rest of the app works without one.

## Status

MVP. See [docs/NEXT-STEPS.md](docs/NEXT-STEPS.md) for the full review this work queue came from.

### Recent work

- **Editor v2** — selection toolbar, slash commands, wikilink autocomplete, block drag handle, properties block redesign.
