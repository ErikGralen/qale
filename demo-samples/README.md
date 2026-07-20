# Demo samples

Ready-to-ingest material for demoing the product's two core pain points. These files live
**outside** the vault on purpose — they are things you *drop into* a running demo, not notes
that get seeded and indexed. They use relative time language ("Friday", "last month", "in three
weeks") so they never go stale and never need re-dating.

The Tavla scenario cast they reference — Nordkap, Kranelund, Sara, Mikkel, Tom, the SCIM and
scheduled-exports storylines — already lives in the demo vault, so the agent's proposals land on
**real hubs** (it updates the actual Nordkap page, the real SCIM insight, existing todos) instead
of floating free.

## Setup

```sh
pnpm refresh-demo        # rebuild .vault-dev dated to today (see /update-demo)
pnpm desktop             # then open the .vault-dev workspace
```

## The pack

| File | Ingest as | Demos |
|------|-----------|-------|
| `nordkap-post-sso-checkin-transcript.txt` | Meeting transcript (you were in it) | **Pain point 1 — after-meeting follow-up** |
| `kranelund-exports-discovery-transcript.txt` | Meeting transcript (you were in it) | **Pain point 2 — insights from customer meetings** |
| `messy-standup-capture.md` | Quick note / paste | Intake + librarian (sloppy links get repaired) |
| `chat-prompts.md` | — | Prompts to paste into a Session |

### Pain point 1 — after-meeting follow-up

Drop **`nordkap-post-sso-checkin-transcript.txt`** into the capture dialog (⇧⌘N) as a normal
meeting transcript. After-Meeting runs and the Inbox fills with the *truth delta*:

- **Actions you now owe** — send Sara the written SCIM plan by Friday, get her named security
  contacts, chase legal on side-letter-vs-contract (your own todos); Sara's CISO intro and scope
  (waiting-on). Watch it *skip* the commitments already tracked as todos.
- **Docs now out of date** — the Nordkap customer page (renewal now gates on a written SCIM date
  before their board meeting), the `nordkap-needs-scim` insight (confidence up), Sara's `last_told`
  ledger, the SSO rollout notes (the Entra UPN claim-mapping gotcha), and the meeting summary.
- **A decision** — commit SCIM delivery to late September, scoping the week after SSO.

The line to land: *"the meeting isn't over until the systems are updated — here are the three
things you owe people and the four docs that just went stale, each as a card citing the
transcript."*

### Pain point 2 — insights from customer meetings

Drop **`kranelund-exports-discovery-transcript.txt`** in the same way. This one is insight-dense:

- **Confirms a rumour** — `kranelund-evaluating-insikt` was low-confidence and secondhand; Mikkel
  now confirms the Insikt demo first-hand. Watch the insight's confidence get proposed *up*.
- **Reinforces a pattern** — the seasonal per-seat pricing objection, now with a second account
  behind it (`per-seat-resistance-midmarket`).
- **New requirement-shaped insights** — scheduled exports must deliver per-region, per-recipient
  format (PDF vs Excel), to a shared distribution list, on a schedule. Each proposed as a cited
  insight/update on the `scheduled-reporting` problem and `scheduled-exports` release.

The line to land: *"a customer meeting is a pile of signal — the product pulls out the insights,
cites the customer's own words, and files them where the next person will actually find them."*

> Tip: to demo the **external-transcript** path instead (insights only, never decisions — for a
> call a colleague ran and you're only reviewing), tick *"Someone else's meeting"* in the capture
> dialog when you drop the Kranelund transcript.

### Intake + librarian

Paste **`messy-standup-capture.md`** as a quick note. It files as a `note`, and its deliberately
sloppy links — `[[tom]]`, `[[nordkap]]`, `[[q3 priorities]]`, `[[elin]]`, `[[bergman falk]]` —
give the librarian prepared one-tap fixes to the real slugs, plus a fresh thread (the Bergman &
Falk SOC 2 request) for Intake to wire in.
