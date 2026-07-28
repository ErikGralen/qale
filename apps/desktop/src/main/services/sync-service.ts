import {
  deriveSeriesSlug,
  meetingPathForEvent,
  planMeetingMirror,
  slugify,
  STATE_CATEGORIES,
  type Frontmatter,
  type StateCategory,
  type SyncedCalendarEvent,
} from '@pm/domain';
import {
  atlassianConnector,
  atlassianAuthSchema,
  googleCalendarConnector,
  type Connector,
  type EventChange,
  type ExternalContainer,
  type ShallowChange,
} from '@pm/connectors';
import type { IndexedNote, UseCaseContext } from '@pm/application';
import type { SyncItemRow, SyncStore } from '@pm/vault';
import type {
  AtRiskLinkDTO,
  ConnectionContainerDTO,
  ConnectionDTO,
  ConnectionHealth,
  ConnectResultDTO,
  DeliveryDeltaDTO,
  ExternalRefMetaDTO,
  ProviderDescriptorDTO,
  ShallowIndexItemDTO,
} from '@pm/ipc';
import type { SettingsService } from './settings-service.js';
import type { GoogleOAuthService } from './google-oauth-service.js';

/**
 * The sync engine (Area C): pulls followed containers on the scheduler tick,
 * keeps the shallow index current, and promotes anything the vault actually
 * links to a full mirror note. This file is the ONLY code path that writes
 * `ticket`/`wikipage` files — and, for calendar sync, the only writer of the
 * machine-owned fields on `meeting` notes (the ownership-split mirror,
 * docs/google-calendar-integration.md).
 *
 * Hard rules (integration plan): reads are silent — no Inbox cards, no dialogs;
 * health is a quiet DTO field. Offline/expired keeps serving the mirror.
 * Two connections (Atlassian, Google Calendar); state is per-connection.
 */

/** Bare ticket key, e.g. "PAY-142" — the shape POs type and providers mint. */
const TICKET_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

/** Local data older than this shows the quiet stale indicator on chips. */
const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/** Ceiling on tickets auto-tracked because they block something we hold. High
 *  enough that a real dependency web fits, low enough that one pathological
 *  epic can't quietly become the sync's whole job. */
const BLOCKER_TRACK_CAP = 100;

const GOOGLE_PROVIDER = 'google-calendar';

/** Registered provider descriptors (Atlassian fields mirror atlassianAuthSchema;
 *  Google has no fields — its auth is a browser flow, rendered as a button). */
const ATLASSIAN_DESCRIPTOR: ProviderDescriptorDTO = {
  id: 'atlassian',
  label: 'Jira + Confluence',
  fields: [
    { key: 'siteUrl', label: 'Site URL', placeholder: 'your-team.atlassian.net' },
    { key: 'email', label: 'Account email', placeholder: 'you@company.com' },
    {
      key: 'apiToken',
      label: 'API token',
      secret: true,
      hint: 'Create one at id.atlassian.com → Security → API tokens (≈60 seconds).',
    },
  ],
  renewFieldKeys: ['apiToken'],
};

const GOOGLE_DESCRIPTOR: ProviderDescriptorDTO = {
  id: GOOGLE_PROVIDER,
  label: 'Google Calendar',
  fields: [],
  renewFieldKeys: [],
  authKind: 'oauth',
};

