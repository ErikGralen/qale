# Tool conventions

How the workspace records the way this team uses Jira and Confluence, so drafts land the way the
team expects. Written 2026-08-31 against the code as it stands.

**The problem.** Every team bends its tools into a house shape: a label that must be on every
ticket, one project for bugs and another for roadmap work, specs that always live in one space,
a page format the org recognizes. Qale drafts tickets and page updates today and knows none of
this. So the first draft is generic, the PM fixes the same things every time, and a correction
said in chat ("always tag these with `team-checkout`") is agreed with and forgotten. The cost is
paid at the exact moment the product is supposed to shine: the after-meeting draft.

**The idea.** One conventions skill per system, `skills/jira/SKILL.md` and
`skills/confluence/SKILL.md`. The body is instructions the agent follows when it drafts for that
system, organized by moment: when you draft a ticket, when you comment, when you update a page.
The user can open and edit it like any skill. It fills itself from three feeders that already
exist: standing instructions from chat, the first-look debrief's observations (confirmed by the
PM, never mined silently), and the user's own edits.

**One distinction carries the whole design.** "Most NORD tickets carry `team-checkout`" is an
observation; "set `team-checkout` on tickets you draft for NORD" is an instruction. Observations
can be wrong or stale, so they stay hypotheses until the PM confirms them. Only instructions go
in the skill, because whatever is in the skill repeats on every draft. This is the same rule the
debrief already follows: nothing lands from a source alone, and their yes is what makes it law.

**Why a skill and not a voices-style file.** Voices moved out of `skills/` because a voice is a
short brief that only exists at drafting time. Conventions look similar, but two things pull the
other way: `propose_instruction` routes "remember to..." rules to skills by name, which is the
cheapest feeder and works today, and the Skills page is where the user already goes to read and
edit what the agent follows. `house-rules` set the precedent: a skill that never runs but is
read. Loading follows the voices pattern anyway: not always-on, read at drafting time, because
the body only earns its prompt cost when something is being drafted for that system.

**How to use this doc.** Same convention as the others: one ticket per thing, your call under
**Decision**, what landed under **Notes**.

---

## CV-1. The two skills, created on demand

**Today:** nothing. The shipped skills are the workflow ones plus `house-rules`; no file anywhere
describes how the team uses its systems.

