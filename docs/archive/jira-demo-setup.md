# Setting up a real Jira/Confluence site for the Tavla demo

> Written 2026-07-23, alongside the Area C (sync engine) build. This is the
> exact recipe for a live Atlassian site that makes every integration scenario
> in the demo runnable for real: live chips, after-meeting outbound cards that
> actually land, the librarian redlining a real Confluence page, blocked-epic
> markers on todos. Offline (no site), the demo still works from the static
> mirrors in `.vault-dev/tickets/` and `.vault-dev/wikipages/` — this doc is
> for the online version.

## 1. The site (10 min, free)

1. Go to <https://www.atlassian.com/try> and create a **free** Jira + Confluence
   cloud site. Any name works; `tavla-demo.atlassian.net` reads nicely on the
   Connections screen.
2. Make sure both **Jira** and **Confluence** are enabled on the site (the free
   tier includes both; Confluence sometimes needs one extra "add product" click
   from the site admin screen).

## 2. The API token (1 min)

1. <https://id.atlassian.com/manage-profile/security/api-tokens> → **Create API
   token**. A plain (unscoped) token is the simplest and works everywhere; a
   scoped token also works — the connector probes both routing styles, you
   never have to know which kind you made.
2. Pick a comfortable expiry (max 1 year). When it expires, the app shows a
   quiet "token expired — paste a new one" line in Settings → Connections;
   nothing breaks loudly. Copy the token now — Atlassian shows it once.

## 3. Jira: the `PAY` project (the last two manual steps)

The demo's mirrors, links, and skills all speak the project key **PAY**.

1. Create a project → **key `PAY`**, name "Payments" (company-managed "Kanban"
   is fine; team-managed also works).
2. Add a workflow status named exactly **`Blocked`** (In Progress category).
   The state map normalizes on Jira's own status *category*, but the loud
   `blocked` chip state comes from the label — a status literally named
   Blocked is the demo's drama. (Board → ⋯ → Manage workflow → add status.)
   This is the one thing the REST API can't do on a company-managed workflow,
   which is why it's manual.

Everything else — the cast issues, their statuses and comment threads, the
Confluence space and pages — is created (and reset) by the script below.

## 4. Seed and reset: `pnpm reset-atlassian`

`scripts/reset-atlassian.ts` converges the live site to the demo baseline.
The same command seeds a fresh site and cleans up after a demo run — it always
drives toward the same desired state, so it's safe to run repeatedly.

```sh
# first run: paste the token once, --save remembers it in .atlassian-demo.json
# (gitignored, mode 600; env vars ATLASSIAN_SITE/EMAIL/TOKEN also work)
pnpm reset-atlassian --site=tavla-demo.atlassian.net --email=you@x.com --token=... --save

pnpm reset-atlassian          # thereafter: reset to baseline
pnpm reset-atlassian --dry    # print the plan, write nothing
```

What it converges:

- **Jira `PAY`** — the cast exists with the right types, statuses, and
  descriptions: **SAML SSO (epic)** in **Blocked** (assigned to you — this is
  the star: drift scenario, at-risk todo marker, commitment-check context),
  **Audit-log export for SSO events** Done, **IdP metadata validation in
  staging** In Progress, plus Done/To Do fillers. Comment threads are reset to
  the seeds (comment authorship/timestamps are you/now — the story lives in
  the text). Every write is **convergent**: descriptions, assignee, comments,
  and page bodies are touched only when they actually deviate, so a re-run on
  a clean site is a no-op. That matters beyond tidiness — a gratuitous write
  bumps the issue's `updated` / the page's version, the mirror re-syncs past
  pending cards' drafted snapshots, and every approval then refuses once with
  "changed since this was drafted". Issues **not** in the cast are
  **deleted** — that's the reset:
  the demo-created SCIM ticket and outbound comments vanish, the epic goes
  back to Blocked, the stage is set again. `--keep-extras` skips the deletes.
- **Confluence** — the **Product** space exists; **Enterprise Onboarding**
  and **Product weekly update** are rewritten to their canonical bodies from
  `vault-dev/wikipages/` (which un-does the librarian's fix and any
  weekly-update appends). Other pages are listed but never touched. The
  load-bearing sentence lands verbatim by construction:

  > SCIM provisioning ships in Q2 alongside the SSO rollout, so group mapping
  > is automatic from day one.

  The librarian's redline anchors on the page's actual text, and the vault's
  decision `2026-04-15-defer-scim-to-q3` ("Ship SSO first, defer SCIM to Q3")
  is what it contradicts. Once the page is mirrored, the drift sweep files a
  prepared-fix card; approving it edits the real page in place (with a
  `Source: …` provenance line) and the mirror re-syncs.