/** A bare host is what people paste; the client needs a scheme. */
function withScheme(siteUrl: string): string {
  const trimmed = siteUrl.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Provider timestamps arrive in several ISO dialects; the domain schema wants
 *  one. Unparseable input falls back to `now` — a mirror must never be invalid. */
function normalizeIso(value: string | undefined, nowMs: number): string {
  const parsed = value ? Date.parse(value) : NaN;
  return new Date(Number.isNaN(parsed) ? nowMs : parsed).toISOString();
}

function isStateCategory(v: unknown): v is StateCategory {
  return typeof v === 'string' && (STATE_CATEGORIES as readonly string[]).includes(v);
}

/** A synced meeting note surfaced from the shallow event index (agenda reads). */
export interface AgendaMeeting {
  notePath: string;
  title: string;
  startMs: number;
  endMs: number;
  cancelled: boolean;
}

/** Per-connection runtime state; credentials live in settings, data in the store. */
interface ConnectionState {
  connector: Connector | null;
  fingerprint: string | null;
  health: ConnectionHealth;
  identity: string | undefined;
}

const freshState = (): ConnectionState => ({
  connector: null,
  fingerprint: null,
  health: 'ok',
  identity: undefined,
});

export class SyncService {
  private readonly conns: Record<'atlassian' | typeof GOOGLE_PROVIDER, ConnectionState> = {
    atlassian: freshState(),
    [GOOGLE_PROVIDER]: freshState(),
  };
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly getContext: () => UseCaseContext | null,
    private readonly getStore: () => SyncStore | null,
    private readonly settings: SettingsService,
    private readonly oauth: GoogleOAuthService,
    /** Fired after a tick that changed anything (mirror paths, or [] for
     *  connection-state-only changes) — pushes vault + connections events. */
    private readonly onChanged: (mirrorPaths: string[]) => void,
  ) {}

  /** Rebuild connectors when credentials change; cheap to call every time. */
  reconfigure(): void {
    const atl = this.settings.getAtlassian();
    const atlFingerprint = atl ? `${atl.baseUrl}|${atl.email}|${atl.token}` : null;
    if (atlFingerprint !== this.conns.atlassian.fingerprint) {
      this.conns.atlassian = {
        ...freshState(),
        fingerprint: atlFingerprint,
        connector: atl
          ? atlassianConnector.create({
              siteUrl: withScheme(atl.baseUrl),
              email: atl.email,
              apiToken: atl.token,
            })
          : null,
      };
    }

    const google = this.settings.getGoogle();
    const googleFingerprint = google ? `grant|${google.refreshToken.slice(0, 12)}` : null;
    if (googleFingerprint !== this.conns[GOOGLE_PROVIDER].fingerprint) {
      this.conns[GOOGLE_PROVIDER] = {
        ...freshState(),
        fingerprint: googleFingerprint,
        identity: google?.email ?? undefined,
        connector: google
          ? googleCalendarConnector.create({ getAccessToken: () => this.oauth.getAccessToken() })
          : null,
      };
    }
  }

  providers(): ProviderDescriptorDTO[] {
    return [ATLASSIAN_DESCRIPTOR, GOOGLE_DESCRIPTOR];
  }

  /** Connection list for Settings — store-backed, never hits the network. */
  list(): ConnectionDTO[] {
    this.reconfigure();
    const out: ConnectionDTO[] = [];
    const atl = this.settings.getAtlassian();
    if (atl && this.conns.atlassian.connector) {
      out.push(
        this.connectionDto(
          'atlassian',
          ATLASSIAN_DESCRIPTOR.label,
          withScheme(atl.baseUrl).replace(/^https?:\/\//, ''),
        ),
      );
    }
    const google = this.settings.getGoogle();
    if (google && this.conns[GOOGLE_PROVIDER].connector) {
      out.push(
        this.connectionDto(GOOGLE_PROVIDER, GOOGLE_DESCRIPTOR.label, google.email ?? 'Google account'),
      );
    }
    return out;
  }

  private connectionDto(id: 'atlassian' | typeof GOOGLE_PROVIDER, providerLabel: string, siteLabel: string): ConnectionDTO {
    const store = this.getStore();
    const state = this.conns[id];
    const containers: ConnectionContainerDTO[] = (store?.listContainers(id) ?? []).map((c) => ({
      id: c.containerId,
      kind: c.kind,
      name: c.name,
      followed: c.followed,
      lastSync: c.lastSync,
      itemCount: store?.countByContainer(id, c.containerId),
    }));
    const lastSync = containers.reduce<number | null>(
      (acc, c) => (c.lastSync !== null && (acc === null || c.lastSync > acc) ? c.lastSync : acc),
      null,
    );
    return {
      id,
      providerId: id,
      providerLabel,
      siteLabel,
      ...(state.identity ? { identity: state.identity } : {}),
      health: state.health,
      lastSync,
      containers,
    };
  }

  /** Validate + verify + persist credentials, then refresh containers. */
  async connect(providerId: string, values: Record<string, string>): Promise<ConnectResultDTO> {
    if (providerId === GOOGLE_PROVIDER) return this.connectGoogle();
    if (providerId !== 'atlassian') {
      return { ok: false, health: 'unreachable', error: 'Unknown provider.' };
    }
    const parsed = atlassianAuthSchema.safeParse({
      ...values,
      siteUrl: withScheme(values['siteUrl'] ?? ''),
    });
    if (!parsed.success) {
      return {
        ok: false,
        health: 'auth-expired',
        error: 'Check the site URL, email and API token — one of them is missing or malformed.',
      };
    }
    const probe = atlassianConnector.create(parsed.data);
    const verify = await probe.verifyAuth();
    if (!verify.ok) {
      return {
        ok: false,
        health: verify.health,
        error:
          verify.error ??
          (verify.health === 'auth-expired'
            ? 'The token was rejected — paste a fresh one from id.atlassian.com.'
            : "Couldn't reach the site — check the URL and your connection."),
      };
    }
    await this.settings.setAtlassian(parsed.data.siteUrl, parsed.data.email, parsed.data.apiToken);
    this.conns.atlassian.fingerprint = null; // force rebuild on next call
    this.reconfigure();
    this.conns.atlassian.health = 'ok';
    this.conns.atlassian.identity = verify.identity?.displayName;
    await this.refreshContainers('atlassian').catch(() => {});
    this.onChanged([]);
    return {
      ok: true,
      health: 'ok',
      ...(this.conns.atlassian.identity ? { identity: this.conns.atlassian.identity } : {}),
      siteLabel: parsed.data.siteUrl.replace(/^https?:\/\//, ''),
      connection: this.list().find((c) => c.id === 'atlassian'),
    };
  }

  /**
   * Google connect: the browser round-trip (loopback + PKCE), then the same
   * verify-and-persist shape as Atlassian. No calendar is followed by default —
   * the PM chooses which calendars to mirror from the Connections list.
   */
  private async connectGoogle(): Promise<ConnectResultDTO> {
    try {
      await this.oauth.connect();
    } catch (err) {
      return {
        ok: false,
        health: 'unreachable',
        error: err instanceof Error ? err.message : 'Google sign-in didn’t complete.',
      };
    }
    this.conns[GOOGLE_PROVIDER].fingerprint = null;
    this.reconfigure();
    const state = this.conns[GOOGLE_PROVIDER];
    const verify = await state.connector!.verifyAuth();
    if (!verify.ok) {
      state.health = verify.health;
      return {
        ok: false,
        health: verify.health,
        error: verify.error ?? 'Google connected but the calendar probe failed — try again.',
      };
    }
    state.health = 'ok';
    state.identity = verify.identity?.email ?? verify.identity?.displayName;
    if (verify.identity?.email) await this.settings.setGoogleEmail(verify.identity.email);

    // Populate the calendar catalogue; nothing is followed by default — the PM
    // picks which calendars to mirror from the Connections list.
    await this.refreshContainers(GOOGLE_PROVIDER).catch(() => {});
    void this.tick().catch(() => {});
    this.onChanged([]);
    return {
      ok: true,
      health: 'ok',
      ...(state.identity ? { identity: state.identity } : {}),
      siteLabel: state.identity ?? 'Google account',
      connection: this.list().find((c) => c.id === GOOGLE_PROVIDER),
    };
  }

  /** The calm expired path. Atlassian: merge the re-pasted secret over stored
   *  creds. Google: re-run the browser flow. Follows and marks are untouched. */
  async renewAuth(connectionId: string, values: Record<string, string>): Promise<ConnectResultDTO> {
    if (connectionId === GOOGLE_PROVIDER) return this.connectGoogle();
    const creds = this.settings.getAtlassian();
    if (connectionId !== 'atlassian' || !creds) {
      return { ok: false, health: 'unreachable', error: 'Nothing is connected yet.' };
    }
    return this.connect('atlassian', {
      siteUrl: creds.baseUrl,
      email: creds.email,
      apiToken: creds.token,
      ...values,
    });
  }

  /** A pending Google browser flow the PM gave up on. */
  cancelOAuth(): void {
    this.oauth.cancel();
  }

  /** Disconnect clears the CREDENTIAL (the part that lies if it stays), keeps
   *  local data: mirrors, meeting notes and follows survive a reconnect. */
  async disconnect(connectionId: string): Promise<void> {
    if (connectionId === 'atlassian') {
      await this.settings.clearAtlassian();
    } else if (connectionId === GOOGLE_PROVIDER) {
      await this.oauth.disconnect();
    } else {
      return;
    }
    this.conns[connectionId] = freshState();
    this.onChanged([]);
  }

  async setFollow(connectionId: string, containerId: string, followed: boolean): Promise<void> {
    if (connectionId !== 'atlassian' && connectionId !== GOOGLE_PROVIDER) return;
    this.getStore()?.setFollow(connectionId, containerId, followed);
    this.onChanged([]);
    // A newly-followed container syncs right away — the picker feels live.
    if (followed) void this.tick().catch(() => {});
  }

  /** Pull a provider's container catalogue into the store (names refresh, follows kept). */
  async refreshContainers(providerId: 'atlassian' | typeof GOOGLE_PROVIDER = 'atlassian'): Promise<ExternalContainer[]> {
    this.reconfigure();
    const store = this.getStore();
    const connector = this.conns[providerId].connector;
    if (!connector || !store) return [];
    const containers = await connector.listContainers();
    for (const c of containers) store.upsertContainer(providerId, c.kind, c.id, c.name);
    return containers;
  }

  /**
   * One sync tick: for each followed container, incremental shallow pull →
   * upsert index → advance the high-water mark → deep-sync anything the vault
   * links. Reentrancy-guarded; a tick that overlaps the next is skipped, not
   * queued. Errors set the quiet health state and never escape.
   */
  tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(): Promise<void> {
    this.reconfigure();
    const ctx = this.getContext();
    const store = this.getStore();
    if (!ctx || !store) return;

    const now = Date.now();
    const written: string[] = [];
    let anyChange = false;
    let anyFailed = false;

    for (const providerId of ['atlassian', GOOGLE_PROVIDER] as const) {
      const state = this.conns[providerId];
      if (!state.connector) continue;

      // Refresh the catalogue every tick so calendars added (or renamed) in
      // Google since connect surface on their own — not just when it's empty.
      // upsertContainer keeps existing follow flags, so this only ever adds new
      // rows (unfollowed) and freshens names.
      await this.refreshContainers(providerId).catch(() => {});
      const followed = store.followedContainers(providerId);
      if (followed.length === 0) continue;

      let failed = false;
      for (const container of followed) {
        try {
          const pulled = await state.connector.pullChanges(
            { kind: container.kind, id: container.containerId, name: container.name },
            container.highWater,
            { now },
          );
          const deep = providerId === 'atlassian' ? this.deepTargets(ctx) : null;
          for (const change of pulled.changes) {
            anyChange = true;
            if (change.kind === 'event') {
              const path = await this.applyEvent(ctx, store, change);
              if (path) written.push(path);
            } else {
              store.upsertItem(shallowToRow(change));
              if (deep && this.isDeep(change, deep, store)) {
                const path = await this.writeMirror(ctx, store, change, now);
                if (path) written.push(path);
              }
            }
          }
          store.setHighWater(providerId, container.containerId, pulled.highWaterMark, now);
        } catch (err) {
          failed = true;
          console.error(
            `[pm] sync: pull failed for ${container.containerId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      // Promotion sweep (Atlassian): items linked from the vault since the last
      // tick but NOT changed upstream still deserve their mirror note (linking
      // IS the gesture). Events have no promotion — qualifying is attendance.
      if (providerId === 'atlassian') {
        try {
          const deep = this.deepTargets(ctx);
          for (const kind of ['ticket', 'wikipage'] as const) {
            for (const row of store.itemsByKind(kind)) {
              if (row.notePath) continue;
              if (!this.isDeepRow(row, deep)) continue;
              const path = await this.writeMirror(ctx, store, rowToShallow(row), now);
              if (path) written.push(path);
            }
          }
        } catch (err) {
          console.error('[pm] sync: promotion sweep failed:', err instanceof Error ? err.message : err);
        }

        // Tracked pass: everything we hold by id rather than by container.
        try {
          const paths = await this.syncTracked(ctx, store, now);
          if (paths.length > 0) {
            written.push(...paths);
            anyChange = true;
          }
        } catch (err) {
          console.error('[pm] sync: tracked pull failed:', err instanceof Error ? err.message : err);
        }
      }

      if (failed) {
        anyFailed = true;
        // Classify quietly: one probe tells expired-token apart from network-down.
        try {
          const verify = await state.connector.verifyAuth();
          state.health = verify.ok ? 'ok' : verify.health;
          state.identity = verify.identity?.displayName ?? state.identity;
        } catch {
          state.health = 'unreachable';
        }
      } else {
        state.health = 'ok';
      }
    }

    if (written.length > 0) {
      await ctx.git.commitPaths(written, `sync: ${written.length} mirror${written.length === 1 ? '' : 's'}`).catch(() => {});
    }
    if (anyChange || written.length > 0 || anyFailed) this.onChanged(written);
  }

  // -------------------------------------------------------------------------
  // The meeting mirror patcher (google-calendar): the ONLY writer of the
  // machine-owned fields on meeting notes. Decisions live in @pm/domain
  // (planMeetingMirror); this method resolves the note, applies the plan, and
  // keeps the shallow row + note_path binding true.
  // -------------------------------------------------------------------------

  private async applyEvent(
    ctx: UseCaseContext,
    store: SyncStore,
    change: EventChange,
  ): Promise<string | null> {
    try {
      // Cancellation arrives as a stub (id + status, little else) — merge over
      // the shallow row so the plan sees the event as we last knew it.
      const prior = store.itemByExternalId(change.external_id);
      const row = mergeEventRow(prior?.kind === 'event' ? prior : null, change);
      store.upsertItem(row);
      const event = rowToEvent(row);

      // Resolve the bound note. A note_path whose file is gone means the PM
      // deleted a synced note — that's a human gesture; never recreate it.
      let notePath = row.notePath;
      let note = notePath ? await ctx.vault.readNote(notePath) : null;
      if (notePath && !note) return null;
      if (!note) {
        // Adopt hand-written or restored notes that already carry this event id.
        const adopted = this.mirrorMeetingByExternalId(ctx, change.external_id);
        if (adopted) {
          notePath = adopted.path;
          note = await ctx.vault.readNote(adopted.path);
          store.setNotePath(GOOGLE_PROVIDER, change.external_id, adopted.path);
        }
      }

      const seriesSlug = row.recurringId
        ? store.seriesSlug(GOOGLE_PROVIDER, row.recurringId, () => deriveSeriesSlug(event))
        : undefined;
      const plan = planMeetingMirror({
        event,
        calendar: row.container,
        provider: GOOGLE_PROVIDER,
        ...(seriesSlug ? { seriesSlug } : {}),
        participants: resolveParticipants(ctx, event),
        existing: note ? { frontmatter: note.frontmatter as Record<string, unknown>, body: note.body } : null,
      });

      if (plan.action === 'skip') return null;
      if (plan.action === 'delete') {
        await ctx.vault.remove(notePath!);
        ctx.index.removeByPath(notePath!);
        store.setNotePath(GOOGLE_PROVIDER, change.external_id, null);
        return notePath!;
      }
      if (plan.action === 'patch') {
        const written = await ctx.vault.writeNote(notePath!, plan.frontmatter as unknown as Frontmatter, note!.body);
        ctx.index.reindex(written);
        return notePath!;
      }
      // create — uniquify the filename against unrelated same-day same-title notes.
      let path = meetingPathForEvent(event);
      for (let i = 2; i <= 9 && (await ctx.vault.exists(path)); i += 1) {
        path = meetingPathForEvent(event).replace(/\.md$/, `-${i}.md`);
      }
      const written = await ctx.vault.writeNote(path, plan.frontmatter as unknown as Frontmatter, '');
      ctx.index.reindex(written);
      store.setNotePath(GOOGLE_PROVIDER, change.external_id, path);
      return path;
    } catch (err) {
      console.error(
        `[pm] sync: meeting mirror failed for ${change.external_id}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  private mirrorMeetingByExternalId(ctx: UseCaseContext, externalId: string): IndexedNote | null {
    return (
      ctx.index
        .listByType('meeting')
        .find(
          (n) => (n.frontmatter as Record<string, unknown>)['external_id'] === externalId,
        ) ?? null
    );
  }

  /**
   * Everything the vault currently links that could name an external item:
   * ticket keys (bare `[[PAY-142]]` or `tickets/…` slugs) and wikipage refs
   * (`wikipages/…` slugs, or a link target whose slug matches a known page
   * title). Case-insensitive; recomputed per tick from the index.
   */
  private deepTargets(ctx: UseCaseContext): { ticketKeys: Set<string>; pageSlugs: Set<string> } {
    const ticketKeys = new Set<string>();
    const pageSlugs = new Set<string>();
    for (const note of ctx.index.all()) {
      // Mirror notes themselves don't count as "linked from the vault".
      if (note.type === 'ticket' || note.type === 'wikipage') continue;
      for (const link of note.links) {
        const bare = link.target.split('#')[0]!.replace(/\.md$/, '').trim();
        if (TICKET_KEY_RE.test(bare)) ticketKeys.add(bare.toUpperCase());
        else if (bare.startsWith('tickets/')) ticketKeys.add(bare.slice('tickets/'.length).toUpperCase());
        else if (bare.startsWith('wikipages/')) pageSlugs.add(bare.slice('wikipages/'.length).toLowerCase());
        else pageSlugs.add(slugify(bare).toLowerCase());
      }
    }
    // Existing mirror notes stay deep — a re-sync must keep them fresh even if
    // the last inbound link was removed (demotion is a human delete, not ours).
    for (const note of ctx.index.all()) {
      if (note.type === 'ticket') {
        const id = (note.frontmatter as Record<string, unknown>)['external_id'];
        if (typeof id === 'string') ticketKeys.add(id.toUpperCase());
      } else if (note.type === 'wikipage') {
        pageSlugs.add(note.slug.replace(/^wikipages\//, '').toLowerCase());
      }
    }
    return { ticketKeys, pageSlugs };
  }

  private isDeep(
    change: Exclude<ShallowChange, EventChange>,
    deep: { ticketKeys: Set<string>; pageSlugs: Set<string> },
    store: SyncStore,
  ): boolean {
    return this.isDeepRow(
      store.itemByExternalId(change.external_id) ?? shallowToRow(change),
      deep,
    );
  }

  private isDeepRow(
    row: SyncItemRow,
    deep: { ticketKeys: Set<string>; pageSlugs: Set<string> },
  ): boolean {
    if (row.notePath) return true;
    if (row.kind === 'ticket') return deep.ticketKeys.has(row.externalId.toUpperCase());
    return deep.pageSlugs.has(slugify(row.title).toLowerCase());
  }

  // -------------------------------------------------------------------------
  // Tracked items: held by id, not by container
  // -------------------------------------------------------------------------

  /**
   * Every ticket the vault mentions, every one an agent was asked to watch, and
   * every one blocking something we already hold — pulled by id, whatever
   * project it lives in. Without this pass the only tickets that ever sync are
   * those inside a followed container, which makes `[[INFRA-88]]` in a note a
   * dead link unless the PM happens to follow all 900 tickets of INFRA.
   *
   * Tracked implies deep: if you named a ticket, you want to know when it moves.
   * The set is small by construction, and `writeMirror` skips items whose
   * `remote_updated` hasn't changed, so re-reading it each tick is close to free.
   */
  private async syncTracked(ctx: UseCaseContext, store: SyncStore, nowMs: number): Promise<string[]> {
    const connector = this.conns.atlassian.connector;
    if (!connector?.pullByKeys) return [];

    // Linking IS the tracking gesture — no separate "watch this" chore.
    // (Wikipages have no key a human would type; theirs arrive via the agent
    // tool or the followed-space pull, so only ticket keys register here.)
    for (const key of this.deepTargets(ctx).ticketKeys) {
      store.track('atlassian', 'ticket', key, 'link', nowMs);
    }

    const followed = new Set(store.followedContainers('atlassian').map((c) => c.containerId));
    const byKind = new Map<'ticket' | 'wikipage', string[]>();
    for (const tracked of store.listTracked('atlassian')) {
      const prior = store.itemByExternalId(tracked.externalId);
      // Already covered by its container's own incremental pull this tick.
      if (prior && followed.has(prior.container)) continue;
      const ids = byKind.get(tracked.kind) ?? [];
      ids.push(tracked.externalId);
      byKind.set(tracked.kind, ids);
    }

    const written: string[] = [];
    for (const [kind, ids] of byKind) {
      for (const change of await connector.pullByKeys(kind, ids)) {
        if (change.kind === 'event') continue;
        // Pulled by id, so the provider never says which container it came from
        // (and for tickets we infer it from the key) — keep what we already knew
        // rather than blanking a container the chips display.
        const prior = store.itemByExternalId(change.external_id);
        const merged = { ...change, container: change.container || prior?.container || '' };
        store.upsertItem(shallowToRow(merged));
        const path = await this.writeMirror(ctx, store, merged, nowMs);
        if (path) written.push(path);
      }
    }
    return written;
  }

  /**
   * Track the tickets blocking (or blocked by) one we already mirror. Three
   * rules, all load-bearing:
   *
   * - **Blocking links only.** "Relates to" means whatever the person clicking
   *   it wanted it to mean; following it walks half the instance.
   * - **One hop.** We never harvest from an item we auto-added ourselves, or a
   *   messy epic would drag in its blockers' blockers on the next tick.
   * - **Capped, and loudly.** Silently truncating a dependency set is exactly
   *   the quiet incompleteness that makes a drift signal untrustworthy.
   */
  private trackBlockers(
    store: SyncStore,
    externalId: string,
    links: readonly { type: string; key: string }[],
    nowMs: number,
  ): void {
    if (store.trackedSource('atlassian', externalId) === 'blocker') return;
    for (const link of links) {
      if (link.type !== 'blocks') continue;
      const key = link.key.trim().toUpperCase();
      if (!TICKET_KEY_RE.test(key)) continue;
      if (store.trackedSource('atlassian', key)) continue;
      if (store.countTrackedBySource('atlassian', 'blocker') >= BLOCKER_TRACK_CAP) {
        console.warn(
          `[pm] sync: blocker tracking cap (${BLOCKER_TRACK_CAP}) reached — ${key} not tracked`,
        );
        return;
      }
      store.track('atlassian', 'ticket', key, 'blocker', nowMs);
    }
  }

  /**
   * Watch an external item on request (the agent's `track_external`). This is a
   * READ decision — we're deciding to look at something, not writing anything
   * upstream — so it takes no approval card, per the outbound hard floor.
   */
  async trackExternal(kind: 'ticket' | 'wikipage', externalId: string): Promise<boolean> {
    const store = this.getStore();
    const id = externalId.trim();
    if (!store || !id) return false;
    store.track('atlassian', kind, kind === 'ticket' ? id.toUpperCase() : id, 'agent', Date.now());
    await this.tick().catch(() => {});
    return true;
  }

  /** Stop watching — the one place tracking is ever removed, and only on a
   *  human/agent gesture. Sync never un-tracks behind the user's back. */
  untrackExternal(externalId: string): void {
    this.getStore()?.untrack('atlassian', externalId.trim());
  }

  /**
   * THE mirror-note writer — the only code allowed to write ticket/wikipage
   * files. Skips unchanged items (same remote_updated/version as the note on
   * disk) so re-pull slack can't churn commits or reset freshness; a real
   * change writes the full body and sets `status: new`, which is exactly what
   * makes the freshness spine mark dependents stale.
   */
  private async writeMirror(
    ctx: UseCaseContext,
    store: SyncStore,
    change: Exclude<ShallowChange, EventChange>,
    nowMs: number,
  ): Promise<string | null> {
    try {
      const existingRow = store.itemByExternalId(change.external_id);
      const path =
        existingRow?.notePath ??
        (change.kind === 'ticket'
          ? `tickets/${change.external_id}.md`
          : `wikipages/${slugify(change.title)}.md`);

      const remoteUpdated = normalizeIso(change.remote_updated, nowMs);
      const existing = await ctx.vault.readNote(path);
      if (existing) {
        const fm = existing.frontmatter as Record<string, unknown>;
        const unchanged =
          change.kind === 'wikipage'
            ? fm['version'] === change.version && fm['remote_updated'] === remoteUpdated
            : fm['remote_updated'] === remoteUpdated;
        if (unchanged) {
          if (!existingRow?.notePath) store.setNotePath('atlassian', change.external_id, path);
          return null;
        }
      }

      const full = await this.conns.atlassian.connector!.fetchFull(change.kind, change.external_id);
      // A dependency we can see is a dependency worth holding — the other
      // team's blocker becomes a live chip on the note that links it without the
      // PM ever having heard of their project.
      if (change.kind === 'ticket' && full.links?.length) {
        this.trackBlockers(store, change.external_id, full.links, nowMs);
      }
      const frontmatter =
        change.kind === 'ticket'
          ? ({
              type: 'ticket',
              title: `${change.external_id} · ${full.title}`,
              summary: `${change.external_id} — ${full.title} (${full.state ?? change.state})`,
              status: 'new',
              provider: 'jira',
              external_id: change.external_id,
              container: change.container,
              state: full.state ?? change.state,
              state_category: full.state_category ?? change.state_category,
              ...(full.assignee ?? change.assignee
                ? { assignee: full.assignee ?? change.assignee }
                : {}),
              // Provider relationships (docs/typed-links.md): the indexer turns
              // these into `synced` edges (parent → part-of, links verbatim).
              ...(full.parentKey ? { parent: full.parentKey } : {}),
              ...(full.links?.length ? { links: full.links } : {}),
              remote_updated: normalizeIso(full.remote_updated ?? change.remote_updated, nowMs),
              url: full.url,
            } as unknown as Frontmatter)
          : ({
              type: 'wikipage',
              title: full.title,
              summary: `${full.title} — mirrored page in ${change.container}`,
              status: 'new',
              provider: 'confluence',
              external_id: change.external_id,
              container: change.container,
              version: full.version ?? change.version ?? 0,
              remote_updated: normalizeIso(full.remote_updated ?? change.remote_updated, nowMs),
              url: full.url,
            } as unknown as Frontmatter);

      const written = await ctx.vault.writeNote(path, frontmatter, full.bodyMarkdown || full.title);
      ctx.index.reindex(written);
      store.setNotePath('atlassian', change.external_id, path);
      return path;
    } catch (err) {
      console.error(
        `[pm] sync: mirror write failed for ${change.external_id}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Read surface (chips, autocomplete, at-risk, delivery deltas)
  // -------------------------------------------------------------------------

  searchIndex(query: string, limit = 6): ShallowIndexItemDTO[] {
    const store = this.getStore();
    if (!store || !query.trim()) return [];
    // searchItems never returns events (SQL-side filter); the guard narrows the type.
    return store.searchItems(query.trim(), limit).flatMap((row) => (row.kind === 'event' ? [] : [{
      kind: row.kind,
      externalId: row.externalId,
      slug: row.kind === 'ticket' ? `tickets/${row.externalId}` : `wikipages/${slugify(row.title)}`,
      container: row.container,
      containerName: this.containerName(row.container) ?? row.container,
      title: row.title,
      ...(row.state ? { state: row.state } : {}),
      ...(isStateCategory(row.stateCategory) ? { stateCategory: row.stateCategory } : {}),
      url: row.url,
    }]));
  }

  /** Chip/hover metadata for one mirror slug ("tickets/PAY-142", a wikipage
   *  slug, or a bare external id — L9: lookup by external id works too). */
  refMeta(slugOrId: string): ExternalRefMetaDTO | null {
    const ctx = this.getContext();
    const store = this.getStore();
    if (!ctx) return null;

    const bare = slugOrId.split('#')[0]!.replace(/\.md$/, '').trim();
    const key = bare.startsWith('tickets/') ? bare.slice('tickets/'.length) : bare;

    // Deep mirror first — actual data beats the shallow row.
    const note =
      this.mirrorByPath(ctx, `${bare}.md`) ??
      (TICKET_KEY_RE.test(key) ? this.mirrorByExternalId(ctx, 'ticket', key) : null) ??
      this.mirrorByExternalId(ctx, 'wikipage', key) ??
      this.wikipageBySlug(ctx, bare);
    if (note) return this.metaFromNote(note);

    // Shallow index fallback (followed but not linked yet). Events never render
    // as reference chips — meetings are notes, not external refs.
    const found =
      store?.itemByExternalId(key) ??
      (bare.startsWith('wikipages/')
        ? (store?.itemsByKind('wikipage') ?? []).find(
            (r) => slugify(r.title).toLowerCase() === bare.slice('wikipages/'.length).toLowerCase(),
          ) ?? null
        : null);
    if (!found || found.kind === 'event') return null;
    const row = found;
    const syncedAt = this.lastSyncFor(row.container) ?? Date.now();
    return {
      kind: row.kind as 'ticket' | 'wikipage',
      externalId: row.externalId,
      slug: row.kind === 'ticket' ? `tickets/${row.externalId}` : `wikipages/${slugify(row.title)}`,
      title: row.title,
      containerName: this.containerName(row.container) ?? row.container,
      ...(row.state ? { state: row.state } : {}),
      ...(isStateCategory(row.stateCategory) ? { stateCategory: row.stateCategory } : {}),
      ...(row.assignee ? { assignee: row.assignee } : {}),
      url: row.url,
      remoteUpdated: row.remoteUpdated,
      syncedAt,
      stale: this.isStale(syncedAt),
      health: this.conns.atlassian.health,
      notePath: row.notePath,
    };
  }

  pageBody(externalIdOrSlug: string): string | null {
    const ctx = this.getContext();
    if (!ctx) return null;
    const bare = externalIdOrSlug.replace(/\.md$/, '').trim();
    const note =
      this.mirrorByExternalId(ctx, 'wikipage', bare) ?? this.wikipageBySlug(ctx, bare);
    if (!note) return null;
    // Bodies aren't in the index — read from disk synchronously? The vault port
    // is async; callers get the indexed summary path instead. Handled in the
    // IPC handler (async) — this method resolves the path only.
    return note.path;
  }

  /** Blocked tickets the vault depends on — rendered in owning views only. */
  atRisk(): AtRiskLinkDTO[] {
    const ctx = this.getContext();
    if (!ctx) return [];
    const out: AtRiskLinkDTO[] = [];
    for (const note of ctx.index.all()) {
      if (note.type !== 'ticket') continue;
      const fm = note.frontmatter as Record<string, unknown>;
      if (fm['state_category'] !== 'blocked') continue;
      const linked = ctx.index
        .backlinks(note.slug)
        .map((b) => b.fromPath)
        .filter((p, i, arr) => arr.indexOf(p) === i);
      if (linked.length === 0) continue;
      out.push({
        externalId: String(fm['external_id'] ?? note.title),
        slug: note.slug,
        title: note.title,
        state: String(fm['state'] ?? 'Blocked'),
        stateCategory: 'blocked',
        reason: 'blocked',
        delta: `now ${String(fm['state'] ?? 'Blocked')}`,
        changedAt: String(fm['remote_updated'] ?? new Date(note.mtime).toISOString()),
        linked,
      });
    }
    return out;
  }

  /**
   * "Since last time" for one meeting: mirror tickets in the meeting's 1-hop
   * orbit (linked from the meeting note or from notes it links) whose upstream
   * change postdates the previous meeting in the same series (else 7 days).
   */
  async deliveryDelta(meetingPath: string): Promise<DeliveryDeltaDTO[]> {
    const ctx = this.getContext();
    if (!ctx) return [];
    const meeting = ctx.index.get(meetingPath);
    if (!meeting) return [];

    const since = this.previousMeetingDate(ctx, meeting) ?? Date.now() - 7 * 24 * 60 * 60 * 1000;

    const orbit = new Set<string>();
    const addLinks = (n: IndexedNote): void => {
      for (const l of n.links) {
        const p = ctx.index.resolve(l.target.split('#')[0]!.trim());
        if (p) orbit.add(p);
      }
    };
    addLinks(meeting);
    for (const p of [...orbit]) {
      const n = ctx.index.get(p);
      if (n && n.type !== 'ticket' && n.type !== 'wikipage') addLinks(n);
    }

    const out: DeliveryDeltaDTO[] = [];
    for (const p of orbit) {
      const n = ctx.index.get(p);
      if (!n || n.type !== 'ticket') continue;
      const fm = n.frontmatter as Record<string, unknown>;
      const updated = Date.parse(String(fm['remote_updated'] ?? ''));
      if (Number.isNaN(updated) || updated < since) continue;
      const category = isStateCategory(fm['state_category']) ? fm['state_category'] : 'open';
      out.push({
        externalId: String(fm['external_id'] ?? n.title),
        slug: n.slug,
        title: n.title,
        line: category === 'done' ? 'shipped' : `now ${String(fm['state'] ?? category)}`,
        stateCategory: category,
      });
    }
    return out;
  }

  /**
   * Synced meeting notes whose event overlaps [fromMs, toMs) — the shallow event
   * index read surface for time-aware sessions (before-meeting auto-prep) and
   * capture matching. Only events promoted to a meeting note (`note_path` set)
   * are returned; solo blocks and holds stay shallow. The store query compares
   * ISO strings (mixed-zone slop), so we over-fetch by a wide pad and filter to
   * the real instants here — the callers get precise, sorted results.
   */
  agenda(fromMs: number, toMs: number): AgendaMeeting[] {
    const store = this.getStore();
    if (!store) return [];
    const padMs = 12 * 60 * 60 * 1000;
    const rows = store.eventsBetween(
      GOOGLE_PROVIDER,
      new Date(fromMs - padMs).toISOString(),
      new Date(toMs + padMs).toISOString(),
    );
    const out: AgendaMeeting[] = [];
    for (const r of rows) {
      if (!r.notePath || !r.startAt || r.allDay) continue;
      const startMs = Date.parse(r.startAt);
      if (Number.isNaN(startMs)) continue;
      const endParsed = r.endAt ? Date.parse(r.endAt) : startMs;
      const endMs = Number.isNaN(endParsed) ? startMs : endParsed;
      if (startMs >= toMs || endMs < fromMs) continue; // precise overlap
      out.push({
        notePath: r.notePath,
        title: r.title,
        startMs,
        endMs,
        cancelled: r.eventStatus === 'cancelled',
      });
    }
    return out.sort((a, b) => a.startMs - b.startMs);
  }

  /**
   * The synced meeting a just-captured transcript most likely belongs to
   * (capture matching, job 3): prefer the one in progress, else the most
   * recently ended, else the soonest starting — within a window around now.
   * Cancelled meetings never match.
   */
  matchMeetingForCapture(nowMs: number): AgendaMeeting | null {
    const CAPTURE_BACK_MS = 90 * 60 * 1000;
    const CAPTURE_FWD_MS = 30 * 60 * 1000;
    return rankCaptureMatch(this.agenda(nowMs - CAPTURE_BACK_MS, nowMs + CAPTURE_FWD_MS), nowMs);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private previousMeetingDate(ctx: UseCaseContext, meeting: IndexedNote): number | null {
    const fm = meeting.frontmatter as Record<string, unknown>;
    const series = typeof fm['series'] === 'string' ? fm['series'] : null;
    const myDate = Date.parse(String(fm['date'] ?? ''));
    if (!series || Number.isNaN(myDate)) return null;
    let best: number | null = null;
    for (const n of ctx.index.listByType('meeting')) {
      if (n.path === meeting.path) continue;
      const nfm = n.frontmatter as Record<string, unknown>;
      if (nfm['series'] !== series) continue;
      const d = Date.parse(String(nfm['date'] ?? ''));
      if (Number.isNaN(d) || d >= myDate) continue;
      if (best === null || d > best) best = d;
    }
    return best;
  }

  private mirrorByPath(ctx: UseCaseContext, path: string): IndexedNote | null {
    const n = ctx.index.get(path);
    return n && (n.type === 'ticket' || n.type === 'wikipage') ? n : null;
  }

  private mirrorByExternalId(
    ctx: UseCaseContext,
    type: 'ticket' | 'wikipage',
    externalId: string,
  ): IndexedNote | null {
    return (
      ctx.index
        .listByType(type)
        .find(
          (n) =>
            String((n.frontmatter as Record<string, unknown>)['external_id'] ?? '').toLowerCase() ===
            externalId.toLowerCase(),
        ) ?? null
    );
  }

  private wikipageBySlug(ctx: UseCaseContext, slug: string): IndexedNote | null {
    const bare = slug.replace(/^wikipages\//, '').toLowerCase();
    return (
      ctx.index
        .listByType('wikipage')
        .find((n) => n.slug.replace(/^wikipages\//, '').toLowerCase() === bare) ?? null
    );
  }

  private metaFromNote(note: IndexedNote): ExternalRefMetaDTO {
    const fm = note.frontmatter as Record<string, unknown>;
    const str = (k: string): string | undefined => (typeof fm[k] === 'string' ? (fm[k] as string) : undefined);
    const container = str('container') ?? '';
    const row = this.getStore()?.itemByExternalId(str('external_id') ?? '');
    const syncedAt = this.lastSyncFor(container) ?? note.mtime;
    return {
      kind: note.type as 'ticket' | 'wikipage',
      externalId: str('external_id') ?? note.title,
      slug: note.slug,
      title: note.title,
      containerName: this.containerName(container) ?? container,
      ...(str('state') ? { state: str('state') } : {}),
      ...(isStateCategory(fm['state_category']) ? { stateCategory: fm['state_category'] } : {}),
      ...(str('assignee') ? { assignee: str('assignee') } : {}),
      url: str('url') ?? row?.url ?? '',
      remoteUpdated: str('remote_updated') ?? new Date(note.mtime).toISOString(),
      syncedAt,
      stale: this.isStale(syncedAt),
      health: this.conns.atlassian.health,
      notePath: note.path,
    };
  }

  private containerName(containerId: string): string | null {
    return (
      this.getStore()
        ?.listContainers('atlassian')
        .find((c) => c.containerId === containerId)?.name ?? null
    );
  }

  private lastSyncFor(containerId: string): number | null {
    return (
      this.getStore()
        ?.listContainers('atlassian')
        .find((c) => c.containerId === containerId)?.lastSync ?? null
    );
  }

  private isStale(syncedAt: number): boolean {
    return this.conns.atlassian.health !== 'ok' || Date.now() - syncedAt > STALE_AFTER_MS;
  }
}

/**
 * Which synced meeting a just-captured transcript belongs to (pure, testable):
 * prefer the meeting in progress, else the most recently ended, else the soonest
 * starting. Cancelled meetings never match. `candidates` is any window around now.
 */
export function rankCaptureMatch(candidates: AgendaMeeting[], nowMs: number): AgendaMeeting | null {
  const live = candidates.filter((m) => !m.cancelled);
  const inProgress = live
    .filter((m) => m.startMs <= nowMs && m.endMs >= nowMs)
    .sort((a, b) => b.startMs - a.startMs);
  if (inProgress[0]) return inProgress[0];
  const ended = live.filter((m) => m.endMs <= nowMs).sort((a, b) => b.endMs - a.endMs);
  if (ended[0]) return ended[0];
  const upcoming = live.filter((m) => m.startMs > nowMs).sort((a, b) => a.startMs - b.startMs);
  return upcoming[0] ?? null;
}

function shallowToRow(change: Exclude<ShallowChange, EventChange>): SyncItemRow {
  return {
    provider: 'atlassian',
    kind: change.kind,
    externalId: change.external_id,
    container: change.container,
    title: change.title,
    state: change.kind === 'ticket' ? change.state : null,
    stateCategory: change.kind === 'ticket' ? change.state_category : null,
    assignee: change.kind === 'ticket' ? (change.assignee ?? null) : null,
    version: change.kind === 'wikipage' ? change.version : null,
    remoteUpdated: change.remote_updated,
    url: change.url,
    notePath: null,
    startAt: null,
    endAt: null,
    allDay: false,
    eventStatus: null,
    attendees: null,
    recurringId: null,
  };
}

function rowToShallow(row: SyncItemRow): Exclude<ShallowChange, EventChange> {
  return row.kind === 'ticket'
    ? {
        kind: 'ticket',
        external_id: row.externalId,
        container: row.container,
        title: row.title,
        state: row.state ?? 'Unknown',
        state_category: isStateCategory(row.stateCategory) ? row.stateCategory : 'open',
        ...(row.assignee ? { assignee: row.assignee } : {}),
        remote_updated: row.remoteUpdated,
        url: row.url,
      }
    : {
        kind: 'wikipage',
        external_id: row.externalId,
        container: row.container,
        title: row.title,
        version: row.version ?? 0,
        remote_updated: row.remoteUpdated,
        url: row.url,
      };
}

/**
 * Merge a pulled event change over the shallow row we already hold. Cancelled
 * instances arrive as stubs (id + status, little else) — the row keeps the last
 * substantive title/time/attendees so the mirror plan can still reason about
 * the note it created.
 */
function mergeEventRow(prior: SyncItemRow | null, change: EventChange): SyncItemRow {
  return {
    provider: GOOGLE_PROVIDER,
    kind: 'event',
    externalId: change.external_id,
    container: change.container || prior?.container || '',
    title: change.title || prior?.title || '(untitled)',
    state: null,
    stateCategory: change.event_status === 'cancelled' ? 'done' : 'open',
    assignee: null,
    version: null,
    remoteUpdated: change.remote_updated,
    url: change.url || prior?.url || '',
    notePath: prior?.notePath ?? null,
    startAt: change.start || prior?.startAt || null,
    endAt: change.end ?? prior?.endAt ?? null,
    allDay: change.start ? change.allDay : (prior?.allDay ?? false),
    eventStatus: change.event_status,
    attendees: change.attendees.length ? change.attendees : (prior?.attendees ?? null),
    recurringId: change.recurring_event_id ?? prior?.recurringId ?? null,
  };
}

/**
 * Resolve an event's human attendees to `[[people/…]]` wikilinks where a person
 * note carries a matching `email` (job 4) — otherwise the provider's display
 * name, else the raw email. The PM and rooms are excluded, mirroring the domain's
 * `eventParticipants`. Creating person notes stays a human gesture; unmatched
 * externals just render as plain emails.
 */
function resolveParticipants(ctx: UseCaseContext, event: SyncedCalendarEvent): string[] {
  const byEmail = new Map<string, string>();
  for (const p of ctx.index.listByType('person')) {
    const email = (p.frontmatter as Record<string, unknown>)['email'];
    if (typeof email === 'string' && email.trim()) byEmail.set(email.trim().toLowerCase(), p.slug);
  }
  const out: string[] = [];
  for (const a of event.attendees) {
    if (a.resource || a.self) continue;
    const slug = a.email ? byEmail.get(a.email.trim().toLowerCase()) : undefined;
    const label = slug ? `[[${slug}]]` : a.name?.trim() || a.email?.trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Rebuild the domain event shape from a (merged) shallow row. */
function rowToEvent(row: SyncItemRow): SyncedCalendarEvent {
  return {
    external_id: row.externalId,
    title: row.title,
    start: row.startAt ?? '',
    ...(row.endAt ? { end: row.endAt } : {}),
    allDay: row.allDay,
    event_status: row.eventStatus ?? 'confirmed',
    attendees: row.attendees ?? [],
    ...(row.recurringId ? { recurring_event_id: row.recurringId } : {}),
    remote_updated: row.remoteUpdated,
    url: row.url,
  };
}
