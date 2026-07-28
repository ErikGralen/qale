import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { invoke, onEvent } from './ipc';

/**
 * IpcChatTransport (PLAN §3.4): a ~30-line custom transport that bridges
 * useChat to the pi agent over IPC. `sendMessages` fires `agent:run`, then
 * returns a ReadableStream fed by the `agent:event` push channel, closing on the
 * terminal `finish` chunk. `reconnectToStream` returns null (no replay for now).
 *
 * The session id is threaded across turns so the pi conversation persists.
 */
export class IpcChatTransport implements ChatTransport<UIMessage> {
  private sessionId: string | undefined;

  constructor(
    private readonly sessionType: string = 'chat',
    initialSessionId?: string,
    /** Fired once when the main process assigns the conversation its id. */
    private readonly onSessionId?: (sessionId: string) => void,
    /**
     * Skill the PM picked for the NEXT turn (Sessions v2 explicit invocation).
     * Read fresh on each send and cleared by the caller once it lands, so the
     * pick applies to one turn rather than sticking to the transport.
     */
    private readonly takeInvokeSkill?: () => string | undefined,
  ) {
    this.sessionId = initialSessionId;
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal } = options;
    const last = messages[messages.length - 1];
    const prompt = last ? extractText(last) : '';

    let streamId: string | null = null;
    const buffer: UIMessageChunk[] = [];
    let unsubscribe: (() => void) | null = null;

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        const push = (chunk: UIMessageChunk) => {
          controller.enqueue(chunk);
          if ((chunk as { type?: string }).type === 'finish') {
            unsubscribe?.();
            controller.close();
          }
        };

        unsubscribe = onEvent((event) => {
          if (event.channel !== 'agent:event') return;
          const chunk = event.chunk as UIMessageChunk;
          if (streamId === null) {
            // Buffer until we know our streamId (agent:run hasn't resolved yet).
            buffer.push(Object.assign(chunk, { __streamId: event.streamId }));
            return;
          }
          if (event.streamId === streamId) push(chunk);
        });

        try {
          const handle = await invoke['agent:run']({
            sessionType: this.sessionType,
            sessionId: this.sessionId,
            prompt,
            invokeSkill: this.takeInvokeSkill?.(),
          });
          this.sessionId = handle.sessionId;
          // Reported on every run, not just id changes — the shell also uses
          // this as the "conversation has real content" signal for tabs.
          this.onSessionId?.(handle.sessionId);
          streamId = handle.streamId;

          // Flush anything that arrived before we knew our streamId.
          for (const buffered of buffer) {
            const bid = (buffered as unknown as { __streamId?: string }).__streamId;
            if (bid === streamId) {
              delete (buffered as unknown as { __streamId?: string }).__streamId;
              push(buffered);
            }
          }
          buffer.length = 0;

          abortSignal?.addEventListener('abort', () => {
            if (streamId) void invoke['agent:abort'](streamId);
          });
        } catch (err) {
          controller.enqueue({
            type: 'error',
            errorText: err instanceof Error ? err.message : String(err),
          } as UIMessageChunk);
          unsubscribe?.();
          controller.close();
        }
      },
      cancel: () => {
        unsubscribe?.();
        if (streamId) void invoke['agent:abort'](streamId);
      },
    });
  }

  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return Promise.resolve(null);
  }
}

function extractText(message: UIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
