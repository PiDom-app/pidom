import * as Sharing from 'expo-sharing';
import {
  BookOpenCheck,
  CloudDownload,
  CloudOff,
  CloudUpload,
  FolderPlus,
  FolderTree,
  Heart,
  HeartOff,
  Info,
  ListTree,
  NotebookPen,
  Pencil,
  RefreshCw,
  RotateCcw,
  Share,
  Share2,
  Smartphone,
  Trash2,
  Users,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetIcon,
  ActionsheetItem,
  ActionsheetItemText,
} from '@/components/ui/actionsheet';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from '@/components/ui/alert-dialog';
import { Button, ButtonText } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { log } from '@/lib/logger';

import type { LibraryDocument } from '../data/types';
import { formatBytes, metaLineFor } from '../data/types';
import { useLibraryActions } from '../data/use-library-actions';
import { useLibraryStatus } from '../data/use-library-status';
import { documentFile } from '../local/paths';
import { useCollectionActions } from '../data/use-collection-actions';
import { CollectionPicker } from './collection-picker';
import { DocumentCover } from './document-cover';
import { DocumentDetails } from './document-details';
import { DocumentProbe, type ProbeResult } from './document-probe';
import { NameDialog } from './name-dialog';
import { RenameDialog } from './rename-dialog';

const SCOPE = 'document-actions';

/**
 * What a reader can do to one document.
 *
 * An `Actionsheet` rather than a `Menu`: these are full-width targets within
 * thumb reach, and the sheet can carry the document's cover and title so there
 * is never a question about which one is about to be deleted.
 *
 * `BottomSheet` would be the richer surface, but gluestack's is built on
 * `@gorhom/bottom-sheet`, which this project does not install. Actionsheet
 * needs only Reanimated and Gesture Handler, both already here.
 */
