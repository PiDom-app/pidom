import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { Spinner } from '@/components/ui/spinner';
import type { Id } from '@convex/_generated/dataModel';
import type { ReadingMode } from '@convex/model/library';
import { log } from '@/lib/logger';
import { useReaderStore } from '@/stores/reader-store';
import { useResolvedTheme } from '@/providers/theme-provider';

import { DocumentActions } from '../library/components/document-actions';
import type { LibraryDocument } from '../library/data/types';
import { useLibraryActions } from '../library/data/use-library-actions';
import { useLibraryStatus } from '../library/data/use-library-status';
import { documentFile } from '../library/local/paths';
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
import type { NavigatorSegment } from './reader-location';
import { SelectionBar } from './selection-bar';
import { useAnnotations } from './use-annotations';
import { useBookmarks } from './use-bookmarks';
import { useReaderDocument } from './use-reader-document';
import { useRecoveredOutline } from './use-recovered-outline';
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
 * What the reader has put over the page, of the things the *chrome* opens.
 *
 * One value rather than a boolean per sheet. There used to be five of those and
 * nothing coordinated them, so two sheets could be open at once and every
 * hand-off between them — settings to modes — had to be remembered as a pair of
 * `setState` calls. A union makes that impossible instead of careful, and makes
 * "close whatever is open" one assignment.
 *
 * What is left in it are the four small ones: a page number, three reading
 * modes, four settings, and a find bar. Each is a short fixed list, so a sheet
 * is the right surface and its height never surprises anybody. The navigator
 * and the note composer used to be here too and are routes now — a list as long
 * as the reader's data has no business setting the height of a control.
 *
 * The password prompt, the link prompt, the selection bar and the document's
 * action sheet are deliberately outside it: those are opened by the renderer or
 * by the library, not by a control in this chrome, and two of them can
 * legitimately sit over one of these.
 */
type Overlay =
  | { kind: 'none' }
  | { kind: 'jump' }
  | { kind: 'modes' }
  | { kind: 'settings' }
  | { kind: 'find' };

