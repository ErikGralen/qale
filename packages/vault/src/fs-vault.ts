import { promises as fs } from 'node:fs';
import { realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve, relative, isAbsolute, sep, dirname } from 'node:path';
import {
  NOTE_TYPE_META,
  NOTE_TYPES,
  makeNote,
  normalizeLifecycleKeys,
  parseFrontmatter,
  typeForDir,
  titleFromSlug,
  type Frontmatter,
  type Note,
  type NoteType,
  type SchemaMiss,
} from '@qale/domain';
import { parseNote, serializeNote, spliceBody } from '@qale/markdown';
import { VaultBoundaryError, type FileListing, type VaultPort } from '@qale/application';
import { toPosixPath } from './paths.js';
import { retryWhileLocked } from './retry.js';

/**
 * Filesystem vault (PLAN §3.5). Enforces hard path containment: every read/write
 * is resolved against `realpath(root)` and rejected if it escapes — the same
 * guard the agent's vault-scoped tools rely on. Reads are lenient so an existing
 * Obsidian vault (notes without our frontmatter) still indexes.
 *
 * Reads and writes part company on what a refusal MEANS. A read that resolves
 * outside is answered as "there is nothing there", which is true and is what
 * every caller already handles. A write that resolves outside is a bug in
 * whatever built the path, so every write throws {@link VaultBoundaryError} and
 * none of them return a value a caller can ignore — deletion included, which
 * used to return quietly and left the index dropping notes that were still on
 * disk.
 */
export class FsVault implements VaultPort {
  private readonly rootDir: string;
  private readonly realRoot: string;

  constructor(rootDir: string) {
    const resolved = resolve(rootDir);
    // Canonicalize the root so containment math is stable even when the vault
    // path is itself under a symlink (e.g. macOS /tmp → /private/tmp).
    let real: string;
    try {
      real = realpathSync(resolved);
    } catch {
      real = resolved;
    }
    this.rootDir = real;
    this.realRoot = real;
  }

  root(): string {
    return this.rootDir;
  }

