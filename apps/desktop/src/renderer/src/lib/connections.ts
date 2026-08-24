import type {
  AtRiskLinkDTO,
  ConnectionDTO,
  ConnectResultDTO,
  ContainerRecommendationDTO,
  DeliveryDeltaDTO,
  ExternalRefMetaDTO,
  ProviderDescriptorDTO,
  ShallowIndexItemDTO,
  StateCategory,
} from '@qale/ipc';
import { invoke, onEvent } from './ipc';

/**
 * Connections client — the renderer's one door to external-system state
 * (connections, followed containers, the shallow mirror index, per-reference
 * live metadata). Thin typed wrappers over the `connections:*` channels; the
 * main-process sync engine owns all state. The DTO shapes live in @qale/ipc and
 * are re-exported here so every UI surface keeps one import site.
 */

export type {
  AtRiskLinkDTO,
  AuthFieldDTO,
  ConnectionContainerDTO,
  ConnectionDTO,
  ConnectionHealth,
  ConnectResultDTO,
  ContainerRecommendationDTO,
  DeliveryDeltaDTO,
  ExternalRefMetaDTO,
  ProviderDescriptorDTO,
  ShallowIndexItemDTO,
} from '@qale/ipc';

// ---------------------------------------------------------------------------
// External-reference detection (shared by chips, autocomplete, previews)
// ---------------------------------------------------------------------------

/** Bare ticket key, e.g. "PAY-142" — the shape POs type and providers mint. */
const TICKET_KEY_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

/** The reference without its anchor or extension — the lookup key, passed to
 *  the main process as written. Nothing here builds a path from it (PD-11). */
export function refKeyOf(target: string): string {
  return target.split('#')[0]!.replace(/\.md$/, '').trim();
}

/** Is this token shaped like a ticket key? Syntax only: two trackers can mint
 *  "PAY-142", so which ticket it names is always a lookup. */
export function isTicketKey(target: string): boolean {
  return TICKET_KEY_RE.test(refKeyOf(target));
}

/** Might a wikilink target name an external mirror (ticket/wikipage)? A cheap
 *  gate, not an address — "[[COVID-19]]" passes it too, so every consumer falls
 *  back to the ordinary vault resolve when the reference's meta comes back
 *  empty. `refMeta` is the one that says which item, if any, this names. */
export function isExternalRef(target: string): boolean {
  const bare = refKeyOf(target);
  return bare.startsWith('tickets/') || bare.startsWith('wikipages/') || TICKET_KEY_RE.test(bare);
}

/** Proper names for the providers we ship; an unknown provider (a future
 *  connector) degrades to a capitalized word instead of a code change. */
const PROVIDER_LABEL: Record<string, string> = {
  jira: 'Jira',
  confluence: 'Confluence',
  'google-calendar': 'Google Calendar',
};

