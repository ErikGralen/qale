# Messaging integrations (Gmail / Slack / Teams): what "send it" actually costs

Status: exploration / decision doc. No code yet.
Author context: written against the current outbound seam (`OutboundPort.execute(payload)`,
`packages/application/src/ports.ts:296`) and the approve-then-execute card flow
(`packages/application/src/use-cases/proposals.ts:434`). Today, message drafts are **not**
sent — they're appended to a workspace note (`packages/agent/src/tools.ts:538`,
"Slack/email are out of scope"). Jira/Confluence, by contrast, really execute on approval.

The question on the table: **can we send a message _as the user_ into Slack/Gmail/Teams,
what does that require (app installs? admin consent?), and is copy-paste actually the right
MVP move?**

Short answer up front: **yes, "send as the user" is technically possible on all three, but
each one drags in an OAuth app registration, a consent/verification wall, and (Slack/Teams)
a per-workspace install that an admin may have to approve. For an MVP, a "handoff" tier
(clipboard + `mailto:` + Teams deep-link) delivers ~80% of the felt value at ~5% of the cost,
_and_ it sends genuinely as the user because the user is the one who hits send.** We should
ship handoff first and treat true API-send as a per-channel upgrade we earn into.

---

## 1. The three walls every "real send" hits

Before per-channel detail, the shape is the same everywhere. To call a "send message as this
human" API you must clear all three of:

1. **App registration.** You register a developer app with the platform (Slack app,
   Google Cloud OAuth client, Azure/Entra app). One-time, us-side, not the user's problem —
   but it's a real artifact we own, version, and get security-reviewed against.

2. **Consent / verification.** The scope that sends _as the user_ is a sensitive/restricted
   scope on every platform. Google makes you pass a **third-party security assessment (CASA)**
   to use `gmail.send` in production past 100 users. Slack/Teams gate the sensitive scopes
   behind an OAuth consent screen the user (and sometimes their admin) must approve.

3. **Installation into the user's tenant.** This is the one people forget. Slack and Teams are
   *workspace/tenant* products: even with a perfect app, the user's **workspace admin may have
   to allow or approve** installing our app into their Slack/Teams before the user can connect
   it. In locked-down enterprises this is a weeks-long IT ticket, not a click.

Gmail is the outlier: it's a *personal* account model, so there's no "workspace admin
installs the app" step for consumer/most Workspace users — but it swaps that for the CASA
security assessment, which costs real money and calendar time.

---

## 2. Slack

### Can we send a message *as the user*?
**Yes — with a Slack _user token_ (`xoxp-…`), not a bot token.**

- A Slack app can request **user scopes**. With the `chat:write` **user** scope, calling
  `chat.postMessage` with the user token posts the message **as that user** — their name,
  their avatar, their DMs, in any channel they can already post to. This is exactly what we want.
- A **bot token** (`xoxb-…`) posts as the *app* ("PM APP" with a bot badge), which is not what
  the user wants for "tell Sara we're committing to the SCIM dates."
- **Incoming webhooks** post as the app to *one preconfigured channel* — useless for
  per-recipient DMs/updates. Ignore for our use case.

### Does Slack require an installation?
**Yes, unavoidably.** There is no Slack send API without a registered Slack app that has been
**OAuth-installed into the target workspace.** Two sub-realities:

- **We must register and maintain a Slack app** (manifest, scopes, redirect URL, review if we
  ever list it publicly).
- **The workspace may gate the install.** Slack workspaces have an "approved apps" / admin
  install-approval policy. Some allow any member to install; many enterprises require an admin
  to approve. So the user connecting PM to Slack can hit a "your admin must approve this app"
  wall that we cannot design around. It's their org's policy.

Distribution options:
- **Single-workspace ("internal") app** — simplest, but it's literally one workspace. No good
  for a product with many customers.
- **Distributed app + OAuth** — the real answer for a product. Each user runs the OAuth flow,
  we store their user token (encrypted, same as Atlassian creds today), we send on their behalf.
  Public distribution / App Directory listing adds Slack review but isn't required for
  "shareable OAuth link" installs.

### Is there a no-API Slack path (for handoff tier)?
**Partially.** Slack deep links can *open* a conversation
(`slack://channel?team=…&id=…` or `https://slack.com/app_redirect?channel=…`) but **there is
no reliable public deep link that pre-fills arbitrary message text into the compose box.** So
the honest Slack handoff is: **copy the drafted message to the clipboard + (optionally) open the
right DM/channel; the user pastes and sends.** They send as themselves because they *are* sending.

