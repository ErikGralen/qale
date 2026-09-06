# The whole picture

Everything Qale would need to know about a PM and their world to be a useful assistant that
learns on its own and asks to learn more. Written 2026-09-06. No solutions in this doc: Erik's
call was "we need the whole picture before we can talk solutions", after three rounds that
proposed mechanisms without one.

How it was made: three agents (Sonnet, Opus, Fable) got the identical brief and enumerated the
picture independently. A fourth inventoried what the code captures today. This doc is the
union, deduplicated, with the inventory as the last column. The rounds before this
(`cold-start-map.md`, `-path.md`, `-asking.md`, `-learning.md`) stand as history; none of their
mechanisms is assumed here.

## How to read the tables

| Column | Meaning |
|---|---|
| Know | The thing, concrete enough to test |
| Why | The value it unlocks, one clause |
| Evidence | Which system, field or behaviour holds it |
| Learn | **O** observe (arithmetic over data, no model) · **I** infer (a model reads) · **A** ask (only the PM knows) · **T** told (the PM volunteers) |
| Change | stable · drifts · churns |
| Conf | How sure Qale can be before asking: high · med · low |
| Today | What the app holds now: **S** typed in settings · **M** per-item mirror, no aggregate · **P** prose in a skill file, written once · **F** frontmatter a model wrote on a note · **D** derived by code · **L** a ledger row · **—** nothing |

---

## 1. The PM themself

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| Name, work email, aliases, Jira account id, Google id | Ties "mine" across systems to one person | Settings You, `currentUser()`, calendar organiser | O/T | stable | high | S (name, aliases, Google email) |
| Exact role: PM, PO, head of product, one of three PMs | What "my ticket", "my update", "my decision" mean | Jira role, calendar titles, signature, ask | O+A | stable | med | — |
| Which product area or team is theirs vs shared | Scope of everything below | Assignee and reporter share per project and component | O | drifts | high | footprint survey at connect, then discarded |
| Who they report to, who reviews their work | Whose voice the update is for | 1:1 series in calendar, org page, "manager" in transcripts | I | drifts | med | — |
| What they are judged on this quarter, in their words | Weighting for every draft and brief | OKR page, exec transcripts, ask | I+A | churns | low | — |
| Week rhythm: dense days, writing day, focus blocks | When to knock and when to stay quiet | Calendar density per weekday and hour | O | drifts | high | — |
| Working hours, timezone, holidays, leave pattern | Never knock at 22:00 or in July | Event times, OOO events | O | stable | high | — |
| Where they write today: Confluence, Docs, Notion, Notes, Slack drafts | Where old notes and PRDs live; where a draft should land | Contributor queries, dropped files' origin, ask | O+A | stable | med | — |
| Their own prose samples | Voice matching without asking | Pages, comments, tickets they authored | O then I | drifts | med | — |
| What they hate doing | What to take off their plate first | Repeated edits to the same part of drafts, direct statements | I+T | stable | low | — |
| How they like to be talked to: terse or narrative, questions or proposals | Every reply's shape | Edits to drafts, which cards they approve unchanged | I | drifts | med | — |
| Working language per audience | Every sentence produced | Language of their own writing per space and recipient | O | stable | high | S (one workspace language) |
| Seniority and tenure | Whether to explain the org or assume it | Jira account age, first authored page | O | stable | high | — |
| Current load: open todos, overdue, meeting hours | When to stop adding | `todos/`, calendar | O | churns | high | D (todos), — (hours) |
| Meetings they run vs attend | How deep prep should go | Organiser field | O | drifts | high | — (organiser not synced) |
| Strengths and blind spots (technical depth, data, customer contact) | Which prep needs padding | Ask; the mix of meetings they attend | A | stable | low | — |
| Devices and hours: phone reads, home office days | When a draft must fit a phone | Calendar locations, telemetry hours | O | drifts | med | — |

