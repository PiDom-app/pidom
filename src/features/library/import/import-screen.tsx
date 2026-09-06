import { useLocalSearchParams, useRouter } from 'expo-router';
import { CloudUpload, Copy, FileX, Info, Lock, Smartphone } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef } from 'react';

import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
import { Center } from '@/components/ui/center';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Image } from '@/components/ui/image';
import { Input, InputField } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { AUTHOR_MAX, CLOUD_BYTE_MAX, TITLE_MAX } from '@convex/model/limits';
import { themeColors } from '@/design/tokens';
import { useResolvedTheme } from '@/providers/theme-provider';

import { COVER_WIDTH, coverHeight } from '../components/document-cover';
import { DocumentProbe, type ProbeResult } from '../components/document-probe';
import { formatBytes } from '../data/types';
import { useImportFlow, type Refusal } from './use-import-flow';

/**
 * Adding a document to the library.
 *
 * This replaced a picker call and a toast, and the reason is that there is now
 * something to show and something to decide. The probe renders the cover, counts
 * the pages and reads the contents while the reader is still reading the title,
 * so the slowest step costs nothing. And nothing is written until they commit —
 * Cancel leaves no row and no file, which the fire-and-forget version could not
 * promise.
 *
 * The screen also has to say three hard things before the reader acts rather
 * than after. A document over 100 MB cannot be synced. A file that is not really
 * a PDF, and a PDF with a password, cannot be added at all. Being told any of
 * those while choosing is a decision; being told after committing is a failure.
 */
