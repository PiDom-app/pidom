import { ChevronRight, Trash2, LogOut } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { GROUP_DESCRIPTION_MAX, GROUP_NAME_MAX } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { Box } from '@/components/ui/box';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Menu, MenuItem, MenuItemLabel } from '@/components/ui/menu';
import { Pressable } from '@/components/ui/pressable';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { NameDialog } from '@/features/library/components/name-dialog';

import { ListSkeleton, Notice, Section } from './segments';

/**
 * Everything a group can be told about itself.
 *
 * **Read live rather than from the mirror.** The rest of this screen renders
 * SQLite, because a member list has to be there on a cold launch with no
 * connection. Settings are the opposite: rarely opened, and nothing here can be
 * *changed* without a connection anyway — membership and what a share grants
 * are decisions the account has to make. Mirroring seven more columns to show
 * them offline would be seven more things to keep in step for a screen nobody
 * opens on a train.
 *
 * **Every one of these is enforced somewhere.** `whoCanAdd` in
 * `Groups.addMember`, `whoCanShare` and both defaults in `Sharing.create`,
 * `showMemberHandles` in `Groups.membersOf`, `showPresence` in
 * `presence.heartbeat`, and Mute in `Notifications.wantsPush`. A switch wired
 * to nothing looks like a feature and is a lie, which is the one thing this
 * screen had to avoid being.
 */
export function GroupSettings({
  remoteId,
  isOwner,
  canAdminister,
  documentCount,
  onRename,
  onLeave,
  currentName,
}: {
  remoteId: string | null;
  isOwner: boolean;
  canAdminister: boolean;
  documentCount: number;
  onRename: () => void;
  onLeave: () => void;
  currentName: string;
}) {
  const detail = useQuery(
    api.groups.detail,
    remoteId === null ? 'skip' : { groupId: remoteId as Id<'groups'> },
  );
  const update = useMutation(api.groups.updateSettings);
  const setMuted = useMutation(api.groups.setMuted);
  const showToast = useAppToast();

  const [describing, setDescribing] = useState(false);

  const write = useCallback(
    (patch: Omit<Parameters<typeof update>[0], 'groupId'>) => {
      if (remoteId === null) {
        return;
      }
      void update({ groupId: remoteId as Id<'groups'>, ...patch }).catch(() => {
        showToast({
          id: 'group-settings',
          tone: 'error',
          title: 'That could not be changed',
          description: 'Check your connection and try again.',
        });
      });
    },
    [remoteId, showToast, update],
  );

  const describe = useCallback(
    async (description: string): Promise<boolean> => {
      write({ description });
      setDescribing(false);
      return true;
    },
    [write],
  );

  if (remoteId === null) {
    return (
      <Notice glyph={ChevronRight}>
        This group has not reached your account yet. Its settings appear once it has synced.
      </Notice>
    );
  }
  if (detail === undefined) {
    return <ListSkeleton rows={5} />;
  }

  const s = detail.group.settings;

  return (
    <VStack>
      <Section title="About">
        <Row label="Name" value={currentName} onPress={onRename} disabled={!canAdminister} />
        <Row
          label="Description"
          value={s.description ?? 'None'}
          onPress={() => setDescribing(true)}
          disabled={!canAdminister}
        />
      </Section>

      <Box className="mx-6 mt-2 h-px bg-hairline" />

      <Section title="Who can do what">
        <Choice
          label="Add people"
          note="Membership decides what somebody can open, so this is the narrow one."
          value={s.whoCanAdd}
          options={[
            { key: 'owner', label: 'Only the owner' },
            { key: 'admins', label: 'Admins' },
            { key: 'members', label: 'Any member' },
          ]}
          disabled={!canAdminister}
          onPick={(whoCanAdd) => write({ whoCanAdd: whoCanAdd as 'owner' | 'admins' | 'members' })}
        />
        <Choice
          label="Share documents in"
          note="Being able to read what is here is not the same as putting something here."
          value={s.whoCanShare}
          options={[
            { key: 'admins', label: 'Admins' },
            { key: 'members', label: 'Any member' },
          ]}
          disabled={!canAdminister}
          onPick={(whoCanShare) => write({ whoCanShare: whoCanShare as 'admins' | 'members' })}
        />
      </Section>

      <Box className="mx-6 mt-2 h-px bg-hairline" />

      <Section title="What a share starts as">
        <Choice
          label="Permission"
          note="A ceiling, not just a default: a sender cannot ask for more than this."
          value={s.defaultRole}
          options={[
            { key: 'viewer', label: 'Can read' },
            { key: 'annotator', label: 'Can annotate' },
          ]}
          disabled={!canAdminister}
          onPick={(defaultRole) => write({ defaultRole: defaultRole as 'viewer' | 'annotator' })}
        />
        <Toggle
          label="Allow downloading"
          note="A downloaded copy is on somebody's device and removing access never reaches it."
          value={s.defaultCanDownload}
          disabled={!canAdminister}
          onChange={(defaultCanDownload) => write({ defaultCanDownload })}
        />
      </Section>

      <Box className="mx-6 mt-2 h-px bg-hairline" />

      <Section title="Privacy">
        <Toggle
          label="Members see each other's handles"
          note="Names and faces stay either way. A handle is what somebody could look you up by afterwards."
          value={s.showMemberHandles}
          disabled={!canAdminister}
          onChange={(showMemberHandles) => write({ showMemberHandles })}
        />
        <Toggle
          label="Show who is here"
          note="Whether being in this group right now shows to the other members."
          value={s.showPresence}
          disabled={!canAdminister}
          onChange={(showPresence) => write({ showPresence })}
        />
      </Section>

      <Box className="mx-6 mt-2 h-px bg-hairline" />

      {/* Any member, including one who can change nothing else here: it decides
          what reaches their phone rather than anything about the group. */}
      <Section title="Yours">
        <Toggle
          label="Mute this group"
          note="Stops notifications from this group only. Everything still arrives in Activity."
          value={detail.group.muted}
          onChange={(muted) => {
            void setMuted({ groupId: remoteId as Id<'groups'>, muted }).catch(() => {
              showToast({ id: 'group-mute', tone: 'error', title: 'That could not be changed' });
            });
          }}
        />
      </Section>

      <Box className="mx-6 mt-2 h-px bg-hairline" />

      <Pressable
        onPress={onLeave}
        accessibilityRole="button"
        accessibilityLabel={isOwner ? 'Delete this group' : 'Leave this group'}
        className="px-4 py-2.5 data-[active=true]:bg-hover"
      >
        <HStack className="items-center" space="md">
          <Icon as={isOwner ? Trash2 : LogOut} size="lg" className="text-destructive" />
          <VStack className="flex-1">
            <Text size="md" className="text-destructive">
              {isOwner ? 'Delete this group' : 'Leave this group'}
            </Text>
            <Text size="xs" className="mt-0.5 text-fg-subtle">
              {isOwner
                ? `Everybody loses access to the ${documentCount} ${documentCount === 1 ? 'document' : 'documents'} shared here.`
                : `You lose access to the ${documentCount} ${documentCount === 1 ? 'document' : 'documents'} shared here.`}
            </Text>
          </VStack>
        </HStack>
      </Pressable>

      <NameDialog
        isOpen={describing}
        onClose={() => setDescribing(false)}
        onSubmit={describe}
        title="Describe this group"
        label="Description"
        initialValue={s.description ?? ''}
        maxLength={GROUP_DESCRIPTION_MAX}
      />
    </VStack>
  );
}

