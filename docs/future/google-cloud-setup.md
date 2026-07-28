# Google Cloud project setup — the OAuth client behind Calendar sync

> Companion to `docs/google-calendar-integration.md` (§Auth). This is the
> checklist for the ONE Google Cloud project we own; every install of the app
> shares its OAuth client. Nothing here ships in the repo — the client id/secret
> reach the app via env vars in dev and embedded constants in release builds
> (sanctioned for installed apps; the "secret" is officially non-confidential
> for this client type).

## One-time project setup

1. **Create the project** at console.cloud.google.com (any name; suggestion:
   `produktminnet`). No billing needed for Calendar API usage at our scale.
2. **Enable the API**: APIs & Services → Library → **Google Calendar API** →
   Enable. (Drive/Gmail later: enable their APIs here too, nothing else changes.)
3. **OAuth consent screen** (APIs & Services → OAuth consent screen):
   - User type: **External**.
   - App name, support email, developer contact — fill honestly; users see these
     on the consent page.
   - Scopes: add `https://www.googleapis.com/auth/calendar.readonly`. It is a
     *sensitive* scope — expect the unverified-app interstitial (below).
   - **Publishing status: set to "In production" immediately.** NEVER leave the
     project in "Testing": testing-mode refresh tokens expire every 7 days and
     users would re-auth weekly. "In production (unverified)" tokens live until
     revoked.
4. **Create the client**: Credentials → Create credentials → OAuth client ID →
   Application type: **Desktop app**. Copy the client id and client secret.

## Wiring the app

Dev (and until we embed for release):

```bash
export PM_GOOGLE_CLIENT_ID="1234…apps.googleusercontent.com"
export PM_GOOGLE_CLIENT_SECRET="GOCSPX-…"
pnpm dev
```

Without `PM_GOOGLE_CLIENT_ID` the Connect button fails fast with a plain
message — the app never opens a broken consent page.

The redirect is a loopback listener (`http://127.0.0.1:<ephemeral>/oauth2/callback`)
per the installed-app flow — **no redirect URI registration is needed** for
Desktop-app clients; Google allows any loopback port.

## What users will see (and why that's fine)

- **"Google hasn't verified this app"** interstitial on consent: expected while
  unverified (sensitive scope). Advanced → "Go to <app> (unsafe)" proceeds.
  Cap: **100 users** until verification. Fine for now; full verification
  (privacy policy URL, demo video, weeks of review) is a ship-to-strangers
  problem, not a build problem.
- Consent page asks for read-only calendar access, nothing else. Write scope
  arrives only with outbound events (phase 4) via incremental consent — Google
  itself asks the user exactly when the app first tries to write.

## Manual verification checklist (per release / after auth changes)

The token flow is fixture-tested; the real consent round-trip is not. Before
calling the integration live-verified, walk this once with a real account:

1. Settings → Connections → Google Calendar → **Connect with Google** — browser
   opens, consent page shows our app name + readonly scope.
2. Consent → tab says "Connected — you can close this tab"; the app card shows
   "Connected as <email>" within a second or two.
3. Primary calendar is auto-followed; a tick creates meeting notes for this
   week's real meetings (check `meetings/` and the Connections item count).
4. Quit + relaunch: still connected (refresh token survives; no re-consent).
5. Revoke at myaccount.google.com → Security → Third-party access; next tick
   flips the card to the quiet "connection expired — reconnect" state; local
   notes keep serving. Reconnect works and re-uses existing follows.
6. `pnpm refresh-demo` untouched — demo vault chrome renders offline without a
   grant (seeded sync frontmatter only).

## Scope notes for later products

- **Drive**: use `drive.file` (recommended tier, no verification burden) —
  access only to files the app created or the user picked. Avoid
  `drive.readonly` (restricted tier).
- **Gmail read scopes are restricted**: public distribution requires an annual
  third-party CASA security assessment (real money, real lead time). Don't
  promise Gmail features without pricing this.
