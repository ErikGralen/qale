# Product understanding

How the app goes from an empty workspace to actually knowing the product. Written 2026-08-07
against the code as it stands. Two halves:

1. **The first look.** The system surveys Confluence and Jira, recommends what to read, and keeps
   watching for new places worth reading. The user confirms with checkboxes, never types a space
   key from memory.
2. **The understanding.** What the system writes down about the product, high level only, governed
   by a skill the user can edit. The picture comes from the user in an interview; the synced
   material checks it rather than writes it. This replaces the about-us skill.

**How to use this doc.** Same convention as onboarding and beta-launch: one ticket per thing, write
your call under **Decision**, fill **Notes** as each one lands.

**The problem being solved.** The opening ends, the workspace is empty, and the memory has nothing
to say for the first week. Today the user must pick containers from a raw alphabetical list (they
may have forty spaces), and the "tell it about your product" First steps row asks them to write an
essay into a skill file on day one. Both asks put the work on the person the product is supposed to
be working for.

---

## Part 1: The first look

The moment an Atlassian connection verifies, the system looks at where the connected person
actually works and says so: "We took a look. These five seem to be where you live. Read them?"
One checkbox per row, a one-line reason per row, an explicit confirm. Then it keeps looking: a
new space with real activity in it gets offered quietly later, and a decline sticks.

What stays as it is: the follow set is the single source of truth, Settings → Connections remains
the place to add and remove at any time, and a newly followed container syncs immediately
(`setFollow` already triggers a tick).

### FL-1. The footprint survey

**Today:** `listContainers()` (connector.ts:177) returns kind, id and name, nothing else. The
picker cannot rank because it knows nothing about activity. The Atlassian client already has
`searchIssuesMeta` (JQL) and `searchPagesMeta` (CQL), which is everything a survey needs.

**Proposal:** a new optional connector method, something like
`surveyFootprint(): Promise<ContainerFootprint[]>`, returning per container: a count of items the
connected person touched recently and when they last touched one. Because Atlassian auth is the
user's own API token, `currentUser()` in a query means the right person with no extra identity
work. Two queries, both bounded:

- Jira: `assignee = currentUser() OR reporter = currentUser(), updated >= -90d`, grouped by
  project client-side from the issue keys.
- Confluence: `contributor = currentUser() AND lastmodified > now("-90d")`, grouped by space.

Cap the result pages (the survey needs "12 pages in DESIGN", not all 12 pages). A survey failure
is never fatal: the caller falls back to the unranked catalogue, which is exactly today. Calendars
are out of scope; Google already follows a different rhythm and has no forty-container problem.

**Decision:** Implement as proposed (Erik, 2026-08-07)

**Notes:** Built.

- `packages/connectors/src/types.ts`: new `ContainerFootprint` (kind, id, count, optional
  `lastTouched`) and an optional `surveyFootprint()` on `Connector`. Optional on purpose: Google
  omits it, and a missing method reads the same as a failed survey.
- `packages/connectors/src/atlassian/connector.ts`: `surveyFootprint()` runs both products in
  parallel, each in two steps. First a sample page (100 rows, 2 pages max) newest-first to learn
  which containers are in play and when each was last touched; then one count query per container
  for the number the card shows. The count step is the deviation worth knowing about: Jira's
  `/search/jql` returns no total at all, so a card built from the sample would say "100 tickets"
  for a project with nine hundred. Only the top 8 containers get a count request. Every failure
  degrades: a dead product leaves the other's rows, a failed count falls back to the sample.
- `packages/atlassian/src/client.ts`: `countIssues(jql)` (POST `/rest/api/3/search/approximate-count`),
  `countPages(cql)` and `searchPageSpaces(cql)` (both read the v1 search's `totalSize`; the latter
  expands `content.space` because ordinary page search never says which space a hit is in, with a
  `resultGlobalContainer.displayUrl` fallback). `searchIssuesMeta` took an optional page cap.
- Window is 90 days, in one constant each for JQL and CQL.
- Tests: three in `packages/connectors/test/atlassian-connector.test.ts` asserting the exact
  `currentUser()` queries, that counts are the provider's totals and not the sampled page, that one
  product failing leaves the other standing, and the count-query fallback.

