import { useRouter } from 'expo-router';
import { HardDrive, Phone, ShieldCheck, SlidersHorizontal } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';

import { Screen } from '@/components/layout/screen';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Switch } from '@/components/ui/switch';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { Notice, ScreenHeader, Section } from '@/features/sharing/components/segments';
import { useConnectionKind } from '@/lib/connectivity';
import {
  usePreferencesStore,
  type CellularCeiling,
  type EvictionOrder,
  type KeepRecent,
  type StorageCap,
  type VerifyCadence,
} from '@/stores/preferences-store';

import { formatBytes } from '../data/types';
import { useDeviceStorage } from '../data/use-device-storage';
import { useDownloadActions } from './use-download-actions';
import { ChoiceSheet, type Choice } from '@/components/layout/choice-sheet';

/**
 * What this device pulls down, and what it keeps.
 *
 * **Every value here stays on the device**, and that is the rule rather than an
 * implementation detail. `preferences-store.ts` says it in one sentence:
 * syncing a phone's answer about its data plan to a tablet that has none is
 * applying an answer to a question that device never asked. The account's own
 * settings screens are next door and hold the opposite kind of thing — who may
 * find this reader, what they want to be told — which should follow them to a
 * new phone and do.
 *
 * **Every switch governs something.** `docs/security.md` has a paragraph about
 * `showReadingActivity` sitting on a screen for months wired to nothing,
 * reading as a protection and being none; each row here names the module that
 * reads it, so the next audit can check rather than assume.
 */