## 2. How they use Jira

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| Projects that exist, which are theirs, which they only watch | Where a draft may land at all | Project list, footprint over 90 days | O | drifts | high | container catalogue + follow set; footprint discarded |
| Projects that are other teams' and read-only for them | Never write where they cannot | Permission probe, footprint absence | O | stable | high | — |
| Boards per project: scrum or kanban, whose board | Sprint vocabulary and status flow | Board API, board filter JQL | O | stable | high | — |
| Sprint cadence, start weekday, naming, current sprint | "This sprint" is a date | Sprint API | O | stable | high | — |
| Issue types in real use and their share per project | Which type a new ticket takes | Count per type per project, 90 days | O | stable | high | — (type not synced) |
| What each issue type really means here | Draft the right type | Counts plus title shapes per type | O then I | stable | med | — |
| Which type the PM creates vs engineers create | Drafts fit the PM's own lane | Reporter by type | O | stable | high | — (reporter not synced) |
| **Labels in use, frequency, last used** | Drafts carry the team's own labels | `labels` field, aggregated | O | drifts | high | — (labels not synced) |
| **When each label is applied: which type, status, reporter, epic, moment** | A rule, not a word list; the fastest way to lose trust is a wrong label | Co-occurrence with type, status, changelog timestamp | O then I | drifts | med | — |
| Labels mandatory by convention (every bug has `customer-reported`) | A draft missing one is rejected every time | Label present on over 90% of a type | O | stable | high | — |
| Dead labels | Never suggest them | Last-used date per label | O | churns | high | — |
| Components and what each maps to (team, module, platform) | Routing a ticket to the right owners | Component list, assignee cluster per component | O+I | stable | med | — |
| Hierarchy: initiative, epic, story, sub-task, and what hangs where | Where a new ticket goes; where a research page links | `parent`, hierarchy levels, Advanced Roadmaps | O | stable | high | M (`parent` only) |
| Workflow statuses per project and the real transition order | What "In Progress" means here | Status list, changelog transitions | O | stable | high | M (status, state category) |
| **Median dwell time per status, and who transitions** | "Stalled" becomes a claim that survives a challenge | Changelog arithmetic | O+I | drifts | high | — |
| Which statuses count as done here | "Shipped" in the update | Resolution and status categories, release transitions, ask | O+A | stable | med | M (state category) |
| Priority scheme and whether anyone uses it | Do not fake a priority | Priority distribution | O | stable | high | — |
| Who assigns, who moves, who closes | Who to name in an update; whether a draft names an assignee | Changelog actor arithmetic | O | drifts | high | — |
| Estimation practice: points, hours, none | Never invent an estimate | Field fill rate | O | stable | high | — |
| Required fields, and fields that are always empty | Never draft into a dead field | createmeta, fill rate per field per type | O | stable | high | — |
| Fields the PM personally never touches | Never set them in their name | Field-change actor per field | O | stable | high | — |
| Title convention: prefix, verb, language, key in title | Drafts that look native | Regex over the last 200 titles | O | stable | high | P (prose, if the debrief wrote it) |
| Description template: headings, AC form, given/when/then | The body of every drafted ticket | Description bodies of their own issues | O+I | stable | med | P |
| Definition of done, and whether a status means it | When to say shipped | Done tickets' fields, DoD page, confirm | O+I then A | stable | low | — |
| Automation rules and bot accounts | Do not argue with a robot, do not credit one, do not "fix" what a rule will undo | App authors in changelog, timing regularity | O | drifts | high | — |
| Link types in use and what each means here | Blocker claims that hold | `issuelinks` | O | stable | high | M (typed links synced) |
| Fix versions and release naming | Any date claim, "ships in 2.14" | Versions endpoint | O | churns | high | — |
| Comment culture: decisions in comments, or noise | Whether to read comments as evidence | Comment length, author mix, decision words | I | stable | med | — (comments not synced) |
| Other teams' projects that touch the PM's | Cross-project blockers | Link edges crossing project keys | O | drifts | high | M (links only where mirrored) |
| Which ticket is a scratchpad vs a shared contract | Tone of a comment | Watchers, comment count, assignee churn | I | drifts | med | — |
| What a badly written ticket by the PM looks like (feedback they got) | The house rule they never wrote down | Edits others made to their tickets | I+A | stable | low | — |

