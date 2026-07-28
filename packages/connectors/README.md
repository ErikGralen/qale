# @pm/connectors

Provider adapters behind a generic `Connector` interface (integration plan
§Work areas B, `docs/jira-confluence-integration.md`). The domain and UI speak
only the generic vocabulary — `ticket`, `wikipage`, `container`,
`state_category` — and everything provider-shaped (auth, incremental pull,
state mapping, markdown conversion, outbound execution) lives here. A future
Linear or Notion connector is a second implementation directory, nothing more.

Connectors are **pure I/O + mapping**: no scheduling, no file writes, no UI.
The sync engine (Area C) owns high-water-mark persistence, vault writes and
cadence; the settings UI renders `authSchema` generically and calls
`verifyAuth`.

## Interface (src/types.ts)

- `authSchema` — zod schema of credential fields, `.describe()`d for generic
  form rendering.
- `verifyAuth()` — probe credentials; returns identity/site info and a health
  state that distinguishes `auth-expired` (a server refused the token) from
  `unreachable` (no server answered). The two have different UX copy; they are
  never conflated.
- `listContainers()` — followable containers (Jira projects, Confluence
  spaces) for the settings picker.
- `pullChanges(container, sinceHighWaterMark)` — incremental shallow records
  (`external_id`, title, raw `state`, `state_category`, assignee,
  `remote_updated`), oldest first, plus the next high-water mark.
- `fetchFull(kind, externalId)` — full body as markdown (description + recent
  comments for tickets; page body for wikipages).
- `mapStateCategory(rawState, hint?)` — the ONE place provider workflow labels
  map to `open | in_progress | blocked | done`. No other code may branch on the
  raw label.
- `execute(outboundPayload)` — perform an approved outbound card
  (`create_ticket` / `comment_ticket` / `update_page`); accepts legacy payloads
  via the domain's `zOutboundPayload` normalization; returns
  `{ externalId, url }` built from the API response only.

## Atlassian adapter (src/atlassian/)

Wraps the existing `AtlassianClient` (`@pm/atlassian`) — JQL/CQL search, v2
pages, ADF→markdown, serialized requests with 429/Retry-After backoff all stay
there. This package adds the probe, the generic mapping, and the pull shapes.

### Auth probe

API tokens come in two kinds; the user never has to know which they created:

1. `GET {siteUrl}/rest/api/3/myself` — succeeds for **unscoped** tokens.
2. On an auth-shaped refusal: `GET {siteUrl}/_edge/tenant_info` (public, no
   auth) resolves the `cloudId`, then
   `GET https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/myself` —
   succeeds for **scoped** tokens. All later requests then route through
   `api.atlassian.com/ex/jira/{cloudId}` (Jira) and
   `api.atlassian.com/ex/confluence/{cloudId}` (Confluence, `/wiki/...` paths);
   deep links always use the site URL.

### REST endpoints used

| Purpose | Endpoint |
| --- | --- |
| Auth probe (identity) | `GET /rest/api/3/myself` |
| Cloud id resolution | `GET /_edge/tenant_info` |
| List Jira projects | `GET /rest/api/3/project/search?maxResults=50` |
| List Confluence spaces | `GET /wiki/api/v2/spaces?limit=50` |
| Incremental ticket pull | `POST /rest/api/3/search/jql` — fields `summary,status,assignee,updated`; JQL `project = "X" [AND updated >= "-Nm"] ORDER BY updated ASC` |
| Incremental page pull | `GET /wiki/rest/api/search?cql=...&expand=content.version` — CQL `space = "X" AND type = page [AND lastmodified > now("-Nm")] ORDER BY lastmodified ASC` |
| Full ticket | `GET /rest/api/3/issue/{key}?fields=summary,status,assignee,updated,description` |
| Ticket comments | `GET /rest/api/3/issue/{key}/comment?maxResults=10&orderBy=-created` |
| Full page | `GET /wiki/api/v2/pages/{id}?body-format=storage` |
| `create_ticket` | `POST /rest/api/3/issue` (markdown → ADF) |
| `comment_ticket` | `POST /rest/api/3/issue/{key}/comment` (markdown → ADF) |
| `update_page` | `GET` page then `PUT /wiki/api/v2/pages/{id}` (version bump, markdown → storage XHTML) |

### Incremental pulls use relative windows

Jira/Confluence interpret absolute datetimes in the **account profile's
timezone**, so formatting a UTC high-water mark as `updated >= "2026-07-22
07:27"` can silently miss hours of changes on a west-of-UTC profile. Pulls
therefore query relative windows (`updated >= "-38m"`, `lastmodified >
now("-38m")`) computed from the mark plus 5 minutes of slack — timezone-proof;
the overlap only re-fetches items the sync engine upserts idempotently. Results
are sorted ascending and capped per request (100 issues / 50 pages), so a
backlog catches up naturally across ticks: each pull advances the mark to the
newest `remote_updated` it saw.

### State mapping

`state_category` comes from Jira's own `statusCategory` (`new` → `open`,
`indeterminate` → `in_progress`, `done` → `done`), so custom workflow names map
correctly without us knowing their words. `blocked` is the one category Jira
doesn't model — its Flagged field is a per-site custom field — so detection is
a deliberately narrow label heuristic (`blocked`, `impediment`, `on hold`,
`stalled`, …). A miss degrades to `in_progress`, never to a wrong loud state.

## Tests

`pnpm --filter @pm/connectors test` — fixture-driven, no live credentials: a
recording fake fetch serves JSON from `test/fixtures/` and the tests assert
both the generic mapping and the wire shape (JQL/CQL strings, ADF bodies,
version bumps, gateway routing for scoped tokens).
