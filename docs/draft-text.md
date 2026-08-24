# draft_text: variants in the chat

Status: spec, not built. Replaces `draft_message` and the message approval card.

## Why

`draft_message` made an approval card for text that is never sent. The card said
"Leaves your workspace" in its header, "Nothing is sent" in its effect line, and
"Approve & send" on its button. What it actually did on approval was append the
open tab to a note and throw the other tabs away. It also failed at the last
possible moment: `linkBack` is optional on the tool and required at accept, so
the failure landed after the person had read the text and picked a tab.

Two different jobs were wearing one costume:

- **Write me some text so I can compare takes.** Might be a message. Might be a
  jingle, a headline, a paragraph. Nothing leaves. Nothing is filed.
- **Send something outward.** Real, but it needs a connector. There is no
  message connector, so this job does not exist today.

`draft_text` is the first job, honestly. The second job stays what it already is:
`draft_jira_comment`, `draft_confluence_update`, the calendar drafts. Those are
real approval cards because they really execute.

## What it is

A panel in the chat. The agent writes one or more variants, they render as tabs
inside the conversation, and the conversation carries on underneath. It is not a
proposal. It never reaches the Inbox. There is nothing to approve, discard, edit
or ask about, because nothing is pending.

A turn may draw several panels ("draft three different intros"). Each call is a
new panel. A revision is a new panel too. Nothing is edited in place.

Two actions on a panel:

- **Copy** puts the open variant's markdown on the clipboard. This is the main
  way text leaves the app.
- **Use this** sends a message as the person, naming the variant they have open.
  The agent reads it as an ordinary turn and does whatever it implies: post it on
  a ticket (a real approval card follows), keep it in a note (a `propose_note`
  card follows), or write another take.

That second button is why nothing else is needed. The panel stays dumb. It knows
about text and tabs. Every destination stays the agent's problem, decided in a
turn, with the real card that destination already has.

## The tool

```
draft_text({
  title?:    string        // heading for the panel, e.g. "Exec update"
  voice?:    string        // a voice name from the workspace
  variants:  [{ label, body }]   // at least one; body is the whole text, markdown
  action?:   { label, message }  // overrides the Use button, see below
})
```

- `label` is what the tab says. Two or three words.
- `body` is the whole text, never a fragment.
- Two variants is the normal case: two takes far enough apart to choose between.
  One only when a second would be the same text reworded.
- No `sources`. The panel asserts nothing about the workspace, so it cites nothing.
- No `rationale`. The person asked for this; explaining their own request back to
  them is noise, and it pushed the text below the fold.
- No `linkBack`. Nothing is filed, so there is nowhere for it to point.
- No `card` id. Each call is a new panel.

`voice` keeps the behaviour it has today: `get_voice` must be read first, and a
draft naming an unread voice is refused once with the brief attached. That
discipline is what keeps the weekly update sounding like the workspace, and
nothing about this change argues against it.

It refuses in one direction only. A draft that names no voice is always allowed,
because whether a voice fits is a judgement about who reads the text, and a
workspace writes plenty that no voice was written for. What makes the judgement
possible is the roster, which is why a voice summary says who it is for before
it says how it sounds: "For customers, and anyone outside the company. Warm,
plain, exact about dates." A summary that only described the sound left an
update to a customer looking like it belonged to no voice at all.

The tool result the model sees is one plain sentence, for example:

> Showed 2 versions in the chat: Short, Friendly. Nothing was filed and nothing
> was sent. If they pick one they will say so.

### The Use button

Clicking sends a user turn built by the renderer:

```
Use the "<open tab label>" version.
```

With `action` set, the button carries the agent's own label and the message gets
its sentence:

```
action: { label: "Post on PAY-142", message: "Post it as a comment on PAY-142." }
→ button reads "Post on PAY-142"
→ sends: Use the "Short" version. Post it as a comment on PAY-142.
```

The sent text appears in the transcript as a normal user message, because that is
what it is.

The button is disabled while a turn is running, and while the session is parked on
a question card.

### Permission

`draft_text` needs no capability and no connector. It writes nothing, sends
nothing and files nothing. It moves out of `MESSAGE_TOOL_NAMES` (which is deleted)
and into the always-on tool list beside the vault tools, along with `get_voice`,
which only reads a file the workspace already holds.

That is a real widening. `draft_message` sat behind `draft-outbound`, so a skill
had to claim a permission to write text that never left the workspace. Skills
that only ever drafted text now claim nothing at all.

The base chat keeps `can: [draft-outbound]`. It no longer needs it for text, but
it is what lets a conversation draft a Jira comment or a Confluence update when a
connector is on.

## How it renders

The tool call already carries the variants in its `input`, and `entriesToUiMessages`
replays tool inputs in order inside the assistant message. So the panel needs no
storage of its own. It renders from the tool part, live and on replay, for free.

Today an assistant turn renders as: one folded `ActivityBlock` for everything, then
any fenced handover text, then the last text part as the answer. Order is lost.
That has to become a walk over the parts in order:

- a `draft_text` tool part flushes the pending activity into an `ActivityBlock`,
  then renders a panel;