## 3. How they use Confluence

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| Spaces, their purpose, which are theirs | Where a page update may go | Space list, contributor share | O then I | stable | high | container catalogue + follow set |
| Page kinds by shape: PRD, spec, decision log, retro, meeting notes, ADR | The right template per output | Title patterns, heading-set clustering, page labels, parent trees | O+I | stable | med | — |
| Templates and blueprints actually in use | Native drafts | Template API, structural similarity | O | stable | med | — |
| Required headings for a spec here | A spec that survives review | Accepted specs' headings | O+I | drifts | med | — |
| Who edits which space or tree | Whose page Qale may propose to patch; whose review a change implies | Version history authors | O | drifts | high | — (contributors not synced) |
| Canonical vs stale, per page | Never cite the 2024 roadmap | Last modified, inbound links, `archived` labels, "OLD" in title | O+I | churns | med | M (`remote_updated`) |
| Where the roadmap lives (page, plan, deck, Productboard) and when it was last true | Roadmap answers cite the right thing | Title and label search, ask | O+A | drifts | low | — |
| Where pricing lives, who owns it, who can see it | Pricing answers or an honest "not here"; no pricing in a customer draft | Search, restrictions, ask | O+A | stable | low | — |
| Restricted pages the PM cannot read | Never promise a read that 403s | Restrictions API | O | drifts | high | — |
| Naming rules: prefixes, dates, `[DRAFT]`, Swedish titles | Titles that fit | Title corpus per space | O | stable | high | — |
| Page tree per feature: PRD, design, tech design, test plan as siblings | Where a new page hangs | Ancestors of their recent pages | O | stable | high | — (ancestors not synced) |
| Confluence labels and what each sorts | Retrieval and placement | Page labels | O | drifts | high | — |
| Macros in use (Jira macro, status lozenge, decision macro) | Patches keep the page working | Storage-format scan | O | stable | high | — |
| Pages edited on a cadence | Recurring deliverables in disguise | Periodicity in version history | O | stable | med | — |
| Replace-whole-page vs append-a-section habit | Match the team's update style | Version diff pattern | O | stable | med | — |
| Whether decisions are recorded anywhere, and where | The decision spine's upstream | Decision macro, "Decision" headings | O+I | stable | med | — |
| The Jira/Confluence boundary: what is written where | Never draft into the wrong system | Cross-reference direction and density | I | stable | med | P |
| Read culture: does anyone read pages, or is Slack the truth | Whether a page update matters | View counts, links from Slack, ask | O+A | stable | low | — |

## 4. Meetings

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| Every recurring series, its cadence, its purpose in one line | Prep and processing per series | Recurrence, title, description, transcripts | O+I | drifts | high / med | D (series slug only) |
| Attendees per series, who actually shows, who never does | Who to brief, who to quote | Invite list vs transcript speakers | O | drifts | high | F (participants per meeting), no aggregate |
| Which series produce decisions vs which are theatre | Where the spine gets fed; where not to spend a model | Decision and todo density per series over months | O+I | stable | med | — |
| The PM's speaking role per series: runs it, presents, listens | Prep type: agenda, questions, or nothing | Organiser field, speaker share and turn position | O | stable | high | — |
| Where transcripts come from, in what format, for which meetings | Which meetings will ever be processed | Source formats, coverage per series | O | stable | high | telemetry `source.tool` only |
| Which meetings never get a transcript (1:1s, calls without consent) | Ask for notes instead, never expect a drop | Coverage per series | O | stable | high | — |
| What good prep looks like per series | The brief is useful, not generic | Own past prep, what was discussed, what prep sections get kept vs deleted | I+A | stable | low | — |
| Standing agenda items and their owner | Prep hits the fixed items | Recurring headings in notes | I | drifts | med | — |
| Meeting language per series | Prep and quotes in the right language | Transcript language | O | stable | high | — |
| Externals in the room, and which series carries which customer | Confidentiality, voice, links to the customer hub | Attendee domains, transcript names | O | churns | high | — (no domain logic) |
| Meetings the PM is not in but hears about | Never draft outbound from these | `origin: external`, no participant match | O | stable | high | F (`origin`) |
| How far ahead the PM actually prepares | When the prep should land to be read | When prep pages get opened vs meeting start | O | stable | med | — |
| Meetings that are really a deadline (steering, QBR) | Work backwards from them | Series name plus what lands right before | I | stable | med | — |
| A series that quietly stopped | Stop prepping a dead series | Gap in recurrence, no note in months | O | churns | high | — |
| Meetings they would drop if they could | Where to save prep effort | Declines, no-shows, ask | O+A | drifts | low | — |
| Time-zone spread of attendees | "Morning" wording, scheduling | Attendee calendars | O | stable | high | — |

