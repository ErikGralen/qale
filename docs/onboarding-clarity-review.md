# Onboarding clarity review

A walk through the opening and First steps as a first-time user who knows
nothing: not what an API key is, not what Obsidian is, not that a Jira token
exists. Written 2026-08-23 against the code as it stands (`onboarding/` screens,
`sync-service.ts` descriptors, `FirstSteps.tsx`).

**How to use this doc.** One section per area. Each says what is there, what a
new user is likely to ask, and one suggested fix. Write your call under **Your
comment**, and I implement from that.

The flow is in good shape overall: every ask has a reason line, skips are real,
errors never trap anyone. The gaps below are almost all the same kind: a term or
a task that is obvious to us and opaque to someone on day one.

**Status 2026-08-23: all 11 areas built as commented.** The Hello screen is
rewritten value-first ("Your new workspace"). The key explainer and the
Atlassian token walk are Collapsible folds; the token walk is one shared
component (`AtlassianTokenHelp`) used by the opening and Settings. The verify
line now says only "We make a quick check of the key here". Obsidian is gone
from the Files screen and the why says "text files (markdown)". The Google
wait names the unverified-app warning. The follow picker states the watch
contract. The transcript help folds under the capture tray's drop zone. The
proposal First step says "suggestion", including its done-lines in main. The
help address (erik@qale.ai) sits on the telemetry screen. Typecheck, lint and
all tests pass. Two things to note: the cost line in the key explainer says
"a few dollars a month" (adjust if wrong), and "card" still names the same
thing everywhere outside onboarding, so a product-wide card→suggestion rename
is an open decision, not done here.

---

## 1. Screen 1, Hello: two terms land before they are explained

**What is there.** "Your product memory" as the title, then the deal, then the
exception: "when the agent works, the notes it reads go to the model provider
you pick."

**What a new user asks.** What is "the agent"? What is a "model provider"? Both
words appear here for the first time, three screens before the key screen
explains them. Also "with the receipts" is an idiom; a non-native reader can
take it literally.

**Suggestion.** Keep the sentence, swap the terms for what they mean at this
point: "when the app works on your notes, it sends them to an AI service (you
pick which one in a moment)". Introduce "agent" later, next to a thing the agent
did. Replace "with the receipts" with "with links to where each answer came
from".

**Your comment:**
Honestly I think we can rewrite this entirely to something mentioning this is your new workspace, our ai will make this easy .. focus on the VALUE/WHY we provide not HOW. We can introduce our product HOW a bit as well afterwards?
---

## 2. Screen 2, You: nothing says the fields are optional

**What is there.** Name and work email, not skippable, but an empty submit is
allowed and treated as "rather not say".

**What a new user asks.** "Do I have to give my email? Will you send me mail?"
There is no visible sign that empty is fine, so the polite reader feels forced
and the suspicious one stalls. The design intent (deliberate empty submit) is
invisible; only the code comment knows it.

**Suggestion.** One quiet line near the button: "Both are optional. Nothing here
is sent anywhere; it stays in your settings." That also answers the mail worry
in the same breath.

**Your comment:**
Yes
---

## 3. Screen 3, Files: "markdown", and what Create actually does

**What is there.** "A plain folder of markdown that you own", a suggested path,
Create / Open buttons, the Obsidian tip, the sync and path-depth warnings.

**What a new user asks.** What is markdown? (A PM who lives in Jira and Docs
may never have met the word.) What happens when I press "Create it": one
folder, or many? (It scaffolds fourteen.) The Obsidian line starts with "Use
Obsidian?" so non-users can skip it, which works, but "vault" inside that line
is Obsidian jargon.

The warnings themselves are the best copy in the flow. No change there.

**Suggestion.** Say "plain text files" first and "markdown" second: "plain text
files (markdown) you can open with anything". Under the Create button's path,
one line: "Qale makes this folder and sets up its own folders inside it." That
stops the surprise when they later open it and find a tree they did not make.

**Your comment:**
Yes sounds good to use plain text files and also we should never mention Obsidian. 
---

## 4. Screen 4, the key: the biggest gap in the flow

**What is there.** Pick Claude or Gemini, paste a key, "Get one at
console.anthropic.com", verify on save, "Add it later".

