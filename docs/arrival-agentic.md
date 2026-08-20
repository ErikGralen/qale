# Arrival, done by the agent

Direction doc, 2026-08-05. Supersedes `docs/arrival-flow-review.md`: none of that file's
proposals get implemented as written. Every finding there is re-dispositioned at the bottom of
this doc, and the ones that survive are carried here. When this doc's work is done, delete both.

## Why

The flow review found fourteen problems. Read together, almost all of them are the same
problem: `planArrival` / `ingestArrival` is a pile of hardcoded heuristics standing in for
judgment. The 90-minute clock window guessing which meeting a transcript belongs to. The
21-day and 5-unit rules silently switching reviews off. The part-marker regex deciding two
files are one meeting. The "text is material unless a file exists" fork. Each rule tries to
answer "what is this and what should happen to it?" without reading anything, and each edge
of each rule is a finding in the review.

An agent that skims the files can answer the question directly. When it is not sure, it can
ask, which a planner never can. `ask_user` with option cards is already built. So is the rest
of the machinery this design needs: session files, and the `spawn` fan-out tool with its
approval card and model picker (`packages/agent/src/spawn.ts`). This is mostly demolition
plus skill copy, not construction.

## The shape

**Landing is mechanical.** The moment Add is pressed, the files are written to disk as
session files in a new session, before any model call. Material is never hostage to an API
key or a model's mood. No key: the files sit in the session as unfiled material with the
session's normal "could not run" state, and nothing is lost.

**Judgment is the skill's.** The session runs "Handle new material". The agent skims the
material, decides filing, matches meetings by what the transcript says (title, participants,
content) rather than by the clock, notices when the PM is not in the room, checks for
duplicates against what is already filed, files into the vault, and starts full reads only
where they are earned. When it cannot tell, it asks with an option card. Everything the old
planner decided silently, the agent decides out loud, in the session, where a correction is
just typing.

**The tray shrinks to almost nothing.** File rows with an X each, one text field, one button.
The handling radio group dies. The ambition/catchup machinery dies. The "Attaches to" line
dies (the agent proposes the match with evidence, where it can be declined). Pasted text
becomes an item row like any file, so the material/instruction fork dies too: the text field
always means "anything I should know or want done?".

**What stays dumb.** Format refusals (unreadable file, empty file), the folder walk, and
image reading stay in the tray. No model is needed to say "this is a zip". These are the only
mechanical rules that survive, because they are about bytes, not meaning.

## The speed ladder

The user chooses their own involvement, per drop, without a mode switch:

- **Rung 0, say nothing.** Drop, Add, done. The agent files and narrates. If the job turned
  out to be pure filing with nothing to review and nothing to ask, the session ends quietly
  (same principle as scheduled runs) and the user never visits it.
- **Rung 1, one line of steering.** "These are old interviews, just file under sources, no
  reviews." The instruction field is the power-user interface: one sentence, skips every
  question, overrides the agent's own judgment. Today `instruction` is decoration on a
  hardcoded pipeline; here it is the steering wheel.
- **Rung 2, drop with aim.** Where you drop carries intent. Drop on a folder in the sidebar
  or a folder page: file there, ask nothing. Drop on a meeting page: this belongs to that
  meeting. Drop anywhere neutral: the agent decides. Aim reaches the agent as a preset
  instruction, not as a separate code path.
- **Rung 3, full conversation.** Open the session, watch, answer cards, redirect by typing.

Over time rung 1 collapses into rung 0: the skill's instructions can carry learned habits
("Teams .vtt exports go to sources, no review") once a pattern has repeated.

**When does Add navigate into the session?** When there is something to watch or answer:
reads starting, a question parked. Pure filing stays quiet with a one-line handoff. A wrong
default here recreates the review's dead-pointer finding or a tab explosion, so this rule is
stated up front.

## Large batches

The skill describes the judgment: up to 5 files, read them yourself. More than that, or
names that say the material is old, treat it as a backlog:
write `brief.md`, spawn one skim per file on a quick model, each child returning title, date,
what kind of thing it is, and whose voice is in it. File from the results, start full reads
only where something looks live, and say what you skipped.

This uses `spawn` exactly as built. Small batches fit the agent's own context, so no fan-out
and no approval card: the fast path stays drop, Add, done. Backlog scale earns the card, which
is one click, shows "30 quick skims on <model>", and is where the quick model gets picked.
Someone who just dropped 30 files is not in a hurry the way someone dropping 3 is, and the
card is the natural place to catch "wait, not those".

**Decided (2026-08-05):** the approval card stays for arrival fan-outs. Zero new code,
consistent with invariant 6, "permission outside". The line between "read them yourself" and
"fan out" is **5 files**: up to 5, the agent reads directly and no card ever appears; above
that, spawn plus the card.

## What the skill says (draft)

Product copy to be written properly, but the judgment it must cover:

- **Filing.** Transcripts go to `sources/`, whoever's meeting they record; the calendar
  meeting they belong to gets them linked on when one matches. Everything else goes to
  `sources/` too. Name the filing in one line as you do it.
- **The meeting page is a card, not a filing** (changed 2026-08-07). Filing a transcript used
  to mint the meeting page as a side effect: an empty scaffold reading "not read yet", which
  the summary then arrived to patch. Two steps for one thing, and the first of them put a
  page in the workspace nobody had approved. Now `file_material` writes only the recording and
  `propose_meeting` proposes the page whole, summary in it, transcript cited. Approve and the
  meeting exists finished; decline and only the recording is on the shelf. Nothing an agent
  authors reaches the workspace without the PM saying yes — a meeting page included.
