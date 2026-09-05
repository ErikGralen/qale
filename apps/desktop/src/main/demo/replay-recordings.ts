/**
 * What the replay server answers from (docs/demo-mode.md DM-4).
 *
 * One file per conversation. A conversation is everything the model was asked
 * inside one session, in order, plus the single-turn jobs (naming a session,
 * a summary, a claim check), which are conversations of length one.
 *
 * The files are plain JSON on purpose. After a recording run somebody reads
 * them, sharpens a headline and cuts a weak insight. Only the `response` side
 * may be edited: the matcher reads the `request` side, and the user side of it
 * is what identifies the conversation.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** A block inside a message. The shape is Anthropic's, kept open on purpose. */
export type ContentBlock = { type: string; [key: string]: unknown };

/** One message as the Messages API carries it. */
export interface WireMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** The Anthropic Message JSON a turn answers with. */
export interface WireResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: ContentBlock[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number; [key: string]: unknown };
}

/** The request side of a turn. Tools are names only: the schemas are noise here. */
export interface RecordedRequest {
  system: string;
  messages: WireMessage[];
  tools?: string[];
  model: string;
}

export interface RecordedTurn {
  request: RecordedRequest;
  response: WireResponse;
}

export interface Recording {
  version: 1;
  /** The slugged first user line. It makes the folder read like the demo script. */
  key: string;
  turns: RecordedTurn[];
}

/** A recording plus the file it came from, so a record run can append to it. */
export interface LoadedRecording {
  recording: Recording;
  file: string;
}

/** The file that holds the answer for a request nothing matched (DM-6). */
export const FALLBACK_FILE = '_fallback.json';

/** What the server says when there is no `_fallback.json` on disk either. */
export const BUILT_IN_FALLBACK =
  'I’m the demo build, so I only know the walkthrough. Try one of the prompts on the Home page, or drop one of the transcripts.';

/**
 * Every recording in the folder, `_fallback.json` apart. Re-read on `reset()`,
 * so a hand edit shows up without a relaunch.
 *
 * A file that will not parse is named on the console and skipped. One bad edit
 * must not take the whole demo down mid-walkthrough.
 */
export function loadRecordings(dir: string): LoadedRecording[] {
  if (!existsSync(dir)) return [];
  const out: LoadedRecording[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name === FALLBACK_FILE) continue;
    const loaded = readRecording(join(dir, name));
    if (loaded) out.push(loaded);
  }
  return out;
}

/** The fallback recording, or null when the folder has none. */
export function loadFallback(dir: string): Recording | null {
  const loaded = readRecording(join(dir, FALLBACK_FILE));
  return loaded?.recording ?? null;
}

function readRecording(file: string): LoadedRecording | null {
  if (!existsSync(file)) return null;
  try {
    const recording = JSON.parse(readFileSync(file, 'utf8')) as Recording;
    if (!Array.isArray(recording.turns)) throw new Error('no turns');
    return { recording, file };
  } catch (err) {
    console.error(`[qale] skipped a recording that will not parse: ${file}`, err);
    return null;
  }
}

export function saveRecording(file: string, recording: Recording): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
}

/**
 * The filename for a new conversation: the first line of its first user
 * message, slugged, plus a short hash of that message. The slug is for the
 * person reading the folder, the hash is so two conversations that open the
 * same way get two files.
 */
export function recordingKey(firstUserText: string): string {
  const line = firstUserText.split('\n').find((l) => l.trim().length > 0) ?? 'turn';
  const slug =
    line
      .toLowerCase()
      .replace(/[^a-z0-9åäö]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || 'turn';
  const hash = createHash('sha1').update(firstUserText).digest('hex').slice(0, 6);
  return `${slug}-${hash}`;
}
