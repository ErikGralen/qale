import type { ArrivalItemInputDTO } from '@pm/ipc';

/**
 * Cross-surface "open the capture dialog" signal (Home, deep links). The dialog
 * lives in the Shell; anything else dispatches this event.
 *
 * The optional draft is the same shape the Shell's drop handler builds, so a
 * transcript pasted into Home's composer lands in the dialog exactly like one
 * dragged onto the window — classified, titled, and still awaiting approval.
 */
export const CAPTURE_EVENT = 'pm:capture';

export interface CaptureRequest {
  text?: string;
  fileName?: string;
  image?: { name: string; dataUrl: string };
  /** Material already gathered by the caller — a multi-file drop. */
  files?: ArrivalItemInputDTO[];
}

export const requestCapture = (draft?: CaptureRequest): void => {
  window.dispatchEvent(new CustomEvent<CaptureRequest | undefined>(CAPTURE_EVENT, { detail: draft }));
};
