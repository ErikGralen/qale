import type { z } from 'zod';
import type { TSchema } from 'typebox';
import type { StateCategory, SyncedCalendarEvent } from '@qale/domain';

/**
 * The provider seam (integration plan §Work areas B): everything provider-shaped
 * — auth, incremental pull, state mapping, markdown conversion, outbound
 * execution, URL formats — lives behind this interface. The domain and every UI
 * surface speak only the generic vocabulary (ticket, wikipage, container,
 * state_category); a future Linear or Notion connector is a second
 * implementation file, not a new code path anywhere upstream.
 *
 * Connectors are pure I/O + mapping: no scheduling, no file writes, no UI. The
 * sync engine (Area C) owns high-water marks, vault writes and cadence; the
 * settings UI renders `authSchema` generically and calls `verifyAuth`.
 */

/** Which mirror note type a container's items become. `calendar` containers
 *  hold events, which materialize as `meeting` notes (the ownership-split
 *  mirror: machine-owned fields only, the body stays the human's). */
export type ContainerKind = 'ticket' | 'wikipage' | 'calendar';

/** A followable container: a Jira project, Confluence space, Google calendar, … */
export interface ExternalContainer {
  kind: ContainerKind;
  /** Provider-stable id used in pulls (project key, space key, team id). */
  id: string;
  name: string;
}

/**
 * How much of a container the connected person has actually touched lately
 * (docs/product-understanding.md FL-1). This is what turns an alphabetical list
 * of forty spaces into a recommendation: a count somebody can check, and a date
 * that says whether they still work there.
 *
 * `count` is the provider's own total for the query, never the size of the page
 * we happened to fetch. A survey that says "12 pages" when it means "the first
 * 12 of 300" is worse than no number at all.
 */
export interface ContainerFootprint {
  kind: ContainerKind;
  /** Matches {@link ExternalContainer.id} — project key, space key. */
  id: string;
  /** Items in this container the person created or changed inside the window. */
  count: number;
  /** ISO timestamp of the most recent one, when the provider said. */
  lastTouched?: string;
}

/**
 * A shallow item record from an incremental pull — exactly the mirror-note
 * frontmatter fields (Area A `zTicket`/`zWikipage`), no body. Bodies are
 * deep-track only, fetched via {@link Connector.fetchFull}.
 */
export interface TicketChange {
  kind: 'ticket';
  external_id: string;
  container: string;
  title: string;
  /** The provider's raw workflow label — display-only, never branch on it. */
  state: string;
  state_category: StateCategory;
  assignee?: string;
  /** ISO timestamp of the last upstream change (provider clock). */
  remote_updated: string;
  url: string;
}

export interface WikipageChange {
  kind: 'wikipage';
  external_id: string;
  container: string;
  title: string;
  version: number;
  remote_updated: string;
  url: string;
}

/** A calendar event from an incremental pull. The domain shape carries the
 *  data; `container` is the calendar id it came from. Unlike tickets, the list
 *  payload is already full — events have no deep fetch. */
export interface EventChange extends SyncedCalendarEvent {
  kind: 'event';
  container: string;
}

export type ShallowChange = TicketChange | WikipageChange | EventChange;

export interface PullResult {
  /** Changed items since the mark, oldest first. */
  changes: ShallowChange[];
  /**
   * The mark to persist for the next pull, per container. Opaque: only the
   * connector that produced it may interpret it. An ISO `remote_updated` on the
   * provider clock is one valid choice, an encoded sync token is another.
   * Return the incoming mark unchanged when nothing changed.
   */
  highWaterMark: string | null;
}

/** A ticket's provider relationship, canonicalized to the link vocabulary
 *: `reversed` = the semantic edge runs the other way
 *  ("is blocked by"). Matches the `links` entries in `zTicket` frontmatter. */
export interface TicketLink {
  type: string;
  key: string;
  reversed?: boolean;
}

/** A deep-tracked item's full content. Shallow fields are best-effort here —
 *  the sync engine merges over the shallow record it already holds. */
export interface FullItem {
  kind: ContainerKind;
  external_id: string;
  title: string;
  url: string;
  /** Description + recent comments (tickets) or the page body (wikipages), as markdown. */
  bodyMarkdown: string;
  state?: string;
  state_category?: StateCategory;
  assignee?: string;
  /** Epic/parent key (tickets), when the provider models hierarchy. */
  parentKey?: string;
  /** The provider's typed issue links, canonicalized. */
  links?: TicketLink[];
  version?: number;
  remote_updated?: string;
}

/**
 * Connection health, distinguishing the two quiet failure states the UX designs
 * for: an expired/revoked token ("paste a new one") vs. the network being down
 * (mirror keeps serving, show "synced Xh ago"). Never conflate them.
 */
export type ConnectorHealth = 'ok' | 'auth-expired' | 'unreachable';

export interface VerifyResult {
  ok: boolean;
  health: ConnectorHealth;
  /** Who the credentials authenticate as, when the probe got that far. */
  identity?: { displayName: string; email?: string };
  /**
   * Where the credentials point. `url` is the only field anybody upstream may
   * read. `detail` holds provider-specific extras (tenant ids, token kinds);
   * only the connector that wrote them may interpret them.
   */
  site?: { url: string; detail?: Record<string, string> };
  /**
   * Per-product health when one credential covers several products. Overall
   * `health` is 'ok' when ANY product authenticates: a one-product token is a
   * working connection, not an expired one. This map carries the partial detail
   * for the Connections UI. Keys are the connector's own product ids.
   */
  products?: Record<string, ConnectorHealth>;
  error?: string;
}

