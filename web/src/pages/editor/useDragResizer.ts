import { useCallback, useEffect, useRef } from "react";

/**
 * Shared wiring for the editor's drag resizers (sidebar width, editor height,
 * sidebar section split). beginDrag registers document-level mousemove/mouseup
 * listeners plus the body cursor/selection lock, and the returned path always
 * undoes them — via mouseup OR via effect cleanup when the component unmounts
 * mid-drag, which previously leaked the listeners and left the body stuck
 * with row-resize cursor and selection disabled.
 *
 * Pass `cursor` to lock body styles for the drag (e.g. "row-resize"); omit it
 * to leave body styles untouched.
 */
export function useDragResizer(): (
  e: { preventDefault(): void },
  onMove: (ev: MouseEvent) => void,
  cursor?: string,
) => void {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Unmount mid-drag: release the listeners and body styles.
    return () => { cleanupRef.current?.(); };
  }, []);

  return useCallback((e, onMove, cursor) => {
    e.preventDefault();
    // Safety: a second mousedown without a mouseup would stack listeners.
    cleanupRef.current?.();
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (cursor) {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      cleanupRef.current = null;
    };
    if (cursor) {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    cleanupRef.current = onUp;
  }, []);
}
