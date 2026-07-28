# Unlinked notes: classify before you offer an answer

*Built 2026-07-28.*

## The problem

The librarian's orphan sweep had one rule — no inbound links, no outbound links,
not a skill — and one answer vocabulary. Every finding landed in a single card:

> **4 notes have no links at all**
> PAY-4 · Payout report exports — *nothing mentions it* — **Delete** · Skip
> PAY-5 · Webhook delivery retries — *nothing mentions it* — **Delete** · Skip
> PAY-6 · Reconciliation report filter — *nothing mentions it* — **Delete** · Skip
> Friday Scratch — *nothing mentions it* — **Delete** · Skip

Three of those rows are Jira mirrors and the fourth is the densest note in the
vault. Delete is wrong for all four, and "nothing mentions it" is wrong for the
tickets — nothing mentions them *by their composed title*, which is not a
sentence anyone writes.

"Has no links" is a symptom with several causes, and they do not share an answer.

## The three causes

| Kind | What it is | The honest answer | Delete? |
|---|---|---|---|
| `external` | A mirror of an upstream record — `provider` set, or type `ticket`/`wikipage` | *Nothing says what it serves.* Link it from the hub page. | **Never** |
| `capture` | A raw dump naming pages it never links | **Process** — the existing `process-note` session | **Never** |
| `stray` | Workspace-owned, cites nothing, cited by nothing | The hygiene case: adopt it or bin it | Yes |

The standing rule: **Delete is only ever offered for notes the workspace itself
owns and that carry no external identity.** A mirror's truth lives upstream — a
local delete loses the annotation and the next sync brings the note straight
back.

Two suppressions, both deliberate:

- **A mirror already closed upstream** (`state_category: done`) is history, not
  maintenance work. PAY-4 disappears from the sweep entirely.
- **A calendar-mirrored meeting** is never reported. An upcoming meeting nobody
  has written about yet is the normal state of the world, and its lifecycle
  belongs to the before/after-meeting flow on the meeting page — not to link
  hygiene. (See the inbox IA rule: agent nudges live in their owning view.)

## Two search directions, not one

The old sweep only asked *"who mentions this note's title?"* — one direction,
one key. Both halves were too narrow:

- **Inbound**, a mirror also hunts its **aliases**: its `external_id` ("PAY-5")
  and the human half of its title. Prose says "tom is picking up PAY-5", never
  "PAY-5 · Webhook delivery retries with backoff". The matched term is recorded
  on the mention so the applied patch links the text that actually appears.
- **Outbound**, each note is scanned for *pages it names but never links*. This
  is what tells a dump apart from a stray page, and it is the reason
  `capture` can be detected at all — Friday Scratch has zero inbound mentions
  and names eight real entities.

Outbound matching uses full titles, plus the **leading word of proper-name
pages** (`person`, `customer`) when that word is unambiguous across the whole
vocabulary: the vault knows "Kranelund Logistics" and "Sara Lindqvist" while the
scratch pad says "kranelund" and "sara". Problems and releases are excluded from
short-name matching on purpose — their titles are descriptive phrases, so a
leading word like "Scheduled" or "Mobile" is a common adjective, not a name, and
matching on it would invent references.

## Result on the demo vault

```
unconnected-mirrors   2 open tickets aren't connected to any problem or customer
                        PAY-5 [To Do]  nothing says what it serves      Skip
                        PAY-6 [To Do]  nothing says what it serves      Skip
unprocessed-captures  1 capture note waiting to be processed
                        Friday Scratch  not wired into anything yet
                        — names Mikkel Sorensen, Sara Lindqvist, Cs Sync,
                          Jonas Palm +4 more        [Process]           Skip
```

PAY-4 is gone (done upstream). No Delete anywhere. Each card states a cause the
PO can act on rather than a symptom nobody can.

## Code map

| Concern | Where |
|---|---|
| `OrphanCandidate`, external detection, the two suppressions | `packages/application/src/use-cases/vault.ts` |
| Kind assignment, both search directions, the per-cause ping groups | `packages/application/src/use-cases/pings.ts` |
| `OrphanKind`, `PingOrphanItem` (`kind`, `detail`, `mentions[].term`, `names`) | `packages/application/src/ports.ts` |
| Row rendering — which actions each kind may offer | `apps/desktop/src/renderer/src/components/inbox/PingRows.tsx` |
| Librarian skill guidance (`## Know`, mirror red flag) | `packages/sessions/src/defaults.ts` |
| Tests | `packages/application/test/orphan-classification.test.ts` |

Ping keys changed (`orphan-connect` → `unconnected-mirrors` /
`unprocessed-captures` / `stray-notes`) and the old key is retired on the next
tick. The rename is load-bearing: reusing it would let a lingering old-format
ping block its replacement for a week via `hasRecent`.

## Known adjacent gap

The demo's calendar meetings carry `participants: ["[[people/sara-lindqvist]]"]`
in frontmatter, which the link index does not treat as an outbound edge — which
is *why* they surfaced as orphans in the first place. Suppressing meetings is
right regardless, but indexing participant refs as edges is a separate,
worthwhile change.
