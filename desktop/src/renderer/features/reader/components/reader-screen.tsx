import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from 'convex/react';
import { useNavigate } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { api } from '@convex/api';
import type { Id } from '@convex/dataModel';
import { usePdfDocument } from '../data/use-pdf-document';
import { useReaderPreferences } from '../data/use-reader-preferences';
import { useReaderView, type Fit } from '../data/use-reader-view';
import { useReaderSession } from '../data/use-reader-session';
import { useBookmarks } from '../data/use-bookmarks';
import { useAnnotations } from '../data/use-annotations';
import { useOutline } from '../data/use-outline';
import { useFindInDocument } from '../data/use-find-in-document';
import { useReaderShortcuts } from '../data/use-reader-shortcuts';
import { ReaderDock } from './reader-dock';
import { ReaderSidebar } from './reader-sidebar';
import { useDockVisibility } from '../data/use-dock-visibility';
import { ReaderCanvas, type ReaderCanvasHandle } from './reader-canvas';
import { FindBar } from './find-bar';
import { SelectionMenu } from './selection-menu';
import { ReaderError, ReaderLoading } from './reader-states';

/** The fits the toolbar's fit button cycles through, in order. */
const FIT_CYCLE: Fit[] = ['fit-width', 'fit-page', 'auto'];

/**
 * The reading workspace for one document.
 *
 * It owns the pieces that have to agree on where the reader is — the current
 * page, which drives the toolbar indicator, the progress writer, the sidebar
 * highlight, and the find jump — and hands each feature its own hook. The
 * document surface is the dominant thing on screen; the toolbar is a thin strip
 * above it and the sidebar an optional column beside it, per the plan's layout.
 */
