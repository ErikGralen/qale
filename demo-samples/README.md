# Demo samples

Material to drop into a running demo, covering the product's two core pain points. These files
live outside the vault on purpose. They're things you feed in during a demo, not notes that get
seeded and indexed. They use relative time language ("Friday", "last month", "in three weeks")
so they never go stale and never need re-dating.

The cast they mention (Nordkap, Kranelund, Sara, Mikkel, Tom, and the SCIM and scheduled-exports
storylines) already lives in the demo vault, so the agent's proposals land on real hubs. It
updates the actual Nordkap page, the real SCIM insight, existing todos, rather than creating
things that float free.

## Setup

```sh
pnpm refresh-demo        # rebuild .vault-dev dated to today (see /update-demo)
pnpm desktop             # then open the .vault-dev workspace
```

## The pack

| File | Ingest as | Demos |
|------|-----------|-------|
| `nordkap-post-sso-checkin-transcript.txt` | Meeting transcript (you were in it) | Pain point 1, after-meeting follow-up |
| `kranelund-exports-discovery-transcript.txt` | Meeting transcript (you were in it) | Pain point 2, insights from customer meetings |
| `messy-standup-capture.md` | Quick note / paste | Intake and librarian (sloppy links get repaired) |
| `chat-prompts.md` | n/a | Prompts to paste into a Session |

### Pain point 1: after-meeting follow-up

Drop `nordkap-post-sso-checkin-transcript.txt` into the capture dialog (⇧⌘N) as a normal meeting
transcript. After-Meeting runs and the Inbox fills up with what changed:

- **Actions you now owe.** Send Sara the written SCIM plan by Friday, get her named security
  contacts, chase legal on side letter versus contract. Those are your own todos. Sara's CISO
  intro and the review scope come back as waiting-on. Watch it skip the commitments already
  tracked as todos.
- **Docs now out of date.** The Nordkap customer page (the renewal now gates on a written SCIM
  date before their board meeting), the `nordkap-needs-scim` insight (confidence up), Sara's
  `last_told` ledger, the SSO rollout notes (the Entra UPN claim-mapping gotcha), and the
  meeting summary.
- **A decision.** Commit SCIM delivery to late September, scoping the week after SSO.

What to say while it runs: the meeting isn't over until the systems are updated, and here are
the three things you owe people and the four docs that just went stale, each one citing the
transcript.

### Pain point 2: insights from customer meetings

Drop `kranelund-exports-discovery-transcript.txt` the same way. This one is dense with insights:

- **Confirms a rumour.** `kranelund-evaluating-insikt` was low-confidence and secondhand. Mikkel
  now confirms the Insikt demo himself, so watch the confidence get proposed up.
- **Reinforces a pattern.** The seasonal per-seat objection, now with a second account behind it
  (`per-seat-resistance-midmarket`).
- **New requirement-shaped insights.** Scheduled exports have to deliver per region, per
  recipient format (PDF or Excel), to a shared distribution list, on a schedule. Each one comes
  back as a cited insight or an update on the `scheduled-reporting` theme.

What to say while it runs: a customer meeting is a pile of raw signal, and the product pulls the
insights out, quotes the customer's own words back, and files them where the next person will
find them.

> Tip: to demo the external-transcript path instead (insights only, never decisions, for a call
> a colleague ran that you're only reviewing), tick "Someone else's meeting" in the capture
> dialog when you drop the Kranelund transcript.

### Intake and librarian

Paste `messy-standup-capture.md` as a quick note. It files as a `note`, and its deliberately
sloppy links (`[[tom]]`, `[[nordkap]]`, `[[q3 priorities]]`, `[[elin]]`, `[[bergman falk]]`)
give the librarian a set of one-tap fixes to the real slugs. It also carries a fresh thread, the
Bergman & Falk SOC 2 request, for Intake to wire in.
