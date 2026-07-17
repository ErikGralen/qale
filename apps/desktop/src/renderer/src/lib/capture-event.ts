/**
 * Cross-surface "open the capture dialog" signal (Landing, boot deep links).
 * The dialog lives in the Shell; anything else dispatches this event.
 */
export const CAPTURE_EVENT = 'pm:capture';

export const requestCapture = (): void => {
  window.dispatchEvent(new CustomEvent(CAPTURE_EVENT));
};