## 5. People and organisation

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| Teams, their names, which product part each owns | Route questions and tickets | Components, assignee clusters, org page, channel names | O+I | drifts | med | — |
| Who owns which component or area | Who to ask, who to name | Component lead, assignee concentration | O | drifts | high | — |
| Who decides what, who has veto | Whether a decision is real yet; whose yes a proposal needs | Who closes debate in transcripts, `deciders` on decisions, ask | I+A | stable | low | F (`deciders`), no aggregate |
| Who pings the PM most, about what | Answer templates; the earliest warning of a commitment about to blow | Mentions, comment authors, meeting requests, inbound requests | O | drifts | high | — |
| Who the PM checks with before deciding | The sounding board; draft routing | 1:1s just before decisions, "let me check with X" | I | drifts | med | — |
| Who is external: agency, contractor, customer, vendor | Confidentiality boundary, different tone | Email domain vs company domain | O | churns | high | — |
| Company domains, subsidiaries, group brands | Entity resolution | Email domains, Confluence footer | O | stable | high | — |
| Aliases: display name, Slack handle, initials in tickets, spoken first name | One person page, not four | Cross-system matching, confirmed once | O+I then A | stable | med | F (`email` as join key only) |
| Who is new, leaving, on leave | Stale ownership, handover, who can keep a promise | Account creation, last activity, OOO, farewell events | O | churns | med | — |
| Each person's care-abouts and hot buttons | What to lead with in a brief or update | Their questions across transcripts and comments | I | drifts | med | F (`cares_about`) |
| What each person was last told, and when | Never repeat, never contradict | `last_told` | O | churns | high | F (`last_told`) |
| Formal hierarchy vs real influence | Who actually blocks | Org chart vs who wins arguments | I+A | stable | low | — |
| The PM's peers (other PMs) and how areas split | Boundary of "mine" | Project ownership overlap | O | drifts | med | — |
| Support and sales as signal sources: who there talks to customers | Where customer signal comes from | Reporters with CS roles | O | stable | high | — |
| Who never reads a long message | Length of a draft | Reply latency and length | I | stable | low | — |
| Who the PM must never surprise | Advance-warning rule | Ask | A | stable | low | — |

## 6. Customers and market

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| The account list, stage (prospect, active, churned, pilot) and segment | Weighting of every signal | CRM, Jira customer field, support, calendar domains, ask | O+A | churns | med | F (`relationship`, free-text `segment`) |
| **Email domain to customer mapping** | Every attendee and reporter resolves to an account | Domains vs customer pages | O | stable | high | — |
| Named key accounts and revenue band | What "at risk" costs | CRM, exec updates, ask | I+A | drifts | low | — |
| Which accounts are at risk and why | The highest-value unasked flag | Escalation language, support volume, renewal proximity, churn talk | I | churns | med | — |
| Renewal and contract dates | Standing deadlines to work back from | CRM, calendar "renewal" events, ask | O+A | churns | low | — |
| Contact per account, and who owns the relationship internally | Who to draft to, who to cc | Attendee lists, email threads | O | drifts | high | F (person `customer` ref) |
| Promises made to each account, by whom, in which room | The most dangerous thing to get wrong; ten times the damage with an external in the room | Transcripts, attendee domains at the moment of promising | I | churns | med | F (told-ledger on the hub) |
| What each account keeps asking for | Roadmap arguments; insight strength | Repeated asks across their meetings, support tags | O+I | drifts | high | insights cite customers; no count |
| Which accounts are vocal vs quiet | How much one voice should count | Insights citing that account | O | drifts | high | — |
| Competitors named, by whom, in what context | Positioning; a request that is a competitive response | Transcripts, lost-deal notes, labels | I | drifts | med | — |
| Where customer signal arrives (support tool, CS calls, NPS, Slack channel) | Which sources to watch before saying "no signal" | Ask, plus source origins | A+O | stable | low | — |
| Deals in flight that depend on unbuilt work | Priority arguments | Sales meetings plus tagged tickets | I | churns | low | — |
| Regulated or public-sector buyers (procurement, GDPR, accessibility law) | Constraints on what can be promised | Domains, labels like `wcag`, `gdpr` | O+I | stable | med | — |
| Pricing exceptions or side deals per account | Never imply a standard price that is not real | Ask only | A | churns | none | — |
| Which accounts may be named in public writing | Confidentiality in an update | Ask | A | stable | low | — |
| What a lost customer said on the way out | Hard-won insight | Churn notes, ask | I+A | stable | low | — |
| Market events (competitor launch, regulation date) | Context for bets | The PM drops it in | T | churns | low | — |

