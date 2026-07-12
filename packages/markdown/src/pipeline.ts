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
  /** Raw, unvalidated frontmatter object (validate with @pm/domain). */
  frontmatter: Record<string, unknown>;
  /** Body markdown with frontmatter stripped. */
  body: string;
  /** Wikilinks found in the body. */
  links: WikiLinkData[];
  /** Whether a frontmatter block was present. */
  hasFrontmatter: boolean;
}

const linkProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkWikiLink);

/** Parse a full note file (frontmatter + body). */
export function parseNote(raw: string): ParsedNote {
  const match = raw.match(FRONTMATTER_RE);
  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  let hasFrontmatter = false;

  if (match) {
    hasFrontmatter = true;
    try {
      const parsed = parseYaml(match[1] ?? '');
      if (parsed && typeof parsed === 'object') frontmatter = parsed as Record<string, unknown>;
    } catch {
      // Malformed YAML → treat as empty frontmatter; caller's zod validation reports it.
      frontmatter = {};
    }
    body = raw.slice(match[0].length);
  }

  return { frontmatter, body, links: extractLinks(body), hasFrontmatter };
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
