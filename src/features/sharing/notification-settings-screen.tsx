import { useRouter } from 'expo-router';
import { Bell, BellOff, Inbox, Lock, Smartphone } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Button, ButtonText } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { ScrollView } from '@/components/ui/scroll-view';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import Constants from 'expo-constants';

import { ListSkeleton, Notice, ScreenHeader, Section } from './components/segments';
import { permissionStatus, register } from '@/features/notifications/register';

/**
 * What this account wants to be told about, and on which device.
 *
 * **This is where the operating system prompt is raised, and nowhere else.**
 * Not on first launch: a permission asked for cold is a permission denied
 * permanently, and there is no second chance at it. Here there is a screen's
 * worth of context in front of it and a reader who came looking.
 *
 * Presence is deliberately absent from the list. It is a heartbeat that times
 * out and changes every few seconds, and a notification for it would be a
 * notification for nothing.
 *
 * The line at the bottom is the security claim and it is worth reading: a push
 * says a PDF was shared and who by, and never the title — it renders on a
 * locked screen, and everything else is behind a query that checks the reader
 * first. See `convex/model/notifications.ts`.
 */
export function NotificationSettingsScreen() {
  const router = useRouter();
  const settings = useQuery(api.settings.mine, {});
  const devices = useQuery(api.notifications.devices, {});
  const update = useMutation(api.settings.updateNotifications);
  const registerDevice = useMutation(api.notifications.registerDevice);
  const showToast = useAppToast();

  const [asking, setAsking] = useState(false);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'undetermined' | null>(null);

  React.useEffect(() => {
    void permissionStatus().then(setPermission);
  }, []);

  const ask = useCallback(async () => {
    setAsking(true);
    const outcome = await register();
    setAsking(false);
    setPermission(await permissionStatus());

    if (outcome.kind === 'denied') {
      showToast({
        id: 'push',
        tone: 'info',
        title: 'Notifications are off for Pidom',
        description: 'You can turn them back on in your device settings.',
      });
      return;
    }
    if (outcome.kind === 'unconfigured') {
      showToast({
        id: 'push',
        tone: 'info',
        title: 'This build cannot receive notifications',
        description: 'Shares still arrive in the app. Nothing else changes.',
      });
      return;
    }
    await registerDevice({
      token: outcome.token,
      platform: outcome.platform,
      deviceName: Constants.deviceName ?? undefined,
      appVersion: Constants.expoConfig?.version ?? undefined,
    });
    showToast({ id: 'push', tone: 'success', title: 'This device will be notified' });
  }, [registerDevice, showToast]);

  if (settings === undefined) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader glyph={Bell} title="Notifications" onBack={() => router.back()} />
        <Divider className="bg-hairline" />
        <ListSkeleton rows={5} />
      </Screen>
    );
  }

  const { notifications } = settings;
  const registeredHere = (devices ?? []).length > 0;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={notifications.allow ? Bell : BellOff}
        title="Notifications"
        subtitle={notifications.allow ? 'On' : 'Off'}
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />

      <ScrollView contentContainerStyle={CONTENT}>
        {permission === 'granted' || permission === null ? null : (
          <VStack className="px-6 pt-4" space="sm">
            <Text size="md" className="font-semibold text-foreground">
              Know when somebody answers
            </Text>
            <Text size="sm" className="text-fg-muted">
              A notification is how you find out a document you shared was accepted, or that one
              arrived for you, without opening the app to check.
            </Text>
            <Button size="lg" onPress={() => void ask()} isDisabled={asking} className="mt-2 h-11">
              {asking ? <Spinner /> : <ButtonText>Allow notifications</ButtonText>}
            </Button>
          </VStack>
        )}

        <Box className="pt-2">
          <Toggle
            label="Allow notifications"
            note="Everything below is off while this is."
            value={notifications.allow}
            onChange={(allow) => void update({ allow })}
          />
        </Box>
        <Divider className="mx-6 bg-hairline" />

        <Section title="Tell me about">
          <Toggle
            label="Documents shared with me"
            value={notifications.documentShares}
            disabled={!notifications.allow}
            onChange={(documentShares) => void update({ documentShares })}
          />
          <Toggle
            label="Answers to what I shared"
            note="Accepted, declined, and access changed."
            value={notifications.shareResponses}
            disabled={!notifications.allow}
            onChange={(shareResponses) => void update({ shareResponses })}
          />
          <Toggle
            label="Group activity"
            note="Being added to a group, and a document shared into one."
            value={notifications.groupActivity}
            disabled={!notifications.allow}
            onChange={(groupActivity) => void update({ groupActivity })}
          />
          <Toggle
            label="Notes on documents I own"
            note="Off. Somebody working through a shared textbook writes tens in an evening."
            value={notifications.annotationActivity}
            disabled={!notifications.allow}
            onChange={(annotationActivity) => void update({ annotationActivity })}
          />
        </Section>

        <Divider className="mt-4 bg-hairline" />

        <Section title="Quiet hours">
          <Toggle
            label="Hold notifications overnight"
            note="They arrive in the morning. Nothing is dropped."
            value={notifications.quietStartMinute !== undefined}
            disabled={!notifications.allow}
            onChange={(on) =>
              void update(
                on
                  ? {
                      quietStartMinute: 22 * 60,
                      quietEndMinute: 7 * 60,
                      // Sent with the write rather than guessed on the server:
                      // quiet hours are a time of day, and a server that
                      // assumed UTC would be wrong by up to half a day.
                      utcOffsetMinutes: -new Date().getTimezoneOffset(),
                    }
                  : { quietStartMinute: undefined, quietEndMinute: undefined },
              )
            }
          />
          {notifications.quietStartMinute === undefined ? null : (
            <HStack className="px-6 pb-3" space="md">
              <Text size="xs" className="text-fg-subtle">
                {formatMinute(notifications.quietStartMinute)} until{' '}
                {formatMinute(notifications.quietEndMinute ?? 0)}
              </Text>
            </HStack>
          )}
        </Section>

        {devices === undefined || devices.length === 0 ? null : (
          <>
            <Divider className="mt-4 bg-hairline" />
            <Section title="Devices">
              {devices.map((device) => (
                <HStack key={device.id} className="items-center px-6 py-3" space="lg">
                  <Icon as={Smartphone} size="lg" className="text-fg-muted" />
                  <VStack className="flex-1">
                    <Text size="md" className="text-foreground">
                      {device.deviceName ?? (device.platform === 'ios' ? 'iPhone' : 'Android')}
                    </Text>
                    <Text size="xs" className="mt-0.5 text-fg-subtle">
                      {device.enabled ? 'Will be notified' : 'Muted'}
                    </Text>
                  </VStack>
                </HStack>
              ))}
            </Section>
          </>
        )}

        <Notice glyph={Lock}>
          A notification says a PDF was shared with you and who by. Never the title — it renders on
          a locked screen, and the rest is behind a query that checks you are allowed to read it.
        </Notice>

        {registeredHere ? null : (
          <Notice glyph={Inbox}>
            This device is not registered for notifications, so shares arrive in the app rather
            than on the lock screen. Everything else works exactly the same.
          </Notice>
        )}
      </ScrollView>
    </Screen>
  );
}

function Toggle({
  label,
  note,
  value,
  disabled = false,
  onChange,
}: {
  label: string;
  note?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <HStack className="items-center px-6 py-3" space="lg">
      <VStack className="flex-1">
        <Text size="md" className={disabled ? 'text-fg-disabled' : 'text-foreground'}>
          {label}
        </Text>
        {note === undefined ? null : (
          <Text size="xs" className="mt-0.5 text-fg-subtle">
            {note}
          </Text>
        )}
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

function formatMinute(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const CONTENT = { paddingBottom: 40 } as const;
