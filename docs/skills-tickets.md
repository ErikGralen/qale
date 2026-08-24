# Skills rework: tickets

Everything here was decided in `docs/skills-rethink.md` (rounds 1 to 5).
Nothing is open. The order below is a workable sequence: the deletions
first, then the new shapes, then the UI, then the reseed.

One late decision that is only in round 5: confidentiality guardrails
("customers never see internal metrics") live in each skill that drafts,
not in voices and not in house rules. KISS, revisit later.

`defaults.ts` and `vault-dev/` must move together on every ticket that
touches a skill body.

## SK-1: delete the shipped-versions machinery

Remove skill-pack versioning end to end: `packages/sessions/src/shipped-versions.ts`,
`packages/application/src/use-cases/skill-pack.ts`, the `SkillPackReview`
component, their IPC surface in `@qale/ipc` and `handlers.ts`, their tests,
and the call sites in `packages/sessions/src/index.ts`. Seeding a new vault
stays; upgrading an existing one goes. Upgrades come back later,
agentically.

Done when: the app builds and seeds a fresh vault, and no code path
compares a skill to a shipped version.

## SK-2: shrink the skill file format

In `packages/sessions/src/runnable.ts`:

- Remove `starts:` and `audience:` from the format. A skill's category now
  comes from its folder (`skills/`, `voices/`, `agents/`) and the
  hard-coded rosters (moments, agents), not from frontmatter.
- Remove `enabled:` for everything except agents. `runnableEnabled` keeps
  working for the agent roster only.
- Frontmatter becomes exactly: `title`, `summary`, `scenarios`, `can`.
- Delete the `MOVED_KEYS`/legacy honouring (`use`, `outbound`,
  `session_files`). No users, no files to protect. An unknown key is
  flagged as an error on the file's page, which is what `broken-demo`
  will demonstrate (SK-13).
- `describeStarts`, `governs`, and the `Start` type simplify or die with
  it.

Done when: `parseRunnable` accepts only the four keys, tests in
`packages/sessions/test` reflect the new format, and nothing reads
`starts` or `audience`.

## SK-3: the house-rules document

- Create `skills/house-rules/SKILL.md` in `defaults.ts` and `vault-dev/`.
  Title "House rules". Three headings: **Language** (from `_language`),
  **Filing** (from `_filing-rules`), **Your rules** (seeds empty).
- The agent runtime loads this one file into every session, replacing the
  `alwaysOnGuides` scan in `packages/agent/src/runtime.ts`. No file can
  declare itself always-on anymore.
- `propose_instruction` (`packages/agent/src/tools.ts`) appends bullets
  under **Your rules** instead of writing to `_your-rules`.
- Delete `_language`, `_filing-rules`, `_your-rules`.

Done when: a session's system prompt contains the house-rules body, a
"remember to always..." card lands under Your rules, and the three old
files are gone from defaults and vault-dev.

## SK-4: unattended rules move into the preamble

The `_unattended` body becomes code-owned text in the agent preamble
(`packages/agent/src/prompts.ts` or where the unattended preamble is
built), applied to unattended runs only, as today. Delete the file.

Done when: an unattended librarian run still gets the question budget and
never-invent rules, with no `_unattended` file on disk.

## SK-5: knowledge moves to the memory

- `_understanding` becomes the product orientation note in the memory
  (the OKF index/orientation shape). It leaves the prompt-injection path
  entirely; sessions reach it through retrieval like any note.
- `discovery-guide` (and its `question-bank.md`) moves into the memory as
  material. `read-when-relevant` has no wearers left and dies with SK-2.
- Both leave `skills/` in defaults and vault-dev.

Done when: neither file is a skill, the orientation note is where the
interview skill (SK-11) writes, and retrieval can find both.

## SK-6: voices get their folder, applied at draft time

- New top-level `voices/` folder. Move `voice-exec` and `voice-cs` there,
  rewritten as tone-and-language briefs only: how to sound, which words,
  what register. No content selection, no "what they care about" that
  steers inclusion.
- One voice-resolution function in the agent package: given a voice name,
  return the file's body, or nothing. The `draft_message` tool description
  lists the current roster so the model knows what exists. No match: draft
  plain, never invent a voice.
- `alwaysOnGuides` stops injecting voices anywhere (with SK-3 the whole
  function goes).
- Outbound drafting tools (Jira comment, Confluence page) accept an
  optional voice and run it through the same resolution. Outbound cards do
  not get alternatives.

Done when: no voice text appears in a session that is not drafting, and a
draft with `voice: "exec"` demonstrably follows the exec brief.

## SK-7: draft_message v2

Rework `draft_message` in `packages/agent/src/tools.ts`:

