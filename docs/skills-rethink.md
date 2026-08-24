# Rethinking skills

A brainstorm, not a plan. Each idea ends with an **Erik:** line. Write your
take there, including "no".

## What exists today

The Skills view has three shelves, derived from `starts:`:

| Shelf                                         | Files                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Playbooks (`you-run-it`, `model-picks-it-up`) | arrival, commitment-check, learn-the-product, process-note, synthesis, weekly-update     |
| Always on (`always`)                          | _filing-rules, _language, _your-rules, _understanding, _unattended, voice-exec, voice-cs |
| Reference (`read-when-relevant`)              | discovery-guide                                                                          |

Agents (librarian, meeting-prep) live on their own page and start themselves.

The problems, as you put them:

- "Always on" is a shelf, not a meaning. Seven very different files sit under
  it: real house rules, two voices that only matter when drafting, a knowledge
  file, and our own agent plumbing.
- The voices are always-on skills with an `audience:` scope. That is wiring,
  not a concept a PM has.
- "Product understanding" gives no value as a standalone skill.
- Skills are the main way a user makes the product theirs, and the current
  shelves don't invite that.

## Idea 1: four kinds, each with its own home

Stop sorting by what _starts_ a file. Sort by what the thing _is_ to the PM.

1. **Moments.** Work the product does at a defined point: new material
   arrives, a meeting is coming up, a commitment slips, the librarian ticks.
   The PM never "runs" these. They should not sit in a generic list at all.
   Show each one attached to its moment: "When material arrives → Handle new
   material". Today: arrival, meeting-prep, commitment-check, librarian.
2. **Requests.** Work the PM asks for: weekly update, find the pattern, tidy
   a note. These keep the composer picker and the model pickup. No slash
   commands, ever. Surfaced as chips where they apply (the Home composer
   already does this) and as buttons in context (a stack of interviews shows
   "Find the pattern").
3. **House rules.** One document, the CLAUDE.md equivalent. See idea 2.
4. **Voices.** Not skills. A separate concept bound to drafting. See idea 3.

Reference material (discovery-guide) stays, but maybe it belongs in the
memory as material, not on a skills page. A guide the agent reads is closer
to a note than to a skill.

The pages this implies: **Moments** (or fold into the Agents page, which is
already "what starts itself"), **Skills** (requests only, now a clean list of
verbs), **House rules** (one door in settings or the sidebar), **Voices**
(with the drafting surface, idea 3).

**Erik:** Yes really like this but i think we can have a single page called "Skills" but seperate them similar to how we have tabs in settings.
THe most important ones are (in order) Skills, house rules, Moments, Voices

## Idea 2: one house-rules document

Merge `_language`, `_filing-rules`, and `_your-rules` into one file with
sections. Call it something a PM would say: "How Qale works for you", "Ground
rules", "Your rules". It is the one file that is always in the prompt, and
the one file "remember to always..." appends to (propose_instruction already
targets `_your-rules`; it would target a section instead).

Why one file: today a user who wants to change the language has to know which
of five underscore files owns it. One document with headings (Language,
Filing, Your rules) is legible, and it is exactly the CLAUDE.md shape you
like: short, always loaded, owned by the user.

What I would keep separate:

- `_unattended` is our agent plumbing wearing a skill costume. The user never
  wrote it and should never edit it. Move its text into the code-owned
  preamble and delete the file. If we want it inspectable, show it read-only
  on the Agents page.
- The voices leave this category entirely (idea 3).

The cost: `shipped-versions.ts` upgrades shipped skills file by file. One
merged file that the user edits freely is harder to upgrade without stepping
on their edits. Options: (a) we stop shipping updates to it after seeding,
it's theirs; (b) sections keep stable heading anchors and we only ever
propose section updates as cards, never overwrite. I lean (a) for the user's
rules and (b) for filing rules, which encode product behaviour.

**Erik:** yes this sounds good. I think we can REMOVE the whole shipped version thing for now. clean up the code. We don't have any users and we will implement something else to handle this agentically in the future.

## Idea 3: voices live where drafting lives

A voice is only real at the moment text leaves the workspace. So attach
voices to the drafting surface, not to the session prompt.

Concretely:

- A **Voices** page (or section): one card per audience. Who they are, what
  they care about, how to sound. Exec and CS ship as examples; the user adds
  "Sara (CTO)", "the board", "support team". Each is still a small file.