---

### FL-2. The recommendation card

**Today:** after a verify, the container list unfolds in place (onboarding `Connections.tsx`,
`ContainerList`), flat and unranked, nothing preselected, with "Pick at least one, or it reads
nothing" as the only guidance. The same list lives in Settings.

**Proposal:** run FL-1 when a connection verifies and render its result as a recommendation:

- Recommended containers on top, checked, each with its reason line ("you edited 12 pages here
  last month", "9 open tickets assigned to you"). The reason is the feature; a recommendation
  without one reads as a guess.
- Everything else below, unchecked, collapsed behind one line ("14 more spaces").
- One confirm writes the follows through the existing `setFollow`. Nothing is followed until it
  is pressed.

This amends the onboarding rule "preselect nothing". The rule was written against silently
following everything; a checked box with a stated reason and an explicit confirm is a different
thing, and the rule's text in `docs/onboarding.md` (ONB-11) should be updated to say so when this
lands. If the survey fails or comes back empty (a brand-new hire has no footprint), the card
degrades to today's flat list without comment.

Same component in both frames, onboarding and Settings, like `ConnectForm` today.

**Decision:** Implement as proposed (Erik, 2026-08-07)

**Notes:** Built.

- `apps/desktop/src/renderer/src/components/FollowPicker.tsx`: the one card. Recommended rows on
  top, ticked, each with its reason line; the rest behind "14 more spaces"; one confirm that walks
  the list and calls the existing `setFollow` for every box whose state actually changed (so
  re-confirming does not kick off sync ticks for containers already followed). Survey answers are
  cached per connection for the app run, because reopening the picker is not new information.
- Reason lines are built in `sync-service.ts` (`footprintReason`), not in the renderer, so both
  frames say the same thing: "You edited 12 pages here, the last one 3 days ago" / "9 tickets are
  yours here, the last one yesterday". The count is the provider's real total (FL-1's second
  query), never the sampled page.
- New IPC: `connections:recommend(connectionId)` → `ContainerRecommendationDTO[]`
  (`packages/ipc`), handled by `SyncService.recommend`, which returns `[]` for a provider with no
  survey, a failed survey, or a footprint that matches nothing in the catalogue. The picker treats
  `[]` as today's flat list and says nothing about it.
- Onboarding `screens/Connections.tsx`: `FollowList` deleted, `FollowPicker` in its place, and the
  card's own Done is now the picker's confirm.
- Settings `ConnectionsSettings.tsx`: a connection with nothing followed opens on the same picker
  instead of a flat list; once something is followed it settles into the existing per-row toggles
  (the right surface for maintenance: one box, one immediate effect), with a "Change what it
  reads" button to reopen the picker.
- `docs/onboarding.md` ONB-11: the "preselect nothing" bullet is rewritten to say why a ticked box
  with a stated reason and an explicit confirm is a different thing, and that no footprint means
  the old rule still applies.

Deviation worth noting: nothing runs the survey at verify time. It runs when the picker opens,
which is the same moment from where a person sits and keeps the connect path free of a network
call that could fail.

Unverified: needs live Atlassian credentials. The queries and the fallbacks are fixture-tested at
the connector level (FL-1), but no run of this card against a real site has happened, and no
Electron app was launched (keychain prompts on this machine).

---

### FL-3. The drift check

**Today:** `refreshContainers` runs on every sync tick and only ever adds unfollowed rows, so the
store already accumulates the containers the user has not followed. Nothing ever looks at them
again, and nothing notices that one of them is new and full of the user's own edits.

**Proposal:** a librarian worklist item, not a new job. On a weekly cadence (not every tick), the
tick diffs the catalogue against three sets: followed, previously seen, and declined. A container
that is new since the last check AND has user footprint per FL-1 becomes one quiet offered
question: "Noticed a new space, Payments Redesign. You have edited eight pages there. Follow it?"
Accept writes the follow through `setFollow`; decline writes the declined ledger and the question
never returns for that container (same posture as the capture-nudge dismiss ledger). No footprint,
no question: a new space the user has never touched is not news.

The ledger and the seen set live in the connector store next to the follows, since they are facts
about containers, not about notes. The offered question decays like other librarian questions.

