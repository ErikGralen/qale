# Sending replies: the handoff card

Status: design, ready to build. Supersedes the "message drafts are saved, not sent" behaviour.
Companion to [messaging-integrations.md](./future/messaging-integrations.md) (why we're not doing
real API send yet) and [commitment-check-redesign.md](./archive/commitment-check-redesign.md).

**The decision: PM never sends. PM drafts, you copy, you send, and you tell PM it went out.**
That last step — the confirmation — is the feature. It's the moment the vault learns something true.

---

## 1. What's wrong today

A message draft is filed as an outbound approval card that looks exactly like a Jira card:

- `packages/agent/src/tools.ts:539` — `draft_message` files `{ provider: 'message', action:
  'send_message' }`, described as "saved to the workspace on approval (not sent; Slack/email are out
  of scope)".
- `apps/desktop/src/renderer/src/components/inbox/cardMeta.tsx:119` — the card's title renders as
  **"Send update — …"**, with the same `Send` icon as the connectors that really push.
- `apps/desktop/src/renderer/src/components/inbox/CardItem.tsx:504` — the primary button reads
  **"Approve & send"**, and the banner above it reads **"Leaves your workspace — goes to exec"**
  (`:271-280`), over a detail pane headed **"What gets sent"** (`:646`).
- `apps/desktop/src/renderer/src/app/InboxView.tsx:444-456` — on approval the card joins the green
  **"Sent this session"** receipt.
- `packages/application/src/use-cases/proposals.ts:395` — what actually happens: append the body to
  the link-back note under `## Draft:` and mark the card accepted.

Every one of those surfaces keys off `kind === 'outbound'`, never off the provider — so the mocked
card inherits the whole vocabulary of the connectors that really push. Nothing leaves the workspace;
the card says it did, four times.

So the product says "send", the button says "send", and the outcome is a paragraph appended to a
note. Three costs:

1. **It misleads.** The one card class where the user is nervous about an agent acting on their
   behalf is the one class where nothing happens. Same verb as the cards that do act.
2. **The record is wrong.** `accepted` means "the world changed" everywhere else. Here it means
   "a draft got filed". Anything downstream reading acceptance as truth is reading a lie.
3. **It throws away the only signal worth having.** PM never finds out whether Sara was actually
   told. `last_told` doesn't move, the commitment doesn't close, and the next session re-proposes
   the nudge PM already wrote and you already sent.

The mock isn't "we didn't build sending". Sending is genuinely out of scope (an app registration,
CASA, and an admin ticket per channel — see messaging-integrations.md §1). The mock is that we
modelled it as *approval* when it's a *handoff*.

---

## 2. The principle

Approval cards mean: **PM may act for you.** Approve → PM pushes.

Handoff cards mean: **PM prepared something; you act.** Copy → you paste and send → you confirm.

These are different gestures with different risks and they should never share a button. A handoff
card can't be wrong in the dangerous direction: nothing leaves the machine, you are literally the
sender, and no "sent via PM APP" badge exists. The only thing PM can get wrong is the draft — which
you're reading anyway before you paste it.

Everything else stays: same card store, same edit-before-accept, same citation requirements, same
link-back into the note that spawned it. This is a change of verb and of what acceptance writes,
not a new subsystem.

---

## 3. The card

```
┌──────────────────────────────────────────────────────────────┐
│ 💬  Reply to Sara Lindqvist — you send it                     │
│     Slack · closes “Send Sara the SCIM timeline” (due Fri)    │
├──────────────────────────────────────────────────────────────┤
│  Hi Sara — SCIM landed on the 12th sprint, so the timeline    │
│  you asked about is: pilot 4 Aug, GA 25 Aug. Happy to walk    │
│  through the rollout if useful.                               │
│                                     [ editable, plain text ]  │
├──────────────────────────────────────────────────────────────┤
│  Why: you committed to this on 17 Jul in Tavla sync           │
│  From: [[tavla-sync-2026-07-17]] · [[decision-scim-timeline]] │
├──────────────────────────────────────────────────────────────┤
│  [ Copy message ]                      Not now  ·  Discard    │
└──────────────────────────────────────────────────────────────┘
```

After Copy, the action row swaps in place:

```
│  Copied ✓   [ I sent it ]              Not yet  ·  Discard    │
```

**Anatomy**

| Part | Where it comes from | Copied? |
|---|---|---|
| Recipient (`to`) | person notes, resolved as wikilinks; or an audience ("CS", "exec") | no |
| Channel | optional hint: Slack / email / Teams / in person | no |
| Subject | `title`, shown only when set (email-shaped) | own tiny copy button |
| Body | the draft, editable in place | **yes — this is all Copy takes** |
| Why / From | rationale + `sources[]` | no |

