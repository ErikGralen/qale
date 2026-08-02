# Getting to beta

What has to be true before we hand this to people who are not us. Written 2026-08-02 against the
code as it stands today, not against what the older docs assume.

**How to use this doc.** One ticket per thing. Each says what is true today and what I would do.
Write your call under **Decision** ("do it", "skip", "later", "discuss: ..."). **Notes** gets filled
in as each one lands. We iterate on this file until the decisions are all filled, then work from it.

Nothing here is started. Everything below was checked against the repo; where a claim came from an
older doc and turned out to be stale, it says so.

---

## What already works

Context, not decisions. Two of these were open questions and are now settled.

- **Packaging works.** `pnpm --filter @pm/desktop package` produces `apps/desktop/dist/mac-arm64/pm.app`.
  It launches, opens the demo workspace, indexes all 94 notes, and `better-sqlite3` loads fine from
  `app.asar.unpacked`. The native module and bundling worry is over. (`docs/open-work.md` §5 says
  "no packaging story, no electron-builder config" and is out of date: `electron-builder.yml` exists.)
- **The suite is green.** `pnpm check-types` passes, all 8 `pnpm test` tasks pass, 40 test files.
- **The Electron security basics are right.** `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, a preload that exposes only the named IPC channels with no generic
  passthrough, a CSP in the page, and window-open routed to the OS browser.
- **The agent cannot touch the machine.** pi runs with `noTools: 'all'`, so there is no built-in bash
  or filesystem tool. Only our own tools exist, and vault paths are contained with a realpath check.
- **Secrets are handled honestly.** `safeStorage` when the OS keychain is there, base64 with a visible
  warning when it is not, decrypted only in the main process.
- **The MCP server is bound to 127.0.0.1 behind a bearer token.**

So the gap to beta is not "does it run". It is identity, money, first run, and the things that only
break when someone else's real notes are involved.

---

# A. Decisions that gate the rest

## 1. The product name

**Today:** the app is called four things. `productName: pm` and `appId: io.leveret.pm` in the
builder, `pm — product brain` in the window title, "Produktminnet" in the agent prompts, the MCP
error string and the Confluence edit message, and the design system calls itself Produktminnet too.
Your notes have **Qale** as the frontrunner (we own qale.ai), pending a EUIPO check against Qalea.

**Proposal:** settle it and sweep before the first build. The app id decides where userData lives, so
changing it after people install strands every user's settings, API key, proposal database and
session history. Renaming later is a migration we should not have to write.

Lead time: the EUIPO check.

**Decision:**

Let's rename to "Qale" for now - remove all traces of "pm" , leveret produktbminnet, product brain etc. 

**Notes:**

---

## 2. Apple Developer account and signing

**Today:** nothing is signed. `electron-builder.yml` has no signing config, no entitlements, no
notarization.

**Proposal:** enrol today, before anything else. An unsigned app downloaded from the internet gets
quarantined by macOS and reads as broken to a normal user. Signing and notarizing needs a paid Apple
Developer account ($99/yr), a Developer ID Application certificate, notarytool credentials in the
build, `hardenedRuntime: true` and the standard Electron entitlements. Enrolment can take days, and
everything else can be built while it processes.

**Decision:**
Will enroll at a later stage, but we can implement changes to harden the app (tickets 11-14)
**Notes:**

---

## 3. Who pays for the model

**Today:** bring-your-own-key only. One field in Settings, encrypted with safeStorage, and nothing
in the app works without it. A PM without an Anthropic account is blocked at minute one, which is the
worst possible place to lose someone.

**Options:**

| Option | Verdict |
|---|---|
| Ship our key inside the app | No. Thirty seconds to pull it out of the asar. |
| Mint a real per-user key via the Anthropic Admin API, one workspace each with a spend limit | Attractive: native per-user cost, no service to run. **But I could not confirm the Admin API can create keys.** Worth ten minutes to check before we plan around it. |
| Run a thin gateway holding our key | What I would do. |

**Proposal:** a small worker holds our Anthropic key. The app sends a per-user beta token instead.
The worker checks the token, forwards to the Anthropic API, streams the response straight back, and
records tokens used per user.

Feasible without forking pi: models in pi's registry carry their own `baseUrl`, so we register a
model whose base URL is our gateway and whose "api key" is the beta token. Streaming is a
pass-through of the SSE body.

What it buys beyond the key:

- a per-user monthly spend cap, enforced where the user cannot edit it
- a kill switch per user, and key rotation without shipping an app update
- one place that already knows who each user is, so it can take telemetry events too (see ticket 5)
- real cost-per-user numbers, which is the number that decides whether this business works

Keep the BYOK field either way. It becomes the escape hatch for anyone who prefers their own key,
and Settings already supports it.

**Decision:**
We will set it up as BYOK, but manually create keys for our users. So no changes needed for now. 

**Notes:**

---

## 3b. Model cost guard and the model itself

**Today:** the default is `claude-opus-4-8`, and the pinned pi-ai (0.80.6) has **no
`claude-opus-5`** entry at all. Nothing caps spend anywhere.

**Proposal:** bump the pi dependency (or add the model entry ourselves) and default to Opus 5. It is
the same price as 4.8 and better at exactly the long agentic work this product does. Then set a
per-user monthly ceiling in the gateway, and log `cache_read_input_tokens` so we can see whether
prompt caching is actually working. Long sessions at $5 in / $25 out per million can run up real
money fast, and if the numbers are bad the fallback is defaulting to Sonnet 5.

**Decision:**
Yes bump the pi but we should also have a way for the user to set the model for a session manually. Also see if the new version has aynthing    we can use. 
**Notes:**

---

## 4. Accounts and login

**Today:** none. No identity of any kind.

**Proposal:** no real account system. We need an identity for exactly two reasons: the gateway has to
know who is calling, and usage has to be attributable to a person. An **invite code** covers both.
One field on first run, the app trades the code for a device token and stores it in `safeStorage`.
No password, no email verification, no account database beyond a table of token, name, cap, spend.
Second machine means a second code.

That is the whole login story, and it is one screen.

**Decision:**
skip
**Notes:**

---

## 5. Usage tracking: what we collect

**Today:** nothing. No telemetry, no crash reporting, no error reporting.

**Proposal:** events, never content. An event is `{ installId, event, timestamp, props }`, where
props are scalars from a **fixed allowlist enforced in code**, not by convention, so a future event
cannot leak a note title by accident. No titles, no paths, no workspace names, no prompts, no model
output.

Events worth having for a beta:

- app opened, app version, platform
- workspace opened, with a note-count bucket (not a name, not a path)
- material captured, by kind
- session started, with the skill name and what triggered it (manual, scheduled, arrival)
- session finished, with a duration bucket and the outcome
- proposal created, by kind
- proposal decided: accepted, rejected, or gone stale
- connector connected, by provider
- which views get opened
- unhandled errors, code and stack only

That answers "did user X start Y sessions", "does anyone ever open Memory", and the proposal
accept-versus-reject rate, which is the number that tells us whether the agent is any good.

**Consent:** ask during onboarding in plain words, listing what leaves the machine (the screen
itself is ONB-6 in `docs/onboarding.md`). Put the
same list in Settings with a switch that genuinely stops the sending. These are people we invited
and can just ask, so get the yes at invite time and let the app confirm it.

**Where it goes:** the gateway from ticket 3. It already knows who the user is, and one service is
one service to run and secure.

**Decision:**
Need to evaluate what platform we can use for this. Also yes it should be toggelable by the user. And we need to be able track per user somehow. Will do this in a seperate session so skip.
**Notes:**

---

# B. Build and release

## 6. Real installers, icon, app id

**Today:** all three platforms are `target: dir` in `electron-builder.yml`, which produces a folder,
not something you can send anyone. There is no `apps/desktop/build/` directory, so the app ships with
the stock Electron icon.

**Proposal:** dmg target, mac only for the beta (arm64 and x64), unless a specific beta user is on
Windows. Windows is a separate certificate and a separate cost. Make an icon: a 1024px PNG turned
into an icns is the whole job once the design exists, and the Impeccable design system already has
the palette. Set the real name and app id from ticket 1 at the same time.

**Decision:**
Will create a logo manually and add it. so skip this for now .
**Notes:**

---

## 7. Version, diagnostics, report a problem

**Today:** every package says version `0.0.1`. There is no way for a user to tell us which build they
are on, and no log or diagnostic surface anywhere.

**Proposal:** a real version number shown in Settings. A "Copy diagnostics" button: version,
platform, workspace note count, whether the keychain is available, the last few log lines. A "Report
a problem" action that opens a prefilled issue or email with that attached. Beta bug reports live or
die on this, and it is cheap.

**Decision:**
yes implment this. 
**Notes:**

---

## 8. Shipping updates

**Today:** none. No `electron-updater`, no update feed, no version check. A new build means we send a
dmg and the user drags it over the old app.

**Auto-update is blocked by the ticket 2 decision, not by effort.** On macOS, Squirrel (which is what
`electron-updater` drives) validates the downloaded update's signature against the running app. An
unsigned app cannot auto-update. So deferring the Apple Developer account defers auto-update with it.
They are one decision, not two.

Deferring signing also makes each manual update worse than it sounds: an unsigned, un-notarized
download is quarantined by Gatekeeper, so every update repeats the right-click-open dance, not just
the first install.

**What a manual update does and does not break.** Dragging a new app over the old one keeps
everything, because state lives in userData keyed on the app id, not next to the binary:

- `settings.json` merges over `DEFAULTS` on load, so new keys appear with their defaults, and there
  is already one rename migration in there (`sessionType` to `skill`). Forward-compatible.
- `app-<vault>.db` uses `CREATE TABLE IF NOT EXISTS` plus idempotent `ALTER TABLE ADD COLUMN`, so new
  columns land on an existing database. Forward-compatible.
- The vault is plain files and is not touched at all.

The one exception is ticket 1: renaming to Qale changes the app id, which changes the userData path,
which reads as a fresh install. That is free right now because nobody has installed anything, and it
is exactly why the rename has to land before the first build.

**Proposal, in three parts:**

1. **Manual reinstall for the beta.** Correct given ticket 2, and safe per the above. Say so in the
   invite so nobody is surprised.
2. **Build the update *check* now, because it needs no signing.** On launch, fetch a small JSON
   (current version, download URL, and a `minimumVersion`). If a newer version exists, show a quiet
   banner with a link. If the running build is below `minimumVersion`, show a blocking notice
   instead, because a gateway change or a schema change can make an old build misbehave in ways the
   user reads as our bug. Roughly fifty lines, no new dependency, and it solves the thing that
   actually costs us: a beta user sitting on a build we fixed two weeks ago and never knowing.
3. **Add `electron-updater` when signing lands.** Once there is a Developer ID, it is a `publish`
   block in `electron-builder.yml` pointed at GitHub Releases plus a few lines in the main process.
   Cheap then, impossible now.

**Also worth knowing: the binary is only one of three things that "update".** The other two are
independent of how the app arrives:

- **The skill pack.** `ensureDefaultSkills` never overwrites an existing file, so an improved shipped
  skill never reaches anyone who already has that file. Auto-update the binary all you like and their
  agent still behaves like build 1. That is ticket 19, and it is the one that actually gates
  improving the product between releases.
- **Stored state.** Handled forward, as above, but there is no schema version number anywhere, so
  nothing can detect a database written by a newer build if a user downgrades. Worth one
  `PRAGMA user_version` and a refusal-to-open check the day we ship a second build.

**Decision:**
skip for now. needs to be a part of a new plan. 
**Notes:**

---

## 9. CI

**Today:** no `.github/workflows/` at all. `check-types`, `lint` and `test` run only when someone
remembers, which is how the suite went red unnoticed once before.

**Proposal:** a PR workflow running the three of them (half a day), plus a manual "build beta"
workflow that produces the signed dmg so releases are not tied to your laptop.

**Decision:**
skip for now. 
**Notes:**

---

## 10. Packaged-app smoke test

**Today:** zero renderer tests, no Electron boot test. I verified the packaged app by hand today; it
worked, but nothing will tell us next time.

**Proposal:** one test that boots the packaged app and opens a workspace. That is exactly the failure
class (native module ABI, bundling) that has bitten this project before, and it is completely
invisible to the unit tests.

**Decision:**
skip for now.
**Notes:**

---

# C. Security

None of these are emergencies. All of them get harder to fix once other people's data is involved.

## 11. Trim the shipped CSP

**Today:** the page CSP allows `http://localhost:8400` in both `script-src` and `connect-src`. That
is a dev-server allowance and it ships inside the packaged HTML.

