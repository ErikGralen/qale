---
name: update-demo
description: >-
  Refresh the Qale demo workspace before showing it off. Cleans harness-written test
  cruft out of the canonical vault-dev/, rebuilds the runtime .vault-dev/ with every
  date slid to today (upcoming meeting stays upcoming, overdue todos stay overdue),
  and confirms the drag-in demo-samples are ready. Use when the user runs /update-demo
  or asks to reset, refresh, re-date, or clean up the demo vault.
---

# Update the demo

Get the Tavla demo workspace into a crisp, current-dated state for a live demo. Three moving parts:

- **`vault-dev/`** — the *canonical* demo source, frozen on a fictional "today" of **2026-07-17**.
  Edit demo content here. It should stay pristine — no harness-written session receipts, no leftover
  test captures.
- **`.vault-dev/`** — the *runtime* copy the app actually opens (gitignored). Built from `vault-dev/`
  by `scripts/refresh-demo.ts`, with all dates shifted so the scenario reads as *now*. Throwaway;
  rebuild it any time.
- **`demo-samples/`** — committed, relative-dated material you drag into the running app to demo the
  two pain points. See `demo-samples/README.md`.

The whole flow is safe to re-run: the refresh script never mutates `vault-dev/`, it only reads it.

## Steps

### 1. Clean the canonical source (`vault-dev/`)

The app writes session receipts and stray captures into whatever vault it's pointed at. If the app
was ever run against `vault-dev/` directly, that cruft is now committed. Remove it:

- **Empty `vault-dev/sessions/`** — every file there is a harness-written receipt, never demo
  content (the refresh/seed scripts skip them anyway). Delete the `.md` files, keep a `.gitkeep`:
  ```sh
  find vault-dev/sessions -name '*.md' -delete
  : > vault-dev/sessions/.gitkeep
  ```
  The deletions show up in `git status` for the user to review before committing.
- **Scan for other test leftovers.** Look at `git status vault-dev/` and the recently-touched
  `notes/`, `sources/`, `meetings/`, `todos/` for things that read like testing, not scenario:
  untitled/empty-summary notes, `asdf`-style captures, sources for URLs that aren't part of the
  story, meetings you clearly generated while testing After-Meeting. **Session receipts are obvious
  cruft — remove them without asking. Anything that looks like real scenario content: list it and
  confirm with the user before deleting.** When unsure, leave it; the next step will flag anything
  broken.

The intentional demo states are NOT cruft — do not "fix" them (see the vault-dev scenario memory):
the deliberately stale insight, the low-confidence/unverified insights, the sloppy links in
`notes/2026-07-16-nordkap-scim-date.md`, the orphan `notes/rollout-runbook.md`, the `broken-demo`
skill, the untagged notes. Leave them.

### 2. Rebuild the runtime vault, dated to today

```sh
pnpm refresh-demo
```

This copies `vault-dev/` → `.vault-dev/`, slides every date-valued frontmatter field and prose date
by (today − 2026-07-17), empties `sessions/`, and self-validates. Read its output:

- The **offset** and **todo-lane summary** ("1 overdue · 1 today · 1 upcoming · 2 waiting · …") tell
  you whether "today" lands well. A healthy demo has at least one overdue todo, the Nordkap check-in
  meeting still upcoming, and waiting-on items.
- The **`App state @ …`** line reports the inbox reset (see below). Expect "removed inbox DB …" on a
  normal run, or "already clean" if there was nothing to clear.
- It must end with **`✓ … all wikilinks resolve`**. If it reports unresolved wikilinks or files
  missing a `type:`, something in step 1 broke — **stop and show the user the failure**, don't
  proceed as if it worked.

**Demoing against the live Atlassian site?** The rebuild restores the *static* mirror ids
(`PAY-142`, fake `tavla.atlassian.net` URLs) — fine offline, wrong online. Run
`pnpm reset-atlassian` afterwards (docs/jira-demo-setup.md): it resets the live site to the
baseline AND reconciles `.vault-dev` to the live keys/ids. Always in that order: refresh first,
then reset-atlassian.

**Why the app-state reset matters.** The inbox (proposal/approval-queue cards) and session
receipts do NOT live in the vault — they sit in a per-vault SQLite DB under Electron's userData dir
(`~/Library/Application Support/@qale/desktop/app-<hash>.db`, keyed by the `.vault-dev` absolute path).
A vault-only rebuild leaves them, so the freshly-dated demo opens behind last run's stale inbox. The
script now clears that per-vault DB, the shared search index (reindexes on open), and the agent-run
session receipts — keying off the same `sha256(vault root)` the app uses. `settings.json` (which
remembers `vaultPath`) is deliberately kept. If a demo ever shows old inbox cards after a refresh,
this reset is the fix — confirm the app is **quit** first (an open app holds the DB and rewrites it).

(Use `--dry` to preview without writing, `--keep-app-state` to rebuild the vault but leave the inbox
DB alone, `--today=YYYY-MM-DD` to pin a date, `--anchor=…` only if the source timeline has been
re-centred away from 2026-07-17.)

### 3. Confirm the ingest samples are ready

Check `demo-samples/` still has the two transcripts, the messy note, and `chat-prompts.md`, and that
the transcripts use **relative** time language only (no absolute `YYYY-MM-DD` — grep for it). If the
scenario in `vault-dev/` has drifted (new customers, renamed people, changed storylines), update the
samples so they still reference real cast and land on real hubs. The samples are the drag-in payload
for the demo; `demo-samples/README.md` maps each to its pain point.

### 4. Report

Tell the user, briefly:

- what was cleaned from `vault-dev/` (e.g. "emptied N session receipts"),
- the offset applied and the lane summary from the refresh,
- the app-state reset (e.g. "cleared the inbox DB + N session receipts") — or "inbox already clean",
- that validation passed (or exactly what failed),
- the one-line run instruction: **open `.vault-dev/` in the app** (not `vault-dev/` — that's what
  keeps cruft from coming back), then drag the `demo-samples/` transcripts in to demo the two pain
  points. First time only: the macOS folder picker hides dot-directories, so press **⌘⇧.** to reveal
  `.vault-dev`, select it once, and the app remembers it (`settings.vaultPath`) on every launch after.

Leave the changes in the working tree for the user to review; don't commit unless asked.
