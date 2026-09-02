# What a proposal card says

## The problem

A card led with a noun phrase naming the file it would write: "New meeting:
Nordkap QBR". The noun is borrowed from the world of things that happen, so the
PO read the card as the real-world act. They thought Qale was about to book a
meeting, when it was only going to write a page about a meeting that already
took place. "New customer" read as a customer won.

The second fault was silence. Only outbound cards said what approving does.
A card that stays in the workspace carried no claim at all, and a reader with no
claim in front of them supplies the worst one.

## Two families

A card either stays in the workspace or leaves it.

- **Stays.** A note, an update, a decision. The effect line comes from
  `vaultEffect` and names the folder the page lands in.
- **Leaves.** An outbound write to Jira, Confluence or the calendar. The card
  carries the "Leaves your workspace" strip, and the effect line comes from
  `outboundEffect`, which names who the write reaches.

`vaultEffect` returns undefined for an outbound card, so the two can never both
speak. `proposalToDTO` (`apps/desktop/src/main/dto.ts`) picks one per card and
writes it into the DTO, so every surface that shows the card says the same
thing.

## The rule

The model owns `rationale`, the "why". The app owns the headline and the effect
line, the "what will happen". Both are composed in code from the payload, never
written by the model. Same card kind, same sentence, always true.

The headline is verb-first for the reason above: it names what the app does, not
the thing the file is named after. No propose tool takes a headline parameter.
`propose_instruction` is the one exception and it writes its own, because only
the tool knows the rule the PO just taught.

## What an open card shows

Two facts, in this order: **which file changes**, and **what the change says**.
That is the decision. Everything else is the agent showing its work, and it goes
below the change or behind a fold.

1. The headline, with the file as an openable chip.
2. The effect line, where the kind has one (see the table below).
3. One provenance line in the head: "from your Nordkap check-in", or the
   "You asked for this" / "No source cited" flag. It reads the same open or shut.
4. The change: a rendered diff, or the page as it will read.
5. **Why this, and where it came from** — one collapsed row holding the model's
   `rationale` and the full "Based on" list. Shut by default.
6. Approve, Edit, Discard.

The fold exists because a session that read twelve things cites twelve. Listed
flat, the chips took more of the card than the change did and pushed Approve off
the screen. Trust is a question asked once, by a reader who already doubts what
is in front of them.

The card cites what it read, never the file it writes. That file is already the
headline chip. Sources are deduped by slug: a session can reach the same note by
two routes, and a reader learns nothing from seeing it twice.

There is no "Ask about this" button. It seeded a session with the card's payload
as JSON, and the card has an Edit lever for the same need.

## The vocabulary

`packages/domain/src/proposals/card-copy.ts` is the source of truth. Read it
before you change a line. The table is a map, not a copy.

| Card                              | Headline                      | Effect line                                                                                |
| --------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Meeting                           | `Write up Nordkap QBR, 4 Aug` | Creates a page in Meetings. It records a meeting that already happened; nothing is booked. |
| Insight                           | `Learned: <summary>`          | Creates a page in Insights.                                                                |
| Theme                             | `Record a theme: <summary>`   | Creates a page in Themes.                                                                  |
| Person                            | `Add a page for Sara Lind`    | Creates a page in People. Nobody is contacted.                                             |
| Customer                          | `Add a page for Nordkap`      | Creates a page in Customers. Nobody is contacted.                                          |
| Your to-do                        | `To do: <summary>`            | Adds a to-do to your list.                                                                 |
| Waiting on someone                | `Waiting on Sara: <summary>`  | Adds "waiting on Sara" to your ledger. Sara is not told.                                   |
| Other note                        | `Write a note: <summary>`     | Creates a page in `<Folder>`.                                                              |
| Decision                          | `Decided: <title>`            | Records the decision in Decisions. Nothing is announced. It replaces "<title>".            |
| Update                            | `Update <title>`              | None. See below.                                                                           |
| Standing instruction              | `Remember this: <rule>`       | Adds the rule to `<file>`. Every session reads it from now on.                             |
| Standing instruction, conventions | `Remember this: <rule>`       | Adds the rule to How we use Jira. Read whenever it drafts for Jira.                        |
| Outbound                          | `Comment on PAY-142`          | See `outboundEffect` in `effect.ts`.                                                       |

## Two rules it inherits

Both come from `effect.ts` and hold for the headline too.

1. **A missing fact shortens the sentence, it never pads it.** No meeting date
   gives "Write up Nordkap QBR" and no trailing comma. No path gives no folder
   name.
2. **Nothing that costs a lookup.** Every line is built from the payload and the
   path, which the card already carries. The outbound lookups are the one
   exception, and they are gathered once per list call in
   `outboundEffectFacts`.

## Why an update has no effect line

Every other kind names a folder the page lands in, or a consequence the reader
cannot see on the card. An update has neither. Its headline is already
"Update <page>", with the page as a chip they can open, and the diff below is the
change itself. The line could only say "Edits a page in your workspace", which is
the headline with the page taken out of it.

A rule is the exception, because it lands in a file the card does not name and it
changes what every later session reads.

## Why the reassurance is rationed

"Nothing is booked", "Nobody is contacted" and "Sara is not told" appear only on
the kinds with a real-world twin: a meeting, a person, a customer, a commitment
someone else owes. On every card the clause becomes boilerplate the reader
learns to skip, and a warning nobody reads protects nobody.