## 7. The product

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| What it is, in a paragraph, in the PM's words | The first line of everything | Marketing site, product page, interview | I+A | stable | med | F (`research/product.md`, prose) |
| Who pays and who uses (often different) | Whose problem wins | Interview, customer hubs | A | drifts | low | — |
| The big parts and their real names, internal vs external | Speak the team's language | Components, Confluence trees, repeated nouns, codebase folders | O+I | stable | high | F (`research/technical.md`, prose) |
| **Codenames and their public equivalents** | Half of every transcript is unreadable without them; churns fastest | Repeated capitalised nouns with no ticket, epic vs release notes, ask | I+A | churns | med | — |
| Current bets: the epics with motion | Weight the debrief and prep | Ticket velocity per epic, exec updates | O+I | churns | high | — (no epic aggregate) |
| The roadmap as stated, its horizon, how firm each item is, and where the honest version lives | Roadmap and date answers | Roadmap page, fix versions, decision spine, ask | I+A | drifts | low | — |
| Pricing model, tiers, plan names, what is gated | Pricing questions and customer drafts | Pricing page, contracts, ask | I+A | drifts | low | — |
| Technical shape: platforms, big services, what is slow or fragile | Feasibility framing | Repo overview (`ask_codebase`), tech pages, engineer transcripts | I | stable | med | F (technical note), `ask_codebase` |
| Constraints nobody wants to touch | Why some asks stall | Reopened tickets, "not now" decisions | I | stable | med | — |
| Release mechanics: app store review, on-prem, feature flags | What "shipped" means to a customer | Fix versions, deploy tickets, ask | O+I | stable | med | — |
| Metrics that matter, where each lives, definitions behind ambiguous ones, which are distrusted | Numbers in updates, never invented | Dashboard links, ask | I+A | drifts | low | — |
| Platforms and markets (web, iOS, Sweden-only, Nordics) | Scope of every feature | Components, locales | O | stable | high | — |
| Integrations the product has (Fortnox, BankID, Visma) | Third-party constraints | Ticket keywords, tech pages | I | drifts | med | — |
| What was tried and abandoned, and why | Never re-propose a dead idea | Won't Do resolutions, superseded decisions | O+I | stable | high | F (decision `standing`), M (state category) |
| Known debt and its owner | Recurring blocker explanation | Tickets that never move, retro pages | O | drifts | med | — |
| Internal vocabulary: what the team calls users, "kund", "ärende" | Native drafts, one word for one thing | Word frequency across tickets, pages, transcripts | O | stable | high | — (no glossary; `tagsInUse` is the only vocabulary aggregate) |

## 8. Process and decisions

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| How a decision becomes real: meeting, doc comment, Slack thread, one person's call | Where to look, where a decision note belongs | Where "we decided" appears, what follows a decision in the data | I+A | stable | low | — |
| Who has veto, per kind of decision | Do not record as decided what one person can undo | Overturned decisions and who overturned them, ask | I+A | stable | low | — |
| What a PRD or spec must contain here | Spec skill output shape | Existing PRDs' headings, sign-off tables | O+I | stable | high | — |
| Release cadence, freeze windows, release ritual and notes owner | Timing language, deliverables | Fix version dates, release notes pages, deploy meetings | O | stable | high | — |
| How priorities are set and when (quarterly planning, scoring, gut) | Framing for prioritisation asks | Planning transcripts, scoring fields | I+A | drifts | low | — |
| Where the backlog is groomed | Where a proposal must arrive | Refinement meeting plus ticket edit timing | O | stable | high | — |
| What "done" means from product's side (shipped, adopted, measured) | Update honesty | Ask, status usage, retro complaints | A+O | stable | low | — |
| Which decisions need a written record vs a Slack line | Not over-formalising | Existing decision pages' subjects | I | stable | med | — |
| Review gates: design, security, legal, compliance | Steps a draft must mention; what cannot ship quietly | Link patterns, review pages, legal attendees | O+I | stable | med | — |
| Retro practice and where actions land | Recurring commitments | Retro pages, action tickets | O | stable | high | — |
| How scope changes are handled | Whether to propose a decision note | Edit history, ask | I+A | stable | low | — |
| Escalation path when blocked or when two teams disagree | Whom to name in a blocker update | Transcripts, who gets copied on Blocked, ask | I+A | drifts | low | — |
| Which process steps are official but skipped | Never insist on a step nobody does | Documented vs observed process | I | drifts | low | — |
| How a contradiction between decisions gets resolved | Flag it or wait | Supersede chain history | O | drifts | med | F (`supersedes`) |