- When a session drafts outbound text, the draft card grows into the UI in
  your screenshot: variant tabs across the top, the draft below, Copy and
  Open in Mail at the bottom. Tabs could be per-voice ("Exec / CS") when the
  audience is ambiguous, or per-treatment ("Short / Shorter / Warmer") when
  the audience is known. The weekly update becomes one card with a tab per
  audience instead of N cards.
- The runtime change is small: `alwaysOnGuides` stops injecting voices
  everywhere; instead `draft_message` (and the outbound tools) resolve the
  voice file for the named audience and apply it at draft time.

The learning loop, which is where "make it theirs" gets real: when the user
edits a draft or asks for a change ("shorter", "never say leverage"), offer a
quiet card: "Save to Exec voice?" Approved corrections accumulate in the
voice file. This is the same standing-instructions machinery pointed at
voices.

Open question: is a voice per **audience** (exec, CS, Sara) or per **format**
(email, Jira comment, weekly update)? I think audience is the identity and
format is a modifier, but a real user will have "how I write Jira comments"
opinions too.

**Erik:** Yes nice, but we can skip the learning loop. And to answer the open question, it can be both or whatever the user wants. If they want a "jira voice" thats fine

## Idea 4: product understanding is knowledge, not a skill

`_understanding` is a document about the product that happens to be injected
into every prompt. It is memory content. Move it into the memory as the
product orientation note (OKF already has index.md orientation files) and
take it off the skills page.

`learn-the-product` (the interview) stays, but as the way to _fill_ that
note, reached from the note itself ("This page is thin. Want me to interview
you?") and from onboarding. It stops being a thing you'd browse to on a
skills page. This also matches docs/product-understanding.md, which already
points this direction.

**Erik:** yea sounds good

## Idea 5: moments the user can extend

If moments are first-class, the natural extension point is: "when X happens,
also do Y". The user writes a small skill and attaches it to a moment. "When
material arrives, also check it against the roadmap." "Before a meeting,
also pull the account's open tickets."

This is the hooks idea, in product clothes. It is also the strongest version
of "make it THEIRS": not just editing our playbooks but adding steps to the
product's own reflexes.

Scope risk: this is a platform feature and we are pre-beta. The cheap v1 is
that each moment's playbook is an editable file (already true) and the user
appends steps to it, with the moment page making that obvious. The attach-a-
separate-skill version can wait.

**Erik:** skip for now. we only have hard coded "momeny skills" that they can edit for now.

## Idea 6: creating a skill starts from what it's for

"New skill" today gives you a name box and an empty file with frontmatter.
Nobody who isn't us can fill that in. Instead the flow asks one question:
what should it do?

- "Something I'll ask for" → a request, seeded with the verb-title pattern.
- "A rule Qale always follows" → appends to house rules, no new file.
- "How I sound to someone" → a new voice card.
- "Do more at a moment" → opens the moment's playbook (idea 5's cheap v1).

The librarian drafts the body from a sentence the user types. The user never
sees `starts:` or `can:`; the flow writes them. The frontmatter stays as the
file format, it just stops being the interface.

**Erik:** yes sounds good

## What I'd cut or rename

- The "Always on" shelf. Gone once ideas 2 and 3 land; nothing is left on it.
- The underscore prefix. It signals "system file" to us and nothing to a
  user. House rules get a real home; the rest get real categories.
- "Skills" as the page name may survive for requests only. "Playbooks" also
  works. Whatever we pick, one word, used everywhere.

**Erik:** yes, yes and se previous comment from beginning of doc. "Skills" is the preferred name

## Open questions