export function ReaderScreen({ documentId }: { documentId: Id<'documents'> }) {
  const navigate = useNavigate();
  const goBack = useCallback(() => void navigate({ to: '/library' }), [navigate]);

  const meta = useQuery(api.library.document, { documentId });
  const pdf = usePdfDocument(documentId);
  const { prefs } = useReaderPreferences();
  const view = useReaderView(prefs);

  const [currentPage, setCurrentPage] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(prefs.sidebarBehavior === 'open');
  const [findOpen, setFindOpen] = useState(false);
  const restored = useRef(false);
  const dock = useDockVisibility(prefs.toolbarBehavior);

  const canvasHandle = useRef<ReaderCanvasHandle | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const pageCount = pdf.pageCount || meta?.pageCount || 0;
  const readingMode = view.mode;

  const { reportPage } = useReaderSession(documentId, pageCount, readingMode);
  const bookmarks = useBookmarks(documentId);
  const annotations = useAnnotations(documentId);
  const outline = useOutline(documentId);
  const find = useFindInDocument(documentId, findOpen);

  // Restore the synced position once, after the document is open and the account
  // says to. A jump reports immediately, so the restore also seeds the writer.
  useEffect(() => {
    if (restored.current || pdf.status !== 'ready' || !meta) return;
    restored.current = true;
    if (prefs.restorePosition && meta.currentPage > 1) {
      jumpTo(meta.currentPage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf.status, meta, prefs.restorePosition]);

  const setPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, pageCount > 0 ? Math.min(page, pageCount) : page);
      setCurrentPage(clamped);
      reportPage(clamped);
    },
    [pageCount, reportPage],
  );

  const jumpTo = useCallback(
    (page: number) => {
      setPage(page);
      canvasHandle.current?.scrollToPage(page);
      dock.wake();
    },
    [setPage, dock],
  );

  // In continuous mode the scroll leads; setPage keeps the writer and indicator
  // in step without moving the scroll back under the reader.
  const onVisiblePage = useCallback(
    (page: number) => {
      setCurrentPage(page);
      reportPage(page);
    },
    [reportPage],
  );

  const step = useCallback((delta: number) => jumpTo(currentPage + delta), [jumpTo, currentPage]);

  const onCycleFit = useCallback(() => {
    const index = FIT_CYCLE.indexOf(view.fit);
    view.setFit(FIT_CYCLE[(index + 1) % FIT_CYCLE.length]);
    dock.wake();
  }, [view, dock]);

  const zoomIn = useCallback(() => {
    view.zoomIn();
    dock.wake();
  }, [view, dock]);

  const zoomOut = useCallback(() => {
    view.zoomOut();
    dock.wake();
  }, [view, dock]);

  const setMode = useCallback(
    (mode: typeof view.mode) => {
      view.setMode(mode);
      dock.wake();
    },
    [view, dock],
  );

  const toggleBookmark = useCallback(
    () => bookmarks.toggle(currentPage, bookmarks.isBookmarked(currentPage)),
    [bookmarks, currentPage],
  );

  const searchFor = useCallback((text: string) => {
    setFindOpen(true);
    find.setTerm(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the find cursor to its page.
  useEffect(() => {
    if (find.current) jumpTo(find.current.page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find.current?.page, find.at]);

  useReaderShortcuts({
    onPrev: () => step(-1),
    onNext: () => step(1),
    onFirst: () => jumpTo(1),
    onLast: () => jumpTo(pageCount || 1),
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onToggleSidebar: () => setSidebarOpen((open) => !open),
    onToggleFind: () => setFindOpen((open) => !open),
    onBookmark: toggleBookmark,
    onToggleToolbar: dock.toggle,
    onClose: () => (findOpen ? setFindOpen(false) : goBack()),
  });

  if (pdf.status === 'error')
    return (
      <ReaderError message={pdf.error ?? 'This document could not be opened.'} onBack={goBack} />
    );
  if (pdf.status === 'loading' || !pdf.doc || !pdf.firstPageSize) return <ReaderLoading />;

  const scalePercent = Math.round(view.manualScale * 100);

  return (
    <div className="flex h-full min-h-0 bg-background">
      {sidebarOpen && (
        <ReaderSidebar
          doc={pdf.doc}
          pageCount={pageCount}
          currentPage={currentPage}
          outline={outline}
          bookmarks={bookmarks.bookmarks}
          onJump={jumpTo}
        />
      )}

      <div ref={surfaceRef} className="relative min-w-0 flex-1" onPointerMove={dock.onPointerMove}>
        <ReaderCanvas
          doc={pdf.doc}
          pageCount={pageCount}
          firstPageSize={pdf.firstPageSize}
          view={view}
          currentPage={currentPage}
          onVisiblePage={onVisiblePage}
          spacing={prefs.pageSpacing}
          background={prefs.documentBackground}
          handleRef={canvasHandle}
        />
        <SelectionMenu
          containerRef={surfaceRef}
          onHighlight={(text) => annotations.keep(currentPage, text)}
          onSearch={searchFor}
        />
        {findOpen && <FindBar find={find} onClose={() => setFindOpen(false)} />}

        {/* The dock floats over the bottom of the surface, horizontally centred.
            The wrapper is click-through so only the dock itself takes the pointer;
            it slides out of view when auto-hidden, leaving the peek handle. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-4">
          <div
            className={cn(
              'transition-[transform,opacity] duration-300 ease-out',
              dock.visible
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none translate-y-[calc(100%+1.5rem)] opacity-0',
            )}
          >
            <ReaderDock
              currentPage={currentPage}
              pageCount={pageCount}
              mode={view.mode}
              fit={view.fit}
              scalePercent={scalePercent}
              sidebarOpen={sidebarOpen}
              isBookmarked={bookmarks.isBookmarked(currentPage)}
              onBack={goBack}
              onToggleSidebar={() => setSidebarOpen((open) => !open)}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onJump={jumpTo}
              onSetMode={setMode}
              onCycleFit={onCycleFit}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onToggleBookmark={toggleBookmark}
              onToggleFind={() => setFindOpen((open) => !open)}
            />
          </div>

          {/* Peek handle: the only affordance when the dock is hidden. Clicking
              wakes it; in manual mode it is the show/hide control. */}
          {!dock.visible && (
            <button
              aria-label="Show reader controls"
              onClick={dock.toggle}
              className="pointer-events-auto absolute bottom-1.5 h-1.5 w-24 rounded-full bg-border-strong opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-focus"
            />
          )}
        </div>
      </div>
    </div>
  );
}