## 9. Commitments and promises

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| Every open promise the PM made, to whom, by when | The core ledger | Transcripts, emails, ticket comments | I at capture, then O | churns | high once filed | F (`todos/`, `commitment`, `due`) |
| Every promise made to them, by whom | Chasing without nagging | Same, reversed | I | churns | high once filed | F (`owner` set) |
| Due dates, stated and implied | Ordering the day | "By Friday" phrases, ticket due dates | I | churns | med | F (`due`) |
| Recurring deliverables: weekly update, steering deck, QBR, board pack, and their audience and format | Standing deadlines; drafts to the right shape | Calendar recurrence, page edit rhythm, past copies | O+I | stable | high | S (weekly-update schedule, off) |
| Hard external dates: go-live, regulation, contract, fair | Immovable deadlines | Calendar, contracts, ask | O+A | churns | low | — |
| Soft vs hard promises ("we'll look at it") | Ledger noise control | Wording, follow-up frequency | I | stable | med | — |
| Promise made in a room with an external in it | Same sentence, ten times the damage | Attendee domains at the moment of promising | O | churns | high | — |
| Promises that contradict a live decision | The most valuable thing to surface | Ledger against decision heads | I | churns | med | — |
| What was quietly dropped | Honesty in an update | Overdue with no activity | O | churns | high | D (overdue), no "dropped" reading |
| Typical lag between promise and delivery, by source type | "Overdue" means at-risk, not normal | Dwell time of closed todos | O | drifts | med | — (no completion history) |
| Which promises the PM tends to drop, and who chases them | Where nudges earn their cost | Ledger history, inbound follow-ups | O | drifts | med | — |
| Team's promises vs personal ones | Owner correctness | Speaker and context | I | stable | med | — |
| Board- or investor-level commitments | Highest-stakes deadline category | Ask; written nowhere | T | stable | none | — |
| Whether an external promise needs internal sign-off first | A rep's message is not product truth | Ask | T | stable | med | — |
| Vacation and OOO windows (July, Christmas, sportlov) | Deadlines shift, quiet weeks | OOO events, national holidays | O | churns | high | — |

## 10. Writing and voice

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| Update audiences and the channel per audience | Voice per draft | Past updates, recipients across systems | O | stable | high | P (two shipped voices: exec, cs) |
| Language per audience: Swedish internally, English to board or engineers | Right language per draft | Past updates, recipient domains | O | stable | high | S (one language) |
| Tone per audience: exec flat, team chatty, customer warm | Voices that match reality | Past texts, edits to drafts | I | drifts | med | P (shipped defaults, not learned) |
| Template of each recurring update (headings, order, length) | Draft shape; never invent a template | Past copies | O | stable | high | — |
| Length they tolerate | Rejection reason number one | Sent length vs drafted length | O | stable | med | — |
| Banned words, pet phrases, terms they insist on | Fewer rewrites; one word for one thing | Words deleted from drafts, `propose_instruction` bullets | I+T | drifts | high once told | P ("Your rules" bullets) |
| **The diff between what Qale drafted and what the PM sent** | The richest voice signal in the product, free | Draft vs approved text | O | drifts | high | — (edited flag in telemetry only, no diff kept) |
| Number habits: SEK vs kr, percent vs absolute, date format | Native drafts | Past texts | O | stable | high | — |
| Register per surface: ticket vs page vs Slack | Right register | Own text per system | O+I | stable | high | — |
| Formatting habits: bullets vs prose, emoji, bold headers | Drafts they will not reformat | Own texts | O | stable | high | — |
| Greeting and sign-off per recipient | Message drafts | Emails | O | stable | high | — |
| "We" vs "I"; hedging vs flat statements | Voice authenticity | Own texts, modal verb rate | O+I | stable | med | — |
| How they name customers in public writing | Confidentiality | Past updates, ask | O+A | stable | med | — |
| What they refuse to write (blame, names in failures) | Never-draft rule | Ask | A | stable | low | — |
| A voice for a reader who fits neither shipped voice | The two voices do not cover every reader | Ask, per recipient | A | churns | none | — |