export function ImportScreen() {
  const router = useRouter();
  const theme = useResolvedTheme();

  const {
    picked,
    picking,
    stage,
    refusal,
    duplicate,
    title,
    author,
    sync,
    canSync,
    syncBlockedBecause,
    setTitle,
    setAuthor,
    setSync,
    dismissDuplicate,
    adopt,
    onProbed,
    commit,
  } = useImportFlow();

  /**
   * Where the file comes from.
   *
   * With no parameters the picker opens as soon as the screen does — a screen
   * whose only content is a button that opens the picker is a screen with
   * nothing on it. With an `incoming` path another app has already chosen one,
   * and opening the picker over it would ask the reader to choose a file they
   * have just finished choosing.
   */
  const { incoming, incomingName } = useLocalSearchParams<{
    incoming?: string;
    incomingName?: string;
  }>();

  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) {
      return;
    }
    openedRef.current = true;
    if (incoming === undefined) {
      void picking();
    } else {
      adopt(incoming, incomingName ?? null);
    }
  }, [picking, adopt, incoming, incomingName]);

  /**
   * Leaving this screen, however it ends.
   *
   * Staging is cleaned up by `useImportFlow`'s unmount cleanup, which catches
   * the swipe-to-dismiss the cancel button does not.
   *
   * `back()` only when there is something behind this screen. Opening a PDF
   * from another app cold-launches straight onto `/import` —
   * `useIncomingDocument` pushes it from the app layout as the first
   * navigation there is — so the stack can be one entry deep. `GO_BACK` is
   * then handled by nobody, which the router reports as "The action 'GO_BACK'
   * was not handled by any navigator", and the reader is left sitting on a
   * screen that has finished its job with no way off it.
   *
   * The library is the right place to land rather than a no-op: the document
   * they just imported is in it.
   */
  const leave = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/');
  }, [router]);

  // The reader dismissed the system sheet, or the import finished. There is
  // nothing left for this screen to be.
  useEffect(() => {
    if (stage === 'cancelled' || stage === 'done') {
      leave();
    }
  }, [stage, leave]);

  const oversize = picked !== null && picked.byteSize > CLOUD_BYTE_MAX;
  const committing = stage === 'saving';

  if (stage === 'refused' && refusal !== null) {
    return <Refused reason={refusal} onChoose={() => void picking()} onCancel={leave} />;
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <VStack className="flex-1">
        <ImportHeader onCancel={leave} disabled={committing} />

        <VStack className="flex-1 px-6">
          <Box className="mt-6 items-center">
            {picked === null || picked.coverUri === null ? (
              <Skeleton className="rounded-md" style={COVER_BOX} />
            ) : (
              <Box className="overflow-hidden rounded-md" style={COVER_BOX}>
                <Image source={{ uri: picked.coverUri }} alt="" size="full" contentFit="cover" />
              </Box>
            )}
          </Box>

          {/* A flat row between two rules rather than a dialog. The reader may
              genuinely want a second copy — a marked-up version of the same
              paper is a different document to a person — so this informs
              rather than interrupts. */}
          {duplicate === null ? null : (
            <VStack className="mt-5">
              <Box className="h-px bg-hairline" />
              <HStack className="items-start py-3.5" space="lg">
                <Icon as={Copy} size="md" className="mt-0.5 text-fg-muted" />
                <VStack className="flex-1">
                  <Text size="sm" className="text-foreground">
                    You already have this one
                  </Text>
                  <Text size="xs" className="mt-0.5 text-fg-subtle">
                    {`Added as “${duplicate.title}”. Same size and same first and last pages. Adding it again makes a second copy on this phone.`}
                  </Text>
                </VStack>
                <Pressable onPress={dismissDuplicate} accessibilityRole="button">
                  <Text size="xs" className="text-primary">
                    Add anyway
                  </Text>
                </Pressable>
              </HStack>
              <Box className="h-px bg-hairline" />
            </VStack>
          )}

          <Field label="Title">
            <InputField
              value={title}
              onChangeText={setTitle}
              maxLength={TITLE_MAX}
              placeholder="Title"
              editable={!committing}
              className="text-foreground"
            />
          </Field>

          <Field label="Author">
            <InputField
              value={author}
              onChangeText={setAuthor}
              maxLength={AUTHOR_MAX}
              placeholder="Optional"
              editable={!committing}
              className="text-foreground"
            />
          </Field>

          <HStack className="mt-3.5 items-center" space="xs">
            <Icon as={Info} size="2xs" className="text-fg-subtle" />
            <Text size="xs" className="text-fg-subtle">
              {picked === null ? 'Choosing a file…' : metaFor(picked)}
            </Text>
          </HStack>

          <Box className="mt-5 h-px bg-hairline" />

          <HStack className="items-start py-4" space="lg">
            <Icon
              as={oversize ? Smartphone : CloudUpload}
              size="lg"
              className={canSync ? 'text-fg-muted' : 'text-fg-disabled'}
            />
            <VStack className="flex-1">
              <Text size="md" className={canSync ? 'text-foreground' : 'text-fg-disabled'}>
                Available on all devices
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                {syncBlockedBecause ??
                  'Keeps a copy in your account so your other phones can download it, and lets Pidom search inside it.'}
              </Text>
            </VStack>
            <Switch
              value={sync}
              onValueChange={setSync}
              disabled={!canSync || committing}
              // React Native's Switch takes colours as props rather than
              // classNames, which is what the token mirror is for.
              trackColor={{
                false: themeColors[theme].border,
                true: themeColors[theme].primary,
              }}
            />
          </HStack>
        </VStack>

        <Box className="px-6 pb-6">
          <Button
            size="lg"
            className="h-12"
            isDisabled={picked === null || title.trim() === '' || committing}
            onPress={() => void commit()}>
            {committing ? <ButtonSpinner /> : null}
            <ButtonText>{committing ? 'Adding' : 'Add to library'}</ButtonText>
          </Button>
        </Box>
      </VStack>

      {/* The probe is mounted, not called: reading a PDF page means putting a
          native view on screen and snapshotting it. It sits off-screen and
          reports once, with the page count, the contents and the cover. */}
      {picked !== null && !picked.probed ? (
        <DocumentProbe pdfUri={picked.uri} onDone={(result: ProbeResult) => onProbed(result)} />
      ) : null}
    </Screen>
  );
}

