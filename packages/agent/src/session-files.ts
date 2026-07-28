import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  createEditToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type EditOperations,
  type LsOperations,
  type ReadOperations,
  type ToolDefinition,
  type WriteOperations,
} from '@earendil-works/pi-coding-agent';
import { SESSION_FILES_DIR } from '@pm/domain';

/**
 * Session files (Sessions v2 Part 1) — a scratch folder a session writes to
 * freely, which is NOT the memory.
 *
 * Two invariants live here:
 *
 * 1. **Not the memory.** The folder is `sessions/.files/<session-id>/`. The dot
 *    means `FsVault.walk` skips it at every level, so nothing under here is
 *    indexed, searched, retrieved for Ask, linkable, counted in freshness, or
 *    committed (it is also in the seeded `.gitignore`). Zero indexer changes.
 *
 * 2. **Read scope is structural, not instructional.** The pi file tools take
 *    injectable operations, and every filesystem touch they make goes through
 *    them with a fully-resolved absolute path. Rooting the operations at the
 *    session's own folder means the model cannot *express* a path outside it —
 *    `../`, an absolute path and `~` all resolve, then get refused. A rule the
 *    agent is told can be forgotten; a root it is given cannot be escaped.
 *
 * `grep` and `find` are deliberately NOT offered: they shell out to ripgrep/fd
 * with the resolved path, so the injectable-operations guarantee above does not
 * cover them. A session folder is small — `ls` plus `read` covers it honestly.
 */

/** Absolute path of one session's working folder. */
export function sessionFilesRoot(vaultDir: string, sessionId: string): string {
  return join(vaultDir, SESSION_FILES_DIR, sessionId);
}

/** Vault-relative path of one session's working folder (for UI + receipts). */
export function sessionFilesRelRoot(sessionId: string): string {
  return `${SESSION_FILES_DIR}/${sessionId}`;
}

export const SESSION_FILE_TOOL_NAMES = ['files_list', 'files_read', 'files_write', 'files_edit'];

/** One file in a session's folder, as the tree and the receipt see it. */
export interface SessionFileEntry {
  /** Path relative to the session's folder, e.g. "per-item/kranelund.md". */
  path: string;
  bytes: number;
  mtime: number;
}

/** Every file in a session's folder, depth-first, alphabetical. Missing folder ⇒ []. */
export async function listSessionFiles(root: string): Promise<SessionFileEntry[]> {
  const out: SessionFileEntry[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else if (entry.isFile()) {
        const stat = await fs.stat(abs).catch(() => null);
        if (stat) out.push({ path: relative(root, abs).split(sep).join('/'), bytes: stat.size, mtime: Math.floor(stat.mtimeMs) });
      }
    }
  };
  await walk(root);
  return out;
}

/** Read one session file by its folder-relative path, or null if it escapes/misses. */
export async function readSessionFile(root: string, relPath: string): Promise<string | null> {
  const abs = contain(root, join(root, relPath));
  if (!abs) return null;
  return fs.readFile(abs, 'utf8').catch(() => null);
}

/** Resolve inside the root, or null when the path escapes it. */
function contain(root: string, candidate: string): string | null {
  const abs = resolve(candidate);
  const rel = relative(resolve(root), abs);
  if (rel.startsWith('..') || isAbsolute(rel)) return null;
  return abs;
}

const REFUSED =
  'Refused: this path is outside your session folder. Session file paths are relative to it — "brief.md", "per-item/nordkap.md".';

/**
 * Filesystem operations rooted at one session's folder. Every entry point
 * refuses a path that resolves outside; the tools themselves have already done
 * `~`/absolute/`..` resolution by the time we see it, so this is the last and
 * only word on containment.
 */
