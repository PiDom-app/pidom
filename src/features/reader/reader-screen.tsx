import { useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import type { ReadingMode } from '@convex/model/library';
import { log } from '@/lib/logger';
import { useReaderStore } from '@/stores/reader-store';
import { useIsOnThisDevice } from '@/stores/local-library-store';
import { useResolvedTheme } from '@/providers/theme-provider';

import { DocumentActions } from '../library/components/document-actions';
import type { LibraryDocument } from '../library/data/types';
import { useLibraryActions } from '../library/data/use-library-actions';
import { useLibraryStatus } from '../library/data/use-library-status';
import { documentFile } from '../library/local/paths';
import { ContentsSheet } from './contents-sheet';
import { FindBar } from './find-bar';
import { forgetPassword, readPassword, savePassword } from './document-password';
import { LinkPrompt } from './link-prompt';
import { openPdfLink, readPdfLink, type PdfLink } from './open-pdf-link';
import { PageJumpSheet } from './page-jump-sheet';
import { PasswordPrompt } from './password-prompt';
import { ReaderCanvas, type ReaderCanvasRef } from './reader-canvas';
import { ReaderChrome } from './reader-chrome';
import { useReaderCommands } from './reader-commands';
import { ReaderModesSheet } from './reader-modes-sheet';
import { ReaderSettingsSheet } from './reader-settings-sheet';
import { SelectionBar } from './selection-bar';
import { useBookmarks } from './use-bookmarks';
import { ReaderFailed, ReaderMissing, ReaderOpening } from './reader-states';
import { useReaderLayout } from './use-reader-layout';
import { useReaderOrientation } from './use-reader-orientation';
import { useFindInDocument } from './use-find-in-document';
import { useReaderSession } from './use-reader-session';
import { useReaderWakeLock } from './use-reader-wake-lock';

const SCOPE = 'reader';

/** `opening → ready`, or `locked`, or `failed`. Nothing else is a state. */
type Phase = 'opening' | 'ready' | 'locked' | 'failed';

/**
 * Reading a document.
 *
 * Composition only. The renderer is in `reader-canvas.tsx`, the controls in
 * `reader-chrome.tsx`, the position in `use-reader-session.ts` and every way of
 * moving the page in `reader-commands.ts` — this file decides which of them is
 * on screen and wires them to each other.
 *
 * **It opens a local file.** `documentFile(profileId, documentId).uri` and
 * nothing else; Convex is never asked for bytes to open a document, which is
 * what lets a 600-page textbook open in airplane mode. Convex supplies the
 * metadata around it — the title, the saved position, whether there is an
 * outline, whether there is a copy in the account to fall back on.
 *
 * No `Screen`: the page runs under the status bar and the chrome carries its
 * own inset. That is what full-bleed means here.
 */
export function ReaderScreen() {
  const router = useRouter();
  const { id, page: requested } = useLocalSearchParams<{ id: string; page?: string }>();
  const documentId = id as Id<'documents'> | undefined;

  const { ready, profileId } = useLibraryStatus();
  const onThisDevice = useIsOnThisDevice(documentId ?? '');
  const theme = useResolvedTheme();
  const layout = useReaderLayout();
  const { fetchDocument } = useLibraryActions();

  const found = useQuery(
    api.library.byIds,
    ready && documentId !== undefined ? { ids: [documentId] } : 'skip',
  );
  const document: LibraryDocument | undefined = found?.[0];

  // The scrubber's chapter ticks *and* the Contents sheet read this one
  // subscription. The sheet used to open its own, which meant a round trip
  // before it could draw anything the reader could use.
  const outline = useQuery(
    api.library.outline,
    ready && documentId !== undefined && document?.hasOutline === true ? { documentId } : 'skip',
  );

  const canvas = useRef<ReaderCanvasRef>(null);
  const [phase, setPhase] = useState<Phase>('opening');
  const [loadProgress, setLoadProgress] = useState(0);
  const [chrome, setChrome] = useState(true);
  const [password, setPassword] = useState<string | undefined>(undefined);
  /** False until the keychain has been asked, so the canvas does not open early. */
  const [passwordChecked, setPasswordChecked] = useState(false);
  const [triedPassword, setTriedPassword] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [acting, setActing] = useState<LibraryDocument | null>(null);
  const [showingContents, setShowingContents] = useState(false);
  const [showingModes, setShowingModes] = useState(false);
  const [showingJump, setShowingJump] = useState(false);
  const [finding, setFinding] = useState(false);
  const [showingSettings, setShowingSettings] = useState(false);
  const [selection, setSelection] = useState<string | null>(null);
  const [link, setLink] = useState<PdfLink | null>(null);
  // `1` is fit-to-page. The renderer's ref exposes only `setPage`, so returning
  // from a pinch is a prop change rather than a method call.
  const [scale, setScale] = useState(1);
  const [zoomed, setZoomed] = useState(false);

  const fit = useReaderStore((state) => state.fit);
  const keepAwake = useReaderStore((state) => state.keepAwake);
  const tint = useReaderStore((state) => state.tint);
  const setTint = useReaderStore((state) => state.setTint);
  const lastMode = useReaderStore((state) => state.lastMode);
  const setFit = useReaderStore((state) => state.setFit);
  const setKeepAwake = useReaderStore((state) => state.setKeepAwake);
  const setLastMode = useReaderStore((state) => state.setLastMode);
  const [modeOverride, setModeOverride] = useState<ReadingMode | null>(null);

  const askedPage = useMemo(() => {
    const parsed = requested === undefined ? Number.NaN : Number.parseInt(requested, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [requested]);

  const session = useReaderSession({
    documentId,
    profileId,
    storedPage: document === undefined ? null : Math.max(1, document.currentPage),
    requestedPage: askedPage,
    storedPageCount: document?.pageCount ?? null,
  });

  // The mode the reader picked this session wins; then the document's own; then
  // whatever they last used. `defaultMode` refuses `spread` on a narrow screen,
  // so a document read on a tablet does not open as two slivers on a phone.
  const mode = layout.defaultMode(modeOverride ?? document?.readingMode ?? null, lastMode);

  // Only while a document is actually open, and only if the reader wants it.
  // A wake lock held by the whole application is a battery complaint.
  useReaderWakeLock(keepAwake && phase === 'ready');
  useReaderOrientation(true);

  // A stored password is tried before the reader is asked for one, so a
  // document they have already unlocked simply opens.
  useEffect(() => {
    if (documentId === undefined) {
      return;
    }
    let live = true;
    readPassword(documentId)
      .then((stored) => {
        if (!live) {
          return;
        }
        if (stored !== null) {
          setPassword(stored);
        }
        setPasswordChecked(true);
      })
      .catch(() => {
        if (live) {
          setPasswordChecked(true);
        }
        // `readPassword` already swallows; this is belt and braces so an
        // unhandled rejection cannot reach the error boundary.
      });
    return () => {
      live = false;
    };
  }, [documentId]);

  const { bookmarks, marked, toggle: toggleBookmark } = useBookmarks({ documentId, ready });

  const find = useFindInDocument({
    documentId,
    profileId,
    ready,
    isSynced: document?.isSynced ?? false,
    active: finding,
  });

  const commands = useReaderCommands({
    canvas,
    page: session.page,
    pageCount: session.pageCount,
    mode,
    onJumped: session.onJumped,
    onModeChanged: (next) => {
      setModeOverride(next);
      setLastMode(next);
      session.onModeChanged(next);
    },
    onFitChanged: setFit,
    onResetZoom: () => {
      setScale(1);
      setZoomed(false);
    },
    onToggleControls: () => setChrome((shown) => !shown),
    onOpenContents: () => setShowingContents(true),
    onOpenSearch: () => setFinding(true),
    onOpenPageJump: () => setShowingJump(true),
    // The three things `ReaderAnatomy` says this does. The position write and
    // the wake-lock release are unmount effects, so leaving is all it takes —
    // but the command is where somebody looks for them, so it says so.
    onClose: () => router.back(),
  });

  const onError = useCallback(
    (error: Error) => {
      // `react-native-pdf` reports a wrong or missing password through the same
      // callback as a corrupt file, so the message is the only thing that
      // separates them. Matching on it is unpleasant and it is what there is;
      // guessing wrong costs a password prompt on a damaged file, which is
      // recoverable, rather than a dead end on an encrypted one.
      const message = String(error?.message ?? '').toLowerCase();
      if (message.includes('password')) {
        // A password was already in play and the document still would not open,
        // so that password is wrong. Forgetting it is the difference between a
        // prompt and a document that is permanently unopenable: without this a
        // saved password that stops working — the file re-encrypted, or the
        // wrong one saved — is retried on every open, forever, and the prompt
        // says "This PDF has a password" as though nothing had been tried.
        if (password !== undefined) {
          setPassword(undefined);
          setTriedPassword(true);
          void forgetPassword(documentId as Id<'documents'>);
        }
        setPhase('locked');
        return;
      }
      setPhase('failed');
      log.error(SCOPE, 'could not open the document');
      log.debug(SCOPE, 'pdf error', error);
    },
    [password, documentId],
  );

  const onPressLink = useCallback((url: string) => {
    const parsed = readPdfLink(url);
    if (parsed !== null) {
      setLink(parsed);
    }
  }, []);

  if (documentId === undefined || profileId === null) {
    return <ReaderMissing />;
  }

  // `documentFile` throws `UnsafeId` on anything that is not a Convex id, which
  // a deep link can be. Caught here rather than in the route's error boundary,
  // because "that is not a document" deserves a sentence rather than
  // "something went wrong".
  let uri: string;
  try {
    uri = documentFile(profileId, documentId).uri;
  } catch {
    return <ReaderMissing />;
  }

  // A document the account has but this phone does not has nothing to render.
  // The tile fetches instead of routing here, so this is the deep-link case.
  if (document !== undefined && !onThisDevice) {
    return <ReaderMissing message="This document is not on this device yet." />;
  }

  if (document === undefined) {
    return (
      <Box className="flex-1 bg-background">
        <Center className="flex-1">
          <Spinner />
        </Center>
      </Box>
    );
  }

  if (phase === 'failed') {
    return (
      <ReaderFailed
        isSynced={document.isSynced}
        onRetry={() => {
          setPhase('opening');
          // Without this the "Opening…" bar reappears at the previous load's
          // final value and then jumps backwards.
          setLoadProgress(0);
          setAttempt((n) => n + 1);
        }}
        onFetch={() => {
          void fetchDocument(document.id);
          router.back();
        }}
      />
    );
  }

  return (
    <Box className="flex-1 bg-background">
      {/* Mounted only once there is a page to open at. The row and this device's
          own record are both consulted first, so the renderer opens on the
          right page instead of opening on page 1 and jumping.

          The key is the whole of the mode switch. Layout props reach the native
          view directly and an Android PdfView is not built to reflow from
          scrolling to paged in place; a reload on an explicit menu tap is the
          cheaper thing to be wrong about. `attempt` reuses the same mechanism
          for Retry and for a password that has just been entered. */}
      {session.resumeAt === null || !passwordChecked ? null : (
      <ReaderCanvas
        key={`${mode}-${fit}-${attempt}`}
        ref={canvas}
        uri={uri}
        // Live only for the spread, whose right pane has no ref and is driven
        // entirely by this prop. Everywhere else the renderer owns the page
        // after the resume, and echoing every `pageChanged` straight back as a
        // `page` prop pushed a navigation command into a view the reader was
        // still scrolling.
        page={mode === 'spread' ? session.page : (session.resumeAt ?? 1)}
        pageCount={session.pageCount ?? document.pageCount}
        scale={scale}
        title={document.title}
        mode={mode}
        fit={fit}
        password={password}
        theme={theme}
        onLoadComplete={(count) => {
          setPhase('ready');
          setTriedPassword(false);
          session.onLoaded(count);
        }}
        onPageChanged={session.onPageChanged}
        onError={onError}
        onTap={commands.toggleControls}
        onScaleChanged={(next) => {
          // Zooming in is somebody looking closely at the page, which is the
          // one moment the controls are certainly in the way. Zooming back out
          // is them finished — so this is a toggle, not a latch that only ever
          // hides.
          const isZoomed = next > 1.05;
          setZoomed(isZoomed);
          if (isZoomed) {
            setChrome(false);
          }
        }}
        onPressLink={onPressLink}
        onSelectionChange={setSelection}
        onLoadProgress={setLoadProgress}
      />
      )}

      {/* Over the page and under the chrome, so the controls stay at full
          contrast while the document dims. Not an inversion — the renderer
          cannot invert a page, and this is honest about being a layer. */}
      {tint === 'none' ? null : (
        <Box
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className={
            tint === 'warm'
              ? 'absolute inset-0 bg-warn/20'
              : 'absolute inset-0 bg-overlay/35'
          }
        />
      )}

      {phase === 'opening' ? (
        <Box className="absolute inset-0">
          <ReaderOpening
            documentId={document.id}
            title={document.title}
            pageCount={document.pageCount}
            progress={loadProgress}
            onBack={commands.closeReader}
          />
        </Box>
      ) : null}

      {finding ? (
        <FindBar
          find={find}
          isSynced={document.isSynced}
          onGo={commands.goToPage}
          onClose={() => setFinding(false)}
        />
      ) : null}

      <SelectionBar
        text={phase === 'ready' && !finding ? selection : null}
        onSearch={(term) => {
          find.setTerm(term);
          setFinding(true);
        }}
        onDismiss={() => setSelection(null)}
      />

      <ReaderChrome
        shown={chrome && phase === 'ready' && !finding}
        title={document.title}
        page={session.page}
        pageCount={session.pageCount ?? document.pageCount}
        hasOutline={document.hasOutline}
        canSearch={document.isSynced}
        onBack={commands.closeReader}
        onContents={commands.openContents}
        onSearch={commands.openSearch}
        isBookmarked={marked(session.page)}
        onToggleBookmark={() => toggleBookmark(session.page)}
        onMore={() => setActing(document)}
        onScrubTo={commands.goToPage}
        onOpenJump={commands.openPageJump}
        onOpenModes={() => setShowingSettings(true)}
        onStep={(by) => (by === 1 ? commands.nextPage() : commands.previousPage())}
        outline={outline}
        uri={uri}
        password={password}
        theme={theme}
      />

      <PasswordPrompt
        isOpen={phase === 'locked'}
        wrong={triedPassword}
        onClose={() => router.back()}
        onSubmit={(entered, remember) => {
          setPassword(entered);
          setTriedPassword(true);
          setPhase('opening');
          setLoadProgress(0);
          setAttempt((n) => n + 1);
          if (remember) {
            void savePassword(documentId, entered);
          } else {
            void forgetPassword(documentId);
          }
        }}
      />

      <LinkPrompt
        link={link}
        onClose={(open) => {
          if (open && link !== null) {
            void openPdfLink(link);
          }
          setLink(null);
        }}
      />

      <PageJumpSheet
        isOpen={showingJump}
        onClose={() => setShowingJump(false)}
        title={document.title}
        page={session.page}
        pageCount={session.pageCount ?? document.pageCount ?? 1}
        onJump={commands.goToPage}
      />

      <ReaderModesSheet
        isOpen={showingModes}
        onClose={() => setShowingModes(false)}
        title={document.title}
        mode={mode}
        fit={fit}
        canSpread={layout.canSpread}
        onPickMode={(next) => {
          commands.setMode(next);
          setShowingModes(false);
        }}
        onPickFit={commands.setFit}
      />

      <ReaderSettingsSheet
        isOpen={showingSettings}
        onClose={() => setShowingSettings(false)}
        title={document.title}
        mode={mode}
        fit={fit}
        tint={tint}
        keepAwake={keepAwake}
        onOpenModes={() => {
          setShowingSettings(false);
          setShowingModes(true);
        }}
        onKeepAwake={setKeepAwake}
        onTint={setTint}
      />

      <DocumentActions
        document={acting}
        onClose={() => setActing(null)}
        onShowContents={() => {
          setActing(null);
          setShowingContents(true);
        }}
      />

      <ContentsSheet
        // `[]` rather than `undefined` when the file declares no contents at
        // all: `undefined` is the sheet's "still loading" state, and a document
        // with no outline is finished, not pending. It should land on the empty
        // state that offers search, not on a spinner that never resolves.
        entries={document.hasOutline === true ? outline : []}
        title={document.title}
        currentPage={session.page}
        bookmarks={bookmarks}
        onRemoveBookmark={toggleBookmark}
        isOpen={showingContents}
        onClose={() => setShowingContents(false)}
        onJump={commands.goToPage}
        onSearch={() => {
          setShowingContents(false);
          router.push({ pathname: '/search', params: { documentId } });
        }}
      />
    </Box>
  );
}
