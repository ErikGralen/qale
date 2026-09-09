import type { ArrivalItemInputDTO } from '@qale/ipc';
import { readableAs } from '@qale/domain';

/**
 * Files held by a composer before they are sent.
 *
 * A drop, a paste and the file picker all end here, as rows of
 * {@link ArrivalItemInputDTO}: the same shape the Add source tray gathers and
 * the same shape `arrival:ingest` takes. Nothing is written anywhere until the
 * person presses send, so a file put in the bar by mistake costs one X.
 */

/** What a paste is called once it is a file like any other. */
export const PASTED_NAME = 'Pasted text.md';

/**
 * A name for a pasted wall of text, told apart from the pastes already in the
 * bar by a number. What the source actually IS stays the agent's to say once it
 * has read it.
 */
export function pastedName(items: readonly ArrivalItemInputDTO[]): string {
  const taken = items.filter(
    (i) => i.name === PASTED_NAME || /^Pasted text \d+\.md$/.test(i.name ?? ''),
  ).length;
  return taken === 0 ? PASTED_NAME : `Pasted text ${taken + 1}.md`;
}

/** A row's own name, for the chip and for its remove button's label. */
export function attachmentName(item: ArrivalItemInputDTO): string {
  return item.name ?? PASTED_NAME;
}

/**
 * What {@link itemsFromFiles} needs of a dropped file. `File` satisfies it; a
 * test can satisfy it with four lines, which is the point. The branching below
 * is the part that only fails on somebody else's machine.
 */
export interface DroppedFile {
  name: string;
  type: string;
  lastModified: number;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

/** Bytes as base64, in chunks: one `fromCharCode` over a whole image overflows
 *  the call stack at a few hundred kilobytes. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * Dropped or picked files, as rows the composer can hold and main can read.
 *
 * The real path wherever there is one: it is the only way a dropped FOLDER can
 * be read at all, and it keeps fifty files off the wire. A file dragged out of a
 * browser has no path, so its bytes ride along instead. A file whose extension
 * says it cannot be read travels as a name alone, and main refuses it by that
 * name, so the person sees which one it was.
 */
export async function itemsFromFiles<T extends DroppedFile>(
  files: readonly T[],
  pathFor: (file: T) => string,
): Promise<ArrivalItemInputDTO[]> {
  const out: ArrivalItemInputDTO[] = [];
  for (const file of files) {
    const path = pathFor(file);
    if (path) {
      out.push({ path, name: file.name, lastModified: file.lastModified });
      continue;
    }
    if (readableAs(file.name) === null) {
      out.push({ name: file.name, lastModified: file.lastModified });
      continue;
    }
    if (file.type.startsWith('image/')) {
      out.push({
        name: file.name,
        dataBase64: toBase64(await file.arrayBuffer()),
        lastModified: file.lastModified,
      });
    } else {
      out.push({ name: file.name, text: await file.text(), lastModified: file.lastModified });
    }
  }
  return out;
}

/** File names in a sentence: "`a`", "`a` and `b`", "`a`, `b` and `c`". */
function nameList(files: readonly string[]): string {
  const quoted = files.map((f) => `\`${f}\``);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/**
 * The message a session gets when files are attached to it.
 *
 * A conversation replays from its transcript text alone, so the names have to be
 * IN the message: nothing attached to a turn survives the round trip. The line
 * names the files where they now sit, and whatever the person typed follows it,
 * as their own words and unchanged.
 */
export function attachedMessage(files: readonly string[], text: string): string {
  const said = text.trim();
  if (files.length === 0) return said;
  const head = `I added ${nameList(files)} to this session.`;
  return said ? `${head}\n\n${said}` : head;
}
