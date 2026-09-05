/**
 * Drag-and-drop on the Documents screen (docs/documents-folders.md DF-5).
 *
 * Two hooks, and they are the whole feature: a document row is a drag source,
 * and anything that names a folder is a place to drop it. The rows in the list,
 * the rows in the rail and the breadcrumb segments all use the same drop hook,
 * so a folder behaves the same wherever it is drawn.
 *
 * The library is `@atlaskit/pragmatic-drag-and-drop`, core package only. It
 * builds on the browser's own drag events, so a drag keeps the native cursor,
 * the native scroll and the native cancel key. Every registration returns a
 * cleanup function, and both hooks own theirs.
 *
 * A drop moves documents. It never navigates: the PM stays where they are and
 * watches the rows leave, the way a desktop file manager works.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  draggable,
  dropTargetForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { setCustomNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/utils/set-custom-native-drag-preview';
import { acceptsDocuments, documentDragData, draggedDocuments } from './documents';

/**
 * How a drop target says "let go here". One look for all three places, and the
 * same ink the app uses for a picked row and a focus ring.
 */
export const DROP_ZONE_CLASS = 'bg-brand/8 text-foreground ring-2 ring-brand/40 ring-inset';

/**
 * A callback ref, the one shape both hooks hand out. A drop zone answers with
 * its own cleanup, which React runs when the element goes.
 */
export type AttachRef = (el: HTMLElement | null) => (() => void) | void;

/**
 * Makes a row a drag source for `paths`.
 *
 * The caller decides what a row drags: itself, or the whole ticked selection
 * when the row is one of the ticked ones. Pass null for a page that does not
 * organise anything, and the row stays a plain row.
 *
 * One document drags with the browser's own preview, which is a picture of the
 * row. Several drag with a small count chip instead, because a picture of one
 * row would say nothing about the other four.
 */
export function useDraggableDocuments(paths: string[] | null): {
  ref: AttachRef;
  /** True while this row is the one being dragged. Fade it. */
  dragging: boolean;
} {
  const el = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);

  // The caller builds a fresh array every render, so the paths are held as one
  // string. That is what re-registers the row when what it drags changes.
  const key = paths === null ? null : paths.join('\n');
  const dragged = useMemo(() => (key === null ? null : key.split('\n')), [key]);

  const ref = useCallback((node: HTMLElement | null) => {
    el.current = node;
  }, []);

  useEffect(() => {
    const node = el.current;
    if (!node || !dragged) return;
    return draggable({
      element: node,
      getInitialData: () => documentDragData(dragged),
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        if (dragged.length < 2) return;
        setCustomNativeDragPreview({
          nativeSetDragImage,
          render: ({ container }) => {
            const chip = document.createElement('div');
            chip.className =
              'rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground shadow-md';
            chip.textContent = `${dragged.length} documents`;
            container.append(chip);
            return () => chip.remove();
          },
        });
      },
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    });
  }, [dragged]);

  return { ref, dragging };
}

/**
 * Makes any number of elements places to drop documents.
 *
 * A zone has two names: `id` names the element, `folder` names where the drop
 * goes ('' is the top level, Documents). They are two names because the same
 * folder is often on screen twice, in the rail and in the list, and only the
 * one under the pointer may light up. An id always asks for the same folder.
 *
 * Every zone gets the same ref every render, so a row registers once and holds
 * its registration while the drag is in the air. `onDrop` may change every
 * render; it is read at drop time.
 */
export function useFolderDropZones(onDrop: (paths: string[], folder: string) => void): {
  /** The ref for the element that accepts documents into `folder`. */
  zone: (id: string, folder: string) => AttachRef;
  /** Is a drag hovering this zone right now? Draw {@link DROP_ZONE_CLASS}. */
  isOver: (id: string) => boolean;
} {
  const [over, setOver] = useState<string | null>(null);
  const latest = useRef(onDrop);
  useEffect(() => {
    latest.current = onDrop;
  });

  const refs = useRef(new Map<string, AttachRef>());

  const zone = useCallback((id: string, folder: string) => {
    const cached = refs.current.get(id);
    if (cached) return cached;
    const attach: AttachRef = (el) => {
      if (!el) return;
      const off = dropTargetForElements({
        element: el,
        // A blocked target gets no events at all, so it never highlights.
        canDrop: ({ source }) => acceptsDocuments(draggedDocuments(source.data), folder),
        onDragEnter: () => setOver(id),
        onDragLeave: () => setOver((z) => (z === id ? null : z)),
        onDrop: ({ source }) => {
          setOver((z) => (z === id ? null : z));
          const paths = draggedDocuments(source.data);
          if (paths.length > 0) latest.current(paths, folder);
        },
      });
      // React runs this when the element goes, drag in the air or not.
      return () => {
        off();
        setOver((z) => (z === id ? null : z));
      };
    };
    refs.current.set(id, attach);
    return attach;
  }, []);

  const isOver = useCallback((id: string) => over === id, [over]);

  return { zone, isOver };
}