**Decision:** Implement as proposed (Erik, 2026-08-07)

**Notes:** Built.

- `packages/vault/src/sync-store.ts`: two columns on `sync_containers` (`first_seen`, stamped once
  on insert and never moved, and `offer_state`: pending / offered / declined), plus a small
  `sync_meta` key-value table holding when the drift check last ran. Both migrations are the same
  idempotent ALTER TABLE the item table already used, so existing workspaces upgrade in place, and
  rows that predate this read as `first_seen: null`, which is exactly "was already here".
- `sync-service.ts`: `containerOffers()` runs at most weekly. The first ever call only records the
  baseline and asks nothing, because otherwise connecting a site would make all forty spaces "new".
  After that it diffs the catalogue against followed / seen / declined, surveys the survivors, and
  marks the ones with real footprint `pending`, keeping the reason line beside them in `sync_meta`
  so the question can be raised weeks later without re-surveying. `markContainersOffered` and
  `answerContainerOffer` are the two ways a row leaves `pending`.
- `packages/application/src/use-cases/librarian.ts`: `planLibrarianSweep` takes `opts.extra`, and
  `newContainerFinding` builds the worklist line. Offers are placed ahead of the repairs. Passing
  them through the ordinary ledger is the point: the settle window, the quiet window, the interval
  and the card cap all apply unchanged, and "do not ask twice" is what that machinery is for.
- `handlers.ts` runs the drift check inside the existing maintenance pass, passes the offers in as
  extras, and marks each offered container the moment a session is handed it. Offered means asked:
  a question left sitting is still a question they were asked.
- New agent tool `follow_container(container_id, follow)` beside `track_external` (same seam: it is
  sync state, not an API call; a read decision, so no approval card). A decline is written to the
  declined ledger and that container is never raised again.
- `agents/librarian/AGENT.md` gained a section telling it this one is a question rather than a
  repair: ask with `ask_user`, record both answers, never follow anything unasked. Mirrored into
  `vault-dev/agents/librarian/AGENT.md` and appended in `shipped-versions.ts`.
- Tests: three in `packages/application/test/librarian-sweep.test.ts` (settle, asked-once, ordering
  ahead of repairs) and three in the new `packages/vault/test/sync-store.test.ts`.

Two things to know. The store tests SKIP on this machine: `better-sqlite3` here is built for
Electron's ABI, which is what every other sqlite test in that package already does. And the whole
path is unverified end to end without a live site and a week of sync history, which is what FL-3
needs to be worth watching at all.

---

## Part 2: The understanding

The goal: the system holds a high-level picture of the product, written down where the user can
read and correct it. Three areas, deliberately few:

- **The product**: what it is, who it is for, what it is trying to do right now.
- **The technical shape**: the architecture in general terms, the big constraints, the names of
  the moving parts. Not code documentation.
- **The organization**: teams, who owns what, who the recurring names are.

High level only, everywhere. The understanding records the shape; the detail stays in the sources
(the synced pages, the tickets, the notes) and the understanding cites them rather than repeating
them.