  /**
   * The one door in. `relPath` is a vault path, so it is posix (see
   * {@link toPosixPath}) and stays posix even on Windows: `resolve` treats both
   * `/` and `\` as separators there, so `resolve('C:\\vault', 'meetings/x.md')`
   * lands on `C:\vault\meetings\x.md` and the caller never has to know which
   * platform it is on.
   *
   * The `isAbsolute` arm is what makes the refusal hold on Windows. `relative()`
   * can only express "go up and over" between two paths on the SAME drive; asked
   * for the route from `C:\vault` to `D:\somebody-elses\notes.md` it gives up and
   * returns the target itself, absolute, with no leading `..` for the check above
   * to catch. Same for a UNC share (`\\server\share\...`). On macOS and Linux
   * every path shares one root so this arm never fires, which is exactly why the
   * hole was invisible.
   */
  contain(relPath: string): string | null {
    const abs = resolve(this.rootDir, relPath);
    const rel = relative(this.realRoot, abs);
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || isAbsolute(rel)) return null;
    // Also verify against realpath when the file exists (defeats symlink escapes).
    try {
      const real = realpathSync(abs);
      const realRel = relative(this.realRoot, real);
      if (realRel.startsWith('..') || isAbsolute(realRel)) return null;
    } catch {
      /* file may not exist yet — the lexical check above still applies */
    }
    return abs;
  }

  async ensureScaffold(): Promise<void> {
    for (const type of NOTE_TYPES) {
      const dir = join(this.rootDir, NOTE_TYPE_META[type].dir);
      await fs.mkdir(dir, { recursive: true });
    }
  }

  async readRaw(relPath: string): Promise<string | null> {
    const abs = this.contain(relPath);
    if (!abs) return null;
    try {
      return await fs.readFile(abs, 'utf8');
    } catch {
      return null;
    }
  }

  async readNote(relPath: string): Promise<Note | null> {
    const raw = await this.readRaw(relPath);
    if (raw === null) return null;
    const parsed = parseNote(raw);
    const { frontmatter, miss } = this.coerceFrontmatter(relPath, parsed.frontmatter, parsed.body);
    const stat = await this.statOf(relPath);
    return makeNote({
      path: relPath,
      frontmatter,
      body: parsed.body,
      mtime: stat,
      schemaMiss: miss,
    });
  }

  async writeNote(relPath: string, frontmatter: Frontmatter, body: string): Promise<Note> {
    // Same compat fold as the read side: a caller (or an agent card) that still
    // says `status:` lands on the type's own lifecycle key, so no write puts the
    // old polymorphic key back on disk.
    const fm = normalizeLifecycleKeys(frontmatter) as Frontmatter;
    const content = serializeNote(fm as unknown as Record<string, unknown>, body);
    await this.writeRaw(relPath, content);
    const stat = await this.statOf(relPath);
    return makeNote({ path: relPath, frontmatter: fm, body, mtime: stat });
  }

  async writeBody(relPath: string, body: string): Promise<Note> {
    const raw = await this.readRaw(relPath);
    if (raw === null) throw new Error(`note not found: ${relPath}`);
    await this.writeRaw(relPath, spliceBody(raw, body));
    const note = await this.readNote(relPath);
    if (!note) throw new Error(`note unreadable after write: ${relPath}`);
    return note;
  }

  /**
   * The three calls that change what is on disk go through
   * {@link retryWhileLocked}, because on Windows they are the three that another
   * program can refuse. Antivirus opens a note the moment it is written, a sync
   * client uploads it, and while either handle is open the next overwrite or
   * delete comes back `EPERM`/`EBUSY` instead of happening. The waits are short
   * and bounded (~0.2s in total) and a real error still throws untouched.
   *
   * `mkdir` is deliberately left bare: it is `recursive`, so it is a no-op on the
   * ordinary path, and a folder that cannot be created is not a lock anybody is
   * about to release.
   */
  async writeRaw(relPath: string, content: string): Promise<void> {
    const abs = this.contain(relPath);
    if (!abs) throw new VaultBoundaryError(relPath);
    await fs.mkdir(dirname(abs), { recursive: true });
    await this.writeAtomic(abs, content, 'utf8');
  }

  async writeBinary(relPath: string, data: Uint8Array): Promise<void> {
    const abs = this.contain(relPath);
    if (!abs) throw new VaultBoundaryError(relPath);
    await fs.mkdir(dirname(abs), { recursive: true });
    await this.writeAtomic(abs, data);
  }

  /**
   * Write to a same-directory temp file, then rename it over the destination.
   * The rename is the only step that touches the real path, and rename is
   * atomic on both POSIX and Windows: a crash, power loss or disk-full error
   * mid-write leaves the old note exactly as it was, never truncated.
   */
  private async writeAtomic(
    abs: string,
    content: string | Uint8Array,
    encoding?: 'utf8',
  ): Promise<void> {
    const tmp = `${abs}.${randomUUID()}.tmp`;
    try {
      await retryWhileLocked(async () => {
        await fs.writeFile(tmp, content, encoding);
        await fs.rename(tmp, abs);
      });
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  async remove(relPath: string): Promise<void> {
    const abs = this.contain(relPath);
    // A refused delete used to return as if it had happened, and every caller
    // here follows one with `index.removeByPath` — so the note left the app
    // while the file stayed on disk, and the next reconcile brought it back.
    if (!abs) throw new VaultBoundaryError(relPath);
    // A delete is the operation Windows refuses most readily of the three: the
    // sharing mode that permits it is the one almost nothing opts into. A rename
    // (which is how `renameNote` moves a note: write the new path, remove the
    // old) is a delete in disguise for the same reason.
    await retryWhileLocked(() => fs.rm(abs, { force: true }));
  }

  async exists(relPath: string): Promise<boolean> {
    const abs = this.contain(relPath);
    if (!abs) return false;
    try {
      await fs.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<FileListing[]> {
    const out: FileListing[] = [];
    await this.walk(this.rootDir, out);
    return out;
  }

  async listDir(relPath: string): Promise<string[]> {
    const abs = this.contain(relPath);
    if (!abs) return [];
    let entries;
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => `${relPath.replace(/\/$/, '')}/${e.name}`)
      .sort();
  }

  private async walk(dir: string, out: FileListing[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (
        name === '.git' ||
        name === '.obsidian' ||
        name === 'node_modules' ||
        name.startsWith('.')
      ) {
        continue;
      }
      const abs = join(dir, name);
      if (entry.isDirectory()) {
        await this.walk(abs, out);
      } else if (entry.isFile() && name.toLowerCase().endsWith('.md')) {
        // Every note id the app knows starts life on this line, so this is where
        // the posix invariant is established rather than defended downstream.
        const rel = toPosixPath(relative(this.rootDir, abs));
        const stat = await fs.stat(abs).catch(() => null);
        if (stat) out.push({ path: rel, mtime: Math.floor(stat.mtimeMs) });
      }
    }
  }

  private async statOf(relPath: string): Promise<number> {
    const abs = this.contain(relPath);
    if (!abs) return Date.now();
    const stat = await fs.stat(abs).catch(() => null);
    return stat ? Math.floor(stat.mtimeMs) : Date.now();
  }

  /**
   * Best-effort frontmatter: honor a valid typed note; otherwise infer `type`
   * from the folder (or default `note`) and derive a `summary`, so any markdown
   * file indexes rather than being dropped.
   */
  private coerceFrontmatter(
    relPath: string,
    raw: Record<string, unknown>,
    body: string,
  ): { frontmatter: Frontmatter; miss?: SchemaMiss } {
    const topDir = relPath.split('/')[0] ?? '';
    const inferredType: NoteType =
      (typeof raw['type'] === 'string' && (NOTE_TYPES as readonly string[]).includes(raw['type'])
        ? (raw['type'] as NoteType)
        : null) ??
      typeForDir(topDir) ??
      'note';

    const summary =
      typeof raw['summary'] === 'string' && raw['summary'].trim()
        ? raw['summary']
        : firstMeaningfulLine(body) || titleFromSlug(relPath.replace(/\.md$/, ''));

    const candidate = { ...raw, type: inferredType, summary };
    const result = parseFrontmatter(candidate);
    if (result.ok && result.data) return { frontmatter: result.data };

    // This branch is where a note LOSES ITS TYPE: one field the schema refuses
    // and a meeting is read back as a plain note, which is a change the PM sees
    // (it left meetings/) without ever being told why. The fallback below is
    // still the right behaviour — never lose the file — but it must not also be
    // the silent one. Said in the log for whoever is looking at one, and carried
    // out on the note for the librarian's scan, which turns it into repair work
    // the PM actually meets.
    const miss: SchemaMiss | undefined =
      inferredType === 'note'
        ? undefined
        : { type: inferredType, error: result.error ?? 'unknown' };
    if (miss) {
      console.error(
        `[vault] ${relPath}: frontmatter does not fit the ${inferredType} schema, reading it as a plain note — ${miss.error}`,
      );
    }

    // Fallback: a permissive authored note so the file is never lost — but the
    // original fields ride along. An explicit frontmatter write later must not
    // erase what the user (or another tool) put there.
    let fallback = parseFrontmatter({
      type: 'note',
      summary,
      sources: Array.isArray(raw['sources']) ? raw['sources'] : [],
    });
    if (!fallback.ok) fallback = parseFrontmatter({ type: 'note', summary, sources: [] });
    return {
      frontmatter: { ...raw, ...(fallback.data as Record<string, unknown>) } as Frontmatter,
      ...(miss ? { miss } : {}),
    };
  }
}

function firstMeaningfulLine(body: string): string {
  for (const line of body.split('\n')) {
    const t = line
      .replace(/^#+\s*/, '')
      .replace(/^>\s*/, '')
      .trim();
    if (t) return t.slice(0, 200);
  }
  return '';
}
