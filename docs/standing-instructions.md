# Standing instructions: "remember to..." in chat becomes a rule

## The problem

Erik writes things like "Remember to create person notes as well" or "If I drop an interesting article, tag it as inspiration by default" in a chat. Today the model agrees, and nothing changes. The preference should become durable product behavior, with the user approving it like any other write.

## The design in one paragraph

A new typed propose tool, `propose_instruction`, in the same family as `propose_todo`. The model calls it whenever the user states something that should hold in the future. The tool appends the rule as a bullet under a `## Standing instructions` section in the skill or agent that owns the behavior, or in a catch-all always-on skill `skills/_your-rules/SKILL.md` when no owner fits (created on first use). The write goes through the normal approval card, shown inline in the chat and in the Inbox. Because always-on skills are concatenated into every session prompt (`alwaysOnGuides`, `runtime.ts`) and a skill's whole body reaches the prompt verbatim when it runs, an approved bullet is law from the next session on. Nothing new is invented: the card kind is the existing `update` (with its `append` lever) or `note` (for first-time creation of `_your-rules`).

## Contract (fixed, both build agents follow this)

### Tool: `propose_instruction`

Lives in `packages/agent/src/tools.ts` inside `createProposeTools`, added to `PROPOSE_TOOL_NAMES` (always active, every session, like the other five).

Params:

- `rule` (required): one short imperative sentence, the thing to do from now on. Cap at 300 chars, refuse longer with a message telling the model to compress.
- `target` (optional): name of the skill or agent that owns the behavior (`arrival`, `librarian`, `meeting-prep`). Resolved via the same candidates logic as `resolveSkill` (skills before agents). If omitted or unresolvable, fall back to `_your-rules`. A resolvable but `enabled: false` target still works (the rule waits for the switch).
- `why` (optional): becomes the card's rationale. Default rationale: "You asked for this in chat."

Behavior:

1. **Target file exists** (including an existing `_your-rules`): emit a `kind: 'update'` card via `createProposal` with `targetPath` = the entry file, `baseHash` = `contentHash(body)`, payload `{ path, append, rationale, headline }`.
   - If the body's last heading is `## Standing instructions`, `append` is just `\n- <rule>`.
   - Otherwise `append` is `\n\n## Standing instructions\n\n- <rule>`. (If the section exists but is not last because a human moved it, we still append a fresh section at the end; the librarian or a human can fold them later. Do not try to patch into the middle of the body: `append` cannot miss its anchor, `patch` can.)
2. **Fallback and `_your-rules` does not exist**: emit a `kind: 'note'` card, payload `{ path: 'skills/_your-rules/SKILL.md', frontmatter: { type: 'skill', title: 'Your rules', summary: 'Things you have told Qale to always do.', starts: ['always'] }, body: '## Standing instructions\n\n- <rule>', rationale, headline }`.
3. **Headline**: the tool authors `payload.headline` (the DTO already reads it, `main/dto.ts`; no tool writes it today). Copy: `Remember this: <rule>` plus, in the card body, one line saying where it lands ("Goes into Arrival's standing instructions." / "Goes into Your rules, which every session reads."). Plain wording, no em dashes.
4. **Evidence**: the user's chat message is the source; there is no vault note to cite. Do whatever `validateEvidence` needs to accept that (the `inference: true` route or empty evidence, whichever the existing helpers already permit). Do not force the model to invent a source.
5. **Dedupe**: before proposing, read the target body; if a normalized version of the rule (lowercase, collapse whitespace, strip trailing punctuation) exactly matches an existing bullet in its Standing instructions section, refuse with "already a standing instruction there." The existing `duplicatePending` guard also applies as-is; if it refuses, relay its message.
6. **Receipt to the model**: same shape as the siblings: `Proposed instruction (p_x): "<rule>" -> <target>. Awaiting review.`

### Prompting

One short paragraph in `SHARED_PREAMBLE` (`packages/agent/src/prompts.ts`), near where the other propose tools are explained: when the user says something that should keep holding ("remember to...", "from now on...", "always...", "by default..."), call `propose_instruction` in the same turn and keep answering normally. Name the target skill when one clearly owns the behavior; leave it out otherwise. Never claim to have remembered something without the card. Plain language, no em dashes.

### Renderer

Minimal. The authored `payload.headline` already carries the card. In `apps/desktop/src/renderer/src/components/inbox/cardMeta.tsx`, add one detection: a card whose `targetPath` starts with `skills/` or `agents/` gets a fitting icon (a book or bookmark from lucide, consistent with existing choices) and a sensible fallback headline (`Remember this: ...` derived from the appended bullet) for cards that somehow arrive without one. No new component, no new card kind, `CardItem` untouched unless the diff view needs nothing anyway (append renders as an addition already).

### Demo vault

`vault-dev/skills/_your-rules/SKILL.md` with `starts: [always]`, title "Your rules", and two example bullets that match the Tavla scenario (for example: "When filing material that mentions a person, create their person note too." and "Articles with no obvious project land with the tag inspiration."). This shows the feature in the skills list and in every session's house rules. No dev-seed card.

## Not in v1 (decided, not forgotten)

- **Removal and conflicts.** "Stop doing X" is a later variant proposing a bullet deletion. Rules are visible and hand-editable on the SkillAgentPage, so v1 has an escape hatch.
- **Settings-shaped preferences.** "Answer in Swedish" has a real setting; v1 lets it become a prose rule anyway, which still works. A refusal-with-pointer can come later.
- **Merging duplicate sections.** If a human moves the Standing instructions section, the tool appends a new one at the end rather than patching mid-body. Cosmetic, self-healing via the librarian or a hand edit.

## Build plan

Two Opus agents in parallel, contract above is the seam:

1. **Core agent**: `propose_instruction` in `packages/agent/src/tools.ts` + `PROPOSE_TOOL_NAMES` + preamble paragraph in `prompts.ts` + tests in `packages/agent/test/` (model the new tests on `tools.test.ts`). Typecheck and test the touched packages.
2. **Surface agent**: `cardMeta.tsx` icon/fallback + `vault-dev/skills/_your-rules/SKILL.md`. Typecheck the desktop app.

Verify: package tests green, monorepo typecheck green, and a hand trace of both example sentences through the tool logic.
