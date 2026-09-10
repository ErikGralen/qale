# Approaches: what to do about the challenges, under the constraints we have

Written 2026-09-10 against the code as it stands. Reads with docs/future/challenges.md.
Same convention as the ticket docs: options, a lean, and your call under **Decision**.

## The constraints, and what each one forbids

- **a. Minimal implementation time for the MVP.** Nothing that takes more than a few days
  before it pays back.
- **b. Little money.** Model spend in the tens of dollars per experiment, not hundreds.
  No hosted infrastructure, no paid labeling.
- **c. Local-first builds trust early.** The vault stays on the machine, and nothing is
  stored elsewhere without a visible act by the user.
- **d. Get there quickly.** Prefer the answer we can have this week over the better answer
  next month.
- **e. The MVP may be thrown away.** The future product may be a rebuild.

Constraint e changes what we should invest in. Code written for the MVP may not survive.
What survives a rebuild is evidence: fixtures, expected outcomes, graders, labeled
proposal outcomes, generated vaults, and the decisions we wrote down. So the rule for the
next weeks is: spend on evidence, keep the machinery thin, and keep the evidence outside
the code that may be deleted.

Two facts from the code make this cheaper than it looks:

- `AgentRuntime` takes a plain config: a vault dir, a user-data dir, a model id and a key
  (`packages/agent/src/runtime.ts`, `AgentRuntimeConfig`). No package under `packages/`
  imports Electron. A headless run is a Node script, not a harness.
- The proposal store already records `status`, `edited_payload_json`, `evidence_json`,
  `skill` and `kind` (`packages/vault/src/proposal-store.ts`). The labels from challenge 5
  are already being written. They are only not being read.

Cost reference, from the measured run in docs/agent-speed.md: 32k output tokens on
Sonnet at $10 per million, plus 22 turns of a 40k cached prompt. About fifty cents a
drop at `medium`, less at `low`. A hundred drops is fifty dollars.

---

## 1. The eval substrate

**Options**

- A. **The manual golden run.** What exists today: `pnpm refresh-demo`, drop the fixture
  by hand, `pnpm session-stats`, read the proposals. Add one grader script that reads the
  proposal store and the session file against an `expected.json`. About a day. Every run
  still needs a person at the app, so three trials per case is a morning.
- B. **A headless runner plus graders.** `scripts/eval-run.ts` builds a temp copy of a
  fixture vault, constructs `AgentRuntime` with the config above, runs the arrival skill
  with `unattended: true`, answers any `ask_user` with a fixed policy (fail the case, or
  take the first option, per case), waits for settle, and dumps the proposals and the
  session file into `evals/runs/<case>/<trial>/`. Graders read that folder. One to two
  days, most of it discovering what the desktop main process does before `run()` that
  the script must repeat (skills seeding, index build, git init).
- C. **A full harness.** Judge model, CI, dashboards. Not now, and possibly never in this
  codebase (constraint e).

**Graders.** Deterministic first, because they are cheap and never wrong:

- the meeting page proposed matches the expected calendar candidate;
- every expected commitment has a todo whose quote appears verbatim in the source;
- every expected decision names its decider;
- no todo duplicates an existing one in the fixture vault;
- proposal count by kind, within an expected range;
- time to first proposal, thinking tokens, wall time (from `sessionStats`).

A judge model (Haiku) only for the things a string match cannot grade: is the meeting
summary faithful, is the rationale honest. Add those after the deterministic set has run
for a week, and only if the deterministic set stops finding regressions.

**Nondeterminism.** Three trials per case. Report pass rate per check, never one
pass/fail. A prompt change ships when no check's pass rate drops.