export function DownloadSettingsScreen() {
  const router = useRouter();
  const connection = useConnectionKind();
  const { entries, used, free } = useDeviceStorage();

  const prefs = usePreferencesStore();
  const set = usePreferencesStore((state) => state.set);

  const downloads = useDownloadActions();
  const [checking, setChecking] = useState(false);
  const [picking, setPicking] = useState<
    null | 'ceiling' | 'recent' | 'cap' | 'order' | 'verify' | 'concurrent'
  >(null);

  const close = useCallback(() => setPicking(null), []);

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={SlidersHorizontal}
        title="Downloads"
        subtitle="What this device pulls down, and keeps"
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />

      <ScrollView contentContainerStyle={CONTENT}>
        {/* ── Network ─────────────────────────────────────────────── */}
        <Section title="Network">
          <Toggle
            label="Download over Wi-Fi only"
            note={
              connection === 'cellular' && prefs.wifiOnly
                ? 'You are on mobile data, so downloads are held until Wi-Fi.'
                : 'Holds full documents until you are on Wi-Fi. Reading what is already here is unaffected.'
            }
            value={prefs.wifiOnly}
            onChange={(wifiOnly) => set({ wifiOnly })}
          />
          <Pick
            label="Ask on mobile data above"
            note="Anything larger waits for you to agree to it, once, for that document."
            value={ceilingLabel(prefs.cellularCeilingMb)}
            disabled={prefs.wifiOnly}
            onPress={() => setPicking('ceiling')}
          />
          <Toggle
            label="Resume when Wi-Fi returns"
            note="Held downloads start on their own rather than waiting to be tapped again."
            value={prefs.resumeOnWifi}
            onChange={(resumeOnWifi) => set({ resumeOnWifi })}
          />
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        {/* ── Automatic ───────────────────────────────────────────── */}
        <Section title="Keep offline automatically">
          <Toggle
            label="Documents shared with me"
            note="Fetches a shared PDF when you accept it, so it is there before you need it."
            value={prefs.autoDownloadAccepted}
            onChange={(autoDownloadAccepted) => set({ autoDownloadAccepted })}
          />
          <Toggle
            label="Favourites"
            note="Anything you have hearted stays on this device."
            value={prefs.autoDownloadFavourites}
            onChange={(autoDownloadFavourites) => set({ autoDownloadFavourites })}
          />
          <Pick
            label="Recently opened"
            note="The last few you read are kept here whatever else happens."
            value={prefs.keepRecent === 0 ? 'Off' : `${prefs.keepRecent} documents`}
            onPress={() => setPicking('recent')}
          />
          <Notice glyph={SlidersHorizontal}>
            Automatic downloads obey everything above them: they wait for Wi-Fi, they respect the
            limit, and they never start when the disk is nearly full.
          </Notice>
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        {/* ── Storage ─────────────────────────────────────────────── */}
        <Section title="Storage">
          <Pick
            label="Keep at most"
            note={
              prefs.storageCapGb === 0
                ? `${formatBytes(used)} used. Downloads stop only when the phone is full.`
                : `${formatBytes(used)} of ${prefs.storageCapGb} GB used. Downloads stop at the limit rather than filling the phone.`
            }
            value={prefs.storageCapGb === 0 ? 'No limit' : `${prefs.storageCapGb} GB`}
            onPress={() => setPicking('cap')}
          />
          <Pick
            label="When full, remove"
            note="Only documents your account still holds. Never the only copy of anything."
            value={orderLabel(prefs.evictionOrder)}
            disabled={prefs.storageCapGb === 0}
            onPress={() => setPicking('order')}
          />
          <Toggle
            label="Never remove finished books"
            note="A book you marked finished stays until you remove it yourself."
            value={prefs.keepFinished}
            disabled={prefs.storageCapGb === 0}
            onChange={(keepFinished) => set({ keepFinished })}
          />
          <Pressable
            onPress={() => router.push('/storage')}
            accessibilityRole="button"
            accessibilityLabel="What is on this device"
            className="px-4 py-2 data-[active=true]:bg-hover"
          >
            <VStack>
              <Text size="md" className="text-foreground">
                What is on this device
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                {entries.length === 0
                  ? 'Nothing yet.'
                  : `${entries.length} document${entries.length === 1 ? '' : 's'}, largest first.${
                      free === null ? '' : ` ${formatBytes(free)} free.`
                    }`}
              </Text>
            </VStack>
          </Pressable>
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        {/* ── Integrity ───────────────────────────────────────────── */}
        <Section title="Integrity">
          <Pick
            label="Check a file before trusting it"
            note="Reads it back and compares it against what your account holds."
            value={cadenceLabel(prefs.verifyCadence)}
            onPress={() => setPicking('verify')}
          />
          <Pressable
            onPress={() => {
              if (checking || entries.length === 0) {
                return;
              }
              setChecking(true);
              void downloads.verifyEverything().finally(() => setChecking(false));
            }}
            disabled={checking || entries.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Check every download now"
            className="px-4 py-2 data-[active=true]:bg-hover"
          >
            <VStack>
              <Text
                size="md"
                className={entries.length === 0 ? 'text-fg-disabled' : 'text-foreground'}
              >
                {checking ? 'Checking…' : 'Check every download now'}
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                {entries.length === 0
                  ? 'Nothing on this device to check.'
                  : checking
                    ? 'Reading each file back. This can take a moment on a large library.'
                    : `${entries.length} document${entries.length === 1 ? '' : 's'}.`}
              </Text>
            </VStack>
          </Pressable>
          <Notice glyph={ShieldCheck}>
            A download is checked before it counts as here: the size your account recorded, the
            first five bytes reading %PDF-, and the file&apos;s fingerprint. Documents under 32 MB
            also get a hash of the whole file, which is the only check that notices a page damaged
            in the middle months later.
          </Notice>
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        {/* ── Queue ───────────────────────────────────────────────── */}
        <Section title="Queue">
          <Pick
            label="At once"
            note="More is not faster on one connection; it only makes the first one slower."
            value={String(prefs.maxConcurrent)}
            onPress={() => setPicking('concurrent')}
          />
          <Toggle
            label="Retry on its own"
            note="Eight attempts, spacing out. Then it waits for you."
            value={prefs.retryAutomatically}
            onChange={(retryAutomatically) => set({ retryAutomatically })}
          />
        </Section>

        <Notice glyph={Phone}>
          All of this is about this handset and stays on it. Another device you sign in to answers
          these for itself — a tablet with no mobile data has no use for an answer your phone gave.
        </Notice>

        <Notice glyph={HardDrive}>
          A document that is only on this phone is never removed to make room, at any limit.
          Removing the only copy of something to satisfy a number would be losing it.
        </Notice>
      </ScrollView>

      <ChoiceSheet
        isOpen={picking !== null}
        onClose={close}
        title={TITLES[picking ?? 'ceiling']}
        subtitle={
          picking === 'cap' && free !== null
            ? `${formatBytes(free)} free on this device`
            : undefined
        }
        choices={choicesFor(picking, prefs)}
        onSelect={(value) => {
          close();
          applyChoice(picking, value, set);
        }}
      />
    </Screen>
  );
}

