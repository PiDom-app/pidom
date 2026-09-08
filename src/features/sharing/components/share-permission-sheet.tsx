import { Check, Download, Eye, NotebookPen, Share2, ShieldCheck } from 'lucide-react-native';
import React from 'react';

import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
} from '@/components/ui/actionsheet';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { useShareStore, type Permission } from '@/stores/share-store';

/**
 * What a recipient will be allowed to do.
 *
 * A sheet rather than a screen, and this is the case where that is right: it is
 * a short fixed list, four rows that will never be five, so its height is not
 * the reader's data. That is the whole test — see `navigator-screen.tsx` for
 * what happened to the surface that failed it.
 *
 * The rule below the divider is the point of the layout. The two options under
 * it are the ones that outlive being taken away: a downloaded file is on
 * somebody's disk and no server reaches it, and a reshare is a permission
 * somebody else now holds. Both are off unless turned on, on every share.
 */
export function SharePermissionSheet({
  isOpen,
  onClose,
  documentTitle,
}: {
  isOpen: boolean;
  onClose: () => void;
  documentTitle: string;
}) {
  const permission = useShareStore((state) => state.permission);
  const setPermission = useShareStore((state) => state.setPermission);

  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        <HStack className="w-full items-center px-6 pt-2.5 pb-3.5" space="lg">
          <Icon as={ShieldCheck} size="lg" className="text-fg-muted" />
          <VStack className="flex-1">
            <Text size="md" className="font-semibold text-foreground">
              What they can do
            </Text>
            <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
              {documentTitle}
            </Text>
          </VStack>
        </HStack>
        <Divider className="bg-hairline" />

        <VStack className="w-full pt-1">
          <Row
            glyph={Eye}
            label="Can read"
            note="Open it and read it. Nothing is written back."
            selected={permission.role === 'viewer'}
            onPress={() => setPermission({ ...permission, role: 'viewer' })}
          />
          <Row
            glyph={NotebookPen}
            label="Can annotate"
            note="Keep passages and write notes on it. Theirs, and you see them."
            selected={permission.role === 'annotator'}
            onPress={() => setPermission({ ...permission, role: 'annotator' })}
          />

          <Divider className="my-1 bg-hairline" />

          <Row
            glyph={Download}
            label="Can download a copy"
            note="Puts the file on their device. Removing access later does not take it back."
            selected={permission.canDownload}
            onPress={() => setPermission({ ...permission, canDownload: !permission.canDownload })}
          />
          <Row
            glyph={Share2}
            label="Can share it on"
            note="Never more than they have themselves."
            selected={permission.canReshare}
            onPress={() => setPermission({ ...permission, canReshare: !permission.canReshare })}
          />

          <Text size="xs" className="px-6 pt-3 pb-1 text-fg-subtle">
            Both of the last two are off unless you turn them on, on every share.
          </Text>
        </VStack>
      </ActionsheetContent>
    </Actionsheet>
  );
}

function Row({
  glyph,
  label,
  note,
  selected,
  onPress,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  label: string;
  note: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      className="px-6 py-3 data-[active=true]:bg-hover">
      <HStack className="items-center" space="lg">
        <Icon as={glyph} size="lg" className={selected ? 'text-primary' : 'text-fg-muted'} />
        <VStack className="flex-1">
          <Text size="md" className="text-foreground">
            {label}
          </Text>
          <Text size="xs" className="mt-0.5 text-fg-subtle">
            {note}
          </Text>
        </VStack>
        {selected ? <Icon as={Check} size="md" className="text-primary" /> : null}
      </HStack>
    </Pressable>
  );
}

/** The one sentence a permission comes down to. Used on the compose screen and in Manage access. */
export function permissionLabel(permission: Permission): string {
  return permission.role === 'annotator' ? 'They can annotate it' : 'They can read it';
}
