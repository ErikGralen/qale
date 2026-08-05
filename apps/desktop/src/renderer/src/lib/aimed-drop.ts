import { useCallback, useState } from 'react';
import type { ArrivalItemInputDTO } from '@qale/ipc';
import { readableAs } from '@qale/domain';
import type { MaterialAim } from './material-aim';
import { requestCapture } from './capture-event';
import { pathForFile } from './ipc';

/**
 * A page that claims its own drops, with an aim attached (./material-aim).
 *
 * The Shell catches every drop nobody else claims; this stops propagation, so a
 * page that aims a drop is the only one that handles it.
 */
export function useAimedDrop(aim: MaterialAim | null): {
  over: boolean;
  handlers: {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
} {
  const [over, setOver] = useState(false);

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!aim || e.dataTransfer.files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      const files: ArrivalItemInputDTO[] = [];
      for (const file of Array.from(e.dataTransfer.files)) {
        // The path route wherever there is one — it is what makes a dropped
        // folder readable at all, and it keeps the bytes off the wire.
        const path = pathForFile(file);
        if (path) {
          files.push({ path, name: file.name, lastModified: file.lastModified });
          continue;
        }
        if (readableAs(file.name) === null) {
          files.push({ name: file.name, lastModified: file.lastModified });
          continue;
        }
        if (file.type.startsWith('image/')) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result as string);
            r.onerror = () => reject(r.error);
            r.readAsDataURL(file);
          });
          files.push({
            name: file.name,
            dataBase64: dataUrl.split(',')[1] ?? '',
            lastModified: file.lastModified,
          });
        } else {
          files.push({ name: file.name, text: await file.text(), lastModified: file.lastModified });
        }
      }
      requestCapture({ files, aim });
    },
    [aim],
  );

  return {
    over: over && !!aim,
    handlers: {
      onDragOver: (e) => {
        if (!aim || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      },
      onDragLeave: (e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e) => void onDrop(e),
    },
  };
}
