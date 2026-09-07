import type { SQLiteDatabase } from 'expo-sqlite';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, MoreHorizontal, Pencil, Trash2 } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { FlashList } from '@shopify/flash-list';

import { Screen } from '@/components/layout/screen';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Box } from '@/components/ui/box';
import { Button, ButtonText } from '@/components/ui/button';
import { Center } from '@/components/ui/center';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuItem, MenuItemLabel } from '@/components/ui/menu';
import { Pressable } from '@/components/ui/pressable';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useAppToast } from '@/components/feedback/use-app-toast';

import { DocumentActions } from '../components/document-actions';
import * as Collections from '../local/repository/collections';
import { useLocalQuery } from '../local/use-local-query';
import { useCollectionActions } from '../data/use-collection-actions';
import { useCoverSync } from '../data/use-cover-sync';
import { useLibraryActions } from '../data/use-library-actions';
import { DocumentTile } from '../components/document-tile';
import { NameDialog } from '../components/name-dialog';
import { useLibraryStatus } from '../data/use-library-status';
import type { LibraryDocument } from '../data/types';
import { messageOf } from '../data/errors';

/**
 * One collection.
 *
 * The count in the subheading is the collection's own denormalised
 * `documentCount`; the "on this device" number beside it is counted here,
 * because it is a fact about the phone rather than about the collection.
 */
/** How many documents one collection shows. The same cap the account applies. */
const COLLECTION_LIMIT = 200;

/** What this screen is built from. */
const TABLES = ['documents', 'documentFiles', 'collections', 'collectionDocuments'] as const;

