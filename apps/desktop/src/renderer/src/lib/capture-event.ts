import type { ArrivalItemInputDTO } from '@qale/ipc';
import type { MaterialAim } from './material-aim';

/**
 * Cross-surface "open the Add material tray" signal (Home, meeting pages, deep
 * links). The tray lives in the Shell; anything else dispatches this event.
 *
 * The optional draft is the same shape the Shell's drop handler builds, so a
 * transcript pasted into Home's composer lands in the tray exactly like one
 * dragged onto the window.
 */
export const CAPTURE_EVENT = 'qale:capture';

export interface CaptureRequest {
  text?: string;
  fileName?: string;
  /** Material already gathered by the caller — a multi-file drop. */
  files?: ArrivalItemInputDTO[];
  /**
   * Where this was aimed (docs/arrival-agentic.md, rung 2): a meeting page's
   * "Add transcript", a drop on a folder. It reaches the agent as a sentence.
   */
  aim?: MaterialAim;
}

/**
 * Long enough that it is material, not something someone typed — a pasted
 * transcript is a file, wherever it was pasted. Home's bar uses this to send a
 * wall of text to the tray instead of asking the agent about it, and the tray
 * uses it to keep one out of its instruction field (AR-5).
 */
const BULK_PASTE_CHARS = 800;
const BULK_PASTE_LINES = 10;

export const isBulkPaste = (text: string): boolean =>
  text.length > BULK_PASTE_CHARS || text.split('\n').length > BULK_PASTE_LINES;

export const requestCapture = (draft?: CaptureRequest): void => {
  window.dispatchEvent(
    new CustomEvent<CaptureRequest | undefined>(CAPTURE_EVENT, { detail: draft }),
  );
};