export interface ExecuteResult {
  /** The provider's own id for the touched item (ticket key, page id). */
  externalId: string;
  /** Deterministic human-facing link, built from the API response only. */
  url: string;
}

/** A bound (credentialed) connector instance. */
export interface Connector {
  /** Registry id, e.g. 'atlassian'. */
  readonly id: string;
  /** Domain `provider` value written into mirror frontmatter, per kind. */
  readonly providers: Partial<Record<ContainerKind, string>>;

  /** Probe the credentials; returns identity/site info and a health state. */
  verifyAuth(): Promise<VerifyResult>;
  /** Followable containers for the settings picker. */
  listContainers(): Promise<ExternalContainer[]>;
  /**
   * Where the connected person actually works, for ranking that list. Optional:
   * a provider with no forty-container problem (a calendar list) simply omits
   * it, and every caller treats a missing method and a failed survey the same
   * way — fall back to the unranked catalogue, which is where we started.
   */
  surveyFootprint?(opts?: { now?: number }): Promise<ContainerFootprint[]>;
  /**
   * Incremental shallow pull: items changed since the high-water mark (null =
   * first sync, pull everything oldest-first up to the page cap; repeated calls
   * with the returned mark catch up naturally).
   */
  pullChanges(
    container: ExternalContainer,
    sinceHighWaterMark: string | null,
    opts?: { now?: number },
  ): Promise<PullResult>;
  /**
   * Shallow pull of specific items BY ID, across container boundaries — how a
   * ticket the vault links (or one blocking something we hold) stays fresh
   * without following its whole project. Ids the caller can't see simply don't
   * come back; that's the permission model, and it's the right one.
   *
   * Optional: connectors whose items have no user-facing id worth typing
   * (calendars) omit it, and the sync engine skips the tracked pass for them.
   */
  pullByKeys?(kind: ContainerKind, externalIds: string[]): Promise<ShallowChange[]>;
  /** Full body for a deep-tracked item. */
  fetchFull(kind: ContainerKind, externalId: string): Promise<FullItem>;
  /**
   * THE one place provider workflow labels map onto the generic enum. All logic
   * downstream branches on the result, never on the raw label.
   */
  mapStateCategory(rawState: string, categoryHint?: string | null): StateCategory;
  /**
   * Perform an approved outbound card (generic actions: create_ticket /
   * comment_ticket / update_page). Accepts the raw stored payload — it is
   * re-validated (and legacy-normalized) via zOutboundPayload here. Only ever
   * invoked by the card-acceptance path, never by an agent tool.
   */
  execute(payload: unknown): Promise<ExecuteResult>;
}

/** One credential field, described so the settings form renders generically. */
export interface ConnectorAuthField {
  /** Matches the key {@link ConnectorProvider.authSchema} expects. */
  key: string;
  label: string;
  placeholder?: string;
  /** Render as a password input and never echo back. */
  secret?: boolean;
  hint?: string;
}

/**
 * What one agent-facing read returns: the text the model reads, and where the
 * words came from.
 *
 * Reads are the one place the provider peeks through (docs/provider-decoupling.md):
 * search speaks the provider's own query language, so each provider brings its
 * own read tools. Everything else about them is neutral, including this result:
 * the host decides how to fence external text, this package only names the
 * origin.
 */
export interface ReadToolResult {
  text: string;
  /**
   * Origin address for text somebody else wrote, e.g. `jira:PAY-142`. Absent
   * when the text is the tool's own sentence ("No matching Jira issues."),
   * which is ours and needs no fence.
   */
  external?: string;
}

/**
 * One read tool a provider offers the agent, already bound to a credential. The
 * shape is deliberately not the agent harness's own tool type: the harness
 * adapts these, so this package never imports the agent.
 */
export interface ProviderReadTool {
  /** Tool name the model calls, e.g. `jira_search`. */
  name: string;
  /** Human-readable label for the session trail. */
  label: string;
  description: string;
  /** JSON Schema for the arguments, built with typebox. */
  parameters: TSchema;
  execute(params: Record<string, unknown>): Promise<ReadToolResult>;
}

/** A registered provider: what the settings UI needs before credentials exist. */
export interface ConnectorProvider<C = unknown> {
  id: string;
  label: string;
  /** Validates the collected field values. */
  authSchema: z.ZodType<C>;
  /** The fields to collect, in the order the form shows them. */
  authFields: ConnectorAuthField[];
  /** Which secret field(s) to re-collect on token expiry (subset of authFields). */
  renewFieldKeys: string[];
  /** `oauth` = auth is a browser flow (no fields); the form renders a Connect
   *  button instead of inputs. Absent/`fields` = paste-credentials form. */
  authKind?: 'fields' | 'oauth';
  create(creds: C, opts?: { fetchImpl?: FetchLike }): Connector;
  /** The provider's agent-facing reads, bound to these credentials. Absent
   *  means the provider offers the agent nothing to read. */
  readTools?(creds: C, opts?: { fetchImpl?: FetchLike }): ProviderReadTool[];
}

/** Injectable fetch so connectors are testable against recorded fixtures. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
