# Arrival

Vision, 2026-07-30. The principles marked *product-wide* are meant to outlive this feature.

Written after a design conversation that started as "redesign the capture modal" and ended with the
conclusion that the modal is the wrong shape for the problem.

## Status

**The spine is built (2026-07-30).** What ships:

- **Add material** (`app/AddMaterial.tsx`) — a tray, not a classification form. Holds 1..N pieces of
  material, leads with a drop zone next to the native multi-select picker, and states one outcome
  for the whole batch. Replaces `CaptureDialog`, which is deleted.
- **Capture vs catch-up** (`application/use-cases/arrival.ts`) — the ambition is chosen from the
  material (≥5 items, or everything older than 21 days), stated on the tray with a one-click flip,
  and catch-up is simply `process: false` for every item: same filing, nothing run. That is what
  makes a forty-file backfill impossible to turn into two hundred todos.
- **A receipt only where the screen can't speak for itself** (`components/ArrivalReceipt.tsx`,
  `lib/arrival-outcome.ts`). Landing on the result IS the confirmation: for a single item the app
  opens the note or the review it just started, so no card appears at all. The receipt is for a
  batch (nothing opened, the outcome is a count), a failure, or a catch-up where the news is that
  nothing ran. Persistent when it does appear, never a toast, in a shared rail so an error can't
  cover it. **Undo is a batch affordance** — one document is deletable where it stands, and a
  second, weaker path to the same thing in a floating card is how you get two ways to delete a note
  and no clear one. It restores every path the batch touched, recorded by a `VaultPort` decorator so
  no capture use case had to learn about arrivals.
- **Drop anywhere** opens the same tray with the files already in it — the accelerator and the
  button are one behaviour.
- **Arrival never authors.** Everything added through this door is raw material in `sources/` —
  dropped files (`system: file`), pasted text (`system: paste`), links, screenshots. The only
  derived note an arrival creates is the meeting note for a transcript of a meeting the PO was in.
  `notes/` is the authored layer and is reachable only by writing one (⌘N): the workspace must
  never claim to have written something that was handed to it, because once the memory cites that
  claim it cannot be corrected. This is the §6 rule made structural.
- **The agent's work is a control, not a footnote.** The tray carries one switch naming the skill
  that will actually run and how many items it takes — *"Handle new material reviews all 2"* — and
  it flips both ways. It resolves through the same binding lookup that will dispatch it, so it
  cannot describe work that won't happen. Off reads *"Just file them"*, with the amber inference
  flag only where the system chose it rather than the PO.
- **Formats we can't read are refused, not guessed at.** `readableAs()` in the domain is the single
  predicate both the renderer and main use; a `.docx` decoded as UTF-8 was filing notes whose body
  began `PK` and ran for pages of mojibake.

**Not built, and deliberately so:** the Import room (folder picker, Obsidian overlay, Evernote
triage, the report), rules-by-promotion, and retrieval ranking for imported material. Catch-up is
the engine those sit on; §6 and §10 are still the brief for them.

---

## 1. Why this document

Everything the product knows arrives from somewhere. Today there is exactly one door — a modal that
takes one file at a time and asks the user to classify it in our vocabulary before anything happens.
That door works for one case (a transcript, right after the call) and fails every other one: fifty
transcripts, a folder of mixed material, an article the user wants read a particular way, a question
with evidence attached, or an existing note-taking system the user wants to move in from.

The failure isn't cosmetic. Arrival is where the memory either accretes or doesn't, and it's where a
new user decides whether this thing is worth their real material.

---

## 2. The person, and where material comes from

One product owner, adopting alone, working between meetings. Material reaches them from six
directions: their own recorded meetings, someone else's forwarded recording, documents people send
them, things they read, threads they paste, and thoughts they have.

What they need back out is narrower than what goes in: commitments that didn't get dropped, decisions
with a name attached, answers they can defend, and the feeling of not being behind.

The emotional state at the moment of arrival varies more than the material does, and it's the better
design signal:

| Situation | State | What they want |
|---|---|---|
| Just came out of a call | Rushing, holding something | To put it down and stop carrying it |
| Behind by weeks or months | Mild guilt | Absolution, without reliving it |
| Read something interesting | Curiosity, no stakes | For it not to be lost |
| Forwarded someone's recording | Obligation, low ownership | To know what's in it |
| Has a question, has the files | Impatient, investigative | An answer, not a filing outcome |
| Trying the product for real | Skeptical, protective | To see it work on *their* material |

Note that "correctly classified" appears nowhere on the right-hand side. Taxonomy is our concern that
we promoted into a user question.

---

## 3. The jobs

**Close the loop.** *When a meeting ends and I'm already late for the next one, I want to hand off
what I'm holding, so I can stop carrying it.* Done = the commitments are somewhere that will remind
me, and I didn't have to think about folders.

**Catch the memory up.** *When the memory doesn't know something everyone assumes it knows, I want to
pour in what I have, so it stops being behind.* Done = the pile is absorbed, I know roughly what came
of it, and I was not handed hundreds of small decisions to make.