- **Dates** — every date token in summaries, descriptions, comments, and page
  bodies is slid by (today − anchor), the same maths as `refresh-demo`. Run
  both the same day so vault and site tell the same story.

The script does **not** create "SCIM group-mapping for Nordkap" — the
after-meeting session drafts that ticket as an approval card; approving the
card is what creates it, live, and appends the real key (e.g. `PAY-7`) back to
the meeting note. That's the money shot; don't spoil it.

## 5. Connect, follow, sync

1. In the app: **Settings → Connections → Jira + Confluence** → paste site URL
   (`tavla-demo.atlassian.net` — no scheme needed), account email, API token.
   Connect verifies immediately and shows who you're signed in as.
2. In the container list, **follow `PAY` and `Product`**. A follow triggers a
   sync right away; after it, every followed item is in `[[` autocomplete.
3. Sync then rides the 5-minute scheduler tick (plus app launch, plus the
   follow toggle). Mirror notes are written **only** for items the vault
   actually links — linking is the deep-track gesture.

### Reconciling with the static demo mirrors (automatic)

Your real site mints its own keys (`PAY-1`, `PAY-2`, …) — they won't be
`PAY-142`/`PAY-156`, and the canonical vault's static mirrors carry a fake
host and made-up Confluence page ids. `reset-atlassian` reconciles the runtime
vault (`.vault-dev`) automatically at the end of every run: it renames
`tickets/PAY-142.md`/`PAY-156.md` to the live keys, rewrites every
`[[PAY-142]]` wikilink and prose mention across the vault, swaps
`tavla.atlassian.net` for your real site, and re-points the wikipage
`external_id`s (which matters — the librarian's fix card targets that pageId,
and against the fictional one it would 404). `--no-reconcile` skips it;
`--vault=path` targets another copy.

Order matters: `pnpm refresh-demo` rebuilds `.vault-dev` from canonical
`vault-dev/` and therefore restores the static ids — when demoing live,
always refresh first, then run `pnpm reset-atlassian`. The canonical tree is
never touched by either script's reconciliation.

## 6. The demo arc, end to end (also the Area C manual verification)

1. **Chips** — open the SSO release note: the epic chip shows the live state
   with hover (title, assignee, "changed 2h ago", open-in-Jira). Offline it
   still renders from the mirror with a quiet stale dot. ✅ pull + refMeta
2. **After the meeting** — drag `demo-samples`' Nordkap check-in transcript
   into capture. The session drafts a comment on the epic + the SCIM ticket.
   Approve both: the comment lands on the real epic (with the provenance
   line), the new ticket exists in Jira, and the meeting note gains a
   `## Pushed` section with the real key. ✅ outbound execute + link-back
3. **Drift** — move the epic to Blocked in Jira (if it isn't), wait a tick
   (or Settings → sync now): the mirror updates, the linked todo shows the
   at-risk marker, and "Help me handle this" (commitment-check) sees the
   blocked epic and proposes a date-risk note to Sara it can actually draft.
   ✅ mirror re-sync + freshness + tier fix
4. **Stewardship** — within a tick or two of the Enterprise Onboarding page
   being mirrored, the librarian files "Fix 'Enterprise Onboarding' — it
   contradicts Ship SSO first, defer SCIM to Q3" with a redline preview.
   Approve → the real page updates in place, provenance footer at the bottom.
   ✅ drift judgment + update_page replace mode
5. **Drafted-against-stale** — with an outbound card pending, edit the target
   issue in Jira, sync, then approve: the card refuses once with "changed
   since this was drafted", shows the delta, and "Approve anyway" sends. ✅
   snapshot staleness

## Gotchas

- **Rate limits:** free-tier Atlassian throttles aggressively during the first
  full pull of a big project. The client serializes requests and honors
  Retry-After; a 3,000-issue backlog takes a while to first-sync. The demo
  project is tiny — not an issue there.
- **Token in a password manager, not in the vault:** the token is stored via
  the OS keychain (or declared-obfuscation fallback — Settings says which).
- **Disconnect** clears the credential but keeps mirrors and follows, so
  reconnecting later picks up where you left off.