const CLOSED: Overlay = { kind: 'none' };

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
  const documentId = id === undefined || id === '' ? undefined : id;

  const { profileId } = useLibraryStatus();
  const theme = useResolvedTheme();
  const layout = useReaderLayout();
  const { fetchDocument } = useLibraryActions();

  /**
   * The document and its contents, from this device. See the hook for what
   * this replaced and why it matters more here than anywhere else.
   */
  const { document, outline, loading } = useReaderDocument(documentId);
  const onThisDevice = document?.fileState === 'available';

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
  const [overlay, setOverlay] = useState<Overlay>(CLOSED);
  const [selection, setSelection] = useState<string | null>(null);
  const [link, setLink] = useState<PdfLink | null>(null);
  const finding = overlay.kind === 'find';

  const fit = useReaderStore((state) => state.fit);
  const keepAwake = useReaderStore((state) => state.keepAwake);
  const tint = useReaderStore((state) => state.tint);
  const setTint = useReaderStore((state) => state.setTint);
  const lastMode = useReaderStore((state) => state.lastMode);
  const setFit = useReaderStore((state) => state.setFit);
  const setKeepAwake = useReaderStore((state) => state.setKeepAwake);
  const setLastMode = useReaderStore((state) => state.setLastMode);
  const takeJump = useReaderStore((state) => state.takeJump);
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

  // `bookmarks` is not read here any more — the list moved to the navigator —
  // but the subscription stays, because the toolbar's filled-or-not icon has to
  // know whether *this* page is marked on every page turn.
  const { marked, toggle: toggleBookmark } = useBookmarks({ documentId });

  // Only `keep` is used here. The list, the edit and the delete live on the
  // navigator, which subscribes to the same query from its own screen.
  const { keep } = useAnnotations({ documentId });

  // The renderer hands the document's own contents back on every load; this
  // keeps them when the row has none. See the hook for why it is that narrow.
  const recoverOutline = useRecoveredOutline({
    documentId,
    hasOutline: document?.hasOutline,
    stored: outline,
  });

  const find = useFindInDocument({
    documentId,
    profileId,
    remoteId: document?.remoteId ?? null,
    isSynced: document?.isSynced ?? false,
    active: finding,
  });

  /** The navigator, as a pushed screen. It reads the rest from its own params. */
  const openNavigator = useCallback(
    (segment: NavigatorSegment) => {
      if (documentId === undefined) {
        return;
      }
      router.push({
        pathname: '/navigator',
        params: { id: documentId, page: String(session.page), segment },
      });
    },
    [router, documentId, session.page],
  );

  /** Writing a note about the page on screen, or about a passage from it. */
  const openNote = useCallback(
    (passage: string | null) => {
      if (documentId === undefined) {
        return;
      }
      router.push({
        pathname: '/note',
        params: {
          id: documentId,
          kind: 'note',
          page: String(session.page),
          value: '',
          ...(passage === null ? {} : { passage }),
        },
      });
    },
    [router, documentId, session.page],
  );

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
    onToggleBookmark: () => toggleBookmark(session.page),
    onToggleControls: () => setChrome((shown) => !shown),
    onOpenNavigator: openNavigator,
    onOpenSearch: () => setOverlay({ kind: 'find' }),
    onOpenPageJump: () => setOverlay({ kind: 'jump' }),
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

  /**
   * A page chosen on the navigator, acted on when the reader comes back.
   *
   * A pushed screen cannot return a value — `router.back()` has nowhere to put
   * "page 142" — so the navigator leaves it in the store and this picks it up.
   * On focus rather than on mount, because the reader is never unmounted: the
   * stack keeps it alive underneath, which is the whole reason these are pushes
   * and not a second reader.
   *
   * `goToPage` and not `setPage`, so a jump from a list is clamped, pair-snapped
   * in a spread, announced to assistive tech and recorded as deliberate — the
   * same as one from the scrubber. That is what the one command is for.
   */
  useFocusEffect(
    useCallback(() => {
      if (documentId === undefined || phase !== 'ready') {
        return;
      }
      const page = takeJump(documentId);
      if (page !== null) {
        commands.goToPage(page);
      }
    }, [documentId, phase, takeJump, commands]),
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

  // `documentFile` throws `UnsafeId` on anything that is not an id this app
  // writes, which a deep link can be. Caught here rather than in the route's
  // error boundary, because "that is not a document" deserves a sentence rather
  // than "something went wrong".
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
    // The device answers in a frame, so this is the frame before it does — and
    // then, if there is still nothing, a document that is not here at all.
    return loading ? (
      <Box className="flex-1 bg-background">
        <Center className="flex-1">
          <Spinner />
        </Center>
      </Box>
    ) : (
      <ReaderMissing />
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
          void fetchDocument(document);
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
        title={document.title}
        mode={mode}
        fit={fit}
        password={password}
        theme={theme}
        onLoadComplete={(count, tableContents) => {
          setPhase('ready');
          setTriedPassword(false);
          session.onLoaded(count);
          recoverOutline(count, tableContents);
        }}
        onPageChanged={session.onPageChanged}
        onError={onError}
        onTap={commands.toggleControls}
        onScaleChanged={(next) => {
          // Zooming in is somebody looking closely at the page, which is the
          // one moment the controls are certainly in the way. Zooming back out
          // is them finished — so this is a toggle, not a latch that only ever
          // hides.
          if (next > 1.05) {
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
          onClose={() => setOverlay(CLOSED)}
        />
      ) : null}

      <SelectionBar
        text={phase === 'ready' && overlay.kind === 'none' ? selection : null}
        onSearch={(term) => {
          find.setTerm(term);
          setOverlay({ kind: 'find' });
        }}
        onKeep={(passage) => keep({ page: session.page, kind: 'passage', text: passage })}
        onNote={(passage) => openNote(passage)}
        onDismiss={() => setSelection(null)}
      />

      <ReaderChrome
        shown={chrome && phase === 'ready' && !finding}
        title={document.title}
        page={session.page}
        pageCount={session.pageCount ?? document.pageCount}
        canSearch={document.isSynced}
        onBack={commands.closeReader}
        onNavigator={() => commands.openNavigator('contents')}
        onSearch={commands.openSearch}
        isBookmarked={marked(session.page)}
        onToggleBookmark={commands.toggleBookmark}
        onMore={() => setActing(document)}
        onScrubTo={commands.goToPage}
        onOpenJump={commands.openPageJump}
        onOpenSettings={() => setOverlay({ kind: 'settings' })}
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
        isOpen={overlay.kind === 'jump'}
        onClose={() => setOverlay(CLOSED)}
        title={document.title}
        page={session.page}
        pageCount={session.pageCount ?? document.pageCount ?? 1}
        onJump={commands.goToPage}
      />

      <ReaderModesSheet
        isOpen={overlay.kind === 'modes'}
        onClose={() => setOverlay(CLOSED)}
        title={document.title}
        mode={mode}
        fit={fit}
        canSpread={layout.canSpread}
        onPickMode={(next) => {
          commands.setMode(next);
          setOverlay(CLOSED);
        }}
        onPickFit={commands.setFit}
      />

      <ReaderSettingsSheet
        isOpen={overlay.kind === 'settings'}
        onClose={() => setOverlay(CLOSED)}
        title={document.title}
        mode={mode}
        fit={fit}
        tint={tint}
        keepAwake={keepAwake}
        // The one hand-off between two sheets, and now a single assignment
        // rather than a close and an open that had to stay in step.
        onOpenModes={() => setOverlay({ kind: 'modes' })}
        onKeepAwake={setKeepAwake}
        onTint={setTint}
      />

      <DocumentActions
        document={acting}
        onClose={() => setActing(null)}
        onShowContents={() => {
          setActing(null);
          openNavigator('contents');
        }}
        onWriteNote={() => {
          setActing(null);
          openNote(null);
        }}
      />

    </Box>
  );
}