### Slack verdict
- True send-as-user: **possible, powerful, and clean** (real user identity), but **requires a
  distributed app + per-user OAuth + potential admin-approval friction.**
- MVP-friendly path today: **clipboard handoff** (+ deep-link to open the convo). Zero infra,
  zero admin ticket, authentic sender.

---

## 3. Gmail

### Can we send a message *as the user*?
**Yes, and this is the cleanest "as the user" of the three** — Gmail's model is a single human
identity.

- OAuth with the **`gmail.send`** scope → `users.messages.send` sends a MIME message **from the
  user's own address**, appearing in their Sent folder. It genuinely is them.
- Softer variant: **`gmail.compose`** (also restricted) creates a **draft** in their Gmail that
  they open and hit send on — less scary permission-wise, keeps a human in the final loop, and
  matches our "draft → approve" philosophy nicely.

### Does Gmail require an installation / what's the wall?
**No per-tenant install, but the verification wall is the expensive part.**

- `gmail.send` / `gmail.compose` are **restricted scopes**. To use them in production for the
  general public, Google requires the app to pass an annual **third-party security assessment
  (CASA)** — real money (order of low-thousands USD/yr) and weeks of lead time — plus OAuth
  consent-screen verification.
- **Below that:** an unverified app in "testing" mode can use restricted scopes for up to
  **100 named test users** with a scary "Google hasn't verified this app" consent screen. Fine
  for design partners / a private beta, **not** for open signups.

### Zero-permission Gmail alternatives (handoff tier)
- **`mailto:` links** — `mailto:sara@…?subject=…&body=…` opens the user's default mail client
  (Gmail-in-browser if configured, Apple Mail, Outlook) with everything pre-filled. **No OAuth,
  no scope, no verification, sends truly as the user.** Caveat: practical URL-length limit
  (~2,000 chars) means long updates get truncated; and it depends on their default-handler setup.
- **SMTP + app password** — user pastes their own SMTP creds. Technically sends as them, but
  Google is actively killing app passwords (requires 2FA-scoped app passwords, fragile, scary to
  ask for). **Avoid.**

### Gmail verdict
- Best "as the user" fidelity of the three; `gmail.compose` (draft) aligns with our approval ethos.
- The cost is **CASA verification** to go past 100 users — plan it as a funded milestone, not a
  weekend.
- MVP path: **`mailto:` handoff** now; **`gmail.compose` draft** for design partners under the
  100-user testing cap; **`gmail.send` + CASA** only when we're scaling paid seats.

---

## 4. Microsoft Teams

### Can we send a message *as the user*?
**Yes — Microsoft Graph, delegated permission `ChatMessage.Send`** (and `Chat.ReadWrite` /
channel equivalents). With delegated auth the message posts **as the signed-in user.**

### Installation / consent reality
**The most enterprise-locked of the three.**

- Requires an **Azure/Entra app registration** on our side.
- Teams/M365 tenants very commonly require **admin consent** for Graph permissions, and orgs
  frequently disable third-party app access wholesale. Expect "ask your IT admin" to be the
  *default* path, not the exception.
- Practically: Teams true-send is a **sell-to-IT** feature, not a self-serve MVP feature.

### The bright spot: Teams deep links *do* pre-fill text
Unlike Slack, Teams supports a compose deep link with a **`message`** parameter:
`https://teams.microsoft.com/l/chat/0/0?users=sara@contoso.com&message=<url-encoded text>`
opens a chat to that person with our drafted text **pre-filled in the compose box** — user
reviews and hits send. **No app, no consent, authentic sender.** This makes the Teams *handoff*
experience actually better than Slack's.

### Teams verdict
- True send-as-user: possible but **gated behind Azure app + near-certain admin consent** →
  defer.
- MVP path: **deep-link with `message=` prefill** — genuinely good, ship it.

---

## 5. The "handoff" tier, and why it's the right MVP spine

"Handoff" = we produce the perfectly-drafted, context-aware message; the user does the final
send from their own client. Concretely, three primitives:

| Channel | Handoff primitive | Pre-fills text? | Opens right convo? | Sends as user? |
|---|---|---|---|---|
| Email | `mailto:` link | ✅ (≤~2k chars) | ✅ (to: filled) | ✅ (their client) |
| Teams | `l/chat` deep link w/ `message=` | ✅ | ✅ | ✅ |
| Slack | clipboard copy + `app_redirect` open | ⚠️ paste step | ✅ | ✅ |
| Any | **Copy to clipboard** button | n/a (manual paste) | ❌ | ✅ |

