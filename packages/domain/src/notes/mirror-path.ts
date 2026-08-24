import { dirForType } from './frontmatter.js';
import { isReservedFile } from './slug.js';

/**
 * Where a mirror note lives: `tickets/jira/PAY-142.md`,
 * `wikipages/confluence/release-checklist.md` (docs/provider-decoupling.md
 * PD-10). The provider segment is the whole point: a Jira `PAY-142` and a Linear
 * `PAY-142` are two different tickets, and a flat path can only hold one of them.
 *
 * Reads still accept the old flat form. A vault written before PD-10 has
 * `tickets/PAY-142.md` in it until the sync engine's one-time move runs, so
 * every lookup takes the name off the END of the path ({@link basename}) rather
 * than off a fixed prefix.
 */

export type MirrorKind = 'ticket' | 'wikipage';

/** The folder one provider's mirrors of this kind live in. */
export function mirrorDir(kind: MirrorKind, provider: string): string {
  return `${dirForType(kind)}/${provider}`;
}

/**
 * The slug a wikilink to a mirror carries. `name` is the file's own name: a
 * ticket key, or a page's slugified title with any `-2` suffix it earned. A
 * provider nobody can name falls back to the flat form, which still resolves —
 * the index falls back to a unique basename.
 */
export function mirrorSlug(kind: MirrorKind, provider: string | null, name: string): string {
  return provider ? `${mirrorDir(kind, provider)}/${name}` : `${dirForType(kind)}/${name}`;
}

export function mirrorPath(kind: MirrorKind, provider: string | null, name: string): string {
  return `${mirrorSlug(kind, provider, name)}.md`;
}

const MIRROR_KINDS: readonly MirrorKind[] = ['ticket', 'wikipage'];

/**
 * The parts of a mirror reference, or null when the target is not one.
 * `tickets/jira/PAY-142` names its tracker; `tickets/PAY-142` (written before
 * PD-10) does not, and neither does a bare `PAY-142`. That difference is the
 * whole question a link has to answer, because two trackers can mint one key.
 */
export function parseMirrorRef(
  target: string,
): { kind: MirrorKind; provider: string | null; name: string } | null {
  const parts = target.replace(/\.md$/i, '').split('/');
  const kind = MIRROR_KINDS.find((k) => dirForType(k) === parts[0]);
  if (!kind || parts.length < 2 || parts.length > 3) return null;
  const name = parts[parts.length - 1]!;
  if (!name) return null;
  return { kind, provider: parts.length === 3 ? (parts[1] ?? null) : null, name };
}

/**
 * The kind and name of a FLAT mirror file (`tickets/PAY-142.md`), or null for
 * anything else — a file already under a provider folder, and the folder's own
 * `index.md`, included. This is the migration's whole test for "does this one
 * still have to move".
 */
export function flatMirrorPath(path: string): { kind: MirrorKind; name: string } | null {
  if (isReservedFile(path)) return null;
  const parts = path.replace(/\.md$/i, '').split('/');
  if (parts.length !== 2 || !parts[1]) return null;
  const kind = MIRROR_KINDS.find((k) => dirForType(k) === parts[0]);
  return kind ? { kind, name: parts[1] } : null;
}