**What a new user asks.** This screen assumes the user knows what an API key
is. Someone who does not will ask, in order:

- What is an API key? Is it my account password?
- Does it cost money? How much? (The Anthropic console needs an account, a
  card, and prepaid credit before a key does anything. That is a ten-minute
  detour through three unfamiliar pages, and nothing on our screen warns them.)
- Claude or Gemini, and on what grounds? "Best is Opus 4.8" names a model they
  have never heard of. There is no line about the practical difference (Gemini
  has a free tier, Claude does not).
- My company already uses Claude. Can I use the company key? Who do I ask?
- Is my data used to train the model? (The screen says notes go to the
  provider; the natural next worry is training.)

One sharp edge behind the copy: the verify call is `/v1/models`, which passes
on a valid key with zero credit. The screen says "we check it here so a typo
fails now, not in the middle of your first meeting", but the empty-wallet
failure still happens in the middle of their first meeting, with the check
having said "That works".

**Suggestion.** Three parts.

1. A folded "What is an API key?" link under the field: three lines that say it
   is a paid pass to an AI service, that you make an account and add a payment
   method at the link above, roughly what a normal month costs, and "if your
   company already uses Claude or Gemini, ask whoever runs that for a key".
2. One line of guidance on the choice itself, e.g. "Claude is what we build and
   test against. Gemini has a free tier that is fine for trying the app."
