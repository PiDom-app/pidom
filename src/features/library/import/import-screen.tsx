import { useRouter } from 'expo-router';
import { CloudUpload, Info, Smartphone } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Button, ButtonSpinner, ButtonText } from '@/components/ui/button';
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
import { CoverRenderer, type CoverResult } from '../components/cover-renderer';
import { formatBytes } from '../data/types';
import { useImportFlow } from './use-import-flow';

/**
 * Adding a document to the library.
 *
 * This replaced a picker call and a toast, and the reason is that there is now
 * something to show and something to decide. The cover renders while the reader
 * is still reading the title, so the slowest step costs nothing. And nothing is
 * written until they commit — Cancel leaves no row and no file, which the
 * fire-and-forget version could not promise.
 *
 * The screen also has to say a hard thing before the reader acts rather than
 * after: a document over 100 MB cannot be synced. Being told that while
 * choosing is a decision; being told after committing is a failure.
 */
export function ImportScreen() {
  const router = useRouter();
  const theme = useResolvedTheme();

  const {
    picked,
    picking,
    stage,
    title,
    author,
    sync,
    canSync,
    syncBlockedBecause,
    setTitle,
    setAuthor,
    setSync,
    onCoverReady,
    commit,
  } = useImportFlow();

  // The picker opens as soon as the screen does. A screen whose only content is
  // a button that opens the picker is a screen with nothing on it.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!openedRef.current) {
      openedRef.current = true;
      void picking();
    }
  }, [picking]);

  // Staging is cleaned up by `useImportFlow`'s unmount cleanup, which catches
  // the swipe-to-dismiss this button does not.
  const cancel = useCallback(() => router.back(), [router]);

  // The reader dismissed the system sheet. There is nothing to add, so there is
  // nothing for this screen to be.
  useEffect(() => {
    if (stage === 'cancelled') {
      router.back();
    }
    if (stage === 'done') {
      router.back();
    }
  }, [stage, router]);

  const oversize = picked !== null && picked.byteSize > CLOUD_BYTE_MAX;
  const committing = stage === 'saving';

  return (
    <Screen edges={['top', 'bottom']}>
      <VStack className="flex-1">
        <HStack className="items-center justify-between px-6 pt-5">
          <Pressable onPress={cancel} accessibilityRole="button" disabled={committing}>
            <Text size="sm" className={committing ? 'text-fg-disabled' : 'text-fg-muted'}>
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
              {picked === null
                ? 'Choosing a file…'
                : `PDF · ${formatBytes(picked.byteSize)}${
                    picked.pageCount === null ? '' : ` · ${picked.pageCount} pages`
                  }`}
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
                  'Keeps a copy in your account so your other phones can download it.'}
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

      {/* The renderer is mounted, not called: turning a PDF page into an image
          means putting a native view on screen and snapshotting it. It sits
          off-screen and reports once. */}
      {picked !== null && picked.coverUri === null && !picked.coverAttempted ? (
        <CoverRenderer
          pdfUri={picked.uri}
          onDone={(result: CoverResult | null) => onCoverReady(result)}
        />
      ) : null}
    </Screen>
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