Why this is not a cop-out for an MVP:

1. **It sends as the user — perfectly.** The user literally is the sender. No identity spoofing,
   no "sent via PM APP" badge, no audit weirdness. The thing everyone's nervous about (an agent
   speaking as me without me seeing it) is structurally impossible here.
2. **Zero of the three walls.** No app registration to maintain, no CASA, no admin ticket. A
   locked-down enterprise customer can use it on day one with IT none the wiser.
3. **It keeps the human in the loop by construction** — which is already our whole product
   posture (draft → approve card → act). Handoff just makes "act" a review-and-send instead of
   a fire-and-forget.
4. **Our real value is upstream of the send.** The magic is "PM knew the decision, knew who was
   waiting on it, and drafted the right message at the right moment." The last mile (the actual
   keystroke) is the *cheap* part emotionally and the *expensive* part in infra. Handoff spends
   nothing on the cheap part.

The honest downside: it's one extra click/paste, and Slack has no text-prefill so it's a paste.
That's the whole cost. For an MVP that's a great trade.

---

## 6. How this maps onto our architecture

The good news: we built the seam for exactly this. `OutboundPort.execute(payload)` is a single
dispatch site, the connector registry is already provider-agnostic
(`packages/connectors/src/index.ts:27` — "nothing hardcodes one"), and creds already live
encrypted in `safeStorage` via the settings service. So:

- **Handoff tier needs almost no backend.** A "message" outbound payload
  (`{ provider: 'email'|'slack'|'teams', action: 'handoff', to, subject?, body, links[] }`)
  can resolve to a `handoff` result the renderer turns into a Copy button / `mailto:` /
  deep-link — instead of appending to a note like today. This is a **renderer + payload-shape**
  change, not a new network integration. It replaces the current
  `tools.ts:538` "saved to workspace, not sent" behavior with a real (if manual) send.
- **True-send tiers are new connectors behind the same `execute`.** A `slackConnector` /
  `gmailConnector` / `graphConnector` each implement `execute(payload) → OutboundResult`
  (`{ externalId, url }` — e.g. the Slack `ts`, the Gmail message id, the Teams message id).
  The card-acceptance path (`proposals.ts:434`) doesn't change; the settings UI gains an OAuth
  connect flow per provider, mirroring the Atlassian creds pattern.
- **Consistency win:** whether a message is handed off or truly sent, it's the *same card*,
  the *same approval*, the *same link-back into the source note*. The only difference is what
  `execute` does at the end. That keeps the mental model clean.

One important honesty fix regardless of tier: **stop making message drafts look identical to
Jira/Confluence drafts that actually execute.** Today both are "approve" cards but only one
acts. Even before real send exists, the message card should say "Copy / open to send" so the
user is never misled about what approval did.

---

## 7. Recommendation for the MVP

**Ship the handoff tier for all three channels. Defer every true-send API until a channel earns it.**

Rollout order:

1. **Now — handoff tier (all channels).**
   - Clipboard "Copy message" on every message card (universal fallback).
   - `mailto:` for email, Teams `message=` deep link, Slack `app_redirect` + copy.
   - Backend: new `handoff` outbound payload shape + renderer affordances. No OAuth, no app reg.
   - Fix the "looks sent but isn't" mismatch in the card copy.

2. **Design-partner phase — Gmail `gmail.compose` (draft) under the 100-user testing cap.**
   - Lets a few real users get "PM dropped a ready-to-send draft in my Gmail." Highest-fidelity
     "as me" experience with the least scary permission, and it dovetails with our approval ethos.
   - Register the Google Cloud OAuth app now (it's the long pole); stay in testing mode.

3. **Scale phase — fund Gmail CASA verification** to lift the 100-user cap, and add
   **Slack distributed-app OAuth** (`chat:write` user scope) for teams that live in Slack.
   Treat Slack admin-approval friction as a known, documented step in onboarding.

4. **Enterprise / sell-to-IT phase — Teams via Graph `ChatMessage.Send`** with Azure app +
   admin consent. Only worth it once we have customers whose IT will do the consent.

Guiding principle: **the drafting is the product; the sending is a distribution detail.** Handoff
lets us ship the product now and buy each real-send integration only when a real customer's
workflow justifies its wall.