**Proposal:** drop it from the production build, and add `object-src 'none'`, `frame-src 'none'`,
`base-uri 'none'` while we are in there.

**Decision:**
yes make this change. 
**Notes:**

---

## 12. Strip the dev affordances from production builds

**Today:** `PM_SCREENSHOT_CLICK` accepts a `js:` prefix and runs arbitrary JavaScript in the renderer
(`apps/desktop/src/main/index.ts`). `PM_VAULT`, `PM_SEED_PROPOSAL` and `PM_MCP` (which prints the MCP
token to the console) are the same shape.

**Proposal:** gate the whole block on `is.dev`. The risk is low because it is environment-gated, but
it is an arbitrary-code path compiled into a signed binary we hand to other people, and that is not
a thing we should ship.

**Decision:**
yes make this change.  
**Notes:**

---

## 13. Allowlist openExternal, block navigation

**Today:** `setWindowOpenHandler` sends any URL straight to `shell.openExternal` with no scheme
check, and there is no `will-navigate` handler.

**Proposal:** restrict to http, https and mailto, and add a `will-navigate` handler so the window
itself can never navigate away from the app. A link in a note should not be able to launch things.

**Decision:**
yes make this change.
**Notes:**

---

## 14. Warn about synced folders

**Today:** nothing stops someone pointing the app at an iCloud or Dropbox folder, where the SQLite
index, the git repo and the file watcher will each misbehave in a different way.

