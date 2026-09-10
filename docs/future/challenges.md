# The challenges ahead: what has to be solved, and in what order

Written 2026-09-10 from a strategy conversation. Status: a formalization, not a plan.
The plan is in docs/future/approaches.md.

**The questions this started from.** How do we optimize the standard prompts for speed
without losing quality? How do we make sure the right information is saved in the right
shape? How do we do what the user expects? How do we run evals at small scale, and also
compare whole setups at large scale, for example one set of Memory shelves against
another on tasks X, Y and Z? And where is the moat, given that long term we may not be
local-first and may want our own algorithms for relevance and graph traversal as a user's
knowledge base grows?

## The knot underneath everything

Every one of those questions needs measurement, and local-first starves us of it. We
cannot tell whether a prompt cut hurt quality, whether six shelves beat four, or whether a
ranking algorithm helps, without ground truth. Today the ground truth is one demo vault,
one fixture transcript, and Erik reading proposals by hand. docs/mvp-strategy.md defers
embeddings and prompt budgets "until a real vault exists to measure against". Under the
current design no real vault ever reaches us. So the first problem is not prompts or
folders. It is the substrate that makes the other questions answerable.

## The six challenges

### 1. The eval substrate

A task is a triple: vault state, input, expected outcome. Qale has three task families.

- Write tasks: a transcript plus a vault, and the proposals that should come out.
- Read tasks: a question plus a vault, and the pages that should be found.
- Maintenance tasks: a vault with drift, and the fixes that should be proposed.

What is missing: a runner that does not need a person at the app (docs/agent-speed.md
AS-1 says the drop is manual because bootstrap lives in Electron), fixture vaults at
several sizes, graders, and a rule for nondeterminism. Some graders are deterministic:
the right meeting matched, the todo quote verbatim in the source, the decision names its
decider. The rest need a judge model. Three to five trials per case, because one run is a
measurement, not a result.

### 2. Speed against quality on the standard prompts

Already formalized in docs/agent-speed.md. Wall time is output tokens over throughput,
and the floor is the visible output. The levers are thinking level, turn count, model,
and how much a drop is asked to produce. docs/prompt-maxxing.md says the direction for
current models is subtraction. Subtraction without a regression suite is guessing. So
this is blocked on challenge 1, and the three named outcomes in AS-2 are the seed of the
suite.

### 3. Schema design, or the folder question

The six shelves (source, decision, insight, research, customer, person) are a hypothesis
about what a PM needs back later. A layout affects three things at once:

- where the agent writes: filing precision and how many cards a drop costs;
- what the model reads: index maps and prompt size;
- what the user browses.

Alternatives exist: flat pages plus tags, entity hubs, time-first. The test of a layout is
retrieval, not taste. Given the same source material filed under layout A and layout B,
does the same task battery succeed more often and with fewer tokens loaded? Two hard
parts. Layout differences only show at scale, and vault-dev is tiny. And real users
cannot be A/B tested on layout, because migrating them back and forth is not acceptable.
So this needs generated vaults.

### 4. Retrieval as the vault grows

Today search is BM25 over an English stemmer (docs/mvp-strategy.md M2), links are never
traversed, trust is a chip, and no tool has a limit. That works at fifty pages. At a
thousand the root map no longer fits the prompt and lexical search returns noise. At ten
thousand ranking and traversal are required.

The formal statement: given a query from the agent or the user, return the smallest set of
pages that lets the task succeed. Metrics: recall at k on read tasks, tokens loaded, time.
The signals we store and nobody else does: types, typed links, real timestamps, and human
verification. Which combination wins is empirical, and needs challenges 1 and 3 first.

### 5. Expectation alignment

"Do what the user expects" is the hardest to state and the easiest to instrument. Every
approve, edit and reject on a card is a label. The edit distance on an approved card is a
quality score. This is the most valuable dataset the product produces, and today it never
leaves the user's machine. Design partners who opt in would give real ground truth for
challenge 1, instead of synthetic guesses.

### 6. The moat, and the local-first question

What compounds over time? Data does: labels from challenge 5 and retrieval logs from
challenge 4. Algorithms compound only if they are trained and evaluated on that data. The
format compounds through adoption, not technology. docs/mvp-strategy.md's discriminating
question was "which capability stops working when the network is off", with the answer
"none". That answer is now open.

The honest framing is a split: the store stays local and readable, the brain is a service
that improves with everyone's data. docs/product-overview.md says a hosted version is a
rewrite. That is true for collaboration. It is not true for a retrieval engine, if the
engine is a package that takes a vault and a query.

## Dependencies

1 first. Then 3 and 2 in parallel. Then 4. 6 is decided from the evidence of 4 and 5.
5 can start any time and feeds 1.

One shortcut: an eval harness and a hosted retrieval engine are the same code. An engine
that runs against any vault in CI is the one that runs server-side later. The generator
and the harness are not overhead before the moat. They are its first component.

## The two decisions that shape the rest

1. Does the brain leave the machine, and if so, what still has to work offline?
2. Does ground truth come from consenting design partners, from generated vaults, or both?
