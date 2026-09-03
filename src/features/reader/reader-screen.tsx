import { useMutation, useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, MoreHorizontal } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable as RNPressable } from 'react-native';
import Pdf from 'react-native-pdf';

import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Progress, ProgressFilledTrack } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { log } from '@/lib/logger';
import { useLocalLibraryStore } from '@/stores/local-library-store';

import { DocumentActions } from '../library/components/document-actions';
import type { LibraryDocument } from '../library/data/types';
import { useLibraryStatus } from '../library/data/use-library-status';
import { documentFile } from '../library/local/paths';

const SCOPE = 'reader';

/**
 * Reading a document.
 *
 * This is what Continue Reading, the progress bars and Finished were all built
 * to be fed by. Until it existed, `library.recordProgress` was a public function
 * with no caller and three of the home rails could never hold anything.
 *
 * **Position is written on the way out, not per page.** A mutation per swipe is
 * a write per swipe, replicated to every device the reader owns, re-rendering
 * rails on all of them to move a bar on one. The page lives in local state
 * while reading and lands once — on unmount, and on the app going to the
 * background, because a reader who swipes up mid-chapter has still read to
 * there.
 */
export function ReaderScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const documentId = id as Id<'documents'> | undefined;

  const { ready, profileId } = useLibraryStatus();
  const onDevice = useLocalLibraryStore((state) => state.ids);

  const found = useQuery(
    api.library.byIds,
    ready && documentId !== undefined ? { ids: [documentId] } : 'skip',
  );
  const document: LibraryDocument | undefined = found?.[0];

  const recordProgress = useMutation(api.library.recordProgress);

  const [chrome, setChrome] = useState(true);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [acting, setActing] = useState<LibraryDocument | null>(null);

  // Refs, because the write happens from a cleanup and an `AppState` listener,
  // neither of which sees the render that set the state.
  const pageRef = useRef(1);
  const pageCountRef = useRef<number | null>(null);
  const openedRef = useRef(false);

  /**
   * Writes where the reader got to.
   *
   * Idempotent and cheap, so calling it from both exits costs a duplicate
   * mutation at worst. Never awaited by anything the reader is waiting on.
   */
  const save = useCallback(() => {
    if (documentId === undefined || !openedRef.current) {
      return;
    }
    recordProgress({
      documentId,
      currentPage: pageRef.current,
      ...(pageCountRef.current === null ? {} : { pageCount: pageCountRef.current }),
    }).catch((error: unknown) => {
      // Losing a page position is not worth interrupting somebody who has just
      // closed a book. It writes again next time.
      log.debug(SCOPE, 'could not save the position', error);
    });
  }, [documentId, recordProgress]);

  // The two ways out of a document: leaving the screen, and leaving the app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        save();
      }
    });
    return () => {
      subscription.remove();
      save();
    };
  }, [save]);

  // Resume where they were. Once — after that the reader owns the page, and
  // re-syncing from the row would fight their swipes.
  useEffect(() => {
    if (document !== undefined && !openedRef.current) {
      openedRef.current = true;
      const resume = Math.max(1, document.currentPage);
      setPage(resume);
      pageRef.current = resume;
    }
  }, [document]);

  if (documentId === undefined || profileId === null) {
    return <Missing />;
  }

  // A document the account has but this phone does not has nothing to render.
  // The tile fetches instead of routing here, so this is the deep-link case.
  if (document !== undefined && !onDevice.has(documentId)) {
    return <Missing message="This document is not on this device yet." />;
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

  const total = pageCount ?? document.pageCount ?? 0;
  const percent = total > 0 ? Math.round((page / total) * 100) : 0;

  return (
    // No `Screen`: the page runs under the status bar, and the chrome carries
    // its own inset. That is what full-bleed means here.
    <Box className="flex-1 bg-background">
      <Pdf
        source={{ uri: documentFile(profileId, documentId).uri }}
        page={page}
        horizontal
        enablePaging
        // The reader taps the page to reach the controls, so the viewer must
        // not swallow it.
        onPageSingleTap={() => setChrome((shown) => !shown)}
        onLoadComplete={(numberOfPages) => {
          setPageCount(numberOfPages);
          pageCountRef.current = numberOfPages;
        }}
        onPageChanged={(current) => {
          setPage(current);
          pageRef.current = current;
        }}
        onError={(error) => {
          log.error(SCOPE, 'could not open the document');
          log.debug(SCOPE, 'pdf error', error);
        }}
        trustAllCerts={false}
        style={FILL}
      />

      {chrome ? (
        <>
          <Box className="absolute inset-x-0 top-0 border-b border-hairline bg-background pt-11">
            <HStack className="items-center gap-1.5 px-4 pb-3">
              <Pressable
                onPress={() => router.back()}
                accessibilityRole="button"
                accessibilityLabel="Back to your library"
                className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
                <Icon as={ArrowLeft} size="lg" className="text-foreground" />
              </Pressable>

              <Text
                size="sm"
                numberOfLines={1}
                className="flex-1 px-1 font-semibold text-foreground">
                {document.title}
              </Text>

              <Pressable
                onPress={() => setActing(document)}
                accessibilityRole="button"
                accessibilityLabel="Document actions"
                className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
                <Icon as={MoreHorizontal} size="lg" className="text-foreground" />
              </Pressable>
            </HStack>
          </Box>

          <Box className="absolute inset-x-0 bottom-0 border-t border-hairline bg-background pb-7">
            <VStack className="px-6 pt-4">
              <HStack className="items-center justify-between">
                <Text size="xs" className="text-fg-muted">
                  {total > 0 ? `${page} of ${total}` : `Page ${page}`}
                </Text>
                <Text size="xs" className="text-fg-subtle">
                  {total > 0 ? `${percent}%` : ''}
                </Text>
              </HStack>
              <Progress value={percent} className="mt-2.5 h-0.5 bg-border">
                <ProgressFilledTrack className="bg-primary" />
              </Progress>
            </VStack>
          </Box>
        </>
      ) : null}

      <DocumentActions document={acting} onClose={() => setActing(null)} />
    </Box>
  );
}

function Missing({ message = 'That document is no longer in your library.' }: { message?: string }) {
  const router = useRouter();
  return (
    <Box className="flex-1 bg-background">
      <Center className="flex-1 px-10">
        <VStack className="items-center" space="md">
          <Text size="sm" className="text-center text-fg-subtle">
            {message}
          </Text>
          <RNPressable onPress={() => router.back()} accessibilityRole="button">
            <Text size="sm" className="text-primary">
              Back to your library
            </Text>
          </RNPressable>
        </VStack>
      </Center>
    </Box>
  );
}

const FILL = { flex: 1 } as const;