1. Do moments live on the Agents page (rename it "What Qale does on its
   own") or as their own page? Two pages about self-starting work is one too
   many.
2. Does the drafting card with tabs live only in sessions, or is it a
   surface other views can open ("draft a reply to this")?
3. When the user disables a moment's skill (arrival off), what does the
   product visibly stop doing, and where do we say that?
4. Do shipped requests (weekly update, synthesis) stay upgradeable after the
   user edits them, or does the first edit fork them for good?

**Erik:**

1. No it lives under skills, but we can move Agents into the same "skills" setting page
2. Not sure what other views could use this? Primarily in sessions
3. the user shouldnt be able to disable a moment skill
4. we will handle this later. right now its Out of scope

---

# Round 2

## Decided in round 1

- One page called **Skills**, with tabs like Settings. Order: Skills, House
  rules, Moments, Voices. The Agents page folds in.
- House rules become one document. The shipped-versions machinery is deleted,
  not reworked. Upgrades come back later, agentically.
- Voices apply at draft time. No learning loop for now. A voice is whatever
  the user wants it to be: an audience, a format, a person.
- `_understanding` moves to the memory as the product orientation note.
  `learn-the-product` fills it, reached from the note and onboarding.
- Moments are hard-coded, editable, and cannot be switched off.
- "New skill" starts from what it's for. Users never see frontmatter keys.
- The draft card with tabs lives in sessions.

## R2-1: the Moments tab is the old Agents page, plus more

If librarian and meeting-prep sit on the Moments tab next to arrival and
commitment-check, the skills-vs-agents split stops being a thing the user
sees. Every row reads the same way: "When material arrives → Handle new
material", "Every few hours → Librarian tidies the memory", "Before a
meeting → Prep brief". The trigger text comes from code, so it cannot lie.

The `skills/` vs `agents/` folder split stays on disk (it is filing, and the
roster is hard-coded anyway), but no UI mentions it again.

**Erik:** No, Moments and Agents will be seperate because the simple reason that Agents should be able to be shut off. Moments will not.

## R2-2: `starts:` mostly dies

Follow the decisions through and almost nothing needs `starts:` anymore:

- `always` → gone. House rules are one known file the runtime always loads.
  Voices load at draft time. No user file can declare itself always-on.
- Moments → hard-coded roster, so their files need no start either.
- What remains: a user skill is either a playbook (run it, or the model
  picks it up; today's default) or reference material the agent reads when
  relevant.

So the frontmatter a skill can carry shrinks to roughly: `title`, `summary`,
`scenarios`, `can`, and one boolean-ish thing for "this is reference, not a
playbook". The `audience:` key retires with the voices.

Where do voices live on disk? I'd give them their own folder, `voices/`,
beside `skills/`. Folder = category, visible in git, no `type:` key to get
wrong.

**Erik:** sounds good

## R2-3: the house-rules file, concretely

- Address: `skills/house-rules/SKILL.md` (the Skills page owns it, and the
  session engine already reads that tree). Title: "House rules".
- Body: three headings. **Language**, **Filing**, **Your rules**. The first
  two seed from today's `_language` and `_filing-rules`. The third seeds
  empty.
- `propose_instruction` appends bullets under **Your rules** instead of
  writing to `_your-rules`.
- The House rules tab shows this one document, editable in place. No list,
  no rows.
- `_unattended` text moves into the code-owned agent preamble and the file
  is deleted.

**Erik:** yes

## R2-4: how a draft picks its voice, and what the card shows

- `draft_message` gets a `voice` parameter naming a voice file. The tool
  description lists the current roster, so the model knows what exists. No
  matching voice: draft plain, never invent one.
- The card: tabs across the top, draft below, Copy and Open in Mail at the
  bottom. For the weekly update, one card with a tab per voice replaces
  today's N cards.
- Your screenshot's tabs are treatments ("Ask, short / Ask, shorter") of one
  message. Do we want that in v1: the model always drafts two takes per
  outbound message so there is something to choose between? It costs a
  little latency and makes the card feel like the screenshot. Or v1 is one
  take per tab and treatments come later.
- Open in Mail is a `mailto:` handoff. Drafts bound for Jira or Confluence
  already have their own outbound path and keep it.

**Erik:** We can skip the Open in mail for now. The draft message shuold take two parameters , voice and something like alternatives. Voice can be "Exec" and alternatives could be set by the agentt to be "short" and "shorter"etc
The user should be able to switch the "Voice" and alternatives, but i'm not sure which one makes more sense considereing the technical implementation. Either they have to ask in chat "Pleae write it using this voice instead" or they can click a drop down to select something else, then it regenereates. etc. Would be nice if they could also prompt "make it shorter" and it adds alternative instead of creating a new box etc
also think about how we can have clean code and UI/UX to handle drafting so it's similar for JIRA and some random slack message etc (where we only have "copy")

## R2-5: what keeps an off switch

Moments lose theirs (decided). For the rest I'd keep it minimal: a skill or
voice the user does not want gets deleted, and the New-skill flow makes
recreating one cheap. The `enabled` toggle machinery goes away with the
shelf it served. If deleting feels too final we keep the switch on the
Skills tab only.

**Erik:** only agents should have enabled i thnk

## The cleanup list this adds up to

Work items, once the round-2 answers land. Not for this doc to sequence.

- Delete: `shipped-versions.ts`, `skill-pack.ts`, `SkillPackReview`, their
  IPC surface and tests.
- Delete: `_unattended` (into the preamble), `_understanding` (into the
  memory), `_your-rules`, `_language`, `_filing-rules` (into house rules),
  `voice-exec`/`voice-cs` (into `voices/`).
- Retire frontmatter: `starts: [always]`, `audience:`, probably `enabled:`.
- Rebuild SkillsView as the tabbed page; remove the Agents page; new-skill
  four-way flow.
- `draft_message` voice parameter; the tabbed draft card in SessionView.
- Update `broken-demo` so it still demonstrates a visible config error in
  the new vocabulary.
- Re-seed `defaults.ts` and `vault-dev/` together (they must move together).

**Erik:** yes

---

# Round 3

## Decided in round 2

- Moments and Agents are separate tabs, because Agents can be shut off and
  Moments cannot. Only agents keep `enabled:`.
- `starts: [always]` and `audience:` die. Voices get a `voices/` folder.
- House rules: `skills/house-rules/SKILL.md`, three headings, edited in
  place. `_unattended` moves into the code preamble.
- No Open in Mail for now. `draft_message` takes `voice` and agent-set
  `alternatives` ("short", "shorter"). The user can switch both.
- The cleanup list stands.

## R3-1: the full tab roster, every file placed

Five tabs: **Skills, House rules, Moments, Voices, Agents**.

| Tab         | Contents                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Skills      | weekly-update, synthesis, process-note, plus everything the user creates                             |
| House rules | the one document                                                                                     |
| Moments     | arrival ("When material arrives"), commitment-check ("When a commitment slips and you ask for help") |
| Voices      | exec, cs, whatever the user adds                                                                     |
| Agents      | librarian, meeting-prep, with their clocks and the only off switches                                 |

The split rule is simple to say: an agent runs on a clock and can be shut
off; a moment fires when something happens in the product and cannot.

One file has no obvious home: `learn-the-product`. You decided it stops
being browsable as a skill and is reached from the product note and
onboarding. But the file must live somewhere legible. I'd put it on the
Moments tab with the trigger text "When the product page is thin, or from
onboarding". Alternative: it stays a normal skill on the Skills tab and we
just also link it from those places.

**Erik:**
Not really sure because this is mostly a "one off" thing done in onboarding. Any ideas? i dont see how this will be run twice.

## R3-2: the draft card, mechanics

One tool call carries the whole card:

```
draft_message({
  voice: "exec",              // a file in voices/, or absent for plain
  subject?: "...",
  alternatives: [{ label: "Short", body: "..." }, { label: "Shorter", body: "..." }],
})
```

Tabs render the alternatives. The card keeps an id.

Follow-ups reuse the card instead of stacking new boxes: `draft_message`
gets an optional `card` parameter. When the agent passes the id of an
existing card, the call updates it: new alternatives append as tabs, a new
voice replaces the set. So "make it shorter" in chat becomes one more tab on
the same card, which is the behaviour you asked for.

Switching voice or asking for a new alternative: I'd make everything go
through the session, one code path. The dropdown on the card is sugar: pick
"CS" and it sends a canned message into the chat ("Redraft this in the CS
voice"), the agent answers by updating the card. No second regeneration
engine beside the session loop, no card that can change without the
transcript showing why. v1 can even ship without the dropdown, chat only,
and the dropdown lands later without new machinery.

**Erik:** sound good

## R3-3: one draft concept for every destination

The thing that varies is the transport, not the card. So: one `DraftCard`
component that renders voice, tabs, body, and a footer the destination
decides.

- No destination (a Slack message, an answer to paste anywhere): Copy only.
- Jira comment, Confluence page, calendar event: the existing outbound
  approval flow IS the footer action ("Send to Jira"), same payload path as
  today. The card around it is the same component.
- Email: Copy now; a mail handoff is one more footer button later.

Voice resolution lives in one place, the drafting tools, so a Jira comment
can be drafted in the CS voice exactly like a weekly update can. Whether
outbound drafts also get alternatives in v1: I'd say no, keep alternatives
for copy-transport drafts first, and add them to outbound once the card has
settled.

**Erik:** Not sure what you mean and I'm a bit confused. The draft message with "Copy" is different from a card that propses an edit to jira? I think we shuold have a voice for jira but probably don't need multiple version of it. Only when we are writing messages on slack, email or something like that do we want alrtneraitve?

## R3-4: kill `starts:` completely

Round 2 left one survivor: `read-when-relevant`, worn only by
discovery-guide. Move discovery-guide into the memory as material (it is a
guide the agent reads, which is a note) and the whole `starts:` key is gone.
A skill file's frontmatter becomes exactly: `title`, `summary`, `scenarios`,
`can`. Nothing else to document, nothing to get wrong, and `broken-demo`
demonstrates a typo in one of those four.

**Erik:** yes sounds good.

## R3-5: tabs are alternatives, so the weekly update is per-voice cards again

A correction to round 1. I said the weekly update becomes one card with a
tab per audience. Your `draft_message(voice, alternatives)` shape gives tabs
a different meaning: alternatives of ONE message, in one voice. Two tab
dimensions cannot share one row, so the weekly update goes back to one card
per audience (as today), each card with its own alternatives. I think that
is the better reading anyway: an exec update and a CS update are different
messages, not two takes on one.

**Erik:** yea a think that's a good take but lets continue brainstomring. Writing a message to an exec vs customer might not just be a differenec of tone, but what context is needed etc

---

# Round 4

## Decided in round 3

- Card mechanics as specced: one call carries voice + alternatives, a
  `card` parameter updates in place, the dropdown is a canned chat message,
  v1 can be chat-only.
- `starts:` dies completely. discovery-guide moves to the memory. Skill
  frontmatter = `title`, `summary`, `scenarios`, `can`.
- Weekly update: one card per voice, each with its own alternatives.

## R4-1: learn-the-product stops being a file you can find

You're right that nobody browses to an interview twice. But the _knowledge_
does go stale: the product ships things, positioning changes, a new area
appears. So the interview has two real entry points, and neither is a menu:

- **Onboarding** runs it once.
- **The product note itself** carries the door afterwards: a quiet line on
  the orientation note ("This page is thin on pricing. Want to tell me?"),
  and the librarian can offer the same when it notices staleness. That is
  an `offered` question, machinery we already have.

So: remove it from every tab. The interview instructions stop being a vault
file and become product-owned text (like onboarding copy), invoked by those
two doors. One less thing on the Skills page, and the reason it exists sits
where the user would actually feel the gap.

**Erik:** aight, int that case i think it shuold be its own skill but be more generic so it's not about the prdcut but about anything, like the pricing or onboarding flow etc.

## R4-2: two cards, not one (untangling R3-3)

My R3-3 overreached. Restated the way you put it:

- **A message draft** (Slack, email, anything a human pastes): the new
  tabbed card. Voice + alternatives + Copy. This is `draft_message`.
- **An outbound proposal** (Jira comment, Confluence edit, calendar event):
  today's approval card, unchanged. No tabs, no alternatives. One draft,
  approve or don't.

The only shared piece is voice resolution: one function the drafting tools
call, so an outbound Jira comment can be written in a "Jira" voice if the
user made one. No shared card component, no alternatives on outbound.
Simpler than what I wrote, and it matches what the two cards mean: a
message draft is "help me say this", an outbound proposal is "may I change
this system".

**Erik:** yea and i think there could be a flow of "message draft" -> "outbound proposal" in some cases

## R4-3: a voice is an audience brief, not a tone

Your exec-vs-customer point: the difference is what to include, not just
how to sound. An exec wants the decision and the number; a customer must
never see internal metrics or another customer's name. That is content
selection, and it belongs to the audience, once, instead of being
re-explained inside every skill that drafts.

So the voice file grows from a style note into a small brief. Template:

```
# Voice: <name>
Who reads this. ...
What they care about. ...
What they already know. ...   (so drafts stop re-explaining it)
Never include. ...            (confidentiality lives here)
How to sound. ...
```

Consequences:

- `weekly-update` slims down: today its body hand-carries per-audience
  guidance ("CS: what changes for customers and when"). That moves into the
  cs voice, where every other draft to CS also benefits from it. The skill
  keeps only the list of which voices to draft for, in its body, where the
  user can add "the board".
- Two drafts for two audiences are genuinely two messages built from the
  same facts, not one text restyled. Which confirms R3-5's per-voice cards.
- "Never include" is the quietly important line: it is the only place a
  confidentiality rule can live where every future draft to that audience
  inherits it.

Ship exec and cs rewritten into this template as the two examples. The
new-voice flow asks one question, "who is this for?", and seeds the
headings.

**Erik:** actually the voice should probably be more about the tone, language etc, but it shouldnt tell what to include in a weekly update to an exec. The weekly update SHOULD be telling us what to include for audiences.

---

# Round 5

## Decided in round 4

- The interview survives as its own skill, generalized beyond the product.
- Message draft → outbound proposal is a real flow in some cases.
- Voices carry tone and language. What to include per audience stays in the
  skill that drafts (weekly-update keeps its per-audience guidance).

## R5-1: the interview skill, generalized

`learn-the-product` becomes a generic skill on the Skills tab: the user
tells Qale about something, Qale asks until it has it, then writes it into
the memory. Title candidate: "Tell Qale about something" (or "Teach Qale").
Scenarios: "let me tell you about our pricing", "you don't seem to know how
onboarding works", "let me explain how the team is set up".

The old entry points survive as callers: onboarding runs it with the topic
"the product", and the thin-page door on the product note runs it with the
topic that is thin. Same skill, a topic handed in. The product-specific
interview questions in today's body become one example topic among several.

**Erik:** yes!

## R5-2: draft flows into outbound, through chat

The case: you draft a reply in a session, like it, and say "post that as a
comment on the ticket". No new UI. The agent takes the alternative you have
selected (the card knows its active tab) and calls the outbound tool with
that body. The outbound proposal card appears as usual, you approve, it
sends. The message card stays behind as the working copy.

The one mechanical need: the agent must know which tab the user selected.
So tab selection writes back to the session (a small state event), the same
way an ask_user answer does. Cheap, and it also makes "make the one I
picked shorter" work.

**Erik:** yes!

## R5-3: where does "never show customers internal metrics" live?

You cut content selection from voices, agreed. One narrow thing is left
homeless: the confidentiality guardrail. "Customers never see internal
metrics or other customers' names" is not what-to-include-in-an-update (the
skill's job) and not tone (the voice's job). It is an audience-bound
"never". Three homes:

- (a) One "Never" line allowed in a voice file. My pick: it is bound to the
  audience, and every draft in that voice inherits it, whatever skill drew
  it.
- (b) House rules. Global, but then it fires even in drafts where the
  audience differs.
- (c) Each skill repeats it. That is the duplication we just removed.

**Erik:** I think C for now. Might change in the future but I'm invoking KISS here

## The settled shape, once round 5 lands

For checking, not for re-opening. Correct anything that reads wrong.

- **One Skills page, five tabs**: Skills, House rules, Moments, Voices,
  Agents.
- **Skills tab**: weekly-update, synthesis, process-note, the generalized
  interview skill, and everything the user creates. Frontmatter is `title`,
  `summary`, `scenarios`, `can`. No toggles; delete is the off.
- **House rules tab**: one document (`skills/house-rules/SKILL.md`),
  headings Language / Filing / Your rules, always loaded,
  `propose_instruction` appends under Your rules.
- **Moments tab**: arrival and commitment-check, hard-coded triggers shown
  as "When X → Y", editable bodies, no off switch.
- **Voices tab**: files in `voices/`, tone and language only, applied at
  draft time by voice resolution shared across drafting tools. Exec and CS
  ship as examples.
- **Agents tab**: librarian and meeting-prep, their clocks, the only
  `enabled:` toggles.
- **Message drafts**: tabbed card (voice, alternatives, Copy), updated in
  place via a card id, all changes through the session. Can flow into an
  outbound proposal by chat.
- **Outbound proposals**: unchanged card, voice applies, no alternatives.
- **Deleted**: shipped-versions machinery, `starts:`, `audience:`,
  `enabled:` on non-agents, the five underscore files, the Agents page,
  the "Always on" shelf, the underscore convention.
- **Moved**: `_understanding` → memory orientation note. discovery-guide →
  memory material. `_unattended` → code-owned preamble.

**Erik:**
