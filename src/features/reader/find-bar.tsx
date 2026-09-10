import { ChevronDown, ChevronUp, Search, X } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Input, InputField } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

import type { FindState } from './use-find-in-document';

/**
 * Finding a word without leaving the page.
 *
 * It replaces the top chrome rather than stacking under it, because both are
 * the same strip of screen and a reader searching a document is not also
 * reading its title. Dismissing puts the chrome back.
 *
 * The snippet line under the field is the reason this is worth having over a
 * bare hit count: `p.142 …the law of small numbers and anchoring effects…` is
 * enough to know whether to go, and going is one tap.
 */
export function FindBar({
  find,
  isSynced,
  onGo,
  onClose,
}: {
  find: FindState;
  /** Only a synced document has text to search. */
  isSynced: boolean;
  onGo: (page: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { hits, at, current } = find;

  // Stepping moves the document. The bar stays put, so the reader keeps the
  // field they are typing in while the page changes behind it.
  useEffect(() => {
    if (current !== null) {
      onGo(current.page);
    }
    // `onGo` is stable through the command layer; re-running on it would
    // navigate on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const count = hits.length === 0 ? '' : `${at + 1} of ${hits.length}`;

  return (
    <Box
      className="absolute inset-x-0 top-0 border-b border-hairline bg-background"
      style={{ paddingTop: insets.top + 8 }}
    >
      <VStack className="px-4 pb-3">
        <HStack className="items-center" space="sm">
          <Input className="h-10 flex-1">
            <InputField
              value={find.term}
              onChangeText={find.setTerm}
              placeholder="Find in this document"
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={find.next}
              accessibilityLabel="Find in this document"
              className="text-foreground"
            />
          </Input>

          {count === '' ? null : (
            <Text size="xs" className="text-fg-subtle">
              {count}
            </Text>
          )}

          <Pressable
            onPress={find.previous}
            disabled={hits.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Previous match"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
          >
            <Icon
              as={ChevronUp}
              size="md"
              className={hits.length === 0 ? 'text-fg-disabled' : 'text-foreground'}
            />
          </Pressable>
          <Pressable
            onPress={find.next}
            disabled={hits.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Next match"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
          >
            <Icon
              as={ChevronDown}
              size="md"
              className={hits.length === 0 ? 'text-fg-disabled' : 'text-foreground'}
            />
          </Pressable>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close find"
            className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
          >
            <Icon as={X} size="md" className="text-foreground" />
          </Pressable>
        </HStack>

        <Status find={find} isSynced={isSynced} />
      </VStack>
    </Box>
  );
}

/**
 * The line under the field.
 *
 * Four things can be true and each gets its own sentence, because "no results"
 * for a document that has no searchable text at all is a wrong answer to a
 * question the reader did not ask.
 */
function Status({ find, isSynced }: { find: FindState; isSynced: boolean }) {
  if (!isSynced) {
    return (
      <HStack className="mt-2 items-center" space="xs">
        <Icon as={Search} size="2xs" className="text-fg-subtle" />
        <Text size="xs" className="flex-1 text-fg-subtle">
          This document is only on this phone, so there is no text to search.
        </Text>
      </HStack>
    );
  }
  if (find.term.trim().length < 2) {
    return null;
  }
  if (find.searching) {
    return (
      <Text size="xs" className="mt-2 text-fg-subtle">
        Searching…
      </Text>
    );
  }
  if (find.hits.length === 0) {
    return (
      <Text size="xs" className="mt-2 text-fg-subtle">
        {`No matches for “${find.term.trim()}”.`}
      </Text>
    );
  }
  return (
    <HStack className="mt-2 items-center" space="sm">
      <Text size="xs" className="text-fg-muted">
        {`p.${find.current?.page ?? ''}`}
      </Text>
      <Text size="xs" numberOfLines={1} className="flex-1 text-fg-subtle">
        {find.current?.snippet ?? ''}
      </Text>
    </HStack>
  );
}