## 11. Preferences about Qale itself

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| What may land without a card, beyond the default policy | The trust contract; fewer cards over time | Approval rate per proposal kind, ask | O+A | drifts as trust grows | high once told | — (policy is hard-coded, no PM boundary on top) |
| Which proposals they always discard | Stop producing them | `card.decided` per skill and kind | O | drifts | high | L (status only; no reason, no rate read back) |
| Which corrections they make repeatedly | The unwritten rule | Diff between draft and approved | O+I | drifts | high | — (routing decision never logged) |
| Quiet hours and no-interrupt contexts | Knock timing | Calendar busy blocks, telemetry hours | O | stable | high | — |
| Preferred model and cost tolerance, per kind of work | Model choice per session | Settings, picker choices | T | drifts | high | S (one provider and model; per-session override not remembered) |
| Tone to the PM: terse, no praise | Every reply | Edits, ask | I+A | stable | med | P (house rules, shipped) |
| What Qale must never write or send, what is private even from the workspace | Hard limits | Ask | A | stable | low | P (only if the PM added a rule) |
| Which systems are read-only forever, whether it may act while they are away | Blast radius | Connection settings, explicit statement | T | stable | high | S (agent toggles) |
| How much explanation they want per card | Card length | Whether they open the fold | O | drifts | med | — |
| Their tolerance for being asked | Question budget | Answered vs parked rate | O | drifts | high | — (ask store deletes the row on answer) |
| Which recurring jobs they want on | Weekly update, prep, librarian | Toggles | T | stable | high | S |
| Whether they want to be pushed or left alone | Nudge policy | Dismissal rate, ask | A+O | drifts | low | L (capture dismiss and mute only) |
| What "too much" looks like to them | When to go quiet for a week | Session open rate falling | O | drifts | med | — |

## 12. Time and rhythm

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| Fiscal year and quarter boundaries | "This quarter" means the right dates | Planning pages, ask | O+A | stable | med | — |
| Planning ritual dates (quarterly planning week, budget) | Prep and deliverables cluster there | Calendar recurrence | O | stable | high | — |
| Swedish holidays, klämdagar, July shutdown, sportlov | Deadlines and quiet weeks | Locale calendar, OOO density | O | stable | high | — |
| Time of day the PM processes meetings | When a session should be ready | Telemetry session times | O | drifts | high | — |
| Busy season for customers (retail Q4, public sector autumn budgets) | Signal spikes are seasonal | Ticket and support volume by month | O | stable | med | — |

## 13. Other tools and where truth spills

| Know | Why | Evidence | Learn | Change | Conf | Today |
|---|---|---|---|---|---|---|
| Which channel carries decisions here (Slack, Teams, email, a room) | Where the memory is thin | Decisions with no meeting and no page, ask | I+A | drifts | low | — |
| Slack or Teams channels that matter and their purpose | Where decisions and pings really happen | Ask, channel names in pasted threads | A+I | drifts | low | — |
| Tools outside Atlassian that hold truth (Figma, Notion, Docs, Miro, Productboard) | Known blind spots; do not miss the real spec | Links in tickets, pages and transcripts | O+I | drifts | high | — |
| Which links they paste most | What to teach itself to read next | URL host frequency across sources | O | drifts | high | — |
| Analytics, BI, CRM and support tools, and who can pull numbers | Numbers and customer signal | Links, email domains, ask | O+A | stable | med | — |
| Code hosting and whether PRs link to tickets | Delivery truth beyond Jira status | Dev panel, PR links | O | stable | high | `ask_codebase` for one repo |
| Transcript tool and its export shape | Arrival parsing | File format | O | stable | high | telemetry word only |
| Where old notes from before Qale live | The largest single memory gift available | Ask, once | A | stable | high | — (CM-4 fork in the interview asks) |
| What they screenshot rather than link | A tool with no API | Attachment frequency and subject | O | drifts | med | — |
| Which system they check first each morning | Where an answer must appear to count | Ask | A | stable | low | — |

---

## What the union shows

Reading the Today column across 13 domains:

