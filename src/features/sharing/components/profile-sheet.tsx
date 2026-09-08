import { Share2, User, Users } from 'lucide-react-native';
import React from 'react';

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
  name,
  handle,
  pictureUrl,
  online = false,
  sharedGroups,
  sharedDocuments,
}: {
  isOpen: boolean;
  onClose: () => void;
  name: string;
  handle: string | null;
  pictureUrl: string | null;
  online?: boolean;
  sharedGroups?: string[];
  sharedDocuments?: number;
}) {
  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        <HStack className="w-full items-center px-6 pt-4 pb-4" space="lg">
          <Box className="relative">
            <Avatar className="h-16 w-16">
              <AvatarFallbackText>{name}</AvatarFallbackText>
              {pictureUrl == null ? null : <AvatarImage source={{ uri: pictureUrl }} />}
            </Avatar>
            {online ? (
              <Box className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-ok ring-2 ring-elevated" />
            ) : null}
          </Box>
          <VStack className="flex-1">
            <Text size="lg" numberOfLines={1} className="font-semibold text-foreground">
              {name}
            </Text>
            {handle === null ? null : (
              <Text size="sm" className="mt-0.5 text-fg-subtle">
                @{handle}
              </Text>
            )}
            {online ? (
              <Text size="xs" className="mt-1.5 text-ok">
                Online
              </Text>
            ) : null}
          </VStack>
        </HStack>

        <Divider className="bg-hairline" />

        <VStack className="w-full pt-1">
          {sharedGroups === undefined || sharedGroups.length === 0 ? null : (
            <Row
              glyph={Users}
              label={`In ${sharedGroups.length} ${sharedGroups.length === 1 ? 'group' : 'groups'} with you`}
              detail={sharedGroups.join(', ')}
            />
          )}
          {sharedDocuments === undefined || sharedDocuments === 0 ? null : (
            <Row
              glyph={Share2}
              label={`${sharedDocuments} ${sharedDocuments === 1 ? 'document' : 'documents'} between you`}
            />
          )}
          {(sharedGroups === undefined || sharedGroups.length === 0) &&
          (sharedDocuments === undefined || sharedDocuments === 0) ? (
            <Row glyph={User} label="Nothing shared between you yet" />
          ) : null}

          <Text size="xs" className="px-6 pt-3 pb-1 text-fg-subtle">
            This is everything Pidom will tell you about another account. Not their email, not
            what else they are reading.
          </Text>
        </VStack>
      </ActionsheetContent>
    </Actionsheet>
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