3. Either soften the verify promise ("we check the key is real; whether it has
   credit shows up on first use") or have the verify make one minimal paid call
   so it actually proves what the copy claims.

**Your comment:**
1. Sounds good
2. We should be more agnostic towards Gemini/ANtrpic, so no.
3. Just say we make a quick check here
---

## 5. Screen 5, Jira + Confluence: the token walk is real work we compress into one hint

**What is there.** Three fields: Site URL ("your-team.atlassian.net"), account
email, API token with the hint "Create one at id.atlassian.com → Security → API
tokens (≈60 seconds)".

**What a new user asks.**

- **Site URL:** "What is my site URL?" The placeholder helps, but the plain
  answer is better: it is the address in your browser when Jira is open.
- **Which email?** The one you sign in to Atlassian with, which is not always
  the work email from screen 2. Nothing says that.
- **The token itself:** "≈60 seconds" is true only for someone who has done it
  before. The real path is: open id.atlassian.com, sign in (maybe through the
  company SSO), find Security, find "Create API token", name it, set an expiry,
  copy it before the dialog closes. First-timers lose the token by closing the
  dialog, then paste the token's name instead.
- **"Do I need to ask an administrator?"** Usually no: any Atlassian user can
  make a token for their own account. But some orgs block API tokens by policy,
  and then the create button is simply missing or the token is refused. Our
  error ("Check the site URL, email and API token") sends them back to re-check
  three correct fields forever.
- **Self-hosted Jira.** API tokens are a Jira Cloud thing. A user on company
  Jira Server or Data Center cannot succeed here at all, and nothing tells them
  which kind they have. Rule of thumb: address ends in `atlassian.net`, it is
  Cloud.
- **Expiry.** Atlassian tokens now expire (a year at most). The renew machinery
  exists (`renewFieldKeys`), but nobody is told at connect time that this will
  come back.

**Suggestion.** Make the hint a small folded "How to get a token" with the
numbered path, the "copy it right away" warning, and two one-liners: "If the
create button is missing, your company blocks API tokens; ask your Atlassian
admin" and "This works with Jira Cloud (your address ends in atlassian.net)".
Change the email placeholder or hint to "the email you sign in to Atlassian
with". When a verify fails on a well-formed token, add the admin possibility to
the error text.

**Your comment:**
yes
---

## 6. Screen 5, Google Calendar: the browser round trip has unexplained moments

**What is there.** A Connect button, "Waiting for the browser…", a "Stop
waiting" link wired to `cancelOAuth`.

**What a new user asks.** "It opened my browser, then Google showed me a
warning screen. Is this safe?" Until the OAuth client is verified by Google,
users see the "unverified app" interstitial and must click through Advanced.
Separately, many workspaces block third-party apps outright: Google shows
"admin approval required", the user closes the tab, and our screen just says
"Waiting for the browser…" forever until they find "Stop waiting".

**Suggestion.** One line under the row while waiting: "Google opens in your
browser. If it asks an administrator to approve the app, that is your
workspace's policy; you can skip this and ask them later." If the beta will run
on an unverified OAuth client, say what the warning screen looks like in the
same line, or get the client verified before invites go out.

**Your comment:**
yea it will be unverified for now so we can just say that
---

## 7. Screen 5, the follow picker: "watch" is doing a lot of unexplained work

**What is there.** After a connect, the card asks which projects, spaces or
calendars it should "watch", recommends some with reasons, and confirms in one
gesture. The screen-level line explains reading only.

**What a new user asks.** What does "watch" actually do? How often? Does it
pull everything in the project, back to when? Can I stop watching later? The
answers exist (sync on follow, changeable in Settings) but only the last one is
said, and only on the design doc, not the screen.

**Suggestion.** One line above the picker: "Watched things are read on a
schedule and kept current as notes in your workspace. You can change the list
any time in Settings." That is the whole contract in two sentences.

**Your comment:**
yes
---

## 8. Screen 6, telemetry: good; one small trust nick

**What is there.** The four-line answer, the fold with the exact list, the
processor line, a real switch, "Open my workspace".

**What a new user asks.** Almost nothing; this is the clearest screen in the
flow. The one nick: "It goes to PostHog" names a company the user has never
heard of, with no gloss. "PostHog, an analytics service, on servers in Europe"
costs three words and removes the "who?" blink.

**Suggestion.** Add the three-word gloss. Nothing else.

**Your comment:**
ok
---

## 9. First steps: "drop a transcript" assumes they know how to get one

**What is there.** The first and most load-bearing row: "Drop in a meeting
transcript. A .txt, .md or .vtt export, or just paste the text."

**What a new user asks.** "Where do I get a transcript?" A PM whose meetings
run on Teams or Meet has recordings, not files, and has never exported one.
Each tool hides the transcript in a different place (Teams: the meeting chat's
recap; Zoom: the web portal under Recordings; Meet: a Doc in Drive). This row
unblocks most of the others, so a user stuck here experiences the whole product
as stuck.

**Suggestion.** The row's click opens the capture tray; put the help there, not
in the row. One folded line in the tray: "Where transcripts live: Teams → the
meeting's recap tab; Zoom → zoom.us → Recordings; Meet → the attached Doc in
Drive. Or copy the text and paste it here." Paste is the universal escape hatch
and deserves to be named first.

**Your comment:**
yes
---

## 10. First steps: two rows lean on app jargon

**What is there.** "Decide on a card" (hint: "Nothing is written until you
approve it", CTA "Inbox") and "Ask your memory something".

**What a new user asks.** "What card?" Before the first proposal exists, "card"
and "Inbox" are both internal words. The row is visible from minute one, but
the thing it names cannot exist until a transcript has been read, so the first
reading is confusion. "Ask your memory" is fine once the Hello screen has
landed the memory idea.

**Suggestion.** Rename the row to the moment it describes: "Approve or reject
its first suggestion", hint "After it reads something, its suggestions wait in
the Inbox for your decision." Same event, no forward reference to a card nobody
has seen.

**Your comment:**
Yea i think "Suggestion" is a better term than "Card"
---

## 11. Cross-cutting: there is no door marked "help" anywhere in the flow

**What is there.** Six screens, each self-contained. If a user is stuck (token
refused, admin says no, key page confusing), the only affordances are skip and
Back.

**What a new user asks.** "Who do I ask?" This is a hand-picked beta; the
answer is presumably "Erik, by mail". Nothing in the app says so. The stuck
user either gives up on the step (fine, skips are designed for that) or gives
up on the app (not fine, and invisible to us except as a telemetry
`step.skipped`).

**Suggestion.** One quiet line on the last screen or in First steps: "Stuck or
unsure? Write to <the beta address>; that is what it is for." Cheap, honest,
and it turns silent abandonment into a message you can act on.

**Your comment:**
yea they can write to erik@qale.ai
---

## What I deliberately did not flag

- The empty workspace start, the skip mechanics, the Back behaviour and the
  "half-done is not done" connection rows: all clear and well-explained
  in-product.
- The sync/iCloud and Windows path warnings: model examples of naming the real
  failure.
- The read-only sentence on the connections screen: exactly the sentence that
  screen needs.
