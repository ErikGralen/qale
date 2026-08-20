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
  /**
   * The skill the last attempt ran with. A retry (`regenerate-message`) is the
   * same turn a second time, so it must run the same way: the opening skill is
   * spent on the first send and a picked one is consumed by the caller as it
   * goes, which would leave a kickoff that failed before the session existed
   * retrying as a plain message with "Run the meeting-prep skill on …" as its
   * text. Re-invoking a skill already in force is a no-op in the runtime, so
   * passing it again costs nothing in the ordinary case.
   */
  private lastSkill: string | undefined;

  constructor(
    /**
     * The skill this conversation opens on, when it was started from a tile or
     * an entry-point button. Spent on the first turn that starts: it is an
     * instruction for that turn, not a property of the conversation. A picked
     * skill on that same turn overrides it — the PM's later choice wins.
     */
    private openingSkill?: string,
    initialSessionId?: string,
    /** Fired once when the main process assigns the conversation its id. */
    private readonly onSessionId?: (sessionId: string) => void,
    /**
     * Skill the PM picked for the NEXT turn. Read fresh on each send and cleared
     * by the caller once it lands, so the pick applies to one turn rather than
     * sticking to the transport.
     */
    private readonly takePickedSkill?: () => string | undefined,
    /**
     * Model the PM moved this session to, read fresh on each send. Unlike the
     * skill it is NOT spent: the choice belongs to the session, so it rides
     * along with every message until they pick another one.
     */
    private readonly pickedModel?: () => string | undefined,
  ) {
    this.sessionId = initialSessionId;
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal, trigger } = options;
    const last = messages[messages.length - 1];
    const prompt = last ? extractText(last) : '';
    const retry = trigger === 'regenerate-message';

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
          const skill = retry ? this.lastSkill : (this.takePickedSkill?.() ?? this.openingSkill);
          this.lastSkill = skill;
          const modelId = this.pickedModel?.();
          const handle = await invoke['agent:run']({
            sessionId: this.sessionId,
            prompt,
            ...(skill ? { skill } : {}),
            ...(modelId ? { modelId } : {}),
          });
          // Spent once the run has actually started, not once it has been asked
          // for: a first turn refused before there was a session (no key yet)
          // keeps its skill so the retry opens on it.
          this.openingSkill = undefined;
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