export function providerLabelOf(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

// ---------------------------------------------------------------------------
// The client API
// ---------------------------------------------------------------------------

export const connections = {
  providers(): Promise<ProviderDescriptorDTO[]> {
    return invoke['connections:providers']();
  },

  list(): Promise<ConnectionDTO[]> {
    return invoke['connections:list']();
  },

  async connect(providerId: string, values: Record<string, string>): Promise<ConnectResultDTO> {
    const result = await invoke['connections:connect'](providerId, values);
    metaCache.clear();
    return result;
  },

  /** Re-paste a token on the calm expired path — same verify, existing follows kept. */
  async renewAuth(connectionId: string, values: Record<string, string>): Promise<ConnectResultDTO> {
    const result = await invoke['connections:renewAuth'](connectionId, values);
    metaCache.clear();
    return result;
  },

  async disconnect(connectionId: string): Promise<void> {
    await invoke['connections:disconnect'](connectionId);
    metaCache.clear();
  },

  /** Abort a pending OAuth browser round-trip (the PM gave up on the tab). */
  cancelOAuth(): Promise<void> {
    return invoke['connections:cancelOAuth']();
  },

  async setFollow(connectionId: string, containerId: string, followed: boolean): Promise<void> {
    await invoke['connections:setFollow'](connectionId, containerId, followed);
    metaCache.clear();
  },

  /**
   * What this connection should read, busiest first. Hits the provider, so it
   * is asked for once when the picker opens; an empty answer is normal (no
   * footprint, no survey, or a failed one) and the picker falls back to the
   * flat list without comment.
   */
  async recommend(connectionId: string): Promise<ContainerRecommendationDTO[]> {
    try {
      return await invoke['connections:recommend'](connectionId);
    } catch {
      return [];
    }
  },

  /** One manual pull across every connection — Settings' "Sync now". */
  syncNow(): Promise<{ ok: boolean; error?: string }> {
    return invoke['connections:syncNow']();
  },

  searchIndex(query: string, limit = 6): Promise<ShallowIndexItemDTO[]> {
    return invoke['connections:searchIndex'](query, limit);
  },

  /**
   * Chip/hover metadata for one reference. The sync engine answers from the
   * shallow index; when it doesn't know the reference (e.g. a mirror note
   * deep-tracked before its container was followed, or an empty index), a
   * real mirror note in the vault still serves the chip.
   */
  async refMeta(target: string): Promise<ExternalRefMetaDTO | null> {
    const key = refKeyOf(target);
    return (await invoke['connections:refMeta'](key)) ?? metaFromVaultNote(key);
  },

  atRisk(): Promise<AtRiskLinkDTO[]> {
    return invoke['connections:atRisk']();
  },

  /** "Since last time" delta lines for one meeting page (keyed by series). */
  deliveryDelta(meetingPath: string): Promise<DeliveryDeltaDTO[]> {
    return invoke['connections:deliveryDelta'](meetingPath);
  },

  /** Current mirrored body of a wikipage — the "before" of a redline preview. */
  pageBody(externalIdOrSlug: string): Promise<string | null> {
    return invoke['connections:pageBody'](externalIdOrSlug);
  },
};

/**
 * One open behavior for every external-ref surface (chips, at-risk markers):
 * the mirror note when it exists, else the provider page. A reference whose
 * meta resolves to nothing may be an ordinary vault note that merely looks
 * like a ticket key (`[[COVID-19]]`) — resolve it like any other wikilink,
 * never a dead click.
 */
export async function openExternalRef(
  target: string,
  meta: ExternalRefMetaDTO | null,
  onOpen?: (path: string) => void,
): Promise<void> {
  // Two trackers hold this id, so the reference names no one item. Opening
  // either would be a guess, and the wrong ticket looks like the right one.
  if (meta?.ambiguousProviders) return;
  if (meta?.notePath && onOpen) {
    onOpen(meta.notePath);
    return;
  }
  if (meta?.url) {
    window.open(meta.url);
    return;
  }
  const path = await invoke['note:resolveLink'](target);
  if (path && onOpen) onOpen(path);
}

/** Small promise cache so a note full of chips fires one lookup per reference. */
const metaCache = new Map<string, Promise<ExternalRefMetaDTO | null>>();

// The cache lives only until the data can have moved: a sync tick, a follow
// toggle, or a credential change pushes `connections:changed`, and a vault
// change can rewrite the mirror notes the fallback reads. Push-driven —
// nothing polls, nothing freezes.
onEvent((event) => {
  if (event.channel === 'connections:changed' || event.channel === 'vault:changed') {
    metaCache.clear();
  }
});

export function refMetaCached(target: string): Promise<ExternalRefMetaDTO | null> {
  const key = refKeyOf(target);
  let hit = metaCache.get(key);
  if (!hit) {
    hit = connections.refMeta(key).catch(() => null);
    metaCache.set(key, hit);
  }
  return hit;
}

/** Local mirror data may be behind after this long without a refresh — the
 *  same quiet threshold the sync engine applies to its own `stale` flag. */
const STALE_AFTER_MS = 12 * 3_600_000;

const STATE_CATEGORIES: readonly StateCategory[] = ['open', 'in_progress', 'blocked', 'done'];

/** Frontmatter is hand-editable in principle — never cast a malformed category
 *  into the pill classes; an unknown value just renders no pill. */
function stateCategoryOf(value: unknown): StateCategory | undefined {
  return STATE_CATEGORIES.includes(value as StateCategory) ? (value as StateCategory) : undefined;
}

/** The vault-note fallback: a real mirror note serves the same fields the
 *  shallow index would. It can't judge connection health, but it is honest
 *  about age — an old file shows the quiet stale hint like any old sync. */
async function metaFromVaultNote(slug: string): Promise<ExternalRefMetaDTO | null> {
  try {
    const path = await invoke['note:resolveLink'](slug);
    if (!path) return null;
    const note = await invoke['note:get'](path);
    if (!note || (note.type !== 'ticket' && note.type !== 'wikipage')) return null;
    const fm = note.frontmatter;
    const str = (k: string): string | undefined =>
      typeof fm[k] === 'string' ? (fm[k] as string) : undefined;
    return {
      kind: note.type,
      externalId: str('external_id') ?? note.title,
      slug: note.slug,
      title: note.title,
      containerName: str('container') ?? '',
      state: str('state'),
      stateCategory: stateCategoryOf(fm['state_category']),
      assignee: str('assignee'),
      url: str('url') ?? '',
      remoteUpdated: str('remote_updated') ?? new Date(note.mtime).toISOString(),
      syncedAt: note.mtime,
      stale: Date.now() - note.mtime > STALE_AFTER_MS,
      health: 'ok',
      notePath: note.path,
    };
  } catch {
    return null;
  }
}