**Fixtures.** Start with what exists: vault-dev plus the transcripts in `demo-samples/`.
That is three to five write cases. Add one read case per shelf ("which customer asked
for SCIM", "what did we decide about pricing") with the expected page slugs. Ten cases
total is enough to catch a regression, and small enough to run every day. Erik's own
vault is free ground truth for a private set of cases that never leaves his machine.

**Where it lives.** A root `evals/` folder: `cases/`, `runs/` (gitignored), and the
graders as pure functions in `packages/agent/src/` beside `session-stats.ts`. The cases
and the expected outcomes are the part that survives a rebuild. Keep them as plain JSON
and markdown, with no import from the app.

**Lean:** B. The runner is what turns every later question into a batch job that costs
dollars instead of afternoons. Under constraint d, A first is tempting, but every hour
spent dropping fixtures by hand is an hour the runner would have paid back within the
week.

**Decision:**

**Notes:**

---

## 2. Speed against quality on the standard prompts

The prompts are three layers, and they cost differently:

- the skills (`packages/sessions/src/defaults.ts`, `vault-dev/skills/*/SKILL.md`), which
  the user can read and edit;
- the tool descriptions in `packages/agent/src/tools.ts`, 27k cached tokens across 41
  tools;
- the system preamble in `packages/agent/src/prompts.ts`.

**The approach is one loop, not a rewrite.** Take one prompt change, run the ten cases
three times, compare pass rates and time to first proposal against the last run, keep or
revert. docs/prompt-maxxing.md says current models want fewer instructions, so most
changes are deletions, and a deletion is a one-line diff with a measurable effect. Do the
skills first: they are the most prescriptive text, they are what a beta user reads, and
the arrival skill is the one on the critical path. Tool descriptions second, and only if
thinking on the fixture stays above about 5,000 tokens a run after AS-2 (the trigger
docs/agent-speed.md already set). The preamble last.

**The model question is part of this.** AS-6 (run the fixture on Haiku) and AS-7 (does a
drop need ten proposals) are the two levers that move the floor, and both are decided
from runner output. Run them in the first batch.

**What is owed first.** The `medium` baseline that docs/agent-speed.md says the four
built tickets were never measured against. It is the first thing the runner produces.

**Lean:** build nothing new for this beyond the runner. The loop is the work.

**Decision:**

**Notes:**

---

## 3. Schema design, or the folder question

**Options**

- A. **Decide by reasoning, keep migrations one-time, revisit after usage.** The
  MT-8 pattern (one move, one commit, one Activity row) already makes a layout change
  cheap for an installed workspace. Zero cost now.
- B. **One generated vault, once.** Generate a year of a fictional company with Haiku:
  about 200 transcripts, calendar entries and a few pasted documents, from a seed
  description of the company, its people and its arc. Under ten dollars. File all of it
  through the headless runner with every card auto-approved: about a hundred dollars on
  Sonnet, less on Haiku. The result is a vault of roughly a thousand pages, filed the way
  the product files, with a known ground truth (the generator knows every decision and
  commitment it planted). To compare two layouts, file the same material twice under two
  skill and schema variants. Two to three days, about two hundred dollars.
- C. **Design partner vaults.** Real, but slow, and needs consent and an export path (see
  challenge 5). Months, not weeks.
- D. **Public corpora.** Deferred to funded, full-time work (Erik, 2026-09-10), but
  recorded here because two of them fit better than anything generated. Details in
  "Public datasets" below.

**What the generated vault answers.** Whether the root map still fits the prompt at a
thousand pages. Whether FTS returns the right page for the twenty read cases, or noise.
Whether the agent's filing drifts (duplicate people, customers split across two slugs,
insights that should have extended a research page). Whether shelf set A finds things
better than shelf set B. These are exactly the questions from the original conversation,
and none of them can be answered at vault-dev size.

**What it does not answer.** How a real PM writes, what they ask, and what they approve.
Generated material is regular in ways real material is not. Treat the results as a
stress test of the machinery, not as a measure of product quality.

**Lean:** A for the MVP layout, and B as the one experiment to run after the runner
exists. Under constraint e, the layout finding matters more for the rebuild than for the
MVP, and B is the cheapest way anyone will ever get it. Keep the generated vault: it is
an asset, and it is the fixture for challenge 4. D replaces most of B once there is time
for it.

**Decision:**

**Notes:**

### Public datasets (option D, for later)

Three families, in order of fit.

**Annotated meeting corpora.** These fit the arrival write task directly, because the
labels we would otherwise hand-write already exist.

- **AMI Meeting Corpus.** 100 hours. The scenario half role-plays a product team
  designing a remote control over four meetings. Each meeting has an abstractive summary
  with DECISIONS, PROBLEMS and ACTIONS headings, and 101 meetings carry 381 annotated
  action items. That is the expected set for the arrival graders: decisions and
  commitments per transcript. Caveats: role-play from around 2005, one product, and
  action-item annotation is subjective (agreement on the sibling ICSI corpus is low), so
  grade recall against a fuzzy set, not exact match.
  https://groups.inf.ed.ac.uk/ami/corpus/annotation.shtml
