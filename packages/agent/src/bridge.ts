import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { stripExternalMarkers } from './external.js';

/**
 * pi → AI SDK UIMessageChunk bridge (PLAN §3.4). pi emits its own event
 * vocabulary; AI Elements consume AI SDK `UIMessage`s. This is the id-correlated
 * state machine that translates one to the other. Every kind needs its start/end
 * frames (text AND reasoning), a message-level `start`, and a terminal `finish`
 * — otherwise useChat renders nothing or hangs in 'streaming' (PLAN §6.6).
 *
 * Chunks are plain JSON so they cross the IPC bridge unchanged.
 */
export type Chunk = Record<string, unknown>;

export class PiUiBridge {
  private messageSeq = 0;
  private startedTexts = new Set<string>();
  private startedReasoning = new Set<string>();
  private finished = false;
  private lastText = '';

  constructor(private readonly emit: (chunk: Chunk) => void) {}

  /**
   * The text of the LAST assistant message of this turn — what the PM would
   * read as the reply, with the tool-calling messages before it dropped. The
   * bridge is the only thing that already decodes pi's text deltas, so the
   * quiet-run backstop (`quiet.ts`) reads it from here rather than re-walking
   * the transcript.
   */
  get finalText(): string {
    return this.lastText;
  }

  /** Open the message stream. Call once before the first pi event. */
  start(): void {
    this.emit({ type: 'start' });
  }

  handle(event: AgentSessionEvent): void {
    switch (event.type) {
      case 'message_start':
        this.messageSeq += 1;
        // Only the last message counts: a turn that called three tools has
        // three assistant messages before the one that answers.
        this.lastText = '';
        break;

      case 'message_update':
        this.handleAssistantEvent(event.assistantMessageEvent as unknown as AssistantEvent);
        break;

      case 'message_end':
        this.closeOpenBlocks();
        break;

      case 'tool_execution_start':
        this.emit({ type: 'tool-input-start', toolCallId: event.toolCallId, toolName: event.toolName });
        this.emit({
          type: 'tool-input-available',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.args ?? {},
        });
        break;

      case 'tool_execution_end':
        if (event.isError) {
          this.emit({
            type: 'tool-output-error',
            toolCallId: event.toolCallId,
            errorText: stringifyToolResult(event.result),
          });
        } else {
          this.emit({
            type: 'tool-output-available',
            toolCallId: event.toolCallId,
            output: stringifyToolResult(event.result),
          });
        }
        break;

      case 'agent_end':
      case 'agent_settled':
        this.finish();
        break;

      default:
        break;
    }
  }

  private handleAssistantEvent(ev: AssistantEvent): void {
    const id = `${this.messageSeq}:${ev.contentIndex ?? 0}`;
    switch (ev.type) {
      case 'text_start':
        if (!this.startedTexts.has(id)) {
          this.startedTexts.add(id);
          this.emit({ type: 'text-start', id });
        }
        break;
      case 'text_delta':
        if (!this.startedTexts.has(id)) {
          this.startedTexts.add(id);
          this.emit({ type: 'text-start', id });
        }
        this.emit({ type: 'text-delta', id, delta: ev.delta });
        this.lastText += ev.delta ?? '';
        break;
      case 'text_end':
        if (this.startedTexts.has(id)) {
          this.startedTexts.delete(id);
          this.emit({ type: 'text-end', id });
        }
        break;
      case 'thinking_start':
        if (!this.startedReasoning.has(id)) {
          this.startedReasoning.add(id);
          this.emit({ type: 'reasoning-start', id });
        }
        break;
      case 'thinking_delta':
        if (!this.startedReasoning.has(id)) {
          this.startedReasoning.add(id);
          this.emit({ type: 'reasoning-start', id });
        }
        this.emit({ type: 'reasoning-delta', id, delta: ev.delta });
        break;
      case 'thinking_end':
        if (this.startedReasoning.has(id)) {
          this.startedReasoning.delete(id);
          this.emit({ type: 'reasoning-end', id });
        }
        break;
      default:
        break;
    }
  }

  private closeOpenBlocks(): void {
    for (const id of this.startedTexts) this.emit({ type: 'text-end', id });
    this.startedTexts.clear();
    for (const id of this.startedReasoning) this.emit({ type: 'reasoning-end', id });
    this.startedReasoning.clear();
  }

  /** Always terminate the stream, even on abort/error. Idempotent. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.closeOpenBlocks();
    this.emit({ type: 'finish' });
  }
}

/** Narrow the assistantMessageEvent union to the fields the bridge reads. */
interface AssistantEvent {
  type: string;
  contentIndex?: number;
  delta?: string;
}

/**
 * Tool result → the text the expanded step shows in the session trail. The
 * origin envelope around external material (`external.ts`) is model-facing
 * plumbing, so it comes off here: this is a display path, and the PM asked for
 * the markers to be invisible in the UI.
 */
function stringifyToolResult(result: unknown): string {
  return stripExternalMarkers(rawToolResult(result));
}

function rawToolResult(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  // Custom tools return { content: [{type:'text', text}], details }.
  const content = (result as { content?: { type: string; text?: string }[] }).content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`))
      .join('\n');
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}
