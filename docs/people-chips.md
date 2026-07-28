# People, not strings — participant chips and the person card

**Built 2026-07-28.**

## The problem

A meeting's `participants` row rendered its raw frontmatter: `[[people/sara-lindqvist]]`
next to `egralen@gmail.com`. Both are true on disk and both are wrong on screen — one leaks
link syntax, the other shows the PO their own email address as if they were a stranger. The
row also offered a × on every chip and a text input, neither of which could work: meeting
provenance is immutable (`TYPE_RULES.meeting`), so main rejected the write and the value
snapped back with no explanation.

## The shape

Participants are stored three ways, and all three are legitimate:

| On disk | Why | Renders as |
|---|---|---|
| `[[people/sara-lindqvist]]` | calendar sync matched the attendee to a page by email | **Sara Lindqvist** + card |
| `Tom Devlin` / `me` | hand-written (capture, seed) | **Tom Devlin** / **You** |
| `lena@fennoenergi.example` | invite from someone with no page yet | the address + "make a page" |

The renderer never parses these against the file. `people:directory` returns the whole
people table (name, role, email, summary, `cares_about`, `last_told`, customer, last/next
meeting) plus the self identity, refreshed with the tree. Resolution
(`renderer/src/lib/people.ts`) walks: self alias → self address → slug → email → display
name. Anything left over is "unknown" — labelled honestly, never invented.

## Decisions

**The card is what the first click buys.** A chip click opens the person card, not the
page — who they are, their customer, when they were last told anything, the next meeting
you're in with them, what they care about, and one "Open page" action. A misclick costs
nothing, and the row keeps reading like text.

**"You" is not an email.** Self identity lives in settings (`identity.name` + aliases,
merged with the connected Google/Atlassian account addresses) and surfaces in Settings →
You. With no name set the chip reads "You"; the card offers to set one.

**Creating a page does not rewrite the note.** "Create person page" writes
`people/<slug>.md` carrying the address, and the chip re-resolves through the directory on
the next refresh. The meeting keeps saying `lena@fennoenergi.example` — that is what the invite
said. Rewriting participants to fix a display problem would be editing provenance, and the
same page teaches the *next* calendar sync to resolve that attendee properly.

**Immutable fields no longer pretend.** `PropertiesBlock` now reads
`TYPE_RULES[type].mutableFields`: frozen fields render as values (people fields as
read-only chips), custom rows lose their remove ×, and `+ Add property` disappears. This
is why participants have no × — not a limitation of the widget, but the meeting's
provenance rule made visible. `PeopleInput` (pick-a-person autocomplete that writes
`[[people/…]]` links, with "add as a new person" inline) is wired for any people field whose
type allows edits.

## Code map

- `packages/application/src/use-cases/people.ts` — `listPeople` (cards + last/next meeting
  in one pass over the meetings), `createPerson`
- `packages/ipc` — `PersonCardDTO`, `PeopleDirectoryDTO`, `people:directory`,
  `people:create`, `settings:setIdentity`, `SettingsDTO.identity`
- `apps/desktop/src/main/services/settings-service.ts` — `identity`, `selfEmails()`
- `apps/desktop/src/renderer/src/lib/people.ts` — resolution, initials, avatar hue, dates
- `apps/desktop/src/renderer/src/components/PersonChip.tsx` — chip + card
- `apps/desktop/src/renderer/src/components/PeopleInput.tsx` — editable people field
- `apps/desktop/test/participants.test.ts` — resolution rules

## Not done

- Todo `owner` ("Waiting on") is still a plain text field; it holds a person and could use
  the same chip.
- Person pages themselves don't show their avatar/hue anywhere but chips.
- A created person page has a name and an email and nothing else — no follow-up prompt to
  fill in role or customer.
