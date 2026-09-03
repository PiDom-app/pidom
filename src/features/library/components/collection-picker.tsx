import { useMutation, useQuery } from 'convex/react';
import { Check, FolderPlus } from 'lucide-react-native';
import React, { useState } from 'react';

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
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';

import { messageOf } from '../data/errors';
import { useLibraryStatus } from '../data/use-library-status';
import { NameDialog } from './name-dialog';

/**
 * Filing a document.
 *
 * Membership is a toggle rather than a one-way "add", because a reader who
 * opens this to check where something already is should be able to fix it in
 * the same gesture. The ticks come from `collections.forDocument`, so the sheet
 * shows the truth rather than making them remember.
 */
export function CollectionPicker({
  documentId,
  isOpen,
  onClose,
}: {
  documentId: Id<'documents'> | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { ready } = useLibraryStatus();
  const collections = useQuery(api.collections.list, ready && isOpen ? {} : 'skip');
  const memberOf = useQuery(
    api.collections.forDocument,
    ready && isOpen && documentId !== null ? { documentId } : 'skip',
  );

  const addDocument = useMutation(api.collections.addDocument);
  const removeDocument = useMutation(api.collections.removeDocument);
  const createCollection = useMutation(api.collections.create);

  const [creating, setCreating] = useState(false);
  const showToast = useAppToast();

  const inside = new Set(memberOf ?? []);

  async function toggle(collectionId: Id<'collections'>) {
    if (documentId === null) {
      return;
    }
    try {
      if (inside.has(collectionId)) {
        await removeDocument({ collectionId, documentId });
      } else {
        await addDocument({ collectionId, documentId });
      }
    } catch (error) {
      showToast({
        id: 'collection',
        tone: 'error',
        title: "Couldn't update the collection",
        description: messageOf(error, 'Try again in a moment.'),
      });
    }
  }

  async function create(name: string): Promise<boolean> {
    try {
      const collectionId = await createCollection({ name });
      if (documentId !== null) {
        // Creating a collection from this sheet means "put this in a new
        // collection", so the document goes in without a second tap.
        await addDocument({ collectionId, documentId });
      }
      return true;
    } catch (error) {
      showToast({
        id: 'collection',
        tone: 'error',
        title: "Couldn't create the collection",
        description: messageOf(error, 'Try again in a moment.'),
      });
      return false;
    }
  }

  return (
    <>
      <Actionsheet isOpen={isOpen} onClose={onClose}>
        <ActionsheetBackdrop />
        <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated">
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>

          <VStack className="w-full px-6 pt-2 pb-3">
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
              <Text size="sm" className="px-6 py-6 text-center text-fg-subtle">
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