/** A value you tap to change, with the current answer on the right. */
function Row({
  label,
  value,
  onPress,
  disabled,
}: {
  label: string;
  value: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="px-4 py-2.5 data-[active=true]:bg-hover"
    >
      <HStack className="items-center" space="md">
        <Text size="md" className={disabled ? 'flex-1 text-fg-disabled' : 'flex-1 text-foreground'}>
          {label}
        </Text>
        <Text size="sm" numberOfLines={1} className="max-w-[180px] text-fg-subtle">
          {value}
        </Text>
        {disabled ? null : <Icon as={ChevronRight} size="sm" className="text-fg-subtle" />}
      </HStack>
    </Pressable>
  );
}

/**
 * One of a short fixed list, chosen from a menu.
 *
 * A menu rather than a sheet, because two or three options do not need a
 * surface of their own — the same reason `access-screen.tsx` uses one for its
 * row actions.
 */
function Choice({
  label,
  note,
  value,
  options,
  disabled,
  onPick,
}: {
  label: string;
  note: string;
  value: string;
  options: { key: string; label: string }[];
  disabled: boolean;
  onPick: (key: string) => void;
}) {
  const current = options.find((option) => option.key === value)?.label ?? value;

  if (disabled) {
    return (
      <HStack className="items-center px-4 py-2.5" space="md">
        <VStack className="flex-1">
          <Text size="md" className="text-fg-disabled">
            {label}
          </Text>
          <Text size="xs" className="mt-0.5 text-fg-subtle">
            {note}
          </Text>
        </VStack>
        <Text size="sm" className="text-fg-subtle">
          {current}
        </Text>
      </HStack>
    );
  }

  return (
    <Menu
      placement="bottom right"
      offset={6}
      trigger={({ ...props }) => (
        <Pressable
          {...props}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${current}`}
          className="px-4 py-2.5 data-[active=true]:bg-hover"
        >
          <HStack className="items-center" space="md">
            <VStack className="flex-1">
              <Text size="md" className="text-foreground">
                {label}
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                {note}
              </Text>
            </VStack>
            <Text size="sm" className="text-fg-muted">
              {current}
            </Text>
            <Icon as={ChevronRight} size="sm" className="text-fg-subtle" />
          </HStack>
        </Pressable>
      )}
    >
      {options.map((option) => (
        <MenuItem key={option.key} textValue={option.label} onPress={() => onPick(option.key)}>
          <MenuItemLabel
            className={option.key === value ? 'text-sm text-primary' : 'text-sm text-foreground'}
          >
            {option.label}
          </MenuItemLabel>
        </MenuItem>
      ))}
    </Menu>
  );
}

/** The same switch row the notification settings use, so the two screens match. */
function Toggle({
  label,
  note,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  note: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <HStack className="items-center px-4 py-2.5" space="lg">
      <VStack className="flex-1">
        <Text size="md" className={disabled ? 'text-fg-disabled' : 'text-foreground'}>
          {label}
        </Text>
        <Text size="xs" className="mt-0.5 text-fg-subtle">
          {note}
        </Text>
      </VStack>
      <Switch
        value={value}
        onValueChange={onChange}
        isDisabled={disabled}
        accessibilityLabel={label}
      />
    </HStack>
  );
}
