import { draftTextShown, type DraftText } from './draft-text';

/**
 * How one assistant turn lays out in the chat (docs/chat-order.md).
 *
 * The turn is drawn in the order it happened. Work piles up into a folded trail
 * until something the PM is meant to read interrupts it, and that flushes the
 * pile. Draft panels and every text the assistant wrote are such interruptions.
 *
 * Text is never folded. A paragraph the PM has read keeps the spot it was drawn
 * in, whatever the turn does next (Erik, 2026-09-11). The old rule called every
 * text but the last one narration and folded it into the trail, so a paragraph
 * the PM was reading jumped into the trail the moment a second text arrived.
 * The trail holds the thinking and the tool steps now, and nothing else.
 */

/** One part of a turn, as useChat hands it over. */
export interface AnyPart {
  type: string;
  text?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/** A step that belongs in the folded trail: the thinking, and every tool call. */
export function isActivityPart(part: AnyPart): boolean {
  return part.type === 'reasoning' || part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

export function isToolPart(part: AnyPart): boolean {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

export function toolNameOf(part: AnyPart): string {
  return part.type.startsWith('tool-') ? part.type.slice(5) : (part.toolName ?? 'tool');
}

export function toolInputOf(part: AnyPart): Record<string, unknown> {
  return typeof part.input === 'object' && part.input !== null
    ? (part.input as Record<string, unknown>)
    : {};
}

/** The work between two things the PM reads, folded into one row. */
export interface TrailBlock {
  kind: 'trail';
  /** Index of the first part in it, for a key that survives the next chunk. */
  from: number;
  parts: AnyPart[];
}

/** A text the assistant wrote, drawn where it was written. */
export interface ProseBlock {
  kind: 'prose';
  at: number;
  text: string;
}

/** A `draft_text` call with something to show (docs/draft-text.md). */
export interface PanelBlock {
  kind: 'panel';
  at: number;
  draft: DraftText;
}

export type TurnBlock = TrailBlock | ProseBlock | PanelBlock;

/**
 * One turn's parts, in the blocks the chat draws, in part order.
 *
 * The same reading serves the streamed turn and the replayed one: the blocks
 * depend only on the parts so far, never on what comes after, so a block that
 * is on screen stays where it is as the rest of the turn arrives.
 *
 * A text part with nothing in it yet draws nothing. It has not been rendered,
 * so nothing moves when its first words land.
 */
export function turnBlocks(parts: readonly AnyPart[]): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  let pending: AnyPart[] = [];
  let from = 0;
  const flush = () => {
    if (pending.length === 0) return;
    blocks.push({ kind: 'trail', from, parts: pending });
    pending = [];
  };
  parts.forEach((part, i) => {
    // A call still running, refused, or with no usable variants reads as null
    // and folds into the trail like any other step.
    const draft =
      isToolPart(part) && toolNameOf(part) === 'draft_text' ? draftTextShown(part) : null;
    if (draft) {
      flush();
      blocks.push({ kind: 'panel', at: i, draft });
      return;
    }
    if (part.type === 'text') {
      const text = part.text ?? '';
      if (!text.trim()) return;
      flush();
      blocks.push({ kind: 'prose', at: i, text });
      return;
    }
    if (isActivityPart(part)) {
      if (pending.length === 0) from = i;
      pending.push(part);
    }
  });
  flush();
  return blocks;
}