- **Most of the picture is OBSERVE, and almost none of it is observed.** Roughly two thirds of
  the rows are arithmetic over data the connections can already reach. The app mirrors per
  item and aggregates nothing. Jira is queried for exactly seven fields (summary, status,
  assignee, updated, description, parent, issuelinks). Labels, issue type, components,
  priority, reporter, sprint, fix version, changelog and comments are never fetched. The
  calendar is synced without organiser, description, location or recurrence rule.
- **The one survey that exists is thrown away.** The footprint survey computes the PM's
  projects and activity at connect time, feeds the follow picker and the first-look prompt,
  and is discarded.
- **Conventions are prose, written once.** The Jira and Confluence conventions skills hold
  free text a model wrote after reading ten tickets, never refreshed, never structured. There
  is no label vocabulary, no status list, no space list anywhere a program can read.
- **Answers are not memory.** The ask store deletes the row when a question is answered. Past
  questions and their answers are gone.
- **Corrections are not memory.** The correction router decides fact, how, taste or slip in
  the prompt and logs nothing. Proposals keep a status and no reason, no diff, no rate.
- **The draft-versus-sent diff is free and unused.** Every approved card carries the PM's
  edit, the single richest voice signal, and only a boolean reaches telemetry.
- **No entity resolution.** No email-domain-to-customer mapping, no alias table for people
  beyond one email, no glossary of the team's words or codenames. `tagsInUse` is the only
  vocabulary aggregate in the product.
- **Nothing about the person.** No role, no manager, no working hours, no timezone, no
  language per audience, no what-they-are-judged-on. Settings hold a name and aliases.

## The most valuable and least obvious

Merged from the three closings; each appeared in at least two.

1. **When each Jira label is applied**, not which labels exist: co-occurrence with type,
   status, reporter and the changelog moment. Arithmetic, and the rule behind it is the value.
2. **Median dwell time per status, and who transitions.** "In Progress" becomes a number and
   "stalled" a claim that survives a challenge.
3. **The diff between what Qale drafted and what the PM sent.** Free, and the only signal that
   says the register was wrong without anyone saying so.
4. **Fields that are always empty, and fields the PM never touches.** Knowing where not to
   write is worth more than knowing where to write.
5. **Which meeting series produce no decisions and no todos over months.** Where not to spend
   a model, and nobody will ever say it out loud.
6. **Codename-to-thing mapping.** Half of every transcript is unreadable without it, and it
   churns faster than anything else.
7. **What was tried and abandoned, with the reason.** Re-proposing a dead idea costs more
   trust than any wrong draft.
8. **Promises made in a room with an external domain in it.** Same sentence, ten times the
   damage.
9. **Bot versus human actors in Jira history.** Half of a mature project's activity is
   automation; a brief that quotes a bot as a person looks foolish, and a "fix" a rule will
   undo looks worse.
10. **Canonical versus stale page**, from last-modified plus inbound links plus labels. Citing
    the wrong roadmap page costs trust fast.
11. **Aliases across systems.** One person page instead of four is what makes "who keeps
    pinging me" answerable.
12. **The rate at which parked questions go unanswered.** The honest measure of whether Qale
    asks too much, and it generalises across people.
13. **The calendar as a leave detector.** OOO, parental leave and the July shutdown change who
    owns what and when a promise can be kept.

## What only the PM can ever supply

1. What they are judged on this quarter, in the words their manager would use.
2. Who has veto, per kind of decision, and who they must never surprise. Transcripts show who
   talks, never who can stop it.
3. What Qale must never write or send, which accounts may never be named, and what is private
   even from the workspace.
4. Promises made outside every connected system: a corridor, a Slack DM, a board meeting.
5. Pricing exceptions and side deals per account.
6. Where the honest roadmap and the real pricing live when the Confluence page is not it, and
   whether the page they are looking at is true today. Freshness is arithmetic; truth is not.
7. What they hate doing, and whether they want to be pushed or left alone.

## Where the three models differed

They covered the same eleven domains with about 80% overlap in items. Fable added the two
domains "time and rhythm" and "other tools and where truth spills"; Opus added "channels" and
"numbers and instruments", which fold into the same two. Opus was the only one to name
restricted pages and read-only projects, the draft-versus-sent diff, and "what each person was
last told". Fable was the only one to name dead labels, mandatory labels by convention, macros
in use, and the leave detector. Sonnet was the only one to name automation that silently
undoes a fix, the lag between promise and delivery by source type, and "which process steps
are official but skipped". Confidence ratings agreed within one step on almost every row.
