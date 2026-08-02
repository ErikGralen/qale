import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { stripExternalMarkers } from './external.js';

/**
 * pi session entries → AI SDK UIMessage JSON (the replay side of the bridge).
 * The live stream goes pi events → chunks (bridge.ts); reopening a chat goes
 * pi JSONL → whole messages here. Both must land on the same UIMessage shape
 * ChatView renders: text / reasoning / dynamic-tool parts.
 */
export interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: UiPart[];
}

type UiPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | {
      type: 'dynamic-tool';
      toolCallId: string;
      toolName: string;
      state: 'input-available' | 'output-available' | 'output-error';
      input: unknown;
      output?: string;
      errorText?: string;
    };

/** Structural slice of pi-ai's Message union (a transitive dep — not imported). */
interface PiContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}
interface PiMessage {
  role: string;
  content: string | PiContentBlock[];
  toolCallId?: string;
  isError?: boolean;
}

export function entriesToUiMessages(entries: SessionEntry[]): UiMessage[] {
  const messages: UiMessage[] = [];
  const toolParts = new Map<string, Extract<UiPart, { type: 'dynamic-tool' }>>();
  let assistant: UiMessage | null = null;
  let seq = 0;

  const push = (role: 'user' | 'assistant', parts: UiPart[]): UiMessage => {
    const m: UiMessage = { id: `h${seq++}`, role, parts };
    messages.push(m);
    return m;
  };

  for (const entry of entries) {
    if (entry.type !== 'message') continue;
    const msg = entry.message as unknown as PiMessage;

    if (msg.role === 'user') {
      assistant = null;
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : msg.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('\n');
      if (text.trim()) push('user', [{ type: 'text', text }]);
      continue;
    }

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      // Tool-calling turns span several pi messages; render them as one
      // assistant UIMessage, matching what the live stream produced.
      if (!assistant) assistant = push('assistant', []);
      for (const block of msg.content) {
        if (block.type === 'text' && block.text?.trim()) {
          assistant.parts.push({ type: 'text', text: block.text });
        } else if (block.type === 'thinking' && block.thinking?.trim()) {
          assistant.parts.push({ type: 'reasoning', text: block.thinking });
        } else if (block.type === 'toolCall' && block.id && block.name) {
          const part: Extract<UiPart, { type: 'dynamic-tool' }> = {
            type: 'dynamic-tool',
            toolCallId: block.id,
            toolName: block.name,
            state: 'input-available',
            input: block.arguments ?? {},
          };
          assistant.parts.push(part);
          toolParts.set(block.id, part);
        }
      }
      continue;
    }

    if (msg.role === 'toolResult' && msg.toolCallId) {
      const part = toolParts.get(msg.toolCallId);
      if (!part) continue;
      // Same strip as the live path in bridge.ts: the origin envelope around
      // external material is model-facing, and a reopened session renders this
      // text in the expanded tool step.
      const text = stripExternalMarkers(
        Array.isArray(msg.content)
          ? msg.content.map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).join('\n')
          : String(msg.content ?? ''),
      );
      if (msg.isError) {
        part.state = 'output-error';
        part.errorText = text;
      } else {
        part.state = 'output-available';
        part.output = text;
      }
    }
  }

  return messages.filter((m) => m.parts.length > 0);
}
