/**
 * ADF (Atlassian Document Format) → markdown. Jira v3 issue descriptions/comments
 * come as ADF JSON (PLAN §2). This is a focused walker covering the common node
 * types; unknown nodes degrade to their text content.
 */
interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export function adfToMarkdown(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  const node = doc as AdfNode;
  return renderNodes(node.content ?? []).trim();
}

function renderNodes(nodes: AdfNode[]): string {
  return nodes.map(renderNode).join('');
}

function renderNode(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return applyMarks(node.text ?? '', node.marks);
    case 'paragraph':
      return `${renderNodes(node.content ?? [])}\n\n`;
    case 'heading': {
      const level = Number(node.attrs?.['level'] ?? 1);
      return `${'#'.repeat(Math.min(6, level))} ${renderNodes(node.content ?? [])}\n\n`;
    }
    case 'bulletList':
      return `${(node.content ?? []).map((li) => `- ${renderNodes(li.content ?? []).trim()}`).join('\n')}\n\n`;
    case 'orderedList':
      return `${(node.content ?? []).map((li, i) => `${i + 1}. ${renderNodes(li.content ?? []).trim()}`).join('\n')}\n\n`;
    case 'listItem':
      return renderNodes(node.content ?? []);
    case 'codeBlock':
      return `\`\`\`\n${renderNodes(node.content ?? [])}\n\`\`\`\n\n`;
    case 'blockquote':
      return `> ${renderNodes(node.content ?? []).trim().replace(/\n/g, '\n> ')}\n\n`;
    case 'hardBreak':
      return '\n';
    case 'rule':
      return '---\n\n';
    case 'mention':
      return `@${node.attrs?.['text'] ?? node.attrs?.['id'] ?? ''}`;
    case 'inlineCard':
      return String(node.attrs?.['url'] ?? '');
    default:
      return node.content ? renderNodes(node.content) : (node.text ?? '');
  }
}

function applyMarks(text: string, marks?: AdfNode['marks']): string {
  let out = text;
  for (const mark of marks ?? []) {
    if (mark.type === 'strong') out = `**${out}**`;
    else if (mark.type === 'em') out = `*${out}*`;
    else if (mark.type === 'code') out = `\`${out}\``;
    else if (mark.type === 'link') out = `[${out}](${mark.attrs?.['href'] ?? ''})`;
  }
  return out;
}
