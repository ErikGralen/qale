# Commitment-check redesign — overdue todos become a per-todo, user-initiated action

> Product record for the change that killed the "From Commitment Check" inbox spam and
> made approval cards able to edit note frontmatter. Written 2026-07-22.

## The problem

Two bugs compounded on the Inbox:

1. **Duplicate "From Commitment Check" groups.** `SchedulerService` auto-fired the
   `commitment-check` skill whenever any todo was overdue, guarded only by an in-memory
   flag that reset on every app launch — and nothing deduped against the still-pending
   batch. A few restarts over a few days produced several overlapping review groups.
2. **"Couldn't line this edit up with the note's current text."** The skill told the agent
   to reschedule/close a todo via `propose_update` "moving the due date." But a todo's
   `due`/`status` live in **frontmatter**, and `propose_update` only did **body**
   search/replace — so the anchor never existed and every reschedule/close card failed.
   No card type could edit frontmatter at all.

Underlying product judgment (from the PO): the memory should **not** reflexively push due
dates on a timer. Overdue handling should be **user-initiated, per todo**, and produce a
grounded plan — not a deadline-shuffle.

## The decision

- **No interval firing.** Removed `fireOverdueReactions` from the scheduler. Overdue todos
  are never swept automatically; nothing lands in the Inbox unprompted for a slipped todo.
- **Approval cards can edit frontmatter.** `update` cards gained an optional `frontmatter`
  shallow-merge (alongside the existing body `patch`, now optional). This is the only card
  path that changes metadata — a todo's `due`/`status`, a meeting's `status`, a person's
  `last_told`. The card preview shows a **Properties** block (`due: Jul 10 → Jul 24`,
  `status: open → done`) because the body diff deliberately hides frontmatter.
- **Per-todo "help me handle this."** `commitment-check` was repurposed from an
  overdue-triggered reaction into an on-demand, single-todo session. It reads the todo, its
  source meeting, and related memory, checks whether it already happened, then proposes
  (as approval cards): a concrete `## Plan` on the todo (default), a close, a reschedule
  **only when a new date is genuinely warranted**, or a nudge draft if someone else is
  blocking. Reachable from a per-row action in the Todos view and a button on the todo's
  own note page. The old bulk "Triage overdue" button (which fired the librarian over all
  overdue todos) was removed.

## Where the code lives

- **Frontmatter-capable update card:** `packages/domain/src/proposals/index.ts`
  (`zUpdatePayload` — `patch` optional, `frontmatter` added, `.refine` requires one);
  `packages/application/src/use-cases/proposals.ts` (`acceptUpdate` merges frontmatter,
  `previewProposal` returns `frontmatterChanges`); `packages/agent/src/tools.ts`
  (`propose_update` gains the `frontmatter` param); `packages/ipc/src/dtos.ts`
  (`UpdatePayloadDTO`, `ProposalPreviewDTO`); `apps/desktop/src/renderer/src/components/inbox/CardItem.tsx`
  (the `PropertyChanges` / Properties block).
- **Kill the interval:** `apps/desktop/src/main/services/scheduler-service.ts`.
- **The skill:** `packages/sessions/src/defaults.ts` (`COMMITMENT_CHECK_SKILL`, now a
  built-in default so it works in any vault) and the demo copy at
  `vault-dev/skills/commitment-check.md`.
- **Trigger UI:** `apps/desktop/src/renderer/src/lib/agent-nudges.ts` (`handleTodoSeed`,
  replacing the old bulk `overdueTriageSeed`); `TodosView.tsx` (per-row action, bulk
  triage removed); `NoteView.tsx` (per-todo header button).
- **Tests:** `packages/application/test/accept-update-frontmatter.test.ts`.

## Verified / still to do

- Verified: package unit tests + `check-types` across domain, application, agent, ipc,
  sessions, and the desktop renderer.
- Manual (needs the running app): open an overdue todo → "Help me handle this" → approve a
  reschedule and confirm the todo's `due` actually changes and the card showed the property
  edit. For the demo vault, `pnpm refresh-demo` clears the accumulated old inbox cards and
  re-seeds the rewritten skill.
