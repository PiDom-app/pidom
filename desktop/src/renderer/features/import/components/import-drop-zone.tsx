import { useEffect, useRef, useState, type ReactNode } from 'react';
import { UploadCloud } from 'lucide-react';
import { useImports } from '../data/use-imports';

/**
 * A window-level drop target for the Library. Wraps the page content and, while
 * a file is dragged anywhere over the window, shows a full-page overlay inviting
 * the drop.
 *
 * Two things matter here. First the footgun: Electron will navigate the webview
 * to `file://` the dropped file unless the top-level `dragover` and `drop` are
 * `preventDefault`ed — so the listeners live on `window` and always cancel the
 * default, whether or not the drop lands on the overlay. Second the seam: the
 * dropped `FileList` is handed straight to `addDropped`, which resolves each
 * `File` to a path in preload and passes only paths to main; no path ever
 * reaches this renderer.
 */
export function ImportDropZone({ children }: { children: ReactNode }) {
  const { addDropped } = useImports();
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave fire per element as the cursor crosses children; a depth
  // counter keeps the overlay up until the drag truly leaves the window.
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      // Cancelling dragover is what actually blocks the file:// navigation.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = hasFiles(e) ? 'copy' : 'none';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) void addDropped(Array.from(files));
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [addDropped]);

  return (
    <div className="relative h-full">
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-overlay/60 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border-strong bg-elevated px-10 py-8 text-center shadow-lg">
            <UploadCloud className="size-8 text-primary" />
            <p className="text-sm font-medium text-foreground">Drop PDFs to import</p>
            <p className="max-w-xs text-xs text-fg-muted">
              They stage on this device and start uploading to your library.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
