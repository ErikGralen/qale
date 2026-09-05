# Where Memory lives, and what belongs in it

Date: 2026-09-05. Status: decided and built (docs/memory-placement-plan.md).

## Where we are

The rail has six places: Home, Calendar, Todos, Sessions, Documents, Memory.
Memory is one row with a `+` and a pinned list under it. The Memory page holds six shelves
(source, decision, insight, theme, customer, person) and a "Synced" group at the end for
tickets and wiki pages. `MEMORY_SHELVES` and `MIRROR_SHELVES` in `lib/nav.ts` are the
two lists.

Two earlier decisions shape this:

- E-16 (easier-tickets): "Let's call it Memory and it's a single entry point, but then the
  user is presented with the different types."
- SB-1 (sidebar-ia): "Documents hold what you write. Memory holds what Qale knows."

The footer under the cog already holds Activity, Skills and Settings. Skills left the rail
because they are "configuration: read once, edited rarely". That is the precedent the
suggestion below leans on.

## Your suggestion, in two parts

1. Move Memory into Settings. It is for the agent, not the user. Reachable, not prominent.
2. Tickets and wiki pages are not Memory. Give them their own place in the sidebar.

---

## 1. Should Memory leave the rail?

**What is right about it.** In the screenshot, Memory takes more vertical space than
anything else: one row plus four pinned children, three of them themes the agent filed.
Nobody chose those pins. The user did not write any of it. Most days the user reaches a
memory page by another door: a #chip, a person chip on a meeting, a wikilink, search, or
the agent quoting it. The rail row is a map, not the only entrance.

**What is wrong with Settings as the new home.** Settings is where you configure. Memory
is content you read. Three things push against burying it:

- PRODUCT.md: "The memory has to visibly accrue" and "Show the memory growing. Week 6 has
  to look different from week 1." Memory is the proof of value. Settings is where proof
  goes to die.
- You said it yourself on E-16: "Someone may want to browse decisions deliberately." A
  decision log, a customer page before a call, "which sources are unprocessed": these
  are reading tasks, and a PM does them on purpose.
- Skills moved under the cog because you read them once. You read a customer page every
  time you meet that customer.

**My read.** The problem in the screenshot is the pinned list, not the row. The row is
one line. The four children are the bulk, and they are agent output pinned by the system.
Demote Memory, don't hide it.

**Options**

- A. Keep the row, drop the pinned children. Memory becomes a single row like Calendar.
  Unprocessed sources keep their attention some other way (see question 4).
- B. Move Memory to the footer, next to Activity and Skills. Still one click, still on
  screen, out of the working set. The rail becomes five places.
- C. A tab or a link inside Settings ("Browse what Qale knows"). Your suggestion as stated.
- D. Nothing changes.

I would do A first and see if B is still wanted. B is one more move if A is not enough.
I would not do C: it makes the product's main proof of value a settings screen.

**Decision:**
Yes move Memory into the footer. Also remove the ability to Pin stuff inside Memory.
---

## 2. Tickets and wiki pages are not Memory

**Agreed.** Qale never writes them, they are copies of another system, and the
"Synced" label at the bottom of the Memory page already says "these are different". A
mirror in the memory is like a printout of someone else's document in your notebook.

Where they go depends on what a ticket page is for inside Qale. Today it holds: state,
the Jira link, the backlinks from your pages, and what Qale drafted against it. The board
view (`TicketBoard`) is the tickets folder's default.

**Options**

- A. One rail row per connected provider, named by the provider: "Jira", "Confluence".
  Appears only when that connection exists, so an unconnected workspace keeps seven
  places. `tickets/<provider>/` paths from provider decoupling already give each row a
  folder. Honest names, and the rail says what is connected at a glance.
- B. One rail row for all mirrors: "Synced" or "Tracker". One row regardless of how many
  connections. Vaguer name, but the rail does not grow per provider.
- C. Under Documents, as read-only folders. Wrong: Documents is what you write.
- D. Reach them only from the Connections settings tab and from links. No browse row at
  all. Cheapest, and it tests whether anyone browses mirrors inside Qale rather than in
  Jira.

I lean A. The board is good enough to browse, the provider name is the honest label, and a
row that appears when you connect is its own onboarding cue. D is the cheap fallback if
you think nobody browses tickets in Qale.

**Decision:**
Yes one rail per provider, so Jira Confluence. User should be able to pin wikipages and tickets under them.
---

## 3. Should the pinned list under Memory go entirely, or only for agent-filed pages?

Today anything you create under Memory (a theme, a decision, a customer) pins on creation,
and an unprocessed source auto-pins. If Memory becomes quiet, the pins are the first thing
to cut. But a decision you just wrote by hand is something you may want back within the
hour.

**Options**

- A. No pins under Memory at all. Tabs and Recent cover "get back to it".
- B. Pins only for pages you created by hand. Agent-filed pages never pin.
- C. Keep as is.

**Decision:**
A) no pins for memory at all (except tickets + wikipages ofcourse.)
---

## 4. Where does "3 unprocessed" go when Memory is quiet?

The auto-pin of an unprocessed source (`qualifiesForRail`) exists so material you handed
over stays visible until it is gone through. If the pinned list under Memory goes, that
signal needs a home.

**Options**

- A. Home. "Waiting on you" is where it belongs anyway: it is a queue item.
- B. A count badge on the Memory row, like the count on Sessions.
- C. Sessions. Arguable: the source is not a proposal, and Sessions is the approval queue only.

I lean A, with B as a small extra if the row stays on the rail.

**Decision:**
B a count on the memory row.
---

## 5. What is the `+` on Memory for once the row is quiet?

It creates a theme, decision, customer or person by hand. If Memory leaves the rail or
loses its children, that `+` loses its spot.

**Options**

- A. Cut it. A decision is recorded by telling Qale, and it proposes the page. Customers
  and people appear from meetings. Hand-creation was a fallback.
- B. Keep it on the Memory page itself (each shelf already has one). Only the rail `+`
  goes.
- C. Keep the rail `+` wherever the row ends up.

**Decision:**
Cut it (A)
---

## 6. Is "Memory" still the right word?

If the place is for the agent by the user, "Memory" is accurate: it is what Qale
remembers. But a user reading the rail might expect their own memory, their notes.
Documents has already taken "what you write".

Candidates: Memory (keep), "What Qale knows", Knowledge. I would keep Memory. It matches
the pitch ("readable product memory") and one word beats a clause in a rail.

**Decision:**
Keep "Memory"
---

## 7. Open thoughts, no ticket yet

- The #tag pages (`ContextView`) are already a better browse than the type shelves for
  "everything about SCIM". If Memory goes quiet, the shelves matter less and the tag pages
  matter more. Worth a look at whether the Memory page should lead with tags, not types.
- Search (⌘K) reaches every memory page today. Any move here should check that the quick
  switcher's "Memory" entry and the crumb on a memory page still agree with the new home.
- The Connections tab in Settings could carry a "Browse" link per provider whatever
  happens in question 2. Cheap, and it gives the mirrors a door from where they are
  configured.
