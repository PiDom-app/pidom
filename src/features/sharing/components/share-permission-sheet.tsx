import {
  CalendarClock,
  Check,
  Download,
  Eye,
  Highlighter,
  Share2,
  ShieldCheck,
} from 'lucide-react-native';
import React, { useState } from 'react';

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
 * The rule below the divider is the point of the layout. The options under it
 * are the ones that outlive being taken away, or decide when taking it away
 * happens by itself: a downloaded file is on somebody's disk and no server
 * reaches it, a reshare is a permission somebody else now holds, and an end
 * date is the only one of the three that shrinks what a share can become
 * without anybody remembering to come back.
 *
 * **The end date is not new machinery.** `documentShares.expiresAt`, the cron
 * that writes `status` when one lapses, and the second check in `Access.grants`
 * have all existed since sharing shipped — nothing ever set the field. It was a
 * finished feature with no way in, which is a worse state than an unfinished
 * one because everything about it looks done.
 *
 * Two callers, two sources of truth, one sheet. Composing a share edits the
 * draft in `share-store`, which is where the rest of that screen keeps its
 * state; changing an existing one on the Access screen has a row to edit
 * instead, so it passes `value` and `onChange` and the store is left alone. A
 * second copy of these four rows would be a second place for the sentence
 * about downloads to go stale.
 */
export function SharePermissionSheet({
  isOpen,
  onClose,
  documentTitle,
  value,
  onChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  documentTitle: string;
  /** Controlled, for editing a share that already exists. */
  value?: Permission;
  onChange?: (permission: Permission) => void;
}) {
  const draft = useShareStore((state) => state.permission);
  const setDraft = useShareStore((state) => state.setPermission);

  const permission = value ?? draft;
  const setPermission = onChange ?? setDraft;
  const [choosingExpiry, setChoosingExpiry] = useState(false);

  return (
    <>
      <Actionsheet isOpen={isOpen && !choosingExpiry} onClose={onClose}>
        <ActionsheetBackdrop />
        <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>

          <HStack className="w-full items-center px-4 pt-2.5 pb-3.5" space="lg">
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
              glyph={Highlighter}
              label="Can annotate"
              note="Keep passages from it. Theirs, and you see them."
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

            <Row
              glyph={CalendarClock}
              label="Access ends"
              note={
                permission.expiresInDays === null
                  ? 'It does not. They keep it until you take it away.'
                  : `${expiryLabel(permission.expiresInDays)} from when you share it.`
              }
              selected={permission.expiresInDays !== null}
              onPress={() => setChoosingExpiry(true)}
            />

            <Text size="xs" className="px-4 pt-3 pb-1 text-fg-subtle">
              Downloading and resharing are off unless you turn them on, on every share. An end date
              is the only one of these that takes access back on its own.
            </Text>
          </VStack>
        </ActionsheetContent>
      </Actionsheet>

      <ExpirySheet
        isOpen={choosingExpiry}
        onClose={() => setChoosingExpiry(false)}
        value={permission.expiresInDays}
        onSelect={(expiresInDays) => setPermission({ ...permission, expiresInDays })}
      />
    </>
  );
}

/**
 * The lengths a share can be offered for.
 *
 * A second sheet over the first rather than a row that cycles, because five
 * values cycled through by tapping is a control nobody can aim. The first sheet
 * closes while this is open — two stacked sheets is two backdrops and a
 * drag indicator nobody can reach.
 */
function ExpirySheet({
  isOpen,
  onClose,
  value,
  onSelect,
}: {
  isOpen: boolean;
  onClose: () => void;
  value: number | null;
  onSelect: (days: number | null) => void;
}) {
  return (
    <Actionsheet isOpen={isOpen} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="rounded-t-md border-t border-border bg-elevated pb-7">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        <HStack className="w-full items-center px-4 pt-2.5 pb-3.5" space="lg">
          <Icon as={CalendarClock} size="lg" className="text-fg-muted" />
          <VStack className="flex-1">
            <Text size="md" className="font-semibold text-foreground">
              Access ends
            </Text>
            <Text size="xs" className="mt-0.5 text-fg-subtle">
              Counted from the moment you share it
            </Text>
          </VStack>
        </HStack>
        <Divider className="bg-hairline" />

        <VStack className="w-full pt-1">
          {EXPIRY_CHOICES.map((days) => (
            <Pressable
              key={String(days)}
              onPress={() => {
                onSelect(days);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: days === value }}
              accessibilityLabel={days === null ? 'Never' : expiryLabel(days)}
              className="px-4 py-2.5 data-[active=true]:bg-hover"
            >
              <HStack className="items-center" space="lg">
                <VStack className="flex-1">
                  <Text size="md" className="text-foreground">
                    {days === null ? 'Never' : expiryLabel(days)}
                  </Text>
                  {days === null ? (
                    <Text size="xs" className="mt-0.5 text-fg-subtle">
                      They keep it until you take it away.
                    </Text>
                  ) : null}
                </VStack>
                {days === value ? <Icon as={Check} size="md" className="text-primary" /> : null}
              </HStack>
            </Pressable>
          ))}

          <Text size="xs" className="px-4 pt-3 pb-1 text-fg-subtle">
            A copy already downloaded is still a file on their device when this runs out. No end
            date reaches one.
          </Text>
        </VStack>
      </ActionsheetContent>
    </Actionsheet>
  );
}

/** How long a share lasts, said the way somebody would choose it. */
export function expiryLabel(days: number): string {
  if (days === 1) {
    return '24 hours';
  }
  if (days === 7) {
    return 'A week';
  }
  if (days === 30) {
    return 'A month';
  }
  if (days === 90) {
    return 'Three months';
  }
  if (days === 365) {
    return 'A year';
  }
  return `${days} days`;
}

/** The choices, and the one that is not a length of time. */
export const EXPIRY_CHOICES: (number | null)[] = [null, 1, 7, 30, 90, 365];

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
      className="px-4 py-2 data-[active=true]:bg-hover"
    >
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