function rootedOps(root: string): ReadOperations & WriteOperations & EditOperations & LsOperations {
  const at = (p: string): string => {
    const abs = contain(root, p);
    if (!abs) throw new Error(REFUSED);
    return abs;
  };
  return {
    readFile: (p) => fs.readFile(at(p)),
    writeFile: async (p, content) => {
      const abs = at(p);
      await fs.mkdir(dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf8');
    },
    mkdir: async (p) => {
      await fs.mkdir(at(p), { recursive: true });
    },
    access: (p) => fs.access(at(p)),
    // `at` throws on an escape rather than reporting "not found": `ls` renders a
    // false here as "Path not found: <absolute path>", which would leak the real
    // root and read as "try somewhere else" instead of "you cannot go there".
    exists: async (p) =>
      fs
        .access(at(p))
        .then(() => true)
        .catch(() => false),
    stat: (p) => fs.stat(at(p)),
    readdir: (p) => fs.readdir(at(p)),
  };
}

/**
 * The session's file tools. pi's read/write/edit/ls definitions, rooted at the
 * session folder and renamed so the vocabulary in the transcript is honest:
 * these touch working material, `vault_*` touches the memory.
 */
export function createSessionFileTools(root: string, onWrite?: () => void): ToolDefinition[] {
  const operations = rootedOps(root);
  // Fire AFTER the write settles, from the operations rather than the tool: the
  // tree must reflect what is on disk, and a wrapped execute() would also fire
  // on the refusal path.
  const notifying: WriteOperations & EditOperations = {
    ...operations,
    writeFile: async (p, content) => {
      await operations.writeFile(p, content);
      onWrite?.();
    },
  };
  const scope =
    'Paths are relative to your session folder; nothing outside it is reachable. ' +
    'These files are working material, not the memory: they are never indexed, never searched, ' +
    'never citable. Anything that should last must go through a propose_* card.';

  const list = {
    ...createLsToolDefinition(root, { operations }),
    name: 'files_list',
    label: 'List session files',
    description: `List your session folder (or a subfolder of it). ${scope}`,
  };
  const read = {
    ...createReadToolDefinition(root, { operations, autoResizeImages: false }),
    name: 'files_read',
    label: 'Read session file',
    description: `Read one of your session files, e.g. "brief.md" or "per-item/nordkap.md". ${scope}`,
  };
  const write = {
    ...createWriteToolDefinition(root, { operations: notifying }),
    name: 'files_write',
    label: 'Write session file',
    description:
      'Write a session file, creating or overwriting it (parent folders are created). Use it for ' +
      'working material that will not fit in one context: a brief, one file per item you read, ' +
      'a rollup. Carry the ORIGINAL source path and the verbatim quote into every file you write — ' +
      `a card's evidence must cite the source, never the scratch file that summarised it. ${scope}`,
  };
  const edit = {
    ...createEditToolDefinition(root, { operations: notifying }),
    name: 'files_edit',
    label: 'Edit session file',
    description: `Edit one of your session files by exact text replacement. ${scope}`,
  };
  return [list, read, write, edit] as ToolDefinition[];
}

/**
 * What the model is told about its folder. The layout is a *suggestion*, not a
 * schema — a skill that wants a different shape just writes a different shape —
 * but naming one keeps the common case legible in the tree the PM watches.
 */
export function sessionFilesPrompt(relRoot: string): string {
  return `

## Your session files
You have a scratch folder for this conversation (\`${relRoot}\`), reachable with \`files_list\`,
\`files_read\`, \`files_write\` and \`files_edit\`. Use it when the work does not fit in one context:
write intermediates and read them back rather than holding everything at once.

It is NOT the memory. Nothing there is indexed, searched, retrievable or citable, and the PM can
delete the lot without losing anything. Two rules follow from that:
- **Citations pass through, never terminate.** When a file summarises a source, carry that source's
  original path and the verbatim quote into the file. A card's \`sources\`/\`evidence\` must cite the
  original — never a session file.
- **Anything that should last goes through a card.** Writing a file is not proposing anything.

A conventional layout, worth following unless your skill says otherwise: \`brief.md\` (what everyone
working on this needs to know), \`per-item/<name>.md\` (one file per thing you read), \`meta.md\`
(what you covered, what was silent, what you could not answer).`;
}