**Proposal:** one check and one warning. Beta users with Obsidian vaults will absolutely do this,
because the first screen invites them to ("an existing Obsidian vault included"). Cheap insurance.
The warning surfaces in the onboarding workspace step (ONB-4 in `docs/onboarding.md`) and anywhere
else a folder gets picked. (`docs/open-work.md` §1.7)

**Decision:**
yes make this change.
**Notes:**

---

## 15. Label external text (prompt injection)

**Today:** a Jira description, a Confluence page and a dropped transcript all arrive in the agent's
context as plain text with no marker saying where they came from. A hostile sentence in a ticket
reads the same as an instruction from the user. (`docs/qm-tickets.md` #1)

**Proposal:** write it down now, decide whether to build it before or after the beta. The approval
gate is the real defence and it holds, so nothing reaches Jira without a click. But the failure mode
is a card in the Inbox that looks like the agent's own suggestion, and it gets more likely the moment
beta users connect real Jira.

**Decision:**
think we implemented this already recently. otherwise tell me. 
**Notes:**

---

# D. First run

This is the biggest product gap, and `docs/open-work.md` §4.1 already called it the highest-leverage
missing piece.

**Moved.** The whole first-run experience now lives in `docs/onboarding.md` with its own tickets:
the opening flow (name, email, workspace, key, consent), the example workspace (was ticket 17, now
ONB-7), the post-capture handoff (was ticket 18, now ONB-9, decision "yes" carried over), and a
"First steps" checklist that introduces the product through real tasks. Tickets 16 to 18 are
retired in favour of ONB-1 to ONB-10 over there. Decisions that gate it still live here: the rename
(ticket 1), invite codes (ticket 4), the telemetry platform (ticket 5), and the example-workspace
prerequisites (tickets 25 and 26).

---

# E. Rework before strangers touch it

Ordered by what actually hurts.

## 19. The skill upgrade path

**Today:** a retired skill is deleted along with any edits the user made, and a skill whose content
changed is left stale in any workspace that already has it. (`docs/open-work.md` §1.6, which notes it
was acceptable for three alpha users who expect the product to swing.)

**Proposal:** fix it, because it breaks the moment we ship a second build, which is the definition of
a beta. Rule: record a hash of the version we shipped, overwrite anything the user has not touched,
leave edited files alone and say so, archive retired skills instead of deleting them.

**Decision:**
Yes we should build this somehow. We should have a way for the users to review our changes to the skills and apply them if they want as well. Or perhaps just override theirs if they also want that. If they have made no changes, no need to distrub the user. 
**Notes:**

---

## 20. `patchFrontmatterField`

**Today:** some write paths still round-trip the whole frontmatter map when they mean to change one
key, which fabricates summaries, injects schema defaults, and loses key order and comments on notes
the user wrote by hand. `acceptUpdate` and `applyLibrarianPatch` were fixed;
`markCitedSourcesProcessed` and `setTodoStatus` were not. (`docs/open-work.md` §1.1)

**Proposal:** build the primitive (splice one key into the raw YAML, the way `writeBody` already does
for bodies). The first screen says "an existing Obsidian vault included", so this will hit real
hand-written notes, and the arrival vision names "someone's imported vault comes back reorganised"
as the single worst signal we could get.

**Decision:**
skip

**Notes:**

---

## 21. Undo a run

**Today:** `NoteHistory` is read-only. The vault is git-backed, so the mechanism exists and the
button does not.

**Proposal:** one-click revert. The pitch is "trust it because you approve"; the missing half is "and
you can undo". The arrival vision's sixth principle says the whole design trades pre-approval for
reversibility, and if undo is approximate the trade is a lie. (`docs/open-work.md` §4.6)

**Decision:**
Sure lets implement this. 
**Notes:**

---

## 22. The naming and storage-leak sweeps

**Today:** "Sessions" versus "chat" versus "conversation", "workspace" versus "vault" versus "folder
of markdown". And file paths still render in three places (`NoteView.tsx`, `RightPanel.tsx`, and the
old capture copy), against a rule that says storage is never on screen.
(`docs/open-work.md` §4.3, §4.4)