The provenance line matters here: outbound bodies today must end with `Source: <meeting>, <date>`
(`packages/sessions/src/defaults.ts:70`). That belongs in the vault, not in a Slack DM. **Message
bodies drop the provenance line** — PM keeps the sources on the card and in the record it writes.

---

## 4. The two moments

**Copy** is not a commitment. It sets `copiedAt` on the record, copies the *current* body (edits
included) to the clipboard, and changes nothing in the vault. You may copy, decide the tone's wrong,
edit, copy again. Free.

**"I sent it"** is the commitment, and it's the only thing that writes. It says: this text, to this
person, on this channel, went out. Because the user asserts it rather than an API confirming it,
the record says so — "sent by you, as copied" — and never claims a message id it doesn't have.

**"Not yet"** collapses the card back to its resting state, keeping `copiedAt`. On the next inbox
open more than a day later, the card asks once, inline: *"You copied this yesterday — did it go
out?"* → I sent it / Not yet / Discard. One ask, in the card, not a ping row (per the inbox IA:
[commitment-check-redesign.md](./archive/commitment-check-redesign.md) — the inbox is an approval
queue, not a nag surface).

**Discard** rejects the card as today.

### Button copy

Recommended: **`Copy message`** → **`I sent it`**, with `Not yet` as the ghost beside it.

The first person is deliberate. "Mark as sent" is admin-speak about a database row; "I sent it" is
you telling PM a fact about the world, which is exactly what's happening, and it keeps the sender
identity unambiguous every time the card is seen. Alternates if it reads too chatty: `Sent it` /
`Yes, sent` / `Mark sent`. Not `Approve`, not `Send` — PM must never own that verb.

---

## 5. What "I sent it" writes

Four things, in one commit:

1. **The record on the note.** Under `## Sent` on the link-back note — the parallel of the existing
   `## Pushed` section (`proposals.ts:449`), and honest about who acted:

   ```markdown
   ## Sent
   ### To [[sara-lindqvist]] — Slack, 2026-07-28 (by you)
   Hi Sara — SCIM landed on the 12th sprint, so the timeline you asked about is…
   ```

   Full body, not a summary: "what you've already told this person" is the memory that makes the
   next draft good. Target resolution, first hit wins: `linkBack` → the recipient's person note →
   the first cited source. Today a missing `linkBack` hard-fails the card (`proposals.ts:397`);
   that becomes a fallback chain, and only an empty chain fails.

2. **`last_told` on each recipient's person note** — the field already exists
   (`properties-schema.ts:83`) and is already what the before-meeting session reads
   (`agent-nudges.ts:18`). Advance-only: never move it backwards.

3. **The commitment.** If the card carries `closes: <todo ref>`, the todo flips done, with the sent
   record as its evidence. A nudge card drafted by commitment-check (`vault-dev/skills/
   commitment-check.md:47`) that you actually sent should close the loop it was drafted for — today
   it can't, and the same nudge comes back next week.

4. **Card status → `accepted`**, stamped `sentAt` / `sentChannel` / the body as copied.

Undo: a 10s toast undo, and beyond that it's an ordinary note edit with per-note version history.

---

## 6. Data model

Small, additive, no new status.

**Payload** (`packages/domain/src/proposals/index.ts`)
- Action `send_message` → **`handoff_message`**; add the old name to `LEGACY_OUTBOUND_ACTIONS`
  (line 52 already exists for exactly this) so persisted rows keep parsing.
- New optional fields: `to` (string[] — wikilinks or names), `channel`
  (`'slack' | 'email' | 'teams' | 'other'`), `closes` (todo ref). `audience` stays for broadcasts;
  a card has `to`, `audience`, or both.
- `sentAt` / `sentChannel` set by the renderer at confirm time and carried on the accept payload.

**Record** (`ProposalRecord`) — `copiedAt?: number`. Status stays `pending` after a copy: `accepted`
must keep meaning "it happened in the world", and until you say so, it hasn't.

**Accept guard** (`proposals.ts` → new `acceptMessageHandoff`) — a `provider: 'message'` card whose
payload lacks `sentAt` is refused. There is no path where a generic approve marks a message sent.

The existing tests (`packages/application/test/accept-outbound-message.test.ts`) pin the old
behaviour — three cases: draft lands in the link-back note, no link-back refuses, missing note
refuses. Case 1 is rewritten against `## Sent`, case 2 becomes the fallback chain, case 3 stays.
New cases: accept without `sentAt` refuses; `last_told` only advances forward; `closes` flips the
todo.

---

## 7. Agent-facing changes

- `draft_message` (`tools.ts:539`): description becomes "Draft a message for the PM to send
  themselves — PM never sends it; the PM copies it and confirms. Write it as the finished message,
  no provenance line." Params gain `to`, `channel`, `closes`.
