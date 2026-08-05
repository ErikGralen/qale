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

export const requestCapture = (draft?: CaptureRequest): void => {
  window.dispatchEvent(new CustomEvent<CaptureRequest | undefined>(CAPTURE_EVENT, { detail: draft }));
};
