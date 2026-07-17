/**
 * Capture classification (universal ingest) — the PO dumps *anything* and the
 * system, not the user, decides what it is. Deterministic and instant so the
 * capture surface can show its guess live; the guess is a suggestion the user
 * can always override with one click. Screenshots are classified by the caller
 * (file mime), never from text.
 */

export const CAPTURE_KINDS = ['transcript', 'link', 'screenshot', 'note'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export interface CaptureClassification {
  kind: CaptureKind;
  /** `high` locks the default; `low` means "best guess — glance at the chips". */
  confidence: 'high' | 'low';
  /** Suggested title: file name, first non-URL line, or the link's host. */
  title: string;
  /** The primary URL when `kind` is `link`. */
  url?: string;
}

const TRANSCRIPT_EXT = /\.(vtt|srt)$/i;
const URL_LINE = /^https?:\/\/\S+$/;
const URL_ANYWHERE = /https?:\/\/\S+/;
/** "Anna: we should…" / "ERIK GRALÉN: …" — a speaker turn at line start. */
const SPEAKER_TURN = /^[\p{L}][\p{L} .'’-]{1,39}:\s+\S/u;
const TIMESTAMP = /(?:^|[\s[(])\d{1,2}:\d{2}(?::\d{2})?(?:[\s\])]|$)/;

function cleanTitle(line: string): string {
  return line
    .replace(/^#+\s*/, '')
    .replace(/^[>*-]\s*/, '')
    .trim()
    .slice(0, 80);
}

function hostOf(url: string): string {
  const host = /^https?:\/\/([^/:?#]+)/i.exec(url)?.[1];
  return host ? host.replace(/^www\./, '') : url.slice(0, 60);
}

export function classifyCapture(text: string, fileName?: string): CaptureClassification {
  const body = text.trim();
  const baseName = fileName?.replace(/\.[a-z0-9]+$/i, '') ?? '';
  const lines = body.split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter((l) => l.length > 0);
  const firstLine = nonEmpty[0] ?? '';

  // Subtitle formats are transcripts regardless of content.
  if ((fileName && TRANSCRIPT_EXT.test(fileName)) || /^WEBVTT\b/.test(body)) {
    return { kind: 'transcript', confidence: 'high', title: baseName || cleanTitle(firstLine) };
  }

  // A dumped link: one URL, at most a couple of comment lines around it.
  const urlLines = nonEmpty.filter((l) => URL_LINE.test(l));
  if (urlLines.length === 1 && nonEmpty.length <= 3 && nonEmpty.every((l) => l.length <= 200)) {
    const url = urlLines[0]!;
    const comment = nonEmpty.find((l) => l !== url);
    return { kind: 'link', confidence: 'high', title: comment ? cleanTitle(comment) : hostOf(url), url };
  }
  if (nonEmpty.length === 1 && URL_ANYWHERE.test(firstLine) && firstLine.length <= 200) {
    const url = URL_ANYWHERE.exec(firstLine)![0];
    const comment = cleanTitle(firstLine.replace(url, '').trim());
    return { kind: 'link', confidence: 'high', title: comment || hostOf(url), url };
  }

  // Transcript signals: repeated speaker turns, timestamps, cue arrows.
  const speakerTurns = lines.filter((l) => SPEAKER_TURN.test(l)).length;
  const timestamps = lines.filter((l) => TIMESTAMP.test(l)).length;
  const cues = lines.filter((l) => l.includes('-->')).length;
  if (cues >= 2) {
    return { kind: 'transcript', confidence: 'high', title: baseName || cleanTitle(firstLine) };
  }
  if (speakerTurns >= 5 && body.length >= 400) {
    return {
      kind: 'transcript',
      confidence: speakerTurns >= 10 || timestamps >= 3 ? 'high' : 'low',
      title: baseName || cleanTitle(firstLine),
    };
  }

  return {
    kind: 'note',
    // Long pasted prose could still be a transcript the heuristics missed.
    confidence: body.length < 2000 ? 'high' : 'low',
    title: baseName || cleanTitle(firstLine),
  };
}