- **ELITR Minuting Corpus.** 120 English and 59 Czech real project meetings, about 180
  hours. Most meetings have several minutes written independently by different people:
  a dataset of "what different people think was worth keeping", which is challenge 5 in
  raw form. https://aclanthology.org/2022.lrec-1.340.pdf
- **QMSum.** Queries and answers over AMI, ICSI and parliamentary committee transcripts.
  Ready-made read cases: question in, expected answer grounded in a transcript.
- **MeetingBank.** City council meetings with decisions. Real and large, but nothing
  product-shaped happens in it. https://ar5iv.labs.arxiv.org/html/2305.17529

**Open-source product processes run in public.** Months of one product evolving, with
real people, real requests and recorded outcomes.

- **GitLab.** Product management in public issues and epics, with opportunity canvases
  and a handbook describing the process. Real PMs are the authors, customer requests are
  cited, prioritization is written down. The closest public thing to a B2B PM's world.
  https://handbook.gitlab.com/handbook/product/product-management/
- **TC39 notes.** Near-verbatim transcripts of the JavaScript standards plenary, with the
  decision recorded at the end of each agenda item, and a proposals repo tracking stage
  advancement. Features only, never bugs, going back years.
  https://github.com/tc39/notes
- **RFC processes.** Rust RFCs, Python PEPs, Kubernetes enhancement proposals, Swift
  Evolution. Each is problem, options, discussion, decision with rationale and a named
  decider. Engineering audience, but the shape is a decision record.
- **Feature request boards.** The Godot proposals repo is explicitly features and not
  bugs, with a template of problem, proposed feature and alternatives. GitHub Discussions
  "ideas" categories and public Canny boards are the same thing. Customer voice with
  verbatim quotes.

**How they map onto the plan.** The meeting corpora replace the hand-written expected
outcomes in challenge 1: dozens of write cases at zero generation cost. GitLab or TC39
replaces most of option B: feed one group's issues and meeting notes chronologically as
arrivals, then ask "what did we decide about X and why" and grade against the recorded
outcome. That is a real longitudinal vault with real ground truth, and it stresses filing
drift, duplicate people and hub growth in ways a generator does not. Generation stays
for two things: Swedish material for the tokenizer work, and planted ground truth at
sizes the public corpora do not reach. For Swedish, municipal council protocols and the
Riksdag's open data are decisions in Swedish; formats not checked.

**Caveats.** Check licences before any of it ships as demo content; internal evals are
fine. The corpora name real people, so they stay internal. The domain is
engineering-heavy, so the customer and person shelves are exercised differently than for
a PM at a SaaS company. GitLab is the least affected.

---

## 4. Retrieval as the vault grows

**For the MVP:** M1 to M4 from docs/mvp-strategy.md, unchanged. Trust weighting in
ranking, a tokenizer that works in Swedish, caps on what a tool returns, and index lines
that state purpose. All offline, all small, a few days together. Embeddings stay deferred,
but the trigger is now concrete: if the read cases fail on the generated vault with FTS
alone, add `sqlite-vec` and a small local model. If they pass, do not.

**For the future product:** do not build ranking or traversal now. Build the record that
a future engine would be evaluated against. Most of it exists: the session file logs
every `vault_read`, `vault_list` and search the agent made, and every proposal's
`evidence_json` says which pages it cited. Two small additions make it a dataset. Keep
session files out of anything that deletes them (`refresh-demo` deletes the demo's; a
real workspace keeps its own in `sessions/`). And write a read case for every real
question a user asks in chat that the agent answered well, with the pages it opened as
the expected set. That is the retrieval ground truth a hosted engine would need, and it
costs nothing to accumulate.

**Lean:** M1 to M4, then nothing until the generated vault says what fails.

**Decision:**

**Notes:**

---

## 5. Expectation alignment

Three things, in order of cost.

**Read what is already written.** A script over the proposal store and git history:
approval rate by skill and kind, how often the PM edited before approving, how big the
edit was. This is one query. It runs on Erik's vault today and on any partner's vault
they choose to share. It is the quality number that challenge 2's speed work must not
lower.

