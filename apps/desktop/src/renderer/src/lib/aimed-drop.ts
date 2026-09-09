import { useCallback } from 'react';
import type { ArrivalItemInputDTO } from '@qale/ipc';
import type { SourceAim } from './source-aim';
import { requestCapture } from './capture-event';
import { useFileDrop } from './file-drop';

/**
 * A page that claims its own drops, with an aim attached (./source-aim).
 *
 * These pages have no composer to put a file in, and where you dropped says
 * something the composer could not hold anyway ("this belongs to that meeting"),
 * so an aimed drop goes to the Add source tray with the aim already said. Home
 * and a session have a composer, and their drops land in it (./file-drop).
 */
export function useAimedDrop(aim: SourceAim | null): {
  over: boolean;
  handlers: {
    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
} {
  const onFiles = useCallback(
    (files: ArrivalItemInputDTO[]) => requestCapture({ files, aim: aim! }),
    [aim],
  );
  return useFileDrop(aim ? onFiles : null);
}