/** The line under the fields, which says what the probe has found so far. */
function metaFor(picked: { byteSize: number; pageCount: number | null; outline: unknown[] }) {
  if (picked.pageCount === null) {
    // The probe is still reading. Saying so beats a size that is about to be
    // joined by two more facts.
    return 'Checking this PDF…';
  }
  const contents =
    picked.outline.length === 0 ? '' : ` · ${picked.outline.length} in contents`;
  return `PDF · ${formatBytes(picked.byteSize)} · ${picked.pageCount} pages${contents}`;
}

/**
 * A file Pidom will not take.
 *
 * Its own screen rather than a toast over the form, because there is nothing on
 * the form left to decide: the title and the sync toggle both describe a
 * document that is not going to exist.
 */
function Refused({
  reason,
  onChoose,
  onCancel,
}: {
  reason: Refusal;
  onChoose: () => void;
  onCancel: () => void;
}) {
  const encrypted = reason === 'encrypted';
  const copy = {
    encrypted: {
      title: 'This PDF has a password',
      body: 'Pidom cannot open it, so it would sit in your library as a document that never renders. Remove the password in whatever made it, then add it again.',
    },
    'not-a-pdf': {
      title: 'That is not a PDF',
      body: 'The name ends in .pdf but the file does not start like one. It was probably renamed, or the download did not finish.',
    },
    unreadable: {
      title: "That file couldn't be read",
      body: 'It starts like a PDF and then stops making sense partway through, which usually means the download was interrupted.',
    },
    'no-size': {
      title: "That file is empty",
      body: 'There are no bytes in it to read. If it came from a download, it may not have finished.',
    },
  }[reason];

  return (
    <Screen edges={['top', 'bottom']}>
      <VStack className="flex-1">
        <ImportHeader onCancel={onCancel} disabled={false} />

        <Center className="flex-1 px-10">
          <Icon
            as={encrypted ? Lock : FileX}
            size="xl"
            className="text-fg-subtle"
          />
          <Heading size="lg" className="mt-5 text-center text-foreground">
            {copy.title}
          </Heading>
          <Text size="sm" className="mt-2 text-center text-fg-muted">
            {copy.body}
          </Text>
          <Text size="xs" className="mt-2.5 text-center text-fg-subtle">
            Nothing was added.
          </Text>
        </Center>

        <VStack className="px-6 pb-6" space="md">
          <Button size="lg" className="h-12" onPress={onChoose}>
            <ButtonText>Choose another file</ButtonText>
          </Button>
          <Pressable onPress={onCancel} accessibilityRole="button" className="items-center py-1">
            <Text size="sm" className="text-fg-muted">
              Cancel
            </Text>
          </Pressable>
        </VStack>
      </VStack>
    </Screen>
  );
}

function ImportHeader({ onCancel, disabled }: { onCancel: () => void; disabled: boolean }) {
  return (
    <HStack className="items-center justify-between px-6 pt-5">
      <Pressable onPress={onCancel} accessibilityRole="button" disabled={disabled}>
        <Text size="sm" className={disabled ? 'text-fg-disabled' : 'text-fg-muted'}>
          Cancel
        </Text>
      </Pressable>
      <Heading size="sm" className="text-foreground">
        Add to library
      </Heading>
      {/* Balances the row so the heading is optically centred. */}
      <Text size="sm" className="text-transparent">
        Cancel
      </Text>
    </HStack>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <VStack className="mt-4" space="xs">
      <Text size="2xs" className="uppercase tracking-wider text-fg-subtle">
        {label}
      </Text>
      <Input className="h-11">{children}</Input>
    </VStack>
  );
}

const PREVIEW_WIDTH = COVER_WIDTH + 12;
const COVER_BOX = { width: PREVIEW_WIDTH, height: coverHeight(PREVIEW_WIDTH) } as const;