**Proposal:** one sweep. Cosmetic individually, but together they are the difference between finished
and nearly finished, and a beta user reads that as whether we know what we are doing.

**Decision:**
Sessions  over chat, workspace over vault. yes lets not show the filepath. and the word "Ask" in the sidebar etc needs to be replaces with New Session perhaps. 
**Notes:**

---

## 23. What I would explicitly not do before beta

**Proposal:** leave the refactors in `docs/open-work.md` §2 alone. The `app-state.tsx` god store, the
proposal-tool helper, the triplicated accept/reject plumbing, the `vault:changed` churn. They are all
real, none of them is what a beta user meets, and touching them now buys risk instead of readiness.

**Decision:**
yes lets not do those. 
**Notes:**

---

# G. The starter skill pack

The pack is not decoration, it **is** the product's behaviour. Everything the agent does well, it
does because a file told it to. So "what ships" is a product decision, not a packaging one.

Ticket 19 (the skill upgrade path) is the delivery mechanism for everything in this section: without
it, whatever pack we ship at build 1 is the pack those users keep forever.

**What ships today.** From `DEFAULT_SKILLS` / `DEFAULT_AGENTS` in `packages/sessions/src/defaults.ts`,
seeded into a workspace by `ensureDefaultSkills`, which never overwrites an existing file:

| File | How it starts |
|---|---|
| `skills/arrival` | the capture pipeline invokes it, always |
| `skills/process-note` | you run it, model picks it up |
| `skills/weekly-update` | you run it, model picks it up, schedulable |
| `skills/synthesis` | you run it, model picks it up |
| `skills/commitment-check` | you run it, model picks it up |
| `skills/_filing-rules` | always |
| `skills/voice-exec` | always, audience: executives |
| `skills/voice-cs` | always, audience: customers |
| `agents/librarian` | triggered |
| `agents/meeting-prep` | triggered |

Plus `chat` and `ask`, which are built-in only and have no file.

## 25. The broken skill: where it lives

**Today:** `broken-demo` is at `vault-dev/skills/broken-demo/SKILL.md`, git-tracked in the demo vault.
It is **not** in the code and not in `DEFAULT_SKILLS`, so it never reaches a fresh workspace. It
exists so the Skills page's invalid-settings flag has something to flag: `starts: [whenever]` is not
a real door, and `outbound: true` is a setting that moved. `/update-demo` lists it as an intentional
demo state.

So: it is in your dev vault, not the code, and it is fine where it is.

**But** ONB-7 in `docs/onboarding.md` proposes bundling the demo vault as the example workspace.
Copy it verbatim and
every beta user's first workspace contains a skill called "Broken on purpose" with a red flag on it.

**Proposal:** build the example workspace from the demo vault through a strip list rather than a
straight copy. `broken-demo` at minimum, and the same question asked of anything else in there that
only exists to exercise a code path.

**Decision:**
skip for now. 
**Notes:**

---

## 26. The demo vault is a hand-copied duplicate of the shipped pack

