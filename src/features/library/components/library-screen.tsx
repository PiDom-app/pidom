import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { ChevronRight, FilePlus2 } from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { useProfile } from '@/features/auth/use-profile';
import { useSession } from '@/features/auth/session-provider';
import { themeColors } from '@/design/tokens';
import { useResolvedTheme } from '@/providers/theme-provider';

import type { LibraryCollection, LibraryDocument } from '../data/types';
import type { HomeSection } from '../data/use-home';
import { useHome } from '../data/use-home';
import { useLibraryActions } from '../data/use-library-actions';
import { useLibraryStatus } from '../data/use-library-status';
import { usePendingProbe } from '../data/use-pending-probe';
import { databaseFault } from '../local/db';
import type { LibraryShare } from '../local/repository/types';
import { documentFile } from '../local/paths';
import { COLLECTION_TILE_HEIGHT, CollectionTile } from './collection-tile';
import { DocumentActions } from './document-actions';
import { COVER_WIDTH } from './document-cover';
import { DocumentProbe, type ProbeResult } from './document-probe';
import { DocumentTile, tileHeight } from './document-tile';
import { EmptyLibrary } from './empty-library';
import { LibraryHeader } from './library-header';
import { LibraryUnavailable, OfflineState, SyncNotice } from './library-notice';
import { LibrarySkeleton } from './library-skeleton';
import { SectionRail } from './section-rail';
import { SharedTile } from './shared-tile';

/**
 * Home.
 *
 * One vertical `FlashList` whose items are sections, each rendering a
 * horizontal `FlashList` of its own. FlashList's docs ask for exactly this
 * shape — "when nesting horizontal FlashLists in a vertical list, we highly
 * recommend the vertical list to be FlashList too" — because it waits for the
 * child layouts rather than guessing at them.
 *
 * A vertical `FlatList` inside a `ScrollView` would be the other way to build
 * it, and is the one arrangement React Native explicitly warns against.
 *
 * There is no card anywhere on this screen. Sections are separated by
 * whitespace, the covers are the only filled shapes, and the single rule sits
 * above "View all library" because it is a boundary rather than decoration.
 */
