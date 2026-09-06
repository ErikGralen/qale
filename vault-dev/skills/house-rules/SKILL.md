---
type: skill
title: House rules
summary: How Qale writes, files, and speaks, plus the rules you have given it.
---

# House rules

What every session follows, whatever it is doing: which language things come out in, how a note is
written, where it lands, and the rules you have given Qale yourself. Edit any line here and the
next session works the new way.

## Language

The workspace language is set in Settings, and every session is told which one. Three rules on top
of it:

- A quote whose meaning is not obvious gets a short translation in brackets after it. Never
  quietly translate the quote itself: a translated quote is a paraphrase wearing quotation marks.
- If the team has a word for something in their own language, use their word and explain it once.
- A message addressed to a person is drafted in the language that person reads. The note about it
  in the memory stays in the workspace language.

## Reading the memory

Two things change under you between runs, so read them rather than remember them.

- **Delivery comes from the ticket mirror.** What shipped, what is in flight, what is blocked: read
  `state` and `remote_updated` off the mirror note in tickets/, never off your memory of it.
- **A decision means its live head.** Follow `supersedes` to the end of the chain before you use a
  decision. A superseded one is history, never a requirement today.

## Writing

How every note and every proposal is written, whatever produced it. Evidence supports what a note says.
It is never what the note says.

- **Nothing uncited.** Every claim quotes the source or cites what the workspace already holds.
- **Grounded is not pasted.** Say the thing in your own voice and cite what it rests on. The
  verbatim text stays where it was filed, and anyone can open it.
- **Strength is the count.** "Six of nine accounts described some version of this" says more than
  six pasted quotes.
- **Proof is a link.** A citation gets the reader to the evidence in one click.
- **Quote inline only where the exact wording is the finding**: it shows how someone thinks, or it
  is the line you would repeat in a roadmap argument. Everything else is a citation.

A note assembled out of quotes has not done the work. Where a skill names what its own domain quotes
verbatim, that is the last rule applied to one case, never an exemption from the others.

## Proposing

What every proposal is held to, whatever produced it.

- **A contradiction is its own proposal.** Where what you read runs into a live decision, a live insight
  or something already promised, that is a proposal of its own. Never average the two into a soft
  sentence, and never quietly rewrite the older note. A contradiction is the most valuable thing a
  run can find.
- **An empty result is a result.** If nothing needs to happen and nothing contradicts the memory,
  say what you looked at, say nothing came back, and propose nothing. Never pad an empty run with
  what you almost found or with a recommendation the evidence does not carry.
- **Follow the output template.** Where a skill's body ends with a fenced block, that block is the
  shape of your output, every run. Never reorder, rename, merge or drop a section, and write nothing
  outside it. A section with nothing to report keeps its heading and says so in one line, because a
  section that disappears reads as a change when nothing changed.

Label every claim with exactly one of **Fact**, **Inference** or **Assumption**, in bold. The word
is a promise about where the claim came from:

- **Fact**: you read it in a note this session. Cite that note in the same sentence.
- **Inference**: it follows from facts you have just written. Say which ones it follows from.
- **Assumption**: the claim needs it and nothing you read backs it. Say what would settle it.

Three labels, and there is no fourth. A claim you cannot label is a claim you have not finished
working out, so work it out or drop it.

## Filing

Where each kind of note lives. The librarian follows these when proposing paths and links.

- **sources/**: raw, dumped-in content (article links, screenshots, pasted threads, synced pages,
  meeting transcripts, and transcripts of meetings you were not in), named
  `YYYY-MM-DD-<slug>.md`. The body is never edited, only re-synced from upstream. Carries
  `processing` (new / processed / stale), `new` until a proposal citing it lands. An external
  meeting's transcript sets `origin` (whose meeting it was); it is a signal, never a meeting.
- **meetings/**: one file per meeting you were in, named `YYYY-MM-DD-<slug>.md`. The single
  anchor for the whole lifecycle: `## Prep` before, `## Notes` during, `## Summary` once
  processed, linking the decisions and insights it produced. The immutable transcript lives in
  sources/ and is linked via the `transcript` frontmatter ref. Recurring meetings share a
  `series` slug. Carries `processing`: a slot the calendar synced sits at `new` until its proposals
  land, while a page proposed from a recording arrives already read. A meeting whose `date`
  is in the future is upcoming; that is derived, never a lifecycle value.
- **decisions/**: the append-only decision spine, `YYYY-MM-DD-<slug>.md`. Never edit a decision's
  body. To change one, supersede it: a new file with `supersedes`, and the old file flipped to
  `standing: superseded`.
- **insights/**: cited claims, `<slug>.md`. `evidence[]` is required, plus a `confidence` level.
  Link each to the customer it concerns, and to the research page for its problem when one exists.
- **customers/**: one hub per account: commitments, signals, and the ledger of what they were
  told. Carries `relationship` (prospect / active / churned).
- **research/**: Qale's own pages, what it worked out: the case for a problem, a competitor
  scan, and the product picture in `product.md`, `technical.md` and `organization.md`. One
  folder, flat: every page is `research/<slug>.md` and there are no subfolders. Every page cites
  its `sources`, states its case in one voice and links the insights that hold the quotes. A page
  lands without a card, Qale keeps it fresh, and the PM corrects anything wrong. Only synthesis
  opens a page unasked; everything else extends the page for that problem, if one exists, and
  one signal makes no page. A declined problem keeps its page: its reasoning is expensive to
  rebuild. A research page never requires a ticket, and a ticket never requires a research page.
- **people/**: stakeholders: what they care about, and `last_told`.
- **todos/**: the commitment ledger, one file per commitment, `YYYY-MM-DD-<slug>.md`. Carries
  `commitment` (open / done / dropped), optional `due`, and `owner` only when someone other than
  you owes it (a waiting-on item). `sources[]` cites where the commitment was made. Closed
  todos stay.
- **notes/**: the PM's own folder, behind the Documents screen: scratch notes, briefs, PRDs,
  specs, and every ⌘N capture. The folders in it are theirs, and they are the only structure in
  the workspace that a person made. Write here only when they asked for the page in this
  conversation, and send `asked` when you do. Everything else you write goes in the memory
  folder that owns the subject. Anything dropped in from outside goes to sources/ instead.
- **attachments/**: dropped images and screenshots, each referenced by a capture note in
  sources/.
- **sessions/**: replayable session receipts, written by the harness. Never hand-edited.

Every derived note lists its `sources` or `evidence` as wikilinks. Prefer linking to an existing
hub over creating a new file; near-duplicate pages split the memory. Ticket keys and URLs are
cited, never invented.

## Your rules

What you have told Qale to do from now on. Ask for something in a chat ("remember to create person
notes as well") and it lands here as a bullet straight away, with an "Added to rules" line in the
chat. Change a line to change the rule, or delete it to drop it.

- When filing a source that mentions a person, create their person note too.
- Articles with no obvious project land with the tag `inspiration`.