- `packages/sessions/src/defaults.ts` (after-meeting §68, weekly-update §384, sprint-review §420,
  commitment-check §592) and the mirrored `vault-dev/skills/*.md`: replace "Drafted, never sent" /
  "Nothing is sent" with the handoff framing, and tell the nudge case to set `closes`.
- `apps/desktop/src/main/services/mcp-service.ts` — the same wording fix in the MCP tool
  description ("Never sends; the PM approves" → per-provider truth).
- The `tier: 'outbound'` gate on `draft_message` (`packages/agent/src/runtime.ts:291`) **stays**,
  even though a handoff leaves nothing. The risk it guards isn't technical reach, it's a skill
  quietly generating words you'll put your name on.

---

## 8. UI changes

The rule: the renderer must branch on **provider**, not on `kind === 'outbound'`. Every site below
is one that currently doesn't.

- `cardMeta.tsx:92,105,119` — message cards get `MessageSquare`, not `Send`. Title: `Reply to
  <person> — you send it` / `Update for <audience> — you send it`.
- `CardItem.tsx:469-504` — for `provider === 'message'`, the approve / approve-anyway /
  approve-edited cluster is replaced by the Copy → I sent it pair. Stale-send doesn't apply (no
  remote to drift against; message cards carry no `draftSnapshot`).
- `CardItem.tsx:271-280` — the banner becomes **"Doesn't leave your workspace — you send this
  yourself"**. That's the opposite claim to the one it makes today, and it's the one that matters.
- `CardItem.tsx:646,720-726` — "What gets sent" → **"What you'll paste"**; "Worth one more glance
  before sending" stays, it's true here.
- `shared.tsx:64-88` — `providerLabel`'s message branch and `outboundTarget`'s `default:` ("Send an
  update to {audience}") become handoff phrasing: **"Update for {audience}, for you to send"**.
- `InboxView.tsx:444-456,747` — the "Sent this session" receipt only lists cards that really
  executed; confirmed handoffs get their own line, **"Sent by you"**. The queue summary's "N to
  send" splits with the grouping below.
- Inbox grouping: handoff cards sit in the same queue but under a **To send** heading, separate from
  **To approve**. Same queue because they need you; different heading because they need a different
  gesture. They stay excluded from batch-approve (`SessionReview.tsx:73-78`) for the same reason
  they are today.
- The accepted state reads **Sent · 14:20 · Slack**, never "Approved".
- `apps/desktop/src/main/dev-seed.ts:103-123` — the seeded exec message card still uses the legacy
  `system:'message', action:'message'` shape and the headline "Send the exec update: …". Reseed it
  in the new shape so the dev path exercises the handoff, not the legacy normalizer.

---

## 9. Edge cases

| Case | Behaviour |
|---|---|
| Edited then copied | Clipboard and record both take the edited body — the box is the source of truth. |
| Edited *after* pasting, in Slack | PM can't know. The record says "as copied" and means it. |
| Copied, never confirmed | Stays pending; one inline ask after a day; otherwise it just sits there. |
| Confirmed by mistake | 10s toast undo → back to pending, record reverted. |
| Audience broadcast (CS/exec) | One card, one copy, one sent record; `last_told` only for named people. |
| Same draft to three people | Three cards. One card = one send = one record. |
| No link-back, no person, no source | The card can't be recorded → accept fails with that reason. Rare; the evidence rules already make it nearly impossible. |

---

## 10. Deliberately not building

`mailto:` links, Teams `message=` deep links, Slack `app_redirect`, Gmail `gmail.compose` drafts,
and real API send. All of it is analysed in [messaging-integrations.md](./future/messaging-integrations.md);
the reason to skip it now is that every one of those is a per-channel branch that buys a saved click
while the confirmation step — the part that feeds the vault — stays identical.

The upgrade path is clean precisely because of this design: a channel that earns real send keeps the
same card, the same body, the same record. Its `execute` fills in `sentAt` and a real message URL
automatically instead of the user's assertion, and the button reverts to `Approve & send` for that
provider only. The handoff card is the floor, not a detour.

---

## 11. Build order

1. Domain: action rename + legacy map, new payload fields, `copiedAt` on the record.
2. Application: `acceptMessageHandoff` — the `## Sent` write, target fallback chain, `last_told`,
   `closes`, the `sentAt` guard. Replaces `proposals.ts:393-405`.
3. Renderer: Copy → I sent it in `CardItem`, `cardMeta` verbs and icon, the **To send** group,
   the sent-state label, the day-later inline ask.
4. Agent + skills: tool description and params, session-default and `vault-dev/skills` wording.
5. Demo: a nudge card in the Tavla scenario that closes a real overdue commitment when confirmed —
   that's the moment worth showing.