**Today:** all ten shipped files exist twice. Once as a string constant in
`packages/sessions/src/defaults.ts`, once as a real file under `vault-dev/`. I diffed all ten today
and they are byte-identical, but only because someone has been keeping them in sync by hand. That
rule is even written down ("both must move together"), which is what a maintenance hazard looks like
shortly before it bites.

**Proposal:** generate the demo vault's `skills/` and `agents/` from `DEFAULT_SKILLS` in
`scripts/refresh-demo.ts`, and let `vault-dev/` hold only what is genuinely demo-specific
(`broken-demo`, `discovery-guide`). Then the copy cannot drift, and the example workspace (ONB-7 in
`docs/onboarding.md`) gets the real pack for free.

**Decision:**
skip for now. 
**Notes:**

---

## 27. Ship `discovery-guide`, and with it the fourth door

**Today:** `vault-dev/skills/discovery-guide/` is a good file (how to get past the feature request to
the problem underneath, with a `question-bank.md` beside it) and it does not ship. It is also the
**only** `read-when-relevant` skill anywhere, so a real user never sees that "a reference the model
pulls in when it needs it" is a thing they can write.

That matters more than one file: the shipped pack currently demonstrates three of the four doors.

**Proposal:** move it into `DEFAULT_SKILLS`. It is also the pack's only two-file skill, so it makes
the folder layout do something visible instead of looking like ceremony.

**Decision:**
skip for now. 
**Notes:**

---

## 28. More voices

**Today:** two, `voice-exec` (audience: executives) and `voice-cs` (audience: customers). Both are
about ten lines and both are good.

**Proposal:** add engineering and company-wide. A PM writes to their team and to everyone at least as
often as to the exec team, and these are the cheapest quality lever in the pack: ten lines each, and
every draft the agent writes gets better.

**Decision:**
skip fo rnow. 
**Notes:**

---

## 29. A house-facts file the user actually fills in

**Today:** nothing in the pack knows anything about the user's product, customers or vocabulary.
Every shipped file is generic by necessity.

**Proposal:** ship `skills/_about-us/SKILL.md` with `starts: [always]`, pre-filled with prompts rather
than content ("What we build:", "Who our customers are:", "Words we use, and what they mean:"). Ask
the user to fill it in via the First steps checklist (ONB-8 in `docs/onboarding.md`), or leave it
for the first time they open Skills.

Probably the single highest-leverage file in the pack, because it improves everything downstream at
once, and it is the one file we cannot write for them.

**Decision:**
yes we should have this, implement. 
**Notes:**

---

## 30. Users cannot create a skill

**Today:** there is no "New skill" button anywhere. `skills:list` and `agents:list` are the only IPC
channels for either, and neither view has a create affordance. Shipped files can be edited (the
purpose-built page saves title, summary and instructions), but adding your own means opening Finder
and making a folder with a `SKILL.md` in it.

**Proposal:** a "New skill" action that writes a starter file and opens it. A starter *library*
implies you can add to it, and "write your own" is what makes this product theirs rather than ours.
It is also how we learn what to ship next: the skills beta users write by hand are the roadmap.

**Decision:**
yes add this. but the users cshouldnt be avle to create agents. 
**Notes:**

---

## 31. What else belongs in the pack

**Today's coverage:** material arrives (arrival), a rough note gets tidied (process-note), a stack of
interviews gets read (synthesis), the week gets written up (weekly-update), a slipping promise gets
chased (commitment-check), the memory gets tidied (librarian), a meeting gets prepped (meeting-prep),
filing and two voices are always on. That is a genuinely decent spread for a starter library.

Two things I notice missing:

- **Capturing a decision.** There is a `decision` note type, a decision spine, supersede handling and
  freshness rules all built around it, and no skill for "we just decided something, write it down
  properly". `process-note` is adjacent but is not it. Decisions are the type the whole product is
  organised around, and the only one with no skill of its own.
- **An obviously editable example.** Every shipped file is finished and confident, which reads as "do
  not touch this". One short file that is visibly a template, saying copy me and change me, teaches
  the format better than any documentation would, and pairs with ticket 30.

**Decision:** (list anything else you want in the pack here)
we skip this for now. 
**Notes:**

---

# H. Machines we do not control

Ticket 14 (synced folders) belongs in this section conceptually; it is left in section C so the
numbering stays stable.

## 32. What happens when the user has no git

