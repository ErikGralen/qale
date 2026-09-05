/**
 * One rail row per connected system (docs/memory-placement.md, MP-4).
 *
 * A ticket and a wiki page are copies of something that lives somewhere else,
 * so they are not Memory. They belong to the system they came from, and the
 * rail says which systems those are: "Jira", "Confluence". Each row opens that
 * system's own folder, `tickets/jira` or `wikipages/confluence`.
 *
 * A row shows for two reasons. A connection names the system, which is how a
 * fresh connect puts the row there before the first mirror lands. Or the
 * workspace still holds mirrors under the folder, which keeps old copies
 * reachable after the connection is removed.
 *
 * A flat mirror (`tickets/PAY-142.md`, written before PD-10) names no system,
 * so it belongs to no row. The sync engine's one-time move files those under a
 * provider, and they appear then.
 */
import { dirForType, mirrorDir, parseMirrorRef, type MirrorKind } from '@qale/domain';
import type { ConnectionDTO, VaultTreeDTO } from '@qale/ipc';
import { providerLabelOf } from './connections';

/** One system on the rail: what it is called, what it holds, where that lives. */
export interface ProviderRow {
  /** The folder segment the mirrors sit under, e.g. `jira`. */
  providerId: string;
  /** What the row says on screen, e.g. "Jira". */
  label: string;
  kind: MirrorKind;
  /** The folder the row opens, e.g. `tickets/jira`. */
  dir: string;
}

const MIRROR_KINDS: readonly MirrorKind[] = ['ticket', 'wikipage'];

function isMirrorKind(kind: string): kind is MirrorKind {
  return (MIRROR_KINDS as readonly string[]).includes(kind);
}

/**
 * The rows the rail draws, ordered by their name. Ordering by the label rather
 * than by the folder keeps the rail stable: a row does not jump when a second
 * connection to the same system arrives.
 */
export function providerRows(
  connections: readonly ConnectionDTO[],
  tree: VaultTreeDTO | null,
): ProviderRow[] {
  const rows = new Map<string, ProviderRow>();
  const add = (kind: MirrorKind, providerId: string): void => {
    const dir = mirrorDir(kind, providerId);
    if (!rows.has(dir))
      rows.set(dir, { providerId, label: providerLabelOf(providerId), kind, dir });
  };

  for (const conn of connections)
    for (const container of conn.containers)
      if (container.provider && isMirrorKind(container.kind))
        add(container.kind, container.provider);

  for (const group of tree?.groups ?? [])
    for (const note of group.notes) {
      const ref = parseMirrorRef(note.path);
      if (ref?.provider) add(ref.kind, ref.provider);
    }

  return [...rows.values()].sort(
    (a, b) => a.label.localeCompare(b.label) || a.dir.localeCompare(b.dir),
  );
}

/**
 * The system a mirror folder belongs to, or null when the folder is not one.
 * `tickets/jira` is Jira's; a bare `tickets` is every system's at once, so it
 * names none.
 */
export function mirrorFolder(dir: string): { kind: MirrorKind; providerId: string } | null {
  const [head = '', providerId = '', ...rest] = dir.split('/');
  if (!providerId || rest.length > 0) return null;
  const kind = MIRROR_KINDS.find((k) => dirForType(k) === head);
  return kind ? { kind, providerId } : null;
}

/** What a folder tab and a folder page call a mirror folder: the system's own
 *  name. Null for a folder that names no system. */
export function mirrorFolderLabel(dir: string): string | null {
  const folder = mirrorFolder(dir);
  return folder ? providerLabelOf(folder.providerId) : null;
}