- **A card may cite a card.** Evidence resolves against notes on disk _and_ against pages a
  pending card would create, so the todos and decisions out of a meeting still cite the
  meeting rather than the raw recording. The skill proposes the meeting first. The exposure
  is one case: approve the todo, decline the meeting, and the todo cites a page that was
  never written. That is a broken link, and broken links are already the librarian's job —
  frontmatter refs index as edges, so it comes back as a `broken-link` finding with repair
  hints on the next tick (5-minute settle, one session per 30 minutes at most). A link the
  librarian will raise beats a citation that pointed at the wrong thing from the start.
- **Matching.** Match a transcript to a meeting by its own date, title, and participants.
  The clock is a hint, never the decider. Two plausible meetings, or none: ask, offering the
  candidates and "new meeting" as cards.
- **Not my meeting.** If the PM never speaks and was not invited, it is someone else's
  meeting: file under `sources/`, set `origin: external` in frontmatter, and never draft
  outbound in the PM's voice over it. Unsure: ask.
- **Duplicates.** Before filing, check whether this material is already here (name, date,
  content). Already filed: say so and stop, offering "add anyway".
- **Re-reads.** When a meeting already has processed transcripts, read only what is new.
  `processing: processed` on a source means its commitments were already proposed; do not
  propose them again.
- **Reviews.** Fresh meeting material earns a full read. A backlog earns filing plus skims.
  The user's instruction always wins, in both directions: "just file these" files without
  reading, "review them anyway" reviews month-old material without argument.
- **Batches.** Up to 5 files: read them yourself. More: the backlog judgment above, via
  `spawn`. The 5 is skill copy, tunable without code.

## What this needs from the platform

1. **Files land as session files.** The one real wiring change: arrival writes into the
   session folder first, and the agent files into the vault from there. Today arrival writes
   straight to the vault. Spawn children can already read the session folder.
2. **A move/refile tool.** The agent can ask but cannot act on "actually that was
   Kranelund's call". If filing is the agent's job, correcting a filing must be too.
3. **Demolition.** `planArrival` / `ingestArrival`'s heuristics, the ambition/handling/split
   DTOs, the `capture:ingest` zombie pipeline and its two dead sibling channels, and the
   tray's radio machinery all go.

## The review, finding by finding

What the agentic design does to each finding in `docs/arrival-flow-review.md`. "Dissolves"
means no dedicated feature is built; the design removes the machinery that caused it.

| Finding                                        | Disposition                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AR-1 wrong meeting / duplicate meeting         | **Dissolves.** Matching is the agent reading the transcript, exactly what the decision asked for ("title, participants, maybe content, fine to ask"). The option card is the fast clarification UI. The clock-window matcher demotes to a hint.         |
| AR-2 "not my meeting" doesn't exist            | **Dissolves, plus one tool.** The agent notices before filing, which is the decision's "catch it earlier", and writes `origin` frontmatter. The move/refile tool covers late corrections. The dead `external` plumbing gets used or deleted.            |
| AR-3 meeting page can't start a review         | **Survives, smaller.** Still a missing button. "Read this meeting" on a meeting holding a transcript starts the arrival session scoped to it; "Mark as filed" goes in the ⋯ menu over the existing channel.                                             |
| AR-4 no door for a second transcript           | **Survives.** "Add transcript" on every past meeting page, opening the tray with the aim preset (rung 2). Also AR-1's manual escape hatch, as the review noted.                                                                                         |
| AR-5 pasted text becomes an instruction        | **Dissolves via the tray change already decided.** Pasted text is an item row; the text field always means instruction. The fork and all three of its data-loss modes go with the planner.                                                              |
| AR-6 duplicate drop is silent                  | **Dissolves into the skill.** The agent checks before filing. The tray may keep a cheap name-match hint, but nothing depends on it.                                                                                                                     |
| AR-7 "together" sticks after the batch shrinks | **Dissolves.** The radio group is deleted; there is no handling state to go stale.                                                                                                                                                                      |
| AR-8 several reviews, dead pointer             | **Dissolves.** No receipt, so no dead pointer; the sidebar sessions rail already shows running reads. The 21-day rule is gone, and "review it anyway" wins by instruction, per the decision.                                                            |
| AR-9 "After-Meeting" naming                    | **Survives as a sweep.** Six user-visible strings name a retired skill; that cleanup is due regardless. Tabs get named after the material.                                                                                                              |
| AR-10 zombie `capture:ingest` pipeline         | **Survives, grows.** The demolition list above includes it and most of the planner besides.                                                                                                                                                             |
| AR-11 re-reads re-propose approved cards       | **Dissolves into the skill.** The distinction is already on disk (`processing: processed`); the skill tells the agent to honour it.                                                                                                                     |
| AR-12 second drop / ⇧⌘N wipes the tray         | **Survives.** Merge incoming drafts while the tray is open; guard ⇧⌘N like ⌘↵. Small tray fix, still worth doing.                                                                                                                                       |
| AR-13 no receipt, no undo, no correction       | **Dissolves by decision.** Receipts and undo are removed entirely (the decision: "if the user uploaded it, they will not regret it one second afterwards"). The session narration is the record, and corrections are conversation plus the refile tool. |
| AR-14 folder drop fails and blames the format  | **Survives.** The folder walk, `openDirectory` on the picker, and an honest empty-file message are mechanical and stay in the tray. It is the front door of the backlog story.                                                                          |

Nothing in the review is left uncovered: eight findings dissolve, six survive as small,
well-bounded pieces (two buttons, a tray merge fix, a string sweep, the folder walk, the
demolition).

## Decisions (2026-08-05)

1. The approval card stays for arrival fan-outs. No auto-approval.
2. The "read them yourself" line is 5 files. Above 5, fan out. Lives in skill copy, tunable
   without code.
3. Habit learning (rung 1 collapsing into rung 0) is out of scope. The ladder text above
   mentions it as a possible future, nothing more; do not build any part of it.