- a fenced handover text flushes, then renders (unchanged behaviour);
- the final text part flushes, then renders as the answer;
- everything else accumulates into the pending activity.

That gives "panel, then a paragraph, then another panel" without special cases.

A call only draws a panel once it has come back and was not refused. Three cases
fold into the activity block like any other step: a call still streaming, a call
whose input carries no usable `variants`, and a refusal. The refusal matters. The
tool turns down a draft that names a voice this session has not read, and that
refusal carries the variants it was called with. Drawing them would put text on
screen that the agent is at that moment rewriting, and the rewrite would land
beside it as a second panel saying the same thing in a different tone. Waiting for
the result also spares the reader a panel that assembles itself a tab at a time.

A refusal is an ordinary tool result whose text opens with "Rejected:", the same
word every tool in the workspace refuses with.

### The panel

- Optional title, quiet, at the top.
- Voice as a caption when set.
- Tabs when there is more than one variant. Pill tablist, arrow keys move between
  them, same as the current message draft.
- The body as rendered markdown.
- A footer row: **Use this** on the left, **Copy** on the right.
- Nothing else. No approve, no discard, no edit, no "Ask about this", no
  "Based on", no rationale, no effect line, no "Leaves your workspace" banner.

The panel sits in the flow of the conversation, not in a card frame that implies
a pending decision.

Which tab is open is local state. It is not persisted and not reported to the
model, because the Use button names the variant in the message it sends. If
someone types "make that one shorter" without clicking, the agent asks or takes
the last one, the way it would with any other ambiguous reference.

## What gets deleted

The message card and everything holding it up.

**packages/agent**

- `draft_message` from `createDraftTools`, with `cleanAlternatives` and
  `mergeAlternatives` if nothing else uses them.
- `MESSAGE_TOOL_NAMES`, and its gating in `runtime.ts` (both the `harness.outbound`
  push and the registry entry).
- The `draft` branch in `card-state.ts`: the tab list, the open-tab line, and the
  "when they say that one" paragraph. Nothing reports an open tab any more.
- `SessionCardState.draft` wherever it is declared.
- `test/draft-message.test.ts`, replaced by `test/draft-text.test.ts`.
- `test/tool-gating.test.ts` loses its `MESSAGE_TOOL_NAMES` assertions and gains
  one: `draft_text` is present with no capability at all.

**packages/domain**

- `'send_message'` from the outbound action list and the `message` provider map.
- `alternatives` and `selected` from the outbound payload schema.
- The `send_message` case in `effect.ts`.
- The affected cases in `test/outbound-effect.test.ts`.

**packages/application**

- The `p.provider === 'message'` branch in `acceptOutbound`.
- The `selectAlternative` use case.
- `test/select-alternative.test.ts` and `test/accept-outbound-message.test.ts`.

**packages/ipc**

- `proposals:selectAlternative` from the channel map and the channel list.
- `'send_message'`, `alternatives` and `selected` from the outbound payload DTO.

**apps/desktop main**

- The `proposals:selectAlternative` handler and its import.

**apps/desktop renderer**

- `MessageDraft` and `isMessageDraft` in `CardItem.tsx`, and the branch that
  chose between them and `OutboundDetail`.
- `src/lib/message-draft.ts` and `test/message-draft.test.ts`.
- The message fallback in `OutboundTargetLine` ("A message to send").
- Check `outboundAct`: `send_message` fell through to `default: { verb: 'send' }`,
  which is where "Approve & send" came from. Every remaining action has its own
  case, so the default becomes unreachable for real payloads. Leave it as the
  safety net it is, but it must no longer be reachable by a message card.

**copy**

- `RunnableConfig.tsx`: drop the sentence about drafting a message needing no
  permission. It is now true of a tool that is not a draft card at all.
- `packages/sessions/src/defaults.ts` and the matching `vault-dev/skills/*/SKILL.md`
  files, which must move together: base chat, weekly-update, commitment-check,
  incoming-request.

## Skill copy

The four places that name `draft_message`:

- **Base chat** (`defaults.ts`): today it says to write a message as a draft card
  rather than in the reply, because a card can be edited and saved. Rewrite for
  what is true: when the answer is a piece of text to use somewhere, write it with
  `draft_text` so it comes with tabs and a Copy button instead of being buried in
  the transcript. Nothing is filed.
- **weekly-update**: one `draft_text` call per voice, Full and Short as the two
  variants. Keeps `can: [draft-outbound]`, which it needs for
  `draft_confluence_update`. The drafts are no longer filed anywhere on approval,
  so the skill should say what it now is: text to paste, with the team page and the
  Confluence update as the cards that actually land.
- **commitment-check**: the nudge becomes a `draft_text`. Drop
  `can: [draft-outbound]` from its frontmatter. It used no other outbound tool, so
  the capability was granting it Jira and Confluence drafts it never calls.
- **incoming-request**: the reply becomes a `draft_text`. Drop
  `can: [draft-outbound]` for the same reason.

## What this does not do

- No filing. If a draft is worth keeping, ask, and a `propose_note` card lands it.
  Add a Save action later only if the lack is actually felt.
- No stored tab selection.
- No message connector. Sending a message is still the person's own client and
  their own paste.