**Move in.** *When I decide to try a tool for something as personal as my own thinking, I want to
bring my existing notes with me without losing their structure or my ability to leave, so I can judge
it against my real material instead of a demo.* Done = my stuff is here, it looks like my stuff, and
I can see exactly what was done to it.

**Get an answer.** *When someone asks me something I should be able to answer, I want to point at the
evidence and get an answer I can defend.* Done = an answer with citations. Whether the evidence got
filed is beside the point.

**Keep it for later.** *When I find something that might matter eventually, I want to keep it without
deciding why.* Done = it's findable later. Nothing else needed to happen.

**Teach it my way.** *When I have a way I like things handled, I don't want to re-explain it every
time.* Done = it keeps doing that, and I never had to open a config file.

**Learn to trust it.** *When the system did something on its own, I want to see what it did and take
it back, so I can decide how much rope to give it.* Done = I stopped checking.

That last one is the adoption job. It's not a feature; it's the precondition for every other job
being allowed to happen without a confirmation step.

---

## 4. Three relationships to material

Anything handed to the system is one of three things, and they want opposite treatment.

**A deposit.** "This belongs in the memory." Filing *is* the point; success is that it's there and
findable. The user has no opinion about what happens next and shouldn't need one.

**An errand.** "Do this with it." An action is the point and filing is a byproduct. The user has
specific intent — a skill they wrote, a prompt for this once — and today has nowhere to put it.

**A question.** "Answer this using these." An answer is the point; the material might not be worth
keeping at all.

A door that only models deposits is what makes the product feel rigid. The fix is not more chips —
it's letting the user say a sentence, and treating silence as a real answer.

---

## 5. Two ambitions: capture and catch-up

The instinct to split ingestion from import is right, but the line isn't volume. It's **what the
material can still cause.**

**Capture answers "what just happened?"** Per-item, forward-looking, about things that are still
live: this meeting produced these commitments, this decision, this contradiction with what we
believed. Fast, attentive, high stakes per item, many times a day.

**Catch-up answers "what do we already know?"** Cross-item, backward-looking, about structure rather
than actions: these forty meetings contain nine themes, four customers, a decision history, and the
fact that one customer has asked for the same thing four separate times. Slow, unattended, low stakes
per item and high stakes in aggregate, rare.

Drawn this way, one whole class of failure disappears by definition rather than by heuristic:
**catch-up is not permitted to create commitments or outbound drafts.** History has no live
commitments. It may *report* that six commitments were made and never closed — that's a finding, and
adopting them is one deliberate act — but it can't quietly mint two hundred todos.

It also means fifty transcripts from this week is capture at scale, while fifty from last year is
catch-up. Same machinery, different ambition.

In the interface these are **"capture"** and **"catch the memory up."** Nobody says "ingest."

---

## 6. Moving in

Catch-up has three flavours, and they are not variations — they're different jobs with different
failure modes. This matters most because moving in is the first thing a real user does.

**A transcript archive** — *"here are forty recordings."* No structure exists. The job is to
**create** structure: meetings, the people in them, the customers they concern, the decisions made,
the themes that recur. The failure mode is flooding the approval queue.

**A knowledge vault** — *"here's my Obsidian folder."* Structure already exists, the user authored it,
and it encodes their own vocabulary and habits. The job is the opposite one: **preserve and index,
don't reorganise.** Their folder names, tags, and link graph are the asset — arguably more valuable
than the prose, because the graph is the part they can't rebuild. The failure mode is arriving to
find your notes rearranged, or being shown a card "proposing" something you wrote down as fact three
years ago. Both destroy trust instantly and permanently.

For this flavour the right first move is an **overlay, not a migration**: leave every file where it
is, resolve the links, recognise the entities, and let the user opt into promoting parts of it into
typed notes as they turn out to matter. Their material starts as theirs and becomes ours only by
invitation.

**An everything dump** — *"here's my Evernote export."* Structure is nominal and most of the content
is sediment: web clippings, receipts, half-written notes, three copies of the same thing. The job is
to **separate signal from sediment and be honest about the ratio.** The failure mode here is the worst
of the three and the least visible: importing eighteen hundred web clippings degrades retrieval for
everything else, forever, and it degrades it silently. Nothing looks broken; the memory just gets
worse at answering. Imported-but-unvetted material has to be rankable *below* material that was
earned, or the import quietly poisons the product's core value.

Across all three, two things are non-negotiable. **Nothing the user wrote gets rewritten** — we add
alongside, never edit in place. And **the exit stays open**: plain markdown in a git repository they
own means import is reversible and export is a non-event. That property is the only honest answer to
"what if I want to leave," and it's what makes trying us with real material a reasonable risk instead
of a leap.

---

## 7. The shape we chose

**Material plus an optional instruction, behaving like nothing at all by default.**

- **Drop anything, any number, anywhere.** It lands immediately — versioned, unchanged, no model in
  the loop, no modal. Arrival never waits.
- **An optional sentence.** Empty means "you decide," and that's the common case. A sentence turns
  the drop into an errand or a question. A named skill of the user's own does the same thing more
  precisely.
