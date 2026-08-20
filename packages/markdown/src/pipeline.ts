import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Root } from 'mdast';
import { remarkWikiLink, collectWikiLinks, type WikiLinkData } from './wikilink.js';

/**
 * The unified markdown pipeline (PLAN §3.2 `packages/markdown`): parse
 * frontmatter + body, extract wikilinks, serialize. We split frontmatter and
 * serialize by hand rather than round-tripping through remark-stringify — that
 * would normalize the body and rewrite bytes we didn't touch, breaking Obsidian
 * and git diffs (PLAN §1, "never rewrite bytes we didn't touch").
 */

const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ParsedNote {
  /** Raw, unvalidated frontmatter object (validate with @qale/domain). */
  frontmatter: Record<string, unknown>;
  /** Body markdown with frontmatter stripped. */
  body: string;
  /** The block's YAML text, verbatim. Absent when the file had no block at all. */
  rawFrontmatter?: string;
  /**
   * The block was there and yielded no object: broken YAML, or a bare scalar.
   * `frontmatter` is `{}` in that case, which reads identically to "no
   * frontmatter" and is why this flag exists — the normalizer (OW4) has to tell
   * a file with nothing to say from one whose fields it could not read, so it
   * can preserve the second rather than write over it.
   */
  malformed?: boolean;
}

const linkProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkWikiLink);

/** Parse a full note file (frontmatter + body). */
export function parseNote(raw: string): ParsedNote {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw };

  const block = match[1] ?? '';
  const body = raw.slice(match[0].length);
  let parsed: unknown;
  try {
    parsed = parseYaml(block);
  } catch {
    // Malformed YAML → treat as empty frontmatter; caller's zod validation reports it.
    parsed = null;
  }
  const object = !!parsed && typeof parsed === 'object';
  const frontmatter = object ? (parsed as Record<string, unknown>) : {};
  // An empty block (`---\n---`) is fine and says nothing; a block with text in it
  // that yielded no object is frontmatter somebody meant and we could not read.
  const malformed = block.trim().length > 0 && !object;
  return { frontmatter, body, rawFrontmatter: block, ...(malformed ? { malformed: true } : {}) };
}

/** Extract wikilinks (with line numbers) from a body string. */
export function extractLinks(body: string): WikiLinkData[] {
  const tree = linkProcessor.runSync(linkProcessor.parse(body) as Root) as Root;
  return collectWikiLinks(tree);
}

/**
 * Serialize frontmatter + body back to file text. YAML is emitted for the
 * frontmatter block; the body is written verbatim.
 */
export function serializeNote(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
  const trimmedBody = body.replace(/^\n+/, '').replace(/\s+$/, '');
  return `---\n${yaml}\n---\n\n${trimmedBody}\n`;
}

/**
 * Replace only the body of a raw note file, preserving the original
 * frontmatter block byte-for-byte. Body-only saves must never round-trip
 * frontmatter through parse/serialize: a note whose frontmatter failed
 * validation would be rewritten with the coerced in-memory fallback,
 * permanently erasing the user's real fields.
 */
export function spliceBody(raw: string, body: string): string {
  const match = raw.match(FRONTMATTER_RE);
  const trimmedBody = body.replace(/^\n+/, '').replace(/\s+$/, '');
  if (!match) return `${trimmedBody}\n`;
  return `${match[0].trimEnd()}\n\n${trimmedBody}\n`;
}