/* ── rows ────────────────────────────────────────────────────────── */

/** The settings switch, lifted verbatim from `notification-settings-screen.tsx`. */
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

/** A row whose value is one of a fixed few, tapped to change it. */
function Pick({
  label,
  note,
  value,
  disabled = false,
  onPress,
}: {
  label: string;
  note?: string;
  value: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      className="px-4 py-2 data-[active=true]:bg-hover"
    >
      <HStack className="items-center" space="lg">
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
        <Text size="md" className={disabled ? 'text-fg-disabled' : 'text-fg-muted'}>
          {value}
        </Text>
      </HStack>
    </Pressable>
  );
}

/* ── the choices ─────────────────────────────────────────────────── */

const TITLES: Record<string, string> = {
  ceiling: 'Ask on mobile data above',
  recent: 'Keep recently opened',
  cap: 'Keep at most',
  order: 'When full, remove',
  verify: 'Check a file',
  concurrent: 'Downloads at once',
};

function ceilingLabel(mb: CellularCeiling): string {
  return mb === -1 ? 'Never ask' : mb === 0 ? 'Always ask' : `${mb} MB`;
}

function orderLabel(order: EvictionOrder): string {
  return order === 'largest'
    ? 'Largest'
    : order === 'finished-first'
      ? 'Finished first'
      : 'Least recently opened';
}

function cadenceLabel(cadence: VerifyCadence): string {
  return cadence === 'always' ? 'Often' : cadence === 'never' ? 'Never' : 'Weekly';
}

function choicesFor(
  picking: string | null,
  prefs: ReturnType<typeof usePreferencesStore.getState>,
): Choice[] {
  switch (picking) {
    case 'ceiling':
      return ([0, 5, 25, 50, -1] as CellularCeiling[]).map((mb) => ({
        value: String(mb),
        label: ceilingLabel(mb),
        note:
          mb === -1
            ? 'Download whatever is queued, on any connection.'
            : mb === 0
              ? 'Agree to every download on mobile data.'
              : undefined,
        selected: prefs.cellularCeilingMb === mb,
      }));
    case 'recent':
      return ([0, 3, 5, 10] as KeepRecent[]).map((n) => ({
        value: String(n),
        label: n === 0 ? 'Off' : `${n} documents`,
        selected: prefs.keepRecent === n,
      }));
    case 'cap':
      return ([0, 1, 2, 5, 10] as StorageCap[]).map((gb) => ({
        value: String(gb),
        label: gb === 0 ? 'No limit' : `${gb} GB`,
        note: gb === 0 ? 'Downloads stop only when the phone is full.' : undefined,
        selected: prefs.storageCapGb === gb,
      }));
    case 'order':
      return (['least-recently-opened', 'largest', 'finished-first'] as EvictionOrder[]).map(
        (order) => ({
          value: order,
          label: orderLabel(order),
          selected: prefs.evictionOrder === order,
        }),
      );
    case 'verify':
      return (['always', 'weekly', 'never'] as VerifyCadence[]).map((cadence) => ({
        value: cadence,
        label: cadenceLabel(cadence),
        note:
          cadence === 'always'
            ? 'A few every time the queue runs.'
            : cadence === 'never'
              ? 'Only when you ask.'
              : undefined,
        selected: prefs.verifyCadence === cadence,
      }));
    case 'concurrent':
      return [1, 2, 3].map((n) => ({
        value: String(n),
        label: String(n),
        selected: prefs.maxConcurrent === n,
      }));
    default:
      return [];
  }
}

function applyChoice(
  picking: string | null,
  value: string,
  set: ReturnType<typeof usePreferencesStore.getState>['set'],
): void {
  switch (picking) {
    case 'ceiling':
      return set({ cellularCeilingMb: Number(value) as CellularCeiling });
    case 'recent':
      return set({ keepRecent: Number(value) as KeepRecent });
    case 'cap':
      return set({ storageCapGb: Number(value) as StorageCap });
    case 'order':
      return set({ evictionOrder: value as EvictionOrder });
    case 'verify':
      return set({ verifyCadence: value as VerifyCadence });
    case 'concurrent':
      return set({ maxConcurrent: Number(value) as 1 | 2 | 3 });
    default:
      return;
  }
}

const CONTENT = { paddingBottom: 40 } as const;
