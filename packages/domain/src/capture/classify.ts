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

/**
 * A transcript's first line is a spoken turn ("me: thanks for making time…"),
 * not a title — slugifying it yields garbage filenames. Prefer the dropped
 * file's name; else a genuine heading-like line if one exists; else nothing, so
 * naming falls to the model (capture) or a clean date-based default.
 */
function transcriptTitle(baseName: string, nonEmpty: string[]): string {
  if (baseName) return baseName;
  // Only the head of the file can plausibly be a title — a mid-file line that
  // happens to look heading-ish is just a continuation of someone's turn.
  const heading = nonEmpty.slice(0, 5).find(
    (l) =>
      l.length <= 60 &&
      !SPEAKER_TURN.test(l) &&
      !TIMESTAMP.test(l) &&
      !URL_ANYWHERE.test(l) &&
      !l.includes('-->') &&
      // Transcript furniture, not titles: the WEBVTT magic line, SRT cue counters.
      !/^WEBVTT\b/i.test(l) &&
      !/^\d+$/.test(l),
  );
  return heading ? cleanTitle(heading) : '';
}

export function classifyCapture(text: string, fileName?: string): CaptureClassification {
  const body = text.trim();
  const baseName = fileName?.replace(/\.[a-z0-9]+$/i, '') ?? '';
  const lines = body.split('\n').map((l) => l.trim());
  const nonEmpty = lines.filter((l) => l.length > 0);
  const firstLine = nonEmpty[0] ?? '';

  // Subtitle formats are transcripts regardless of content.
  if ((fileName && TRANSCRIPT_EXT.test(fileName)) || /^WEBVTT\b/.test(body)) {
    return { kind: 'transcript', confidence: 'high', title: transcriptTitle(baseName, nonEmpty) };
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
    return { kind: 'transcript', confidence: 'high', title: transcriptTitle(baseName, nonEmpty) };
  }
  if (speakerTurns >= 5 && body.length >= 400) {
    return {
      kind: 'transcript',
      confidence: speakerTurns >= 10 || timestamps >= 3 ? 'high' : 'low',
      title: transcriptTitle(baseName, nonEmpty),
    };
  }

  return {
    kind: 'note',
    // Long pasted prose could still be a transcript the heuristics missed.
    confidence: body.length < 2000 ? 'high' : 'low',
    title: baseName || cleanTitle(firstLine),
  };
}
