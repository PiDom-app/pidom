import { useRouter } from 'expo-router';
import { Bell, BellOff, Inbox, Lock, Smartphone, X } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '@convex/_generated/api';
import { useAppToast } from '@/components/feedback/use-app-toast';
import type { Id } from '@convex/_generated/dataModel';
import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Button, ButtonText } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import Constants from 'expo-constants';

import { ConfirmDialog } from './components/confirm-dialog';
import { ListSkeleton, Notice, ScreenHeader, Section } from './components/segments';
import { formatMinute, TimeSheet } from './components/time-sheet';
import { pushAvailable } from '@/features/notifications/native';
import { permissionStatus, register } from '@/features/notifications/register';
import { useDeviceStore } from '@/stores/device-store';

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
  const setDeviceEnabled = useMutation(api.notifications.setDeviceEnabled);
  const forgetDevice = useMutation(api.notifications.forgetDevice);
  const showToast = useAppToast();

  const thisDevice = useDeviceStore((state) => state.deviceId);
  const setThisDevice = useDeviceStore((state) => state.setDeviceId);

  const [asking, setAsking] = useState(false);
  const [permission, setPermission] = useState<'granted' | 'denied' | 'undetermined' | null>(null);
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [forgetting, setForgetting] = useState<{ id: string; name: string } | null>(null);

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
    setThisDevice(
      await registerDevice({
        token: outcome.token,
        platform: outcome.platform,
        deviceName: Constants.deviceName ?? undefined,
        appVersion: Constants.expoConfig?.version ?? undefined,
      }),
    );
    showToast({ id: 'push', tone: 'success', title: 'This device will be notified' });
  }, [registerDevice, setThisDevice, showToast]);

  /**
   * Every write, carrying the offset again.
   *
   * Quiet hours are a time of day and the account stores minutes since local
   * midnight, so the server needs to know which midnight. Sending it with the
   * setting that changed rather than once when quiet hours were switched on is
   * what stops them drifting by an hour at the end of October, or by nine
   * after a flight.
   */
  const write = useCallback(
    (patch: Parameters<typeof update>[0]) =>
      void update({ ...patch, utcOffsetMinutes: -new Date().getTimezoneOffset() }),
    [update],
  );

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
  // A build with no native module cannot ever mint a token, so offering the
  // permission prompt would be offering a button that does nothing.
  const canPush = pushAvailable();
  const quietOn = notifications.quietStartMinute !== undefined;
  const quietStart = notifications.quietStartMinute ?? 22 * 60;
  const quietEnd = notifications.quietEndMinute ?? 7 * 60;

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
        {permission === 'granted' || permission === null || !canPush ? null : (
          <VStack className="px-4 pt-4" space="sm">
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
            onChange={(allow) => write({ allow })}
          />
        </Box>
        <Divider className="mx-6 bg-hairline" />

        <Section title="Tell me about">
          <Toggle
            label="Documents shared with me"
            value={notifications.documentShares}
            disabled={!notifications.allow}
            onChange={(documentShares) => write({ documentShares })}
          />
          <Toggle
            label="Answers to what I shared"
            note="Accepted, declined, and access changed."
            value={notifications.shareResponses}
            disabled={!notifications.allow}
            onChange={(shareResponses) => write({ shareResponses })}
          />
          <Toggle
            label="Group activity"
            note="Being added to a group, and a document shared into one."
            value={notifications.groupActivity}
            disabled={!notifications.allow}
            onChange={(groupActivity) => write({ groupActivity })}
          />
          <Toggle
            label="Notes on documents I own"
            note="Off. Somebody working through a shared textbook writes tens in an evening."
            value={notifications.annotationActivity}
            disabled={!notifications.allow}
            onChange={(annotationActivity) => write({ annotationActivity })}
          />
        </Section>

        <Divider className="mt-2 bg-hairline" />

        <Section title="Quiet hours">
          <Toggle
            label="Hold notifications overnight"
            note="They arrive in the morning. Nothing is dropped."
            value={quietOn}
            disabled={!notifications.allow}
            onChange={(on) =>
              write(
                on
                  ? { quietStartMinute: 22 * 60, quietEndMinute: 7 * 60 }
                  : { quietStartMinute: undefined, quietEndMinute: undefined },
              )
            }
          />
          {!quietOn ? null : (
            <>
              <TimeRow
                label="From"
                minute={quietStart}
                disabled={!notifications.allow}
                onPress={() => setPicking('start')}
              />
              <TimeRow
                label="Until"
                minute={quietEnd}
                disabled={!notifications.allow}
                onPress={() => setPicking('end')}
              />
              <Text size="xs" className="px-4 pt-1 pb-2 text-fg-subtle">
                {quietStart === quietEnd
                  ? 'Start and end are the same, so nothing is held.'
                  : `Held between ${formatMinute(quietStart)} and ${formatMinute(quietEnd)}, your time.`}
              </Text>
            </>
          )}
        </Section>

        {devices === undefined || devices.length === 0 ? null : (
          <>
            <Divider className="mt-2 bg-hairline" />
            {/* Per device, because "notify me" is not one answer: a tablet on
                a shelf and a phone in a pocket are different questions, and
                muting the shelf should not mute the pocket. */}
            <Section title="Devices">
              {devices.map((device) => {
                const name =
                  device.deviceName ?? (device.platform === 'ios' ? 'iPhone' : 'Android');
                const here = device.id === thisDevice;
                return (
                  <HStack key={device.id} className="items-center px-4 py-2" space="lg">
                    <Icon as={Smartphone} size="lg" className="text-fg-muted" />
                    <VStack className="flex-1">
                      <Text size="md" className="text-foreground">
                        {here ? `${name} · this device` : name}
                      </Text>
                      <Text size="xs" className="mt-0.5 text-fg-subtle">
                        {device.enabled ? 'Will be notified' : 'Muted'}
                      </Text>
                    </VStack>
                    <Switch
                      value={device.enabled}
                      isDisabled={!notifications.allow}
                      onValueChange={(enabled) =>
                        void setDeviceEnabled({ deviceId: device.id, enabled })
                      }
                      accessibilityLabel={`Notify ${name}`}
                    />
                    {/* Forgetting is separate from muting and says so: a mute
                        is reversible from here, and forgetting means the next
                        notification needs this device to register again. */}
                    <Pressable
                      onPress={() => setForgetting({ id: device.id, name })}
                      accessibilityRole="button"
                      accessibilityLabel={`Forget ${name}`}
                      className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
                    >
                      <Icon as={X} size="md" className="text-fg-subtle" />
                    </Pressable>
                  </HStack>
                );
              })}
            </Section>
          </>
        )}

        <Notice glyph={Lock}>
          A notification says a PDF was shared with you and who by. Never the title — it renders on
          a locked screen, and the rest is behind a query that checks you are allowed to read it.
        </Notice>

        {/* Two different facts, and saying the wrong one is worse than saying
            nothing: a build that cannot notify is not a device that has not
            been registered, and the reader can do something about only one of
            them. */}
        {!canPush ? (
          <Notice glyph={Inbox}>
            This build cannot receive notifications — remote push needs a development build rather
            than Expo Go. Shares still arrive in the app, and everything on this screen is
            remembered for a build that can.
          </Notice>
        ) : registeredHere ? null : (
          <>
            <Notice glyph={Inbox}>
              This device is not registered for notifications, so shares arrive in the app rather
              than on the lock screen. Everything else works exactly the same.
            </Notice>
            {/* An action, because "not registered" is a state a reader can do
                something about and could not. Registration is attempted once
                per launch and gives up quietly on anything that goes wrong — a
                dropped connection, a token the push service refused — which
                left this notice as a statement of fact with no way out of it. */}
            <Box className="px-4 pt-1">
              <Button
                variant="outline"
                size="lg"
                onPress={() => void ask()}
                isDisabled={asking}
                className="h-11"
              >
                {asking ? <Spinner /> : <ButtonText>Register this device</ButtonText>}
              </Button>
            </Box>
          </>
        )}
      </ScrollView>

      <TimeSheet
        isOpen={picking !== null}
        onClose={() => setPicking(null)}
        title={picking === 'end' ? 'Until' : 'From'}
        value={picking === 'end' ? quietEnd : quietStart}
        onPick={(minute) =>
          write(picking === 'end' ? { quietEndMinute: minute } : { quietStartMinute: minute })
        }
      />

      <ConfirmDialog
        isOpen={forgetting !== null}
        onClose={() => setForgetting(null)}
        onConfirm={() => {
          if (forgetting !== null) {
            void forgetDevice({ deviceId: forgetting.id as Id<'deviceTokens'> });
            if (forgetting.id === thisDevice) {
              setThisDevice(null);
            }
          }
          setForgetting(null);
        }}
        title={`Forget ${forgetting?.name ?? 'this device'}?`}
        lines={[
          'It stops receiving notifications and disappears from this list.',
          'Opening Pidom on it again puts it back, without asking for permission a second time.',
        ]}
        confirmLabel="Forget"
      />
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
    <HStack className="items-center px-4 py-2" space="lg">
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

/** One end of the quiet window, tapped to change it. */
function TimeRow({
  label,
  minute,
  disabled,
  onPress,
}: {
  label: string;
  minute: number;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label} ${formatMinute(minute)}`}
      className="px-4 py-2 data-[active=true]:bg-hover"
    >
      <HStack className="items-center" space="lg">
        <Text size="md" className={disabled ? 'flex-1 text-fg-disabled' : 'flex-1 text-foreground'}>
          {label}
        </Text>
        <Text size="md" className={disabled ? 'text-fg-disabled' : 'text-fg-muted'}>
          {formatMinute(minute)}
        </Text>
      </HStack>
    </Pressable>
  );
}

const CONTENT = { paddingBottom: 40 } as const;