**Today, the good part:** git is genuinely optional and the code treats it that way. `history()`,
`fileAt()` and `commitPaths()` each check `available()` and `isRepo()` before doing anything, and
`commitPaths` swallows every error on purpose ("never let a git hiccup break a vault write"). The
version-history dialog has a real branch for it: "Version history needs git, which isn't installed on
this system", and the Enable button is hidden in that case so the `'git is not installed'` throw is
unreachable. Notes, sessions, proposals, the index and the agent all work without it.

**Today, the macOS trap:** `/usr/bin/git` exists on **every** Mac, including ones with no developer
tools. Verified on this machine: it is a 118KB stub linked against `libxcselect.dylib` with 78 hard
links, while the real 7MB binary lives at `/Library/Developer/CommandLineTools/usr/bin/git`. Two
consequences:

- A naive check (`which git`, or the file existing) **passes on a machine that has no git**.
- Invoking the stub without Command Line Tools is what triggers Apple's "The git command requires
  the command line developer tools. Would you like to install them now?" dialog.

We call `available()` during `openVault`, so a user on a fresh Mac could open their workspace and get
an Apple installer dialog with no explanation of where it came from. Not verified on a clean machine
yet, because this one has the tools installed. Worth ten minutes in a VM.

**And it repeats:** `available()` is not cached. Each of `history`, `fileAt` and `commitPaths` calls
it, and each call spawns `git --version`. On a machine without git we spawn a failing process on
every note save, and if that spawn is what prompts, we prompt every time.

**The part that is not cosmetic:** ticket 21 (one-click undo) is built on git. No git means no
history **and no undo**, and undo is one of the two pillars of the trust story. Also worth noting for
later: git is absent by default on Windows, so shipping there turns this from an edge case into the
default.

**Proposal:**

1. Cache `available()` once per app run. Small fix, removes the repeated spawn and the repeated
   prompt risk.
2. Probe safely on macOS: check `xcode-select -p` first, which exits non-zero without triggering the
   installer, and only spawn git if that succeeds. Verify on a clean machine.
3. Say it once, in the right place. Onboarding should notice and explain plainly what they lose
   (history and undo) with the one-line fix (`xcode-select --install`). Today the only mention is
   inside a dialog they may never open.
4. Note `isomorphic-git` as the real fix if Windows ever happens: it removes the system dependency
   entirely. It covers everything the adapter uses except `log --follow` rename tracking, so it is a
   real port rather than a swap, and I would not do it for this beta.

**Decision:**
yes do this. 
**Notes:**

---

# F. Sequence

## 24. Timeline

**Proposal:** roughly four weeks of focused work, one person.

| Phase | Tickets | Size |
|---|---|---|
| 0 | 1, 2, 3, 4, 5 (decisions, plus enrolment and EUIPO lead time) | mostly waiting |
| 1 | 1, 2, 6, 7, 9 (name sweep, app id, icon, dmg, signing, version, CI) | 3 to 4 days |
| 2 | 3, 3b, 4 (gateway, invite codes, redemption, spend caps, model bump) | 3 to 4 days |
| 3 | 5 (telemetry: schema, allowlist, transport, consent, a way to read it) | 2 days |
| 4 | onboarding (ONB-1 to ONB-10 in `docs/onboarding.md`), 14, 32, 25, 26 (first run, example workspace and its strip list, handoff, synced-folder guard, the no-git case, stop hand-copying the pack) | 4 to 5 days |
| 5 | 19, 20, 21, 11, 12, 13, 10 (rework, security, smoke test) | 4 to 5 days |
| 6 | 27, 28, 29, 30, 31, 22 (the pack itself, then the naming and copy sweep) | 3 to 4 days |

Section G splits across phases on purpose. Tickets 25 and 26 are prerequisites for shipping an
example workspace at all, so they ride with phase 4. Ticket 19 in phase 5 is what makes an improved
pack reach people who already installed. The pack's own content (27 to 31) comes last, because by
then we will have watched people use the current one.

**The two-week cut**, if we want three friendly users sooner: phase 0, phase 1 without CI, phase 2,
the smallest useful phase 3, a cut-down phase 4 (the opening without the example week), plus
tickets 14, 19 and 25. Everything else
follows while they are using it. That works because the users are friendly and can be told what is
rough. It stops working the moment someone we do not know installs it.

**Decision:**

**Notes:**
