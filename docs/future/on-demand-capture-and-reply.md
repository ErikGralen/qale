# On-demand capture & reply: act on the thread you're looking at

Status: exploration / provocation. Companion to
[messaging-integrations.md](./messaging-integrations.md).

**Not** passive "capture everything." The model here is explicit and momentary: you're in a Slack
thread (or a Gmail thread, a Jira ticket, a doc), you hit a command, and PM does one of two things
on *that* surface:

1. **Capture** — pull this thread's context into PM, resolved to the right decision/person/problem.
2. **Draft a reply** — PM writes a reply in your voice using vault memory, and drops it into the
   compose box for you to edit and send.

Think Raycast command / share action / a button in the thread — user-initiated, scoped to the
foreground surface, reads only when you press the key. This is a strictly *smaller and better*
proposal than ambient capture, and it dodges the three things that made ambient hard.

---

## Why on-demand is the better design (what it deletes)

- **The trust ask collapses.** "Reads everything on your screen, always" → "reads the one thread
  you invoked it on, when you invoked it." Same local-first storage story, none of the surveillance
  vibe. Behaviorally scoped to an explicit keypress.
- **The privacy leak closes.** With ambient, you had to pre-filter torrents of screen text before
  it hit the LLM. Here, the payload is exactly one thread the user chose. Nothing incidental leaves
  the machine.
- **Context selection — the hard part — mostly evaporates.** Goldfish's whole problem is "which of
  the things I passively saw is relevant right now, and don't confidently grab the wrong one." When
  the user invokes *on* a thread, they've *told us* what's relevant. Foreground surface wins,
  definitionally. No ranking, no ambiguity, no wrong grab. The remaining work is the easy,
  high-value kind: resolve this thread to the right entity in the vault.

So this keeps the two upsides from the earlier exploration — effortless capture, and inject-to-compose
outbound that sends as the user with no OAuth — while dropping the ambient baggage.

---

## The two commands

### Command A — "Capture this thread into PM"
Grab the focused thread's text → resolve it against the typed spine (decisions, people, problems,
`[[type::target]]` links) → file it where it belongs (attach to the SCIM decision, log a commitment
under `waiting-on::sara`, drop a mirror under the right person/problem note). One keystroke turns
"a Slack thread I'll forget" into structured product memory, linked, with provenance.

This is the capture problem solved without drag-in transcripts — but *pull*, not *watch*.

### Command B — "Draft a reply here"
Grab the thread → PM drafts a reply in your voice (per-project voice guides / skills-v2 voice
bindings already model "your tone in this project") grounded in vault memory (the decision, its
history, what you've already told this person) → **inject the draft into the compose box.** You
read it, tweak it, hit send.

Crucially: it sends **as you**, because it's your session and your keystroke — no Slack app, no user
token, no admin consent, no CASA. This is the inject path from
[messaging-integrations.md](./messaging-integrations.md), but triggered *from inside the thread*
instead of from a card in PM's inbox — which is more natural, because that's where you already are.

---

## One mechanism: the desktop app + accessibility. No extension.

Constraint: **we don't want the user to install both an app and a browser extension.** So drop the
extension entirely. The Electron app already exists and already installs; make it do everything
through the macOS **Accessibility API** (Win UI Automation later). One install, one permission.

The nice part is that a browser is *also* just a foreground app. Browsers expose their rendered page
to the accessibility tree (that's how screen readers read web pages), so a one-shot AX read of the
focused window covers **both** Slack web in Chrome/Arc/Safari **and** Slack desktop — with the same
code path. No per-browser extension, no "which browser," no Web Store review.

And the *same* Accessibility permission that lets us read the AX tree also lets us **post synthetic
keystrokes** (macOS routes both through it). So one permission covers both halves:

- **Capture (read):** global hotkey → a **single** AX read of the focused window → thread text to PM.
  Not polling, not background — one read per keypress.
- **Reply (act):** PM drafts → put it on the clipboard → optionally fire a synthetic ⌘V into the
  focused compose field (user has their cursor there). Same permission, no DOM injection needed.

| Surface | Capture | Reply |
|---|---|---|
| Slack/Gmail/Jira **web** (any browser) | one-shot AX read on hotkey | clipboard + optional auto-paste ⌘V |
| Slack/Teams/Mail **desktop** | one-shot AX read on hotkey | clipboard + optional auto-paste ⌘V |

**What we give up by dropping the extension** (worth being honest):
- The AX tree is messier than the DOM, and a few canvas-rendered surfaces expose little text — an
  OCR fallback (Screen Recording permission) exists but that's a second, scarier permission, so skip
  it for now and accept uneven coverage on a minority of apps.
- Reply is a **paste into whatever's focused**, not a precise inject into a known compose box. The
  user must have their cursor in the reply field. In the on-demand flow that's natural (you're in the
  thread, you click the box, you hit the key), but it's less magic than DOM injection.

The trade we're making: slightly less precise, one uniform mechanism, **one install and one
permission** instead of two. Given the constraint, that's the right call.

Honest note on the permission: macOS grants Accessibility per-app and *continuously* — there's no
"read just this once." So we *hold* a broad capability but *use* it only on your keypress. The
defensible posture is behavioral + transparent: read only on invoke, show a "here's what PM captured"
ledger, per-app allow/deny. Still a far smaller ask than passive "watch everything."

---

## How it rides the architecture we already have

- **Capture** files through the same use-cases that create notes/decisions/mirrors today; the only
  new part is the ingestion adapter (the AX read) and entity resolution against the spine.
- **Reply** is the existing outbound story: PM drafts → (optionally) an approval card → `execute`.
  Here `execute`'s final step is "put on clipboard + optional auto-paste" instead of "POST to
  Atlassian." Same `OutboundPort.execute()` seam (`ports.ts:296`), same card, same link-back into the
  source note (`proposals.ts:434`). The clipboard/keystroke actuator is just another executor.
- **Voice** is already a primitive: per-project voice guides / skills-v2 voice bindings are exactly
  "adapt to my tone in this project," which is what a good reply needs.

The new engineering is: (1) a native module that does a one-shot AX read of the focused window +
posts synthetic keystrokes, both behind the one Accessibility permission; (2) a global-hotkey
trigger in the Electron main process; (3) an entity-resolution step that maps a captured thread to
the right vault entities. The brain, memory, voice, and outbound seam already exist.

---

## Where this leaves us

The earlier docs were circling the two real gaps: capture is manual, and outbound hits walls. The
on-demand command answers both with one gesture from inside the thread — pull the context you point
at, and drop the reply back where you'll send it, as you, with none of the OAuth/install machinery.
One install, one permission, no extension. It's the smallest thing that makes PM feel like it's
*with you in the work* rather than a place you visit afterward.

**Next concrete step, if we pursue it:** the native AX read + synthetic-keystroke module and a
global hotkey in the existing Electron app, with the two commands (Capture / Draft reply) wired
through the existing use-cases and the `execute` seam. No browser extension, no second install.
