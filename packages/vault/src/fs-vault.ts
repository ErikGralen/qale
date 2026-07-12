import { promises as fs } from 'node:fs';
import { realpathSync } from 'node:fs';
import { join, resolve, relative, sep, dirname } from 'node:path';
import {
  NOTE_TYPE_META,
  NOTE_TYPES,
  makeNote,
  parseFrontmatter,
  typeForDir,
  titleFromSlug,
  type Frontmatter,
  type Note,
  type NoteType,
} from '@pm/domain';
import { parseNote, serializeNote } from '@pm/markdown';
import type { FileListing, VaultPort } from '@pm/application';

/**
 * Filesystem vault (PLAN §3.5). Enforces hard path containment: every read/write
 * is resolved against `realpath(root)` and rejected if it escapes — the same
 * guard the agent's vault-scoped tools rely on. Reads are lenient so an existing
 * Obsidian vault (notes without our frontmatter) still indexes.
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

  contain(relPath: string): string | null {
    const abs = resolve(this.rootDir, relPath);
    const rel = relative(this.realRoot, abs);
    if (rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
    // Also verify against realpath when the file exists (defeats symlink escapes).
    try {
      const real = realpathSync(abs);
      const realRel = relative(this.realRoot, real);
      if (realRel.startsWith('..')) return null;
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
    const frontmatter = this.coerceFrontmatter(relPath, parsed.frontmatter, parsed.body);
    const stat = await this.statOf(relPath);
    return makeNote({ path: relPath, frontmatter, body: parsed.body, mtime: stat });
  }

  async writeNote(relPath: string, frontmatter: Frontmatter, body: string): Promise<Note> {
    const content = serializeNote(frontmatter as unknown as Record<string, unknown>, body);
    await this.writeRaw(relPath, content);
    const stat = await this.statOf(relPath);
    return makeNote({ path: relPath, frontmatter, body, mtime: stat });
  }

  async writeRaw(relPath: string, content: string): Promise<void> {
    const abs = this.contain(relPath);
    if (!abs) throw new Error(`path escapes vault: ${relPath}`);
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  async remove(relPath: string): Promise<void> {
    const abs = this.contain(relPath);
    if (!abs) return;
    await fs.rm(abs, { force: true });
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

  private async walk(dir: string, out: FileListing[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (name === '.git' || name === '.obsidian' || name === 'node_modules' || name.startsWith('.')) {
        continue;
      }
      const abs = join(dir, name);
      if (entry.isDirectory()) {
        await this.walk(abs, out);
      } else if (entry.isFile() && name.toLowerCase().endsWith('.md')) {
        const rel = relative(this.rootDir, abs);
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
  ): Frontmatter {
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
    if (result.ok && result.data) return result.data;

    // Fallback: a permissive authored note so the file is never lost.
    const fallback = parseFrontmatter({ type: 'note', summary, sources: [] });
    return fallback.data as Frontmatter;
  }
}

function firstMeaningfulLine(body: string): string {
  for (const line of body.split('\n')) {
    const t = line.replace(/^#+\s*/, '').replace(/^>\s*/, '').trim();
    if (t) return t.slice(0, 200);
  }
  return '';
}
