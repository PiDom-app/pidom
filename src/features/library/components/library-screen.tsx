import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import { ChevronRight, FilePlus2 } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
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
import { useLocalLibraryStore } from '@/stores/local-library-store';

import type { LibraryCollection, LibraryDocument } from '../data/types';
import type { HomeSection } from '../data/use-home';
import { useHome } from '../data/use-home';
import { useLibraryActions } from '../data/use-library-actions';
import { COLLECTION_TILE_HEIGHT, CollectionTile } from './collection-tile';
import { DocumentActions } from './document-actions';
import { COVER_WIDTH } from './document-cover';
import { DocumentTile, tileHeight } from './document-tile';
import { EmptyLibrary } from './empty-library';
import { LibraryHeader } from './library-header';
import { OfflineState, StaleNotice } from './library-notice';
import { LibrarySkeleton } from './library-skeleton';
import { SectionRail } from './section-rail';

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

  const { sections, loading, isEmpty, offline, stale, staleAt, hasNetwork, refreshing, refresh } =
    useHome();
  const { fetchDocument } = useLibraryActions();

  const [acting, setActing] = useState<LibraryDocument | null>(null);

  // Google's copy is there the instant the sheet closes; the Convex row is a
  // round trip later. Preferring the local one keeps the header from flashing.
  const name = account?.name ?? profile?.name ?? null;
  const email = account?.email ?? profile?.email ?? null;
  const photoUrl = account?.photoUrl ?? profile?.pictureUrl ?? null;

  const localIds = useLocalLibraryStore((state) => state.ids);

  const openDocument = useCallback(
    (document: LibraryDocument) => {
      // A document the account has and this phone does not: the tap means
      // "get it", which is the one thing it can mean.
      if (!localIds.has(document.id) && document.isSynced) {
        void fetchDocument(document.id);
        return;
      }
      router.push({ pathname: '/reader', params: { id: document.id } });
    },
    [localIds, fetchDocument, router],
  );

  const openCollection = useCallback(
    (collection: LibraryCollection) => {
      router.push({ pathname: '/collection', params: { id: collection.id } });
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
    [openCollection, openDocument],
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

  // Nothing to show and nothing coming. Without this the screen is a skeleton
  // that never resolves, on the one screen whose promise is that documents stay
  // readable with no connection.
  if (loading && offline) {
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
            {stale && staleAt !== null ? (
              <StaleNotice savedAt={staleAt} hasNetwork={hasNetwork} onRetry={() => void refresh()} />
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
    </Screen>
  );
}

// A vertical FlashList is a ScrollView underneath, and a ScrollView in a flex
// column with no flex of its own does not get a height to scroll within. Not a
// className: FlashList's own props take styles and are not interop'd.
const FILL = { flex: 1 } as const;

/** The way out of the home screen, and the way to add to it. */
function ViewAllFooter({
  onViewAll,
  onImport,
}: {
  onViewAll: () => void;
  onImport: () => void;
}) {
  return (
    <Box className="mt-6 border-t border-hairline">
      <Pressable
        onPress={onViewAll}
        accessibilityRole="button"
        className="h-14 flex-row items-center justify-center gap-1.5 data-[active=true]:bg-hover">
        <Text size="sm" className="font-medium text-primary">
          View all library
        </Text>
        <Icon as={ChevronRight} size="sm" className="text-primary" />
      </Pressable>

      <Pressable
        onPress={onImport}
        accessibilityRole="button"
        accessibilityLabel="Import PDF"
        className="h-14 flex-row items-center justify-center gap-2 border-t border-hairline data-[active=true]:bg-hover">
        <Icon as={FilePlus2} size="sm" className="text-fg-muted" />
        <Text size="sm" className="text-fg-muted">
          Import PDF
        </Text>
      </Pressable>

      <HStack className="h-8" />
    </Box>
  );
}