**A reason on reject.** One tap when a card is rejected: wrong, duplicate, not now, do
not want this. Stored beside `status`. Without it a rejection says nothing about which
of four different failures happened. Half a day.

**Send the counts.** The telemetry sender is built and holds itself to counts and
booleans (docs/telemetry-posthog.md). TEL-1, the PostHog account, is the only thing
missing. Add one event: card decided, with skill, kind, outcome, an edit-size bucket and
the reason. No content leaves, the consent screen already lists what is sent, and across
a beta of ten people it gives approval rate per proposal kind, which is the alignment
number at zero trust cost.

**For content, a visible act.** An "export evaluation bundle" action in Settings that
zips the session files and the proposal store, for the two or three partners who agree
to hand it over by email. No upload, no server, no account. It preserves constraint c
because the user does it, sees what is in it, and can open the zip. Half a day. That
bundle plus the graders is a real eval case from a real vault, which no generated
material replaces.

**Lean:** all four. Together they are two days, and they are the cheapest ground truth in
the plan.

**Decision:**

**Notes:**

---

## 6. The moat, and the local-first question

**Under the constraints, the MVP stays local-first, and nothing hosted is built.** The
MVP's job for the moat is three things: prove that PMs approve cards and keep coming
back, accumulate labeled outcomes with consent, and keep the format readable by other
tools so that leaving Qale is easy and leaving the format is not.

**The trust line is narrower than "nothing leaves".** Session text already goes to
Anthropic on every run, and the product overview says so. What users are promised is that
nothing is stored elsewhere and nothing changes without approval. A remote index or a
remote ranker, opt-in, behind the same consent screen, is the same category of trust as
the remote model. That makes the future decision smaller than "stop being local-first".
It is "which reads may go through a service, and what still works with the network off".
Write that boundary down now, even if nothing is built against it: reading, editing and
searching your own notes work offline, always; the agent needs the network, already; a
ranker may, later.

**What carries over if the MVP is rebuilt.** Make these first-class, versioned, and
outside `apps/desktop`:

- `evals/cases/` with expected outcomes;
- the graders, as pure functions with no app imports;
- the generated vault and its planted ground truth;
- exported partner bundles, kept where consent allows;
- the docs under `docs/` and the format (OKF).

Everything else in the repo is allowed to be disposable.

**Lean:** decide the offline boundary in one paragraph, build nothing hosted, and treat
the evidence list above as the product of the next six weeks.

**Decision:**

**Notes:**

---

## Sequence

A rough order for the next three to four weeks, with the model spend beside it.

1. **The runner and the deterministic graders, ten cases.** Two days. Capture the `medium`
   baseline owed from docs/agent-speed.md. About ten dollars.
2. **The prompt loop on arrival, plus AS-6 and AS-7.** One change at a time, three
   trials each. A week of short iterations. Fifty to a hundred dollars.
3. **Alignment: the outcomes query, the reject reason, TEL-1 and the card event, the
   export bundle.** Two days. No spend.
4. **M1 to M4.** A few days. No spend.
5. **The generated vault, once, under the current layout.** A weekend. About a hundred
   dollars. Run the read cases on it. Decide embeddings and the layout experiment from
   what fails.
6. **The layout comparison,** only if step 5 shows the layout is what fails, and not
   filing. Another hundred dollars.

Total model spend under three hundred dollars, most of it in step 5.

## Not now, and what would revive it

- **Anything hosted.** Revive when partner bundles show retrieval failing in ways local
  ranking cannot fix, or when a second user needs the same vault.
- **Public datasets (challenge 3, option D).** Revive with funding and full-time work.
  Start with AMI for write cases and one GitLab group for the longitudinal vault.
- **Embeddings.** Revive when the read cases fail on the generated vault with FTS alone.
- **A ranking or traversal algorithm.** Revive when there is a dataset to evaluate it on.
  Step 5 and the partner bundles are that dataset.
- **A judge model in the graders.** Revive when the deterministic checks stop catching
  regressions.
- **Fan-out for proposals (AS-9).** Revive per docs/agent-speed.md: time after the first
  proposal still over a minute after the prompt loop.
- **A design partner program with a formal consent flow.** Revive when more than three
  people want to send bundles. Until then, email is the flow.