export function DocumentActions({
  document,
  onClose,
  onShowContents,
  onWriteNote,
}: {
  document: LibraryDocument | null;
  onClose: () => void;
  /**
   * Offered only where a Contents sheet can actually open — the reader owns
   * one, and jumping to a page means nothing on a library screen. Absent
   * everywhere else, and the menu item goes with it.
   */
  onShowContents?: (document: LibraryDocument) => void;
  /**
   * Writing a note about the page the reader is on.
   *
   * Passed only from the reader, which is the only screen with a page to write
   * one about. It is also the whole of the Android path into notes: that
   * renderer reports no text selection, so there is no selection bar there to
   * offer Keep and Note from, and without this the capability would exist on
   * one platform.
   */
  onWriteNote?: () => void;
}) {
  const router = useRouter();
  /**
   * Whether this is the reader's own document.
   *
   * Four of the items below are the owner's — renaming, syncing, deleting, and
   * managing who else can open it — and on a document that arrived under a
   * grant every one of them would be refused by the account. They are absent
   * rather than present and inert, which is the same choice made everywhere
   * else in this sheet. Hiding them is a convenience; `requireDocument` on the
   * server is the rule.
   */
  const mine = document?.ownedByMe ?? true;
  const {
    deleteDocument,
    toggleFavorite,
    rename,
    syncDocument,
    unsyncDocument,
    fetchDocument,
    removeDownload,
    setFinished,
    reprocess,
    recordProbe,
  } = useLibraryActions();
  const { profileId } = useLibraryStatus();
  const { create: createCollection, addDocument: addToCollection } = useCollectionActions();

  /**
   * Creates a collection and puts this document in it, in one step.
   *
   * The same two mutations `CollectionPicker` runs when a reader creates from
   * inside it — this is that path without the intermediate sheet, for the
   * common case of filing something into a group that does not exist yet.
   */
  /**
   * A new collection with this document already in it.
   *
   * Two local writes and two queue rows, and the id the second one needs is
   * minted by the first — on this device, so there is no round trip between
   * them and no window in which a collection exists with nothing in it.
   */
  async function createCollectionWith(name: string, documentId: string): Promise<boolean> {
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
    return await addToCollection(collectionId, documentId);
  }
  const showToast = useAppToast();

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingRemoveDownload, setConfirmingRemoveDownload] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [filing, setFiling] = useState(false);
  const [namingCollection, setNamingCollection] = useState(false);
  const [showingDetails, setShowingDetails] = useState(false);
  /**
   * The document whose local file is being read again.
   *
   * Held here rather than in `useLibraryActions` because a probe is a mounted
   * native view, and this component is what can mount one. It outlives the
   * sheet on purpose: the reader closes the sheet immediately, and the tile
   * carries the state from there.
   */
  const [reprobing, setReprobing] = useState<LibraryDocument | null>(null);

  // Hooks cannot be called conditionally, so the id has to be a string either
  // way; an empty one is simply never on the device.
  // From the row rather than from the scan store: `fileState` is written after
  // a download has been checked, and it is the only thing that knows the
  // difference between a file that is here and one that is here and broken.
  const onThisDevice = document?.fileState === 'available';
  const isOpen =
    document !== null &&
    !confirmingDelete &&
    !confirmingRemoveDownload &&
    !renaming &&
    !filing &&
    !namingCollection &&
    !showingDetails;

  async function share() {
    if (document === null || profileId === null) {
      return;
    }
    try {
      if (!(await Sharing.isAvailableAsync())) {
        showToast({ id: 'share', tone: 'error', title: 'Sharing is not available here' });
        return;
      }
      await Sharing.shareAsync(documentFile(profileId, document.id).uri, {
        mimeType: 'application/pdf',
        UTI: 'com.adobe.pdf',
      });
    } catch (error) {
      // No title and no path: `log.error` survives into release, and both are
      // reader content.
      log.error(SCOPE, 'sharing failed');
      log.debug(SCOPE, 'share error', error);
    }
    onClose();
  }

  return (
    <>
      <Actionsheet isOpen={isOpen} onClose={onClose}>
        <ActionsheetBackdrop />
        <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>

          {document === null ? null : (
            <>
              <HStack className="w-full items-center px-6 pt-2.5 pb-3.5" space="lg">
                <DocumentCover
                  documentId={document.id}
                  title={document.title}
                  width={44}
                  dimmed={!onThisDevice}
                />
                <VStack className="flex-1">
                  <Text size="md" numberOfLines={1} className="font-semibold text-foreground">
                    {document.title}
                  </Text>
                  <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
                    {document.author === null
                      ? metaLineFor(document, { showProgress: true })
                      : `${document.author} · ${metaLineFor(document, { showProgress: true })}`}
                  </Text>
                </VStack>
              </HStack>

              <Divider className="bg-hairline" />

              <VStack className="w-full pt-1">
                {/* Open is the tile's tap, not a menu item — the sheet is what
                    a long press gets you, and it opens over the reader too. */}
                <ActionsheetItem
                  onPress={() => {
                    void setFinished(document, !document.isFinished);
                    onClose();
                  }}>
                  <ActionsheetIcon
                    as={document.isFinished ? RotateCcw : BookOpenCheck}
                    className="text-fg-muted"
                  />
                  <ActionsheetItemText className="text-foreground">
                    {document.isFinished ? 'Mark as unread' : 'Mark as finished'}
                  </ActionsheetItemText>
                </ActionsheetItem>

                {/* A document the account has but this phone does not. */}
                {!onThisDevice && document.isSynced ? (
                  <ActionsheetItem
                    onPress={() => {
                      void fetchDocument(document);
                      onClose();
                    }}>
                    <ActionsheetIcon as={CloudDownload} className="text-fg-muted" />
                    <ActionsheetItemText className="text-foreground">
                      Download to this device
                    </ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                {/* Syncing needs the file here to upload. A document that is
                    only in the account is already synced by definition — and a
                    document somebody else owns is theirs to sync, so the item
                    is absent rather than present and refused. */}
                {onThisDevice && mine ? (
                  <ActionsheetItem
                    onPress={() => {
                      if (document.isSynced) {
                        void unsyncDocument(document);
                      } else {
                        void syncDocument(document);
                      }
                      onClose();
                    }}>
                    <ActionsheetIcon
                      as={document.isSynced ? CloudOff : CloudUpload}
                      className="text-fg-muted"
                    />
                    <ActionsheetItemText className="text-foreground">
                      {document.isSynced
                        ? 'Keep on this device only'
                        : 'Make available on all devices'}
                    </ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                <ActionsheetItem onPress={() => setFiling(true)}>
                  <ActionsheetIcon as={FolderPlus} className="text-fg-muted" />
                  <ActionsheetItemText className="text-foreground">
                    Add to collection
                  </ActionsheetItemText>
                </ActionsheetItem>

                <ActionsheetItem onPress={() => setNamingCollection(true)}>
                  <ActionsheetIcon as={FolderTree} className="text-fg-muted" />
                  <ActionsheetItemText className="text-foreground">
                    New collection with this
                  </ActionsheetItemText>
                </ActionsheetItem>

                <ActionsheetItem
                  onPress={() => {
                    void toggleFavorite(document.id, !document.isFavorite);
                    onClose();
                  }}>
                  <ActionsheetIcon
                    as={document.isFavorite ? HeartOff : Heart}
                    className="text-fg-muted"
                  />
                  <ActionsheetItemText className="text-foreground">
                    {document.isFavorite ? 'Remove from favourites' : 'Add to favourites'}
                  </ActionsheetItemText>
                </ActionsheetItem>

                {/* Only when the account still has a copy. Doing this to a
                    local-only document is a delete, and Delete already exists
                    with the confirmation that deserves. */}
                {onThisDevice && document.isSynced ? (
                  <ActionsheetItem onPress={() => setConfirmingRemoveDownload(true)}>
                    <ActionsheetIcon as={Smartphone} className="text-fg-muted" />
                    <ActionsheetItemText className="text-foreground">
                      Remove from this device
                    </ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                {/* Only where a page jump means something — which is the
                    reader — and no longer only where the PDF declares an
                    outline. The sheet behind this holds the bookmarks and the
                    notes as well, and most PDFs declare no outline, so gating
                    it on one hid the reader's own marks on most documents. */}
                {onShowContents !== undefined ? (
                  <ActionsheetItem onPress={() => onShowContents(document)}>
                    <ActionsheetIcon as={ListTree} className="text-fg-muted" />
                    <ActionsheetItemText className="text-foreground">
                      Contents and bookmarks
                    </ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                {onWriteNote !== undefined ? (
                  <ActionsheetItem onPress={onWriteNote}>
                    <ActionsheetIcon as={NotebookPen} className="text-fg-muted" />
                    <ActionsheetItemText className="text-foreground">
                      Write a note
                    </ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                {mine ? (
                  <ActionsheetItem onPress={() => setRenaming(true)}>
                    <ActionsheetIcon as={Pencil} className="text-fg-muted" />
                    <ActionsheetItemText className="text-foreground">Rename</ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                {/* Offered when something the pipeline should have produced is
                    missing. A document that came out `ready` with its text
                    extracted has nothing here to redo, so the item is absent
                    rather than present and inert. */}
                {onThisDevice &&
                (document.processing !== 'ready' ||
                  document.textStatus === 'failed' ||
                  !document.hasOutline) ? (
                  <ActionsheetItem
                    onPress={() => {
                      const target = document;
                      onClose();
                      // The device half needs the file, so it only runs where
                      // the file is. The cloud half runs from the server.
                      setReprobing(target);
                      void reprocess(target);
                    }}>
                    <ActionsheetIcon as={RefreshCw} className="text-fg-muted" />
                    <ActionsheetItemText className="text-foreground">Reprocess</ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                <ActionsheetItem onPress={() => setShowingDetails(true)}>
                  <ActionsheetIcon as={Info} className="text-fg-muted" />
                  <ActionsheetItemText className="text-foreground">Details</ActionsheetItemText>
                </ActionsheetItem>

                {/* Two different acts, named differently.

                    **Share with people** grants access: the document stays one
                    row with one owner, and a recipient gets a permission that
                    can be taken back. **Send a copy** hands the file itself to
                    another application through the operating system's share
                    sheet, and nothing about that copy is ever recallable. A
                    single "Share" covering both would be one word for the
                    difference this whole feature is built around.

                    The first needs a copy in the account, because a recipient
                    has nothing to fetch otherwise. The second needs the file on
                    this device, because that is what it sends. */}
                {document.isSynced ? (
                  <ActionsheetItem
                    onPress={() => {
                      onClose();
                      router.push({ pathname: '/share', params: { id: document.id } });
                    }}>
                    <ActionsheetIcon as={Share2} className="text-fg-muted" />
                    <ActionsheetItemText className="text-foreground">
                      {mine ? 'Share with people' : 'Share it on'}
                    </ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                {mine && document.isSynced ? (
                  <ActionsheetItem
                    onPress={() => {
                      onClose();
                      router.push({ pathname: '/access', params: { id: document.id } });
                    }}>
                    <ActionsheetIcon as={Users} className="text-fg-muted" />
                    <ActionsheetItemText className="text-foreground">
                      Who can open this
                    </ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                {onThisDevice ? (
                  <ActionsheetItem onPress={() => void share()}>
                    <ActionsheetIcon as={Share} className="text-fg-muted" />
                    <ActionsheetItemText className="text-foreground">
                      Send a copy…
                    </ActionsheetItemText>
                  </ActionsheetItem>
                ) : null}

                <Divider className="my-1 bg-hairline" />

                <ActionsheetItem onPress={() => setConfirmingDelete(true)}>
                  <ActionsheetIcon as={Trash2} className="text-destructive" />
                  <ActionsheetItemText className="text-destructive">
                    {/* On somebody else's document this removes the copy from
                        this phone, which is all it can remove. The grant is
                        theirs and stays until they take it back. */}
                    {mine ? 'Delete' : 'Remove from this device'}
                  </ActionsheetItemText>
                </ActionsheetItem>
              </VStack>
            </>
          )}
        </ActionsheetContent>
      </Actionsheet>

      {/* Deleting removes the file from this device and the record from every
          other one, so it gets an acknowledgement rather than an undo toast. */}
      <AlertDialog
        isOpen={confirmingDelete && document !== null}
        onClose={() => setConfirmingDelete(false)}
        size="md">
        <AlertDialogBackdrop />
        <AlertDialogContent className="rounded-md border border-border bg-popover">
          <AlertDialogHeader>
            <Heading size="md" className="text-foreground">
              Delete this document?
            </Heading>
          </AlertDialogHeader>
          <AlertDialogBody className="mt-2 mb-4">
            <Text size="sm" className="text-muted-foreground">
              {document === null
                ? ''
                : document.isSynced
                  ? `“${document.title}” will be removed from this device, from your account, and from every other device. Your original file is not affected.`
                  : `“${document.title}” will be removed from this device. It is not in your account, so this is the only copy Pidom has. Your original file is not affected.`}
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
                const target = document;
                setConfirmingDelete(false);
                onClose();
                if (target !== null) {
                  void deleteDocument(target.id);
                }
              }}>
              <ButtonText>Delete</ButtonText>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RenameDialog
        isOpen={renaming && document !== null}
        initialTitle={document?.title ?? ''}
        initialAuthor={document?.author ?? null}
        onClose={() => {
          setRenaming(false);
          onClose();
        }}
        onSubmit={async (title, author) => {
          if (document === null) {
            return false;
          }
          return await rename(document.id, title, author);
        }}
      />

      <CollectionPicker
        documentId={document?.id ?? null}
        isOpen={filing && document !== null}
        onClose={() => {
          setFiling(false);
          onClose();
        }}
      />

      <NameDialog
        isOpen={namingCollection && document !== null}
        title="New collection"
        label="Name"
        placeholder="Backend, Fiction, Contracts…"
        onClose={() => {
          setNamingCollection(false);
          onClose();
        }}
        onSubmit={async (name) => {
          if (document === null) {
            return false;
          }
          return await createCollectionWith(name, document.id);
        }}
      />

      <DocumentDetails
        document={showingDetails ? document : null}
        onClose={() => {
          setShowingDetails(false);
          onClose();
        }}
      />

      {/* Mounted, not called: reading a PDF page means putting a native view on
          screen and snapshotting it. It sits off-screen, reports once, and
          unmounts itself. */}
      {reprobing === null || profileId === null ? null : (
        <DocumentProbe
          pdfUri={documentFile(profileId, reprobing.id).uri}
          onDone={(result: ProbeResult) => {
            const target = reprobing;
            setReprobing(null);
            void recordProbe(target.id, result);
          }}
        />
      )}

      {/* Removing the local copy destroys data on this phone, so it is
          acknowledged — and the sentence that matters is the one saying the
          account copy is safe. */}
      <AlertDialog
        isOpen={confirmingRemoveDownload && document !== null}
        onClose={() => setConfirmingRemoveDownload(false)}
        size="md">
        <AlertDialogBackdrop />
        <AlertDialogContent className="rounded-md border border-border bg-popover">
          <AlertDialogHeader>
            <Heading size="md" className="text-foreground">
              Remove from this device?
            </Heading>
          </AlertDialogHeader>
          <AlertDialogBody className="mt-2 mb-4">
            <Text size="sm" className="text-muted-foreground">
              {document === null
                ? ''
                : `The copy in your account stays, so you can download it again any time. This frees ${formatBytes(document.byteSize)} here.`}
            </Text>
          </AlertDialogBody>
          <AlertDialogFooter>
            <Button
              variant="outline"
              size="sm"
              onPress={() => setConfirmingRemoveDownload(false)}>
              <ButtonText>Cancel</ButtonText>
            </Button>
            <Button
              size="sm"
              onPress={() => {
                const target = document;
                setConfirmingRemoveDownload(false);
                onClose();
                if (target !== null) {
                  removeDownload(target.id);
                }
              }}>
              <ButtonText>Remove</ButtonText>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