- **A persistent, editable receipt instead of a dialog.** Not a modal to dismiss — a strip that says
  what is happening and lets you change it while it happens: *undo*, *not my meeting*, *just file
  it*, *add an instruction*. Ignore it and the right thing happens. Touch it and you've done
  everything the old modal did, in one click, without ever having been blocked.
- **The drop target carries intent, at no UI cost.** On the window: you decide. On a composer: I have
  something to say about this. On a customer or theme page: it belongs to this.
- **Everything runs in the background; watching is optional.** Then "is the user waiting?" never has
  to be inferred — it's just whether they kept the tab open.
- **Catch-up gets a room, not a dialog.** "Here's my archive" deserves to see what was found, watch
  it run, and get a report organised by what was learned rather than by files touched.
- **Ambiguity parks; it never blocks.** Anything the system can't place lands raw and unclaimed, and
  one question at the end covers the whole residue. During a batch it never stops to ask.
- **Rules are promoted, never authored.** After a run the user liked: *"always handle these this
  way."* That's how someone reaches power-user configuration without ever facing a blank rule editor.

What disappears: the type chips, the "someone else's meeting" checkbox, the "act on it" toggle. Each
was the system asking the user to fill in a field it could either infer or ask about later, and only
when the answer actually mattered.

---

## 8. Guiding principles

### Arrival

1. **Arrival is free.** Nothing the user hands us waits on a decision, a form, or a model. If we
   need to know something, we ask after the material is safe.
2. **Silence is an answer.** An empty field means "you decide," never "you forgot." *(product-wide:
   applies to every optional input we ship)*
3. **Ask only what only they know, and only when the answer changes what happens.** A question whose
   answer we could have inferred costs more than being occasionally wrong and correctable.
   *(product-wide)*
4. **Defer, don't block.** Ambiguity parks and batches. A system that stops five times to ask is
   worse than five separate dialogs, because you can't answer question four until it gets there.

### Trust

5. **Reversibility inside, permission outside.** Pre-approval is absolute for anything that leaves
   the machine — Jira, Confluence, Slack, email. Anything that stays in the user's own versioned
   directory gets legibility and one-click undo instead. Filing a file and posting to a stakeholder
   are not the same risk, and treating them the same is what made fifty files unusable. *(product-wide
   — this is a deliberate narrowing of "nothing writes without an approval card")*
6. **Undo has to be real.** One click, restores everything a run touched, no partial states. The
   whole design trades pre-approval for reversibility; if undo is approximate, the trade is a lie.
7. **The receipt is the interface.** For anything the system did on its own, the artifact that says
   what happened *is* the UI — not a log to go find. *(product-wide: sessions, scheduled runs, sync)*
8. **Never rewrite what the user authored.** Add alongside. This is what makes handing us a personal
   vault a reasonable act. *(product-wide)*
9. **Propose at the altitude of the finding, not the file.** Forty files should not produce forty
   cards. One finding that spans forty files produces one card. Approval fatigue destroys the value of
   the approvals that matter. *(product-wide)*

### Adoption

10. **Day-one value on their material, not our demo.** The product's promise is that the memory
    accretes — catch-up is the time machine that lets week one look like week six. It's an activation
    mechanism, not a bulk-convenience feature.
11. **Structure is earned, never manufactured.** No themes or insights invented from a single document
    on arrival, with nothing to weigh it against. *(product-wide: this is already the Synthesis
    skill's position; it should be everyone's)*
12. **History doesn't make commitments.** What arrives as past produces structure and findings, not
    todos and drafts.
13. **Imported material ranks below earned material** until something vouches for it. Otherwise a
    dump degrades retrieval for everything, silently.
14. **The exit stays open.** Plain markdown, git, no proprietary format. The files are theirs; we're a
    lens over them. *(product-wide — this is the foundation the rest of the trust story stands on)*

---

## 9. How we'll know we got it wrong

Signals to watch for, in rough order of how badly each one means we've failed:

- Someone's imported vault comes back reorganised, or a card proposes something they'd already
  written as fact.
- The user starts clicking through approval cards without reading them. At that point the gates
  protect nothing and cost everything.
- A catch-up run produces a queue nobody will ever empty.
- Search gets worse after an import, and nobody can say why.
- The user can't answer "what did it do to my stuff?" without reading a session transcript.
- Anything has to be configured before the first useful thing happens.
- There are two inboxes and the user has to keep both at zero.
- We're maintaining a classifier *and* a router, and neither is authoritative.

---

## 10. What this doesn't cover

Deliberately out of scope here, to be designed separately:

- **Automatic transcript delivery.** When a notetaker bot starts delivering recordings, the drop
  disappears as an input method entirely and the receipt and the report become the only surfaces.
  That's an argument for putting the intelligence in the pipeline rather than the drop UI, which this
  document assumes but does not specify.
- **The instruction ambiguity.** "Summarise these" over five interviews could mean five summaries or
  one synthesis. Genuinely ambiguous, genuinely different outcomes, and the phrasing usually tells
  you. Needs a real answer before errands ship.
- **Format adapters.** ENEX, Notion exports, Bear, Apple Notes. The principles above apply unchanged;
  the parsing does not.