- Parameters: `voice` (optional), `subject` (optional), `alternatives`
  (list of `{label, body}`), `card` (optional id of an existing draft
  card).
- Without `card`: create a draft card holding all alternatives.
- With `card`: update that card in place. New alternatives append as tabs.
  A different voice replaces the set.
- The old `audience` parameter dies with the audience concept.

Done when: one call produces one card with N tabs, a follow-up call with
the id adds a tab to the same card, and the tool description names the
available voices.

## SK-8: the message draft card

In `SessionView.tsx`: the draft card renders the screenshot shape. Tabs
across the top (the alternative labels), the active alternative's body
below, Copy at the bottom. No Open in Mail, no dropdown in v1: switching
voice or adding an alternative happens by asking in chat, and the agent
updates the card (SK-7).

Tab selection writes back to the session as a small state event, the same
path an `ask_user` answer takes, so the agent always knows which
alternative the user is looking at. That is what makes "make the one I
picked shorter" and SK-9 work.

Done when: a two-alternative draft renders as tabs, Copy copies the active
tab, "make it shorter" in chat adds a tab to the same card, and the
selection event is visible in the session record.

## SK-9: draft flows into outbound

"Post that as a comment on the ticket" works: the agent takes the active
alternative from the draft card (it knows the selection from SK-8) and
calls the outbound tool with that body. The normal outbound proposal card
appears; approval sends it. The message card stays behind. This is
prompting plus the selection event, no new UI. Say it in the drafting
guidance where `draft_message` is described.

Done when: the flow works end to end against the demo Jira.

## SK-10: slim the weekly update

The weekly-update skill keeps its per-audience content guidance (that is
the skill's job) but drafts through `draft_message` v2: one card per
voice, each with its own alternatives. The body lists which voices to
draft for, where the user can add "the board". Confidentiality lines the
old voices carried move into this skill's body (the round-5 KISS call).

Done when: running the weekly update yields one tabbed card per listed
voice.

## SK-11: generalize the interview skill

`learn-the-product` becomes a generic interview skill: the user tells
Qale about something, Qale asks until it has it, then writes it into the
memory (the orientation note from SK-5, or the right note for the topic).
Title along the lines of "Tell Qale about something". Scenarios: "let me
tell you about our pricing", "you don't seem to know how onboarding
works", "let me explain how the team is set up".

Callers hand in a topic: onboarding runs it with "the product"; the
thin-page offer on the orientation note runs it with the thin topic. The
product-specific questions in today's body become one example topic.

Done when: the skill runs from the composer with any topic, and
onboarding still reaches it.

## SK-12: the tabbed Skills page

Rebuild `SkillsView.tsx` as one page with five tabs, in this order:
**Skills, House rules, Moments, Voices, Agents**.

- Skills: the requests (weekly-update, synthesis, process-note, the
  interview skill, user-created ones). No toggles; delete is the off.
- House rules: the one document, edited in place. No list.
- Moments: arrival ("When material arrives") and commitment-check ("When
  a commitment slips and you ask for help"). Trigger text comes from
  code. Editable bodies, no off switch.
- Voices: the `voices/` files.
- Agents: librarian and meeting-prep with their clocks, the only
  `enabled:` toggles. `AgentsView.tsx` folds in here and the separate
  page goes, along with its sidebar row, quick-switcher entry, and
  `openAgents` plumbing.

The shelf machinery (`shelfOf`, "Always on") dies. The underscore-prefix
convention has no remaining files.

Done when: every file in the workspace is reachable from exactly one tab,
and no route opens the old Agents page.

## SK-13: the new-skill flow

"New skill" asks one question first: what should it do?

- "Something I'll ask for" → a new file on the Skills tab, verb-titled.
- "A rule Qale always follows" → opens house rules at Your rules.
- "How I sound" → a new voice file.
- "Do more at a moment" → opens that moment's body.

The librarian can draft the body from a sentence. The user never sees
frontmatter keys. Also update `broken-demo` so it demonstrates a visible
config error in the new four-key vocabulary.

Done when: each of the four paths lands in the right place, and
broken-demo shows its error on the file's page.

## SK-14: reseed and sweep

- Reseed `defaults.ts` and `vault-dev/` to the final roster; run
  `pnpm refresh-demo` and check the demo still tells its story.
- Sweep for stragglers: `newSkillFile`, the skill picker, Home composer
  chips, `skillIndex` in the runtime (only Skills-tab skills belong in
  it), telemetry view names, onboarding copy that mentions skills, and
  docs that describe the old shelves.
- `resolveSkill`'s skills-shadows-agents behaviour: check it still makes
  sense with `voices/` in the tree.

Done when: a fresh vault, the demo vault, and every picker agree with the
settled shape in `docs/skills-rethink.md`, and tests pass.
