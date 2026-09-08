import { useQuery } from 'convex/react';
import { Share2, Users } from 'lucide-react-native';
import React from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
} from '@/components/ui/actionsheet';
import { Avatar, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Box } from '@/components/ui/box';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';

/**
 * A person, as much of them as sharing has any business showing.
 *
 * A name, a handle, a picture, and whether they are online — the exact four
 * fields `Discovery.toPublicProfile` returns, and no more. Not an email, not a
 * last-seen, not what else they are reading. A search result is not a licence
 * to read somebody's account, and the projection is the same one whatever the
 * search matched on.
 *
 * An `Actionsheet` rather than a `Modal`, matching `document-details.tsx`: a
 * dialog opened from a screen would be a third kind of surface for no reason.
 */
export function ProfileSheet({
  isOpen,
  onClose,
  userId,
  name,
  handle,
  pictureUrl,
  online = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Whose profile it is, so the sheet can ask what the two accounts have
   * between them.
   *
   * It used to take `sharedGroups` and `sharedDocuments` as props and neither
   * call site passed them, so every profile fell through to "Nothing shared
   * between you yet" — which on the Access screen is false by construction, and
   * `sharing.profile` existed to answer it and was never called.
   */
  userId: string | null;
  name: string;
  handle: string | null;
  pictureUrl: string | null;
  online?: boolean;
}) {
  const context = useQuery(
    api.sharing.profile,
    !isOpen || userId === null ? 'skip' : { userId: userId as Id<'users'> },
  );
  const sharedGroups = context?.sharedGroups;
  const sharedDocuments = context?.sharedDocuments;

  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        {/* Centred, and the only place in this app that is. Everywhere else a
            face is one row of a list and belongs on the left with the text; a
            sheet about one person has a single subject and no list to line up
            with, so putting it left with an empty right half is a layout
            imitating a row that is not there. */}
        <VStack className="w-full items-center px-6 pt-3 pb-4" space="md">
          <Box className="relative">
            <Avatar className="h-20 w-20">
              <AvatarFallbackText>{name}</AvatarFallbackText>
              <AvatarImage source={{ uri: pictureUrl }} />
            </Avatar>
            {online ? (
              <Box className="absolute bottom-0.5 right-0.5 h-4 w-4 rounded-full border-2 border-elevated bg-ok" />
            ) : null}
          </Box>

          <VStack className="items-center" space="xs">
            <Text size="xl" numberOfLines={1} className="font-semibold text-foreground">
              {name}
            </Text>
            <HStack className="items-center" space="xs">
              {handle === null ? (
                <Text size="sm" className="text-fg-subtle">
                  No handle
                </Text>
              ) : (
                <Text size="sm" className="text-fg-muted">
                  @{handle}
                </Text>
              )}
              {online ? (
                <>
                  <Text size="sm" className="text-fg-subtle">
                    ·
                  </Text>
                  <Text size="sm" className="text-ok">
                    Reading now
                  </Text>
                </>
              ) : null}
            </HStack>
          </VStack>
        </VStack>

        <Divider className="bg-hairline" />

        {/* What the two accounts have between them, as two counts rather than
            a list of sentences. `commonGround` counts by document, so the same
            document reshared back is one thing between two people. */}
        <HStack className="w-full px-6 py-4" space="md">
          <Stat
            glyph={Share2}
            value={context === undefined ? '—' : String(sharedDocuments ?? 0)}
            label={sharedDocuments === 1 ? 'document' : 'documents'}
          />
          <Box className="w-px self-stretch bg-hairline" />
          <Stat
            glyph={Users}
            value={context === undefined ? '—' : String(sharedGroups?.length ?? 0)}
            label={sharedGroups?.length === 1 ? 'group' : 'groups'}
          />
        </HStack>

        {sharedGroups === undefined || sharedGroups.length === 0 ? null : (
          <>
            <Divider className="bg-hairline" />
            <Row glyph={Users} label="In these groups with you" detail={sharedGroups.join(', ')} />
          </>
        )}

        <Divider className="bg-hairline" />

        <VStack className="w-full px-6 pt-3">
          <Text size="xs" className="text-fg-subtle">
            This is everything Pidom will tell you about another account. Not their email, not
            what else they are reading, not when they were last here.
          </Text>
        </VStack>
      </ActionsheetContent>
    </Actionsheet>
  );
}

/**
 * One number about the two of you.
 *
 * A count rather than a sentence, because there are two of them and they are
 * the same shape: "3 documents / 1 group" reads at a glance where "3 documents
 * between you" and "In 1 group with you" are two sentences that have to be
 * parsed. `—` while the account is still answering, so the row does not flash
 * a confident zero and then correct itself.
 */
function Stat({
  glyph,
  value,
  label,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  value: string;
  label: string;
}) {
  return (
    <VStack className="flex-1 items-center" space="xs">
      <Icon as={glyph} size="md" className="text-fg-muted" />
      <Text size="xl" className="font-semibold text-foreground">
        {value}
      </Text>
      <Text size="xs" className="text-fg-subtle">
        {label}
      </Text>
    </VStack>
  );
}

function Row({
  glyph,
  label,
  detail,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  label: string;
  detail?: string;
}) {
  return (
    <HStack className="items-center px-6 py-3" space="lg">
      <Icon as={glyph} size="lg" className="text-fg-muted" />
      <VStack className="flex-1">
        <Text size="md" className="text-foreground">
          {label}
        </Text>
        {detail === undefined ? null : (
          <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
            {detail}
          </Text>
        )}
      </VStack>
    </HStack>
  );
}
