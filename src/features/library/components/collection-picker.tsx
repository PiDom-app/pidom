import type { SQLiteDatabase } from 'expo-sqlite';
import { Check, FolderPlus } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetItem,
  ActionsheetItemText,
  ActionsheetScrollView,
} from '@/components/ui/actionsheet';
import { Divider } from '@/components/ui/divider';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useAppToast } from '@/components/feedback/use-app-toast';

import * as Collections from '../local/repository/collections';
import { useLocalQuery } from '../local/use-local-query';
import { useCollectionActions } from '../data/use-collection-actions';
import { useLibraryStatus } from '../data/use-library-status';
import { NameDialog } from './name-dialog';

/**
 * Filing a document.
 *
 * Membership is a toggle rather than a one-way "add", because a reader who
 * opens this to check where something already is should be able to fix it in
 * the same gesture. The ticks are read from this device, so the sheet shows the
 * truth rather than making them remember — and it shows it with no connection,
 * which is when somebody is most likely to be tidying.
 */
const TABLES = ['collections', 'collectionDocuments'] as const;

export function CollectionPicker({
  documentId,
  isOpen,
  onClose,
}: {
  documentId: string | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { profileId } = useLibraryStatus();
  const { create: createCollection, addDocument, removeDocument } = useCollectionActions();

  const read = useCallback(
    async (db: SQLiteDatabase) => ({
      collections: await Collections.listCollections(db),
      inside:
        documentId === null ? new Set<string>() : await Collections.collectionsOf(db, documentId),
    }),
    [documentId],
  );

  const { data } = useLocalQuery(profileId, TABLES, read);

  const [creating, setCreating] = useState(false);
  const showToast = useAppToast();

  const collections = data?.collections;
  const inside = data?.inside ?? new Set<string>();

  async function toggle(collectionId: string) {
    if (documentId === null) {
      return;
    }
    const ok = inside.has(collectionId)
      ? await removeDocument(collectionId, documentId)
      : await addDocument(collectionId, documentId);

    if (!ok) {
      showToast({
        id: 'collection',
        tone: 'error',
        title: "Couldn't update the collection",
        description: 'Something went wrong on this device. Try again.',
      });
    }
  }

  async function create(name: string): Promise<boolean> {
    const collectionId = await createCollection(name);
    if (collectionId === null) {
      showToast({
        id: 'collection',
        tone: 'error',
        title: "Couldn't create the collection",
        description: 'Something went wrong on this device. Try again.',
      });
      return false;
    }
    if (documentId !== null) {
      // Creating a collection from this sheet means "put this in a new
      // collection", so the document goes in without a second tap.
      await addDocument(collectionId, documentId);
    }
    return true;
  }

  return (
    <>
      <Actionsheet isOpen={isOpen} onClose={onClose}>
        <ActionsheetBackdrop />
        <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated">
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>

          <VStack className="w-full px-4 pt-2 pb-3">
            <Heading size="sm" className="text-foreground">
              Add to collection
            </Heading>
          </VStack>
          <Divider className="bg-hairline" />

          <ActionsheetScrollView className="w-full">
            <ActionsheetItem onPress={() => setCreating(true)}>
              <Icon as={FolderPlus} size="lg" className="text-primary" />
              <ActionsheetItemText className="text-primary">New collection</ActionsheetItemText>
            </ActionsheetItem>

            {collections === undefined ? (
              <HStack className="items-center justify-center py-8">
                <Spinner />
              </HStack>
            ) : collections.length === 0 ? (
              <Text size="sm" className="px-4 py-6 text-center text-fg-subtle">
                No collections yet.
              </Text>
            ) : (
              collections.map((collection) => (
                <ActionsheetItem key={collection.id} onPress={() => void toggle(collection.id)}>
                  <ActionsheetItemText className="flex-1 text-foreground">
                    {collection.name}
                  </ActionsheetItemText>
                  {inside.has(collection.id) ? (
                    <Icon as={Check} size="md" className="text-primary" />
                  ) : null}
                </ActionsheetItem>
              ))
            )}
          </ActionsheetScrollView>
        </ActionsheetContent>
      </Actionsheet>

      <NameDialog
        isOpen={creating}
        title="New collection"
        label="Name"
        placeholder="Backend, Fiction, Contracts…"
        onClose={() => setCreating(false)}
        onSubmit={create}
      />
    </>
  );
}