One assumption to get right: the sources are the check, not the author. Most teams have no page
that says what the product is and who it is for, so mining the synced material for that picture
drafts confident mush. The picture comes from the user (U-2); the material's job is to catch the
recorded picture drifting from reality (U-1's watch clause), which is the job it is actually good
at.

### U-1. The understanding skill

**Today:** the `_about-us` skill (`defaults.ts` `ABOUT_US`, `starts: [always]`) is a fill-in
template: six headed sections of italic prompts the user is asked to replace with prose. It puts
the writing on the user, and nothing ever helps them do it.

**Proposal:** a new default skill that inverts the direction: it is instructions to the agent
about how to keep the product understanding, not a form for the user. The user edits it to change
the policy, not to supply the content. `starts: [always]` like about-us, so every session knows
where the picture lives and what it may do to it. The body covers:

- **What to record**: the three areas above, high level only, with a line or two per area saying
  what belongs and what does not ("architecture means the five boxes and the arrows between them,
  not the code").
- **Where to record it**: the default says notes in the workspace, one per area. But this is the
  line the user is most likely to edit, and the skill says so out loud: a team that keeps this in
  Confluence points the skill at the page instead, and it works because writing to a Confluence
  page already goes through the outbound approval path (`update_page`). The skill file is where
  that preference lives; no settings surface, no new machinery.
- **How to change it**: tighten only. Sharpen, update, strike what is stale; never balloon.
  Claims the user stated themselves land verified, because the user is the source; claims
  inferred from synced material land unverified until confirmed (the trust marks that already
  exist). The freshness machinery applies either way, so an old understanding admits its age.
- **What to watch**: when synced material contradicts the recorded picture, propose the
  correction rather than silently absorbing either side.

Naming needs a pass (ONB-10 discipline): "Qale's understanding" is close but slightly mystical.
Working candidate: title "Product understanding", first line of each note it maintains reading
"Qale keeps this up to date. Correct anything wrong." The contract matters more than the name.

**Decision:** Implement as proposed (Erik, 2026-08-07)

**Notes:** Built as `PRODUCT_UNDERSTANDING` in `packages/sessions/src/defaults.ts`, seeded to
`skills/_understanding/SKILL.md`, `starts: [always]`, title "Product understanding". Mirrored to
`vault-dev/skills/_understanding/SKILL.md` (verified byte-identical) and fingerprinted in
`shipped-versions.ts`.

The three notes are named in the body so everything downstream agrees on where they are:
`notes/understanding-product.md`, `notes/understanding-technical.md`,
`notes/understanding-organization.md`. Flat files under `notes/` rather than a folder of their own,
because the vault tree groups by note type and a fourth top-level folder would have been invisible
in it anyway; the shared `understanding-` prefix is also what U-4 keys its First steps detection on.

The body covers what the ticket asked for: the three areas with a line each on what belongs and
what does not ("architecture means the five boxes and the arrows between them, not the code"); the
default location plus the out-loud invitation to point it at a Confluence page instead, which works
through the existing `draft_confluence_update` approval path; tighten-only, with the rule that an
edit which lengthens a note without making it truer is the wrong edit; verified for what the PM
said (concretely: set `verified` with a `human:` actor, which is what a note's Trust row renders)
and unverified for anything inferred from material; and the watch clause for contradictions,
including the line that silence is not disagreement.

One thing it says that the ticket did not ask for: do not write these notes from synced material on
your own, go through the interview. That is the assumption Part 2 rests on, and without it in this
file an always-on skill naming three empty notes reads as an invitation to fill them.

Length was the one real constraint, since this body rides in every system prompt. It is about as
long as the about-us template it replaces and no longer.

---

### U-2. The interview

**Today:** nothing drafts the understanding, and nothing asks. Even with Confluence flowing after
Part 1, the sources rarely contain the picture: recent activity describes this quarter's work, not
the product, and a draft mined from it would be confidently narrow at the exact moment the user is
deciding whether to trust the app.

**Proposal:** the user's head is the source of truth, so ask it. One offered session, a
conversation rather than a questionnaire, raised from the First steps row on Home and offered once
after onboarding whether or not any connection exists. The interview needs no connectors, which
also fixes the cold start for people who skipped Atlassian entirely.

- **One big invitation first.** "Want me to learn about your product? Tell me as much as you can.
  Useful things: what it is, who pays for it, what the big parts are called, what is being worked
  on right now. Talk, paste anything, or drop material in." A brain-dump ask beats a form; pasted
  or dropped artifacts go through arrival as usual and the draft cites them.
- **Options at every fork**, through the existing ask_user cards: tell me in your own words / drop
  something in / skip for now. Skip parks the question (parked questions survive a quit) and the
  gap gets re-offered quietly later; nothing is dropped on the floor.
- **The technical fork hands over the recipe.** When the technical area comes up, the session asks
  "Do you have access to the code?" and produces the U-3 prompt for Claude Code. The user runs it
  in their repo, drops the resulting file in, and the technical area gets drafted from it, citing
  it. No repo is fine: the five-boxes-and-arrows version can be told out loud like everything
  else.
- **Follow up only where an area is thin**, and leave an area empty with a stated reason sooner
  than fill it. "You did not mention who pays for this, so I left it blank" builds more trust than
  filler.
- **Close by drafting.** "I think I have a good picture now" and the understanding notes per U-1
  land as normal proposal cards. What the user said lands verified; anything inferred from
  material lands unverified.

The interview is itself a default skill, next to synthesis, so the invitation and the question
list are copy the user can edit, and it runs as an ordinary skill-run session (arrival never
authors, the librarian has no spawn). Once the first picture exists, upkeep belongs to the
librarian under U-1's tighten-only rule and needs no further sessions.

**Decision:** Implement as proposed (Erik, 2026-08-07)

**Notes:** Built as `LEARN_THE_PRODUCT` in `packages/sessions/src/defaults.ts`, seeded to
`skills/learn-the-product/SKILL.md`, `starts: [you-run-it, model-picks-it-up]`, title "Learn about
the product". Registered in `DEFAULT_SKILL_BY_NAME` so the First steps row can invoke it by name,
mirrored into `vault-dev/skills/learn-the-product/SKILL.md` (verified byte-identical), fingerprinted
in `shipped-versions.ts`.

It is an ordinary skill-run session and nothing else: no new machinery, no new tools. Everything the
ticket asked for is copy in the body.

- The one big invitation is quoted almost verbatim from this doc, with the instruction to stop
  talking after it.
- Forks use the existing `ask_user` with the three options (own words / drop something in / skip
  for now), and the body says out loud that skip parks the question rather than dropping it.
- The technical fork asks "Do you have access to the code?" and hands over the U-3 prompt inline.
- Read-first names the leftover `_about-us` file as a source, which is what makes U-4's "a filled-in
  one is user data" promise mean something.
- The close drafts the notes as ordinary proposal cards, with the verified / unverified split and
  explicit permission to leave an area empty with a stated reason.
- It needs no connectors, so the cold start works for someone who skipped Atlassian entirely.

The First steps row that raises it is U-4's item; see there. It is not offered a second time on its
own: once the row is ticked the invitation is done, and a still-empty area comes back through the
librarian rather than through another interview.

Unverified: the conversation itself has never been run. That needs a live key and a person to talk
to, and nothing about it can be fixture-tested honestly.

---

### U-3. The Claude Code recipe

**Today:** nothing serves the technical half. Summarizing architecture from Jira ticket titles
produces confident mush; the honest source is the repo, which the app cannot see.

**Proposal:** a recipe, not a feature, and the interview is where it finds the user. Nobody goes
looking for a recipe in the docs, but everyone answers "do you have access to the code?" when the
interview asks at the right moment (U-2's technical fork). The prompt asks Claude Code, run inside
their product's repo, to write a high-level technical overview as a markdown file: what the system
is, the major components, the constraints, in prose a non-engineer can read. The user drops the
file into Qale, arrival files it as material like anything else, and the understanding's technical
section gets drafted from it, citing it.

Secondary surfaces for people who skipped the interview: the docs, and one line on the
understanding note's empty technical section ("Have a repo? There is a faster way to fill this
in.").

Zero new machinery. The only work is writing the prompt well (it should insist on high level and
on plain language, or the output will be a README).

**Decision:** Implement as proposed (Erik, 2026-08-07)

**Notes:** Written, and it lives inside U-2's technical fork as a fenced block the PM can copy. It
is reproduced here as the secondary doc surface:

```
Read this repository and write a high level technical overview of the product as a markdown file
called product-overview.md.

Write it for a smart colleague who does not write code: a new product manager, a designer, a
support lead. Plain language, and explain any term that is not obvious from outside the team.

Cover, in prose:
- What the system is, and what it does for the people who use it.
- The major parts and how they fit together. Five to ten of them, and what each one is for.
- Where the data lives, and what moves between the parts.
- The constraints that shape decisions: the platform, what is slow or expensive, what nobody wants
  to touch, what would need a rewrite.
- The names the team uses for things, including internal names an outsider would not guess.

Keep it under two pages. Do not list files, functions, endpoints or dependencies. This is not a
README and not a setup guide. Where something is genuinely unclear from the code, say so instead
of guessing.
```

Four things in it are load-bearing, and each one is there because leaving it out produces a README:
naming the reader (a smart colleague who does not write code), asking for prose, banning the file
and endpoint lists outright, and the two-page cap. "Say so instead of guessing" is the last one:
without it the model narrates the parts of the repo it did not understand.

The third surface the ticket asks for, one line on an empty technical section pointing at the
recipe, is left to the drafting agent rather than hardcoded: `_understanding` already tells it to
say what is missing and why in an empty area, and the interview holds the prompt. A hardcoded line
would need a template for a note the agent writes in its own words.

---

### U-4. Retiring about-us

**Today:** `_about-us` ships in defaults, has a First steps row ("Tell it about your product",
detection at `handlers.ts:1169` on saves under `skills/_about-us/`), and appears in
`shipped-versions.ts`. Two "tell the system about your product" surfaces would confuse everyone,
so about-us goes when U-1 lands.

**Proposal:**

- **Sections map out, not away.** "What we build", "Who our customers are" and "What we are
  trying to achieve" become the understanding's product area. "Words we use" belongs with the
  language/voice skills, which is where vocabulary already conceptually lives. "Who we write
  updates for" was already flagged in the template as overlapping the voice skills. Nothing in
  the template lacks a home.
- **A filled-in about-us is user data.** For an existing workspace where someone wrote real prose
  into it, do not delete the file; leave it, stop shipping it for new workspaces, and let the U-2
  draft cite it as a source (it is the best source there is). Only a byte-identical untouched
  template gets removed by the shipped-skill upgrade path.
- **The First steps row repoints**: from "edit this skill file" to starting the U-2 interview,
  with detection on the first accepted understanding proposal instead of a file save. The row's
  lesson changes from "skills are files you edit" to "you talk, it drafts, you approve", which is
  the bigger idea anyway.

**Decision:** Implement as proposed (Erik, 2026-08-07)

**Notes:** Built.

- `defaults.ts`: the `ABOUT_US` template string is deleted (git history keeps it) and
  `skills/_about-us.md` joins `RETIRED_SKILL_FILES`. Its fingerprint moves to the retired block of
  `shipped-versions.ts`, where it has to stay forever: it is the only way to tell an untouched
  template (safe to take away) from one somebody wrote real prose into (theirs, left on disk,
  renamed out of force by the existing `retireSkillFile` path). No new machinery for any of this;
  the skill-pack upgrade path already did exactly the right thing.
- The sections map out as the doc says: the product ones are the understanding's product area, and
  vocabulary belongs with the voice and language skills, which already own house words.
- `vault-dev/skills/_about-us/` is deleted, so the demo and a fresh install agree.
- First steps row (`onboarding/FirstSteps.tsx`): "Tell it about your product" now reads "It asks,
  you talk, and it writes down what you said", its button says Start, and it opens a fresh session
  on `learn-the-product` with an opening prompt so the agent starts talking rather than sitting
  there. The row id is `understanding`; a workspace that already ticked `about-us` stays ticked,
  because somebody who filled in that file has still told it about their product.
- Detection moved from `note:save` under `skills/_about-us/` to `proposals:accept` on a card whose
  target starts with `notes/understanding-`. That is the same event this row is now about: the
  approval, not a file save.
- `FirstStepId` in `packages/ipc` gains `understanding` and keeps `about-us` for the stamps that
  already exist.

The interview's own claim on the `_about-us` file is the other half of "a filled-in one is user
data": `learn-the-product` names it as a source to read before asking anything, so a workspace
where somebody did write that essay gets it used rather than orphaned.

---

# Order

FL-1 before FL-2 and FL-3 (both consume the survey). FL-2 is the visible win on the connections
side; FL-3 is small once FL-1 exists but wants a real week of sync history to be worth watching.
U-1 is just skill copy plus deleting nothing yet, and can land any time; U-2 needs only U-1 (the
interview runs with zero connections, so it no longer waits on FL-2) and is the visible win on the
understanding side. U-3 is an afternoon and lands inside U-2's technical fork. U-4 last, once the
replacement demonstrably works. The two parts are now independent tracks and can proceed in
parallel.

Both open questions were settled 2026-08-07: the recommendation card runs wherever a connection
verifies, Settings included, same component in both frames; and the footprint window stays at 90
days, which is wide enough to catch someone returning from ordinary leave.