export function LibraryScreen() {
  const router = useRouter();
  const { account } = useSession();
  const { profile } = useProfile();
  const theme = useResolvedTheme();

  const {
    sections,
    loading,
    isEmpty,
    offline,
    offlineIdentity,
    neverSynced,
    lastSyncedAt,
    hasNetwork,
    refreshing,
    refresh,
  } = useHome();
  const { fetchDocument, recordProbe } = useLibraryActions();

  /**
   * A document whose probe never finished, if there is one.
   *
   * Committing an import before the probe reports is the ordinary case — the
   * Add button is live immediately and the render takes a second or two — and
   * the import screen closes with the probe still running. This is where that
   * document gets read. See `usePendingProbe`.
   */
  const documents = useMemo(
    () => sections.flatMap((section) => (section.kind === 'documents' ? section.documents : [])),
    [sections],
  );
  const pending = usePendingProbe(documents);

  const [acting, setActing] = useState<LibraryDocument | null>(null);

  // Google's copy is there the instant the sheet closes; the Convex row is a
  // round trip later. Preferring the local one keeps the header from flashing.
  const name = account?.name ?? profile?.name ?? null;
  const email = account?.email ?? profile?.email ?? null;
  const photoUrl = account?.photoUrl ?? profile?.pictureUrl ?? null;

  const { profileId } = useLibraryStatus();

  // Read once the local query has settled, because that is what opens the
  // database and therefore what discovers a fault.
  const fault = loading ? null : databaseFault();

  const openDocument = useCallback(
    (document: LibraryDocument) => {
      // Two taps mean "get it" rather than "open it": a document the account
      // has and this phone does not, and one whose file is here and would not
      // open. The second is why this is `fileState` rather than a presence
      // check — a corrupt file is present, and opening it shows nothing.
      if (document.fileState !== 'available' && document.isSynced) {
        void fetchDocument(document);
        return;
      }
      router.push({ pathname: '/reader', params: { id: document.id } });
    },
    [fetchDocument, router],
  );

  const openCollection = useCallback(
    (collection: LibraryCollection) => {
      router.push({ pathname: '/collection', params: { id: collection.id } });
    },
    [router],
  );

  /** A share opens its own screen rather than the reader: there may be no file yet. */
  const openShare = useCallback(
    (share: LibraryShare) => {
      router.push({ pathname: '/share-detail', params: { id: share.id } });
    },
    [router],
  );

  const renderSection = useCallback(
    (section: HomeSection) => {
      if (section.kind === 'collections') {
        return (
          <SectionRail
            title={section.title}
            data={section.collections}
            minHeight={COLLECTION_TILE_HEIGHT}
            keyExtractor={(collection) => collection.id}
            renderItem={(collection) => (
              <CollectionTile collection={collection} onPress={openCollection} />
            )}
          />
        );
      }

      if (section.kind === 'shares') {
        return (
          <SectionRail
            title={section.title}
            data={section.shares}
            minHeight={tileHeight(COVER_WIDTH, false)}
            keyExtractor={(share) => share.id}
            renderItem={(share) => <SharedTile share={share} onPress={openShare} />}
          />
        );
      }

      return (
        <SectionRail
          title={section.title}
          data={section.documents}
          minHeight={tileHeight(COVER_WIDTH, section.showProgress)}
          keyExtractor={(document) => document.id}
          renderItem={(document) => (
            <DocumentTile
              document={document}
              showProgress={section.showProgress}
              onPress={openDocument}
              onLongPress={setActing}
            />
          )}
        />
      );
    },
    [openCollection, openDocument, openShare],
  );

  const header = (
    <LibraryHeader
      name={name}
      email={email}
      photoUrl={photoUrl}
      onOpenAccount={() => router.push('/account')}
      onOpenSearch={() => router.push({ pathname: '/library', params: { focus: 'search' } })}
    />
  );

  // Before every other empty-looking branch, because it is the one that is not
  // about the library at all: the database would not open, so this device knows
  // nothing rather than knowing there is nothing. Falling through to
  // `EmptyLibrary` here would invite somebody to import their first document on
  // top of a library they already have.
  if (!loading && fault !== null) {
    return (
      <Screen>
        {header}
        <LibraryUnavailable fault={fault} />
      </Screen>
    );
  }

  // Nothing here, and no reason yet to believe that is the truth: this device
  // has never finished a sync and cannot reach the account to try. Saying "no
  // documents" would be a claim about somebody's library that nothing on this
  // phone can support.
  if (!loading && isEmpty && neverSynced && offline) {
    return (
      <Screen>
        {header}
        <OfflineState hasNetwork={hasNetwork} onRetry={() => void refresh()} />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen>
        {header}
        <LibrarySkeleton />
      </Screen>
    );
  }

  if (isEmpty) {
    return (
      <Screen>
        {header}
        <EmptyLibrary onImport={() => router.push('/import')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlashList
        style={FILL}
        data={sections}
        keyExtractor={(section) => section.id}
        renderItem={({ item }) => renderSection(item)}
        ListHeaderComponent={
          <>
            {header}
            {offline ? (
              <SyncNotice
                offlineIdentity={offlineIdentity}
                hasNetwork={hasNetwork}
                lastSyncedAt={lastSyncedAt}
                onRetry={() => void refresh()}
              />
            ) : null}
          </>
        }
        ListFooterComponent={
          <ViewAllFooter
            onViewAll={() => router.push('/library')}
            onImport={() => router.push('/import')}
          />
        }
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            // `RefreshControl` takes colours as props rather than classNames,
            // which is what `design/tokens.ts` exists for.
            tintColor={themeColors[theme].fgMuted}
            colors={[themeColors[theme].primary]}
            progressBackgroundColor={themeColors[theme].background}
          />
        }
      />

      <DocumentActions document={acting} onClose={() => setActing(null)} />

      {/* Mounted, not called: reading a PDF page means putting a native view on
          screen and snapshotting it. It sits off-screen and reports once, and
          the row it writes is what selects the next one. */}
      {pending === null || profileId === null ? null : (
        <DocumentProbe
          pdfUri={documentFile(profileId, pending.id).uri}
          onDone={(result: ProbeResult) => void recordProbe(pending.id, result)}
        />
      )}
    </Screen>
  );
}

// A vertical FlashList is a ScrollView underneath, and a ScrollView in a flex
// column with no flex of its own does not get a height to scroll within. Not a
// className: FlashList's own props take styles and are not interop'd.
const FILL = { flex: 1 } as const;

/** The way out of the home screen, and the way to add to it. */
function ViewAllFooter({ onViewAll, onImport }: { onViewAll: () => void; onImport: () => void }) {
  return (
    <Box className="mt-6 border-t border-hairline">
      <Pressable
        onPress={onViewAll}
        accessibilityRole="button"
        className="h-14 flex-row items-center justify-center gap-1.5 data-[active=true]:bg-hover"
      >
        <Text size="sm" className="font-medium text-primary">
          View all library
        </Text>
        <Icon as={ChevronRight} size="sm" className="text-primary" />
      </Pressable>

      <Pressable
        onPress={onImport}
        accessibilityRole="button"
        accessibilityLabel="Import PDF"
        className="h-14 flex-row items-center justify-center gap-2 border-t border-hairline data-[active=true]:bg-hover"
      >
        <Icon as={FilePlus2} size="sm" className="text-fg-muted" />
        <Text size="sm" className="text-fg-muted">
          Import PDF
        </Text>
      </Pressable>

      <HStack className="h-8" />
    </Box>
  );
}