**Proposal:** two skill templates in `defaults.ts`, `skills/jira/SKILL.md` (title "How we use
Jira") and `skills/confluence/SKILL.md` (title "How we use Confluence"), but NOT seeded into
every workspace: a workspace without Jira should not carry an empty Jira skill. The file is
created on first use, by whichever feeder gets there first (CV-3's card or CV-4's card), from the
template. The template body is short and self-explaining:

- One line at the top saying what this is: "Qale follows these rules when it drafts for Jira.
  Edit them freely; short imperative bullets work best."
- Three headed sections matching the drafting moments: "When you draft a ticket", "When you
  comment", and for Confluence "When you update a page". Each starts with one italic example
  line the first real rule replaces.
- A closing "## Standing instructions" section so `propose_instruction`'s append logic finds its
  anchor.

High level only, same discipline as the understanding: rules, not an inventory of the Jira
config. The skill records "bugs go in NORD with the `bug` type", not a mirror of every field
scheme.

**Decision:** Implement as proposed (Erik, 2026-08-31)

**Notes:** Built 2026-08-31. `JIRA_CONVENTIONS` and `CONFLUENCE_CONVENTIONS` sit in
`packages/sessions/src/defaults.ts` next to `HOUSE_RULES`, reached through `CONVENTION_SKILLS`
(name to template) and `conventionsSkill(name)`. That is where they belong for one reason:
`packages/agent` already depends on `@qale/sessions`, so the tool reads the template from the same
constant a later caller (CV-4) will, and there is one copy of each file in the repo. They are in no
seed registry, so nothing seeds them, and `defaults-sync.test.ts` now names both as deliberately
unseeded, checks that neither is in a seed list, and checks that `## Standing instructions` is the
last heading in each. Frontmatter is `type`, `title`, `summary` and nothing else, the house-rules
shape: there is no `starts` key any more, and these files hold rules rather than work.

Two small additions to the spec. Each template's top line carries a third sentence holding the file
high level ("what the team wants done, not a copy of the Jira setup"), and the Standing instructions
section carries one line saying what lands there, the way "Your rules" does. Each italic example is
harmless if a draft follows it literally, because until the PM writes their first rule that is what
happens.

One thing left alone: once the file exists it joins the `use_skill` roster like any other skill, so
the model could load "How we use Jira" as if it were work. Capabilities only widen, so nothing is
lost by it, and the worst case is a session receipt with the wrong name on it. Excluding it the way
`house-rules` is excluded is a one-line change in `listLoadableSkills` if it ever reads wrong.

Tested by the sessions and agent suites. Not run live.

---

## CV-2. Drafting reads the conventions

**Today:** `draft_ticket`, `draft_ticket_comment` and `draft_page_update` (the generic write
tools from provider decoupling) describe their parameters and nothing else. The after-meeting
and weekly-update skills say what to draft, not how the team likes it. Voices show the working
pattern: the draft surface names the brief and the model fetches it at drafting time.

**Proposal:** instructions, not machinery, per the house rule.

- The three tool descriptions gain one line each: before drafting, read `skills/jira/SKILL.md`
  (tickets and comments) or `skills/confluence/SKILL.md` (pages) if it exists, and follow it. The
  session already has read tools; no `get_conventions` gate, because unlike `draft_text` there is
  nothing here that must be forced, only something that must be found.
- The after-meeting and weekly-update skill bodies name the conventions skill in their drafting
  step, so the two most common paths do not depend on the tool description alone.
- A missing file costs nothing: the model reads nothing and drafts as today.

No enforcement anywhere. A convention is prose the model reads, never a lint that blocks a card:
the PM sees every draft anyway, and a gate would need context-free facts, which these are not.

**Decision:** Implement as proposed (Erik, 2026-08-31)

**Notes:** Built 2026-08-31. Two surfaces, prose on both, no code path that can fail.

The three write tools in `packages/agent/src/tools.ts` share one sentence, `conventionsNote(path)`,
sitting between the tool's own instructions and the voice note: "Before you draft, read
`skills/jira/SKILL.md` if it exists and follow it: it says how this team wants this written. Nothing
there, nothing to follow." `draft_ticket` and `draft_ticket_comment` take the Jira path,
`draft_page_update` the Confluence one. It is composed once rather than written out three times,
because the second half of the sentence is the part that must not drift: it is what tells the model
a missing file is normal.

The skills followed. What the ticket calls the after-meeting skill is `arrival`, so the line went on
its "External consequences" bullet, the step where it drafts. Arrival drafts tickets and comments
and never pages, so it names Jira only. The weekly update names Confluence, on the team-page step in
"Produce", which is the one thing it drafts upstream. Both lines say "when the workspace has one".
Mirrored into `vault-dev/skills/arrival/SKILL.md` and `vault-dev/skills/weekly-update/SKILL.md`;
`defaults-sync.test.ts` is what keeps the two copies saying the same thing.

Nothing enforces any of it. There is no `get_conventions`, nothing reads the file for the model, and
nothing checks a draft against it. Neither file exists in a fresh workspace, so a line that read as a
requirement would send every first draft looking for a file that is not there.

Two tests. `packages/agent/test/tools.test.ts` checks that each tool names its own conventions file,
names no other one (the wrong file on the wrong tool sends every ticket rule to the wiki), and says
"if it exists". `packages/sessions/test/sessions.test.ts` checks the same for the two skill bodies.

---

## CV-3. Standing instructions route to the right owner

**Today:** `propose_instruction` resolves `target` through the `resolveSkill` candidates and
falls back to `house-rules` ("Your rules" heading) when the target is missing or unresolvable.
So "always set the `roadmap` label on tickets" said in chat today becomes a house rule that rides
in EVERY session prompt, which is the wrong altitude for a rule only ticket drafting needs.

**Proposal:**

- The prompting paragraph for `propose_instruction` names the conventions skills as candidate
  owners: a rule about drafting tickets targets `jira`, a rule about pages targets `confluence`.
- A named conventions target that does not exist yet is created by the card instead of falling
  back to house-rules: the existing `kind: 'note'` fallback path already does exactly this for
  the catch-all, so it is the same card pointed at the CV-1 template with the rule appended. The
  card's body line says where it lands ("Goes into How we use Jira.").
- Rules with no clear owner keep falling back to house-rules, unchanged.

**Decision:** Implement as proposed (Erik, 2026-08-31)

**Notes:** Built 2026-08-31 in `packages/agent`. The `propose_instruction` paragraph in
`SHARED_PREAMBLE` (`src/prompts.ts`) now says a rule about drafting tickets or ticket comments is
owned by `jira` and one about pages by `confluence`, and that the proposal writes the file when it
does not exist. The tool's own description and its `target` parameter say the same, because that is
what the model reads at call time.

In `src/tools.ts` the resolve step gained one branch: a `target` that resolves to nothing but IS a
conventions name takes the template instead of the house rules. The creation card is the path that
already existed for house-rules, pointed at whichever template applies, so the frontmatter, the
`Remember this: ...` headline, the rationale and the receipt are unchanged in shape. The rationale
reads "Goes into How we use Jira." The append path, the dedupe and the evidence rules are untouched:
an existing conventions file takes a bare bullet, because the template's last heading is the anchor.

One thing the model gets wrong that the code now absorbs: it writes the target from the prose it was
given, where the system is called Jira. `conventionsSkill` folds the case and hands back the
canonical name, and the name is resolved before the file is read, so "Jira" reaches
`skills/jira/SKILL.md` instead of writing a second file beside it.

Seven tests in `test/instructions.test.ts`: creation for each of the two files, the append into an
existing one, the rule already there, a second card for the same missing file, the folded name, and
a name that is not a conventions skill still falling back to the house rules. 262 agent tests and 49
sessions tests pass; every package suite is green (1032 pass, 0 fail, 10 skipped in @qale/vault as
before), plus `pnpm check-types` and `pnpm lint`. Not run live, so the
card as drawn in the Inbox is unverified.

One pre-existing copy line to know about: the effect line for any instruction card says "Adds the
rule to Jira. Every session reads it from now on." The second sentence was already wrong for a rule
landing in a skill, and it is wrong here too. It belongs to the card copy work, not to this ticket.
Fixed there 2026-08-31: a card pointed at either conventions skill now reads "Adds the rule to How we
use Jira. Read whenever it drafts for Jira.", composed in `vaultEffect`
(`packages/domain/src/proposals/card-copy.ts`) from the path alone, with the house-rules sentence
left as it was.

---

## CV-4. The debrief observes, the PM confirms

**Today:** the first-look debrief reads the whole index and speaks about epics, tickets, pages,
the calendar and where sources agree. It never looks at how the team uses the tools, and nothing
else ever will: conventions have no other discovery moment, and nobody sits down to author a
conventions file from scratch.

**Proposal:** one more beat in the debrief's second half, after the picture and before the seed
card. Bounded and hypothesis-first:

- The session may surface at most two or three observed conventions, and only strong patterns:
  a label or component on the clear majority of recent tickets, one space holding all the spec
  pages, one project taking all the bugs. Weak patterns are not raised; a wrong convention
  repeats on every draft, so the bar is higher than for the picture's hypotheses.
- Each is a question with the evidence in it: "Most NORD tickets carry `team-checkout`. Should I
  do the same when I draft?" Yes becomes a proposal card that creates or appends the conventions
  skill (CV-1's template on first use), citing the observation. No and silence both mean nothing
  lands, and a no is not raised again for that pattern.
- With no connection, or an index too thin to show a pattern, the beat says nothing at all.

Same session, no new machinery: `ask_user` for the question, `propose_note` or the update card
for the write, both existing. The skill copy is the whole change.

**Decision:** Implement as proposed (Erik, 2026-08-31)

**Notes:** Built 2026-08-31, copy only, in `TELL_QALE_SKILL`'s `## First look` section. The new beat
sits between the debrief and the already-told branch, as "**Beat three: how they use the tools.**",
and the section's opening line now says three beats instead of two.

The bar is written where it bites rather than as a preamble: "Only strong ones. A confirmed
convention repeats on every draft from then on, so a wrong one is expensive and a weak pattern is
left out." Then the shape of the question, with the evidence inside it, and the two silences: "No and
silence both mean nothing lands, and a no is never raised again." Last line of the beat is the exit:
"With no connection, or nothing that strong in what you read, say nothing here."

A yes is one `propose_instruction` call with `target` set to `jira` or `confluence`. That is the
whole write path, because CV-3 already made that target create the file from CV-1's template on first
use. No new tool, no new card, and no code changed for this ticket.

One deviation from the doc, and it is what the brief asked for: the already-told branch runs beat
three too. A workspace that has been told about the product still has no conventions file, so that
paragraph now reads "beats two and three are the whole session" and sends them through beat three's
questions before the seed card. Everything else in the section is untouched: the heading name the
kickoff points at, the one parked question in beat one, "write nothing, propose nothing", the
citations, and "never read the debrief back into a note".

Four assertions added to the existing first-look test in `packages/sessions/test/sessions.test.ts`:
the beat's heading, `propose_instruction` as the route, "Only strong ones", and the two silences. What
a test cannot reach is whether the model holds the bar, so the beat is unverified in the way every
debrief is: it needs a live site, a live key and somebody to answer.

**Superseded 2026-09-02 by CV-6.** Beat three is cut. Conventions are written up when the
connection is made, from the same read, whether or not the PM wants a walkthrough. `## First look`
is two beats again, and the section now says never to ask about conventions one rule at a time.

---

## CV-5. The demo vault shows it working

**Today:** `vault-dev` has no conventions skills, and the seeded Atlassian demo site
(`pnpm reset-atlassian`) has no house shape a debrief could observe.

**Proposal:** `vault-dev/skills/jira/SKILL.md` and `vault-dev/skills/confluence/SKILL.md` filled
with two or three Tavla-flavored rules each (a label Nordkap insists on, specs living in one
space), so the Skills page and a demo draft both show the feature. If cheap, give the seeded
demo site the matching shape (the label actually on most seeded tickets) so a live demo of CV-4
has something true to observe. The demo copy follows the same plain-language rules as everything
else in `vault-dev`.

**Decision:** Implement as proposed (Erik, 2026-08-31)

**Notes:** Built 2026-08-31. Two demo files and one label on the seeded site.

`vault-dev/skills/jira/SKILL.md` and `vault-dev/skills/confluence/SKILL.md` keep the template's
frontmatter, its top explainer line, its headings and the Standing instructions anchor. Everything
under a heading is Tavla's, so the Skills page shows a filled file rather than the example lines.

Jira, when you draft a ticket: "File it in PAY. It is the only project this team works in.", "Give
it one area label: `enterprise-auth`, `reporting` or `reliability`. One label, never two.", "If the
work comes from one customer, name them in the first line of the description." When you comment:
"Say what changed and what happens next. The ticket already says what the work is.", "Put a date on
anything that is expected, and name who owes it." One standing instruction: "Keep acceptance
criteria to three checkboxes. If it needs more, it is two tickets."

Confluence, when you update a page: "Product pages live in the Product space. Never propose a page
in another space.", "Edit under the headings the page already has. Never add a section at the
bottom.", "The weekly update goes on the Product weekly update page, newest week first, with the
week's dates in the opening line." One standing instruction: "Write every date in full on a page
(2026-07-28). 'Next Friday' is wrong a week later."

Every rule is true of the scenario as it stands, which is the point: all six ticket mirrors are in
PAY and carry exactly one of those three tags, the descriptions name Nordkap and Kranelund where
the work came from them, both pages are in the Product space, and the weekly update page opens on
its week line. A rule the demo vault contradicts would read as a bug in the feature.

The site seed got the shape. `scripts/reset-atlassian.ts` gained a required `label` on `CastIssue`
and one value per cast member, matching the `tags` on the static mirror, so the label rule is true
on the live site too. `listProjectIssues` now reads `labels`, `createIssue` sets it, and the
converge step builds one patch object out of the description and the label and sends it only when
it holds something. That keeps the rule the file already had: never write to a clean issue, because
a gratuitous write bumps `updated` and stales every pending card.

Two test edits in `packages/sessions/test/defaults-sync.test.ts`. The demo-only sweep names both
files, with the reason: nothing seeds them, and the demo copies hold Tavla's rules, so a
word-for-word comparison would be wrong. In its place, a new test checks what must not drift: each
demo file has the same title and the same headings in the same order as its template, and is not
still the template.

`scripts/refresh-demo.ts` needed nothing. It copies the source tree whole (only `sessions/` is
filtered), so both files reach `.vault-dev`; a dry run validates 95 notes with every wikilink
resolving.

Tested: 1036 tests pass across the eight packages, 0 fail, 10 skipped in `@qale/vault` as before,
plus `pnpm check-types` and `pnpm lint`. The seed script is outside the type-check projects, so it
was checked on its own against the same compiler options, clean. `pnpm reset-atlassian` was NOT run,
so the label converge path is unverified against a live site, and neither demo file has been seen in
the app.

---

## CV-6. The write-up happens on connect (E-25)

**Today, before this ticket:** every feeder needed the PM to speak first. `propose_instruction`
takes a rule they state in a chat. The debrief's beat three asks two or three yes/no questions,
and only if they answered the knock with "yes, walk me through it". Say "not now" and the
workspace never learns anything about how the team writes a ticket. Worse, a rule confirmed that
way lands silently, because the write policy applies a rule file with no card (E-8), so nobody
ever reads what was recorded.

**Change:** a connection's first read is the moment. It is the one time the evidence is all
there and nothing has been written yet, so the run reads a sample of what arrived and writes up
how this team writes a ticket and a page: the title shape, what the description holds, the tone,
where things get filed, whatever repeats. One proposal per system. The proposal is how it asks.

**Decision:** Implement as proposed (Erik, 2026-09-02, docs/easier-tickets.md E-25)

**Notes:** Built 2026-09-02 in `apps/desktop/src/main/services/sync-service.ts`, as part of the
kickoff the first look already fires (`firstLookInstruction`). Three pieces:

- `FirstLookRead.containers[]` gained `provider`, taken from the connector's own `providers` map.
  That is what says which conventions file a container's items belong in, so a second tracker
  writes its own file instead of writing into Jira's.
- `conventionsJobs` turns those into one job per system. It quotes the path, the title, the
  summary and the `##` headings out of the shipped template rather than typing them again, so
  renaming a heading in `defaults.ts` cannot leave the kickoff pointing at the old one. A
  container that is empty, one the connector mirrors nowhere, and a calendar all drop out, so a
  Google-only first look says nothing about conventions.
- `conventionsBlock` is the instruction. It says to do this before the knock and whether or not
  they want a walkthrough, names beat one's "propose nothing" as the one thing this overrides,
  and ends on "never ask about conventions one rule at a time".

**Why the kickoff and not the skill.** This file's earlier tickets put behaviour in skill prose
on purpose, and CV-4 put beat three in `TELL_QALE_SKILL`. This job goes the other way, for one
reason: it is not the interview. It runs whether or not the PM wants a walkthrough, it ends in a
file rather than in a conversation, and only the caller knows a connection has just arrived with
nothing written about it. What the PM reads and edits is still prose in a file they own; it is
the conventions file itself.

**Three things this needs and does not have.** None of them are in this workstream's files:

1. **The card.** `writePolicy` in `packages/domain/src/proposals/policy.ts` applies any `skill`
   or `agent` file silently. That rule is right for E-8, where the PM stated the rule in a chat,
   and wrong here, where the agent inferred a whole file from reading their Jira with nobody
   watching. The reason string it prints, "You said it should hold from now on", is simply false
   for this write. The fix is one line: a rule file applies silently only when `asked` is set,
   which every chat-stated rule already sets through `chatIsTheSource`. Until it lands the
   write-up applies without a card, which E-25 asks for the opposite of.
2. **Sonnet.** E-25 wants the read on the quick model, and the first look pins none: FD-2 left it
   open so the interview does not get stuck on the background model when the PM answers. That is
   still right for the interview and wrong for this read, and splitting them means a second
   session fired from `handlers.ts`, pinned to `BACKGROUND_MODEL_ID`.
3. **Labels.** `JiraIssue` in `packages/atlassian` carries no labels and no issue type, and
   neither does the shallow mirror, so nothing in the read path can see them. Beat three's own
   example ("most NORD tickets carry `team-checkout`") is the one thing the model cannot check.
   It needs `labels` and `issueType` on `JiraIssue`, both in the `fields=` list, and one line
   each in `atlassianReadTools`.

**And one thing to cut.** Beat three of `## First look` in `TELL_QALE_SKILL` asked about
conventions one rule at a time, which is what the write-up replaces. **Cut 2026-09-02.**
`## First look` is two beats, and the paragraph in its place says never to ask about conventions
one rule at a time. The kickoff's own sentence still holds and needed no change.

---

## Not doing

- **No per-container conventions in v1.** One skill per system. "NORD wants X but PLAT wants Y"
  can be a bullet inside the skill ("In PLAT, ..."), which costs nothing; per-container files
  can come when a real workspace needs them.
- **No settings surface.** The skill file is the surface, same as every other skill.
- **No validation or enforcement.** Conventions are read, not checked. The approval card is
  where a bad draft dies.
- **No silent mining.** The agent never writes a convention it inferred. CV-4's confirm is the
  only door in from a source.
- **No config mirroring.** The skill holds the team's preferences, not a copy of the Jira
  field configuration. The sync index already knows what exists; the skill records what the
  team wants done with it.
- **No new tools.** `propose_instruction`, `ask_user`, the note and update cards, and the
  existing read tools carry all of it.

---

## Order

CV-1 and CV-2 together (the template and the reads are one feature; neither is useful alone).
CV-3 next, small, mostly prompt copy plus pointing the existing creation fallback at the
template. CV-4 after those, since its yes-card writes what CV-1 defines. CV-5 whenever, but
before the next demo.