export function CollectionScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const collectionId = id === undefined || id === '' ? null : id;

  const { profileId } = useLibraryStatus();
  const { fetchDocument } = useLibraryActions();
  const { renameCollection, removeCollection } = useCollectionActions();

  const read = useCallback(
    async (db: SQLiteDatabase) => {
      if (collectionId === null) {
        return null;
      }
      const collection = await Collections.collectionById(db, collectionId);
      if (collection === null) {
        return null;
      }
      return {
        collection,
        documents: await Collections.documentsIn(db, collectionId, COLLECTION_LIMIT),
      };
    },
    [collectionId],
  );

  const { data, loading } = useLocalQuery(profileId, TABLES, read);
  const showToast = useAppToast();

  useCoverSync(data?.documents ?? EMPTY);

  const [acting, setActing] = useState<LibraryDocument | null>(null);

  // The same rule as every other surface: tap fetches what is only in the
  // account, and opens what is here. Long press is always the sheet.
  const openDocument = useCallback(
    (document: LibraryDocument) => {
      // Two taps mean "get it": a document only the account has, and one whose
      // file is here and would not open.
      if (document.fileState !== 'available' && document.isSynced) {
        void fetchDocument(document);
        return;
      }
      router.push({ pathname: '/reader', params: { id: document.id } });
    },
    [fetchDocument, router],
  );
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (collectionId === null) {
    return (
      <Screen>
        <Center className="flex-1 px-10">
          <Text size="sm" className="text-center text-fg-subtle">
            That collection no longer exists.
          </Text>
        </Center>
      </Screen>
    );
  }

  const onDevice = (data?.documents ?? []).filter(
    (doc) => doc.fileState === 'available',
  ).length;

  return (
    <Screen>
      <HStack className="items-start gap-1.5 px-6 pt-5">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="-ml-2 h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
          <Icon as={ChevronLeft} size="xl" className="text-foreground" />
        </Pressable>

        <VStack className="flex-1 pt-0.5">
          <Heading size="lg" numberOfLines={1} className="text-foreground">
            {data?.collection.name ?? ' '}
          </Heading>
          {data === null ? null : (
            <Text size="xs" className="mt-0.5 text-fg-subtle">
              {data.collection.documentCount === 1
                ? '1 document'
                : `${data.collection.documentCount} documents`}
              {onDevice > 0 ? ` · ${onDevice} on this device` : ''}
            </Text>
          )}
        </VStack>

        <Menu
          placement="bottom right"
          offset={6}
          trigger={({ ...props }) => (
            <Pressable
              {...props}
              accessibilityRole="button"
              accessibilityLabel="Collection actions"
              className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
              <Icon as={MoreHorizontal} size="lg" className="text-foreground" />
            </Pressable>
          )}>
          <MenuItem key="rename" textValue="Rename" onPress={() => setRenaming(true)}>
            <Icon as={Pencil} size="sm" className="mr-2 text-fg-muted" />
            <MenuItemLabel className="text-sm text-foreground">
              Rename
            </MenuItemLabel>
          </MenuItem>
          <MenuItem key="delete" textValue="Delete" onPress={() => setConfirmingDelete(true)}>
            <Icon as={Trash2} size="sm" className="mr-2 text-destructive" />
            <MenuItemLabel className="text-sm text-destructive">
              Delete collection
            </MenuItemLabel>
          </MenuItem>
        </Menu>
      </HStack>

      {loading ? (
        <Center className="flex-1">
          <Spinner />
        </Center>
      ) : (data?.documents ?? EMPTY).length === 0 ? (
        <Center className="flex-1 px-10">
          <Text size="sm" className="text-center text-fg-subtle">
            Nothing in this collection yet. Long-press a document to file it here.
          </Text>
        </Center>
      ) : (
        <FlashList
          style={FILL}
          data={data?.documents ?? EMPTY}
          numColumns={3}
          keyExtractor={(document) => document.id}
          renderItem={({ item }) => (
            <Box className="pb-[18px]">
              <DocumentTile
                document={item}
                width={106}
                showProgress={item.progress > 0}
                onPress={openDocument}
                onLongPress={setActing}
              />
            </Box>
          )}
          contentContainerStyle={GRID_PADDING}
          showsVerticalScrollIndicator={false}
        />
      )}

      <DocumentActions document={acting} onClose={() => setActing(null)} />

      <NameDialog
        isOpen={renaming}
        title="Rename collection"
        label="Name"
        initialValue={data?.collection.name ?? ''}
        onClose={() => setRenaming(false)}
        onSubmit={async (name) => {
          try {
            await renameCollection(collectionId, name);
            return true;
          } catch (error) {
            showToast({
              id: 'collection',
              tone: 'error',
              title: "Couldn't rename",
              description: messageOf(error, 'Try again in a moment.'),
            });
            return false;
          }
        }}
      />

      <AlertDialog
        isOpen={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        size="md">
        <AlertDialogBackdrop />
        <AlertDialogContent className="rounded-md border border-border bg-popover">
          <AlertDialogHeader>
            <Heading size="md" className="text-foreground">
              Delete this collection?
            </Heading>
          </AlertDialogHeader>
          <AlertDialogBody className="mt-2 mb-4">
            <Text size="sm" className="text-muted-foreground">
              The documents in it stay in your library. Only the grouping is removed.
            </Text>
          </AlertDialogBody>
          <AlertDialogFooter>
            <Button variant="outline" size="sm" onPress={() => setConfirmingDelete(false)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onPress={() => {
                setConfirmingDelete(false);
                void removeCollection(collectionId)
                  .then(() => router.back())
                  .catch((error: unknown) => {
                    showToast({
                      id: 'collection',
                      tone: 'error',
                      title: "Couldn't delete",
                      description: messageOf(error, 'Try again in a moment.'),
                    });
                  });
              }}>
              <ButtonText>Delete</ButtonText>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}

const GRID_PADDING = { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 32 } as const;
/** Hoisted so `useCoverSync` is not handed a fresh array on every render. */
const EMPTY: LibraryDocument[] = [];
// A vertical FlashList is a ScrollView underneath, and a ScrollView in a flex
// column with no flex of its own does not get a height to scroll within. Not a
// className: FlashList's own props take styles and are not interop'd.
const FILL = { flex: 1 } as const;
