/**
 * Search & Ask.
 *
 * `download-settings-screen.tsx`'s shape, down to the `Toggle` and `Pick` rows
 * and the `ChoiceSheet` behind the pickers. What is new is that this screen has
 * **both halves of the app's settings vocabulary on it**, and says which is
 * which: everything under *On this phone* and *Indexing* is this handset's own
 * answer and stays on it, and everything under *Ask* and *Conversations* is the
 * account's and follows the reader to another device.
 *
 * That distinction is `preferences-store.ts`'s and it is not decoration — a
 * phone's answer about its battery is not an answer a tablet ever gave, and a
 * conversation started here has to be readable there. A screen that mixed them
 * silently would leave somebody surprised on their second device.
 *
 * **Every switch here governs something**, which is the rule that file states
 * and `docs/security.md` has a paragraph about: `showReadingActivity` sat on a
 * screen for months wired to nothing, reading as a protection and being none.
 * Each row below names the module that reads it.
 */
import { useQuery, useMutation } from 'convex/react';
import { useRouter } from 'expo-router';
import { Ban, Cpu, HardDrive, ScanText, Sparkles, Trash2 } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';

import { api } from '@convex/_generated/api';
import { AI_CONTEXT_PAGES } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { ChoiceSheet, type Choice } from '@/components/layout/choice-sheet';
import { Screen } from '@/components/layout/screen';
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
import { formatBytes } from '@/features/library/data/types';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { database } from '@/features/library/local/db';
import {
  ListSkeleton,
  Notice,
  ScreenHeader,
  Section,
} from '@/features/sharing/components/segments';
import { log } from '@/lib/logger';
import {
  usePreferencesStore,
  type IndexBatteryFloor,
  type IndexCap,
} from '@/stores/preferences-store';

import { useIndexStatus } from './data/use-index-status';
import {
  deleteModel,
  downloadModel,
  modelBytesOnDisk,
  modelPresent,
  ModelError,
} from './engine/model-store';
import { pauseIndexing, rebuildEverything, resumeIndexing } from './index/actions';
import { MODEL_TOTAL_BYTES } from './model';

const SCOPE = 'intelligence-settings';

type Picking = null | 'battery' | 'cap' | 'pages' | 'retention';

export function IntelligenceScreen() {
  const router = useRouter();
  const { profileId, ready } = useLibraryStatus();
  const showToast = useAppToast();

  const settings = useQuery(api.settings.mine, ready ? {} : 'skip');
  const updateAi = useMutation(api.settings.updateAi);

  const prefs = usePreferencesStore();
  const set = usePreferencesStore((state) => state.set);

  const status = useIndexStatus(profileId);
  const [picking, setPicking] = useState<Picking>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);

  const close = useCallback(() => setPicking(null), []);
  const present = profileId !== null && modelPresent(profileId);
  const onDisk = profileId === null ? 0 : modelBytesOnDisk(profileId);

  const fetchModel = useCallback(async () => {
    if (profileId === null) {
      return;
    }
    setDownloading(0);
    try {
      await downloadModel(profileId, (received) => setDownloading(received));
      showToast({
        id: 'model-ready',
        tone: 'success',
        title: 'Search by meaning is ready',
        description: 'Your documents are being prepared now. It runs in the background.',
      });
    } catch (error) {
      const fault = error instanceof ModelError ? error.fault : 'network';
      log.debug(SCOPE, 'the model would not arrive', fault);
      showToast({
        id: 'model-failed',
        tone: 'error',
        title:
          fault === 'tampered'
            ? 'That download did not match its fingerprint'
            : fault === 'truncated'
              ? 'The model did not arrive whole'
              : 'The model could not be downloaded',
        description:
          fault === 'tampered'
            ? 'It has been removed rather than used. Try again on a connection you trust.'
            : 'Nothing was kept. Try again on a steadier connection.',
      });
    } finally {
      setDownloading(null);
    }
  }, [profileId, showToast]);

  const togglePause = useCallback(async () => {
    if (profileId === null) {
      return;
    }
    const db = await database(profileId);
    if (db === null) {
      return;
    }
    if (paused) {
      await resumeIndexing(db);
    } else {
      await pauseIndexing(db);
    }
    setPaused(!paused);
  }, [profileId, paused]);

  const rebuild = useCallback(async () => {
    if (profileId === null) {
      return;
    }
    const db = await database(profileId);
    if (db === null) {
      return;
    }
    await rebuildEverything(db);
    showToast({
      id: 'index-rebuilding',
      tone: 'info',
      title: 'Rebuilding every index',
      description: 'Your documents stay searchable by their words while it runs.',
    });
  }, [profileId, showToast]);

  if (settings === undefined) {
    return (
      <Screen edges={['top', 'bottom']}>
        <ScreenHeader glyph={Sparkles} title="Search & Ask" onBack={() => router.back()} />
        <Divider className="bg-hairline" />
        <ListSkeleton rows={6} />
      </Screen>
    );
  }

  const ai = settings.ai;
  const counts = status.data;

  return (
    <Screen edges={['top', 'bottom']}>
      <ScreenHeader
        glyph={Sparkles}
        title="Search & Ask"
        subtitle="Finding what a document means"
        onBack={() => router.back()}
      />
      <Divider className="bg-hairline" />

      <ScrollView contentContainerStyle={CONTENT}>
        {/* ── On this phone ───────────────────────────────────────────── */}
        <Section title="On this phone">
          <Toggle
            label="Search by meaning"
            note="Finds a passage that is about what you typed, not only one that contains it. Read by intelligence/index/policy.ts."
            value={prefs.indexAutomatically && present}
            disabled={!present}
            onChange={(indexAutomatically) => set({ indexAutomatically })}
          />

          {downloading === null ? (
            <Pressable
              onPress={() => (present ? undefined : void fetchModel())}
              disabled={present}
              accessibilityRole="button"
              accessibilityLabel={present ? 'Model downloaded' : 'Download the model'}
              className="px-4 py-2 data-[active=true]:bg-hover"
            >
              <HStack className="items-center" space="lg">
                <Icon as={Cpu} size="lg" className="text-fg-muted" />
                <VStack className="flex-1">
                  <Text size="md" className="text-foreground">
                    Model
                  </Text>
                  <Text size="xs" className="mt-0.5 text-fg-subtle">
                    multilingual-e5-small, 94 languages. Runs here; nothing it reads is sent
                    anywhere.
                  </Text>
                </VStack>
                <Text size="md" className="text-fg-muted">
                  {present ? formatBytes(onDisk) : formatBytes(MODEL_TOTAL_BYTES)}
                </Text>
              </HStack>
            </Pressable>
          ) : (
            <HStack className="items-center px-4 py-2" space="lg">
              <Spinner size="small" />
              <VStack className="flex-1">
                <Text size="md" className="text-foreground">
                  Downloading the model
                </Text>
                <Text size="xs" className="mt-0.5 text-fg-subtle">
                  {`${formatBytes(downloading)} of ${formatBytes(MODEL_TOTAL_BYTES)}`}
                </Text>
              </VStack>
            </HStack>
          )}

          {!present || downloading !== null ? null : (
            <Pressable
              onPress={() => {
                if (profileId !== null) {
                  deleteModel(profileId);
                }
              }}
              accessibilityRole="button"
              accessibilityLabel="Delete the model"
              className="px-4 py-2 data-[active=true]:bg-hover"
            >
              <HStack className="items-center" space="lg">
                <Icon as={Trash2} size="lg" className="text-fg-muted" />
                <VStack className="flex-1">
                  <Text size="md" className="text-foreground">
                    Delete the model
                  </Text>
                  <Text size="xs" className="mt-0.5 text-fg-subtle">
                    Frees the space. Searching by words is unaffected; searching by meaning stops
                    until it is downloaded again.
                  </Text>
                </VStack>
              </HStack>
            </Pressable>
          )}
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        {/* ── Indexing ────────────────────────────────────────────────── */}
        <Section title="Indexing">
          <Toggle
            label="Index new documents automatically"
            note="A document is indexed once its text has arrived from your account. Read by intelligence/index/actions.ts."
            value={prefs.indexAutomatically}
            disabled={!present}
            onChange={(indexAutomatically) => set({ indexAutomatically })}
          />
          <Toggle
            label="Index over Wi-Fi only"
            note="Indexing uses no data. This holds the text it has to fetch first. Read by intelligence/index/policy.ts."
            value={prefs.indexOnWifiOnly}
            disabled={!present}
            onChange={(indexOnWifiOnly) => set({ indexOnWifiOnly })}
          />
          <Pick
            label="Stop indexing below"
            note="Never runs the battery down finishing a book you are not reading. Ignored while charging."
            value={batteryLabel(prefs.indexBatteryFloor)}
            disabled={!present}
            onPress={() => setPicking('battery')}
          />
          <Pick
            label="Keep at most"
            note={
              counts === null
                ? 'The oldest index is dropped first, and rebuilds when you open it.'
                : `${formatBytes(counts.bytes)} used. The oldest index is dropped first, and rebuilds when you open it.`
            }
            value={capLabel(prefs.indexCapGb)}
            disabled={!present}
            onPress={() => setPicking('cap')}
          />

          {counts === null || (counts.queued === 0 && counts.current === null) ? null : (
            <Pressable
              onPress={() => void togglePause()}
              accessibilityRole="button"
              accessibilityLabel={paused ? 'Resume indexing' : 'Pause indexing'}
              className="px-4 py-2 data-[active=true]:bg-hover"
            >
              <HStack className="items-center" space="lg">
                <Icon as={ScanText} size="lg" className="text-fg-muted" />
                <VStack className="flex-1">
                  <Text size="md" className="text-foreground">
                    {paused ? 'Resume indexing' : 'Pause indexing'}
                  </Text>
                  <Text size="xs" className="mt-0.5 text-fg-subtle">
                    {currentLine(counts)}
                  </Text>
                </VStack>
              </HStack>
            </Pressable>
          )}
        </Section>

        <Divider className="mx-6 mt-2 bg-hairline" />

        {/* ── Library ─────────────────────────────────────────────────── */}
        <Section title="Library">
          <HStack className="items-center px-4 py-2" space="lg">
            <Icon as={HardDrive} size="lg" className="text-fg-muted" />
            <VStack className="flex-1">
              <Text size="md" className="text-foreground">
                {counts === null ? 'Counting' : `${counts.indexed} documents indexed`}
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                {counts === null
                  ? 'Reading this device.'
                  : `${formatBytes(counts.bytes)} · about 400 KB a book. Removing an index does not remove the book.`}
              </Text>
            </VStack>
          </HStack>

          {counts !== null && counts.failed > 0 ? (
            <Notice glyph={Ban} tone="destructive">
              {`${counts.failed} ${
                counts.failed === 1 ? 'document' : 'documents'
              } could not be indexed. Their words are still searchable.`}
            </Notice>
          ) : null}

          <Pressable
            onPress={() => void rebuild()}
            disabled={!present}
            accessibilityRole="button"
            accessibilityLabel="Rebuild every index"
            className="px-4 py-2 data-[active=true]:bg-hover"
          >
            <VStack>
              <Text size="md" className={present ? 'text-foreground' : 'text-fg-disabled'}>
                Rebuild every index
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                Hours of work on a large library, and almost never the answer. Your documents stay
                searchable by their words while it runs.
              </Text>
            </VStack>
          </Pressable>
        </Section>

        <Notice glyph={Cpu}>
          The model never leaves this phone and never phones home. It is downloaded once, checked
          against a known fingerprint before it is used, and deleted whenever you say so.
        </Notice>

        <Divider className="mx-6 mt-2 bg-hairline" />

        {/* ── Ask, which is the account's ─────────────────────────────── */}
        <Section title="Ask · your account">
          <Toggle
            label="Allow Ask"
            note="Sends your question and the pages your phone picked. Off, and Ask still finds the passages."
            value={ai.allowCloud}
            onChange={(allowCloud) => void updateAi({ allowCloud })}
          />
          <Pick
            label="Pages sent per question"
            note="More pages is a better answer and more of your book leaving the phone."
            value={String(ai.contextPages)}
            disabled={!ai.allowCloud}
            onPress={() => setPicking('pages')}
          />
          <Pick
            label="Keep conversations for"
            note="Deleted on the server when the time is up, not hidden here."
            value={`${ai.retentionDays} days`}
            disabled={!ai.allowCloud}
            onPress={() => setPicking('retention')}
          />
          <Pressable
            onPress={() => router.push('/sharing-privacy')}
            accessibilityRole="button"
            accessibilityLabel="Documents other people shared with me"
            className="px-4 py-2 data-[active=true]:bg-hover"
          >
            <VStack>
              <Text size="md" className="text-foreground">
                Documents other people shared with you
              </Text>
              <Text size="xs" className="mt-0.5 text-fg-subtle">
                Their book, their decision. Yours is on Sharing &amp; privacy.
              </Text>
            </VStack>
          </Pressable>
        </Section>

        <Notice glyph={Ban} tone="subtle">
          Your library is never used to train anything, and no part of a document is stored by the
          model. What you keep from a conversation becomes a note and outlives it.
        </Notice>

        {!present ? (
          <Section title="">
            <Button size="lg" className="mx-4 mt-2 h-11" onPress={() => void fetchModel()}>
              <ButtonText>Download the model</ButtonText>
            </Button>
          </Section>
        ) : null}
      </ScrollView>

      <ChoiceSheet
        isOpen={picking !== null}
        onClose={close}
        title={TITLES[picking ?? 'battery']}
        choices={choicesFor(picking, prefs, ai)}
        onSelect={(value) => {
          close();
          applyChoice(picking, value, set, updateAi);
        }}
      />
    </Screen>
  );
}

/* ── Rows, copied from the two settings screens that already have them ─────── */

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

/* ── The picker's four lists ───────────────────────────────────────────────── */

const TITLES: Record<string, string> = {
  battery: 'Stop indexing below',
  cap: 'Keep at most',
  pages: 'Pages sent per question',
  retention: 'Keep conversations for',
};

function batteryLabel(floor: IndexBatteryFloor): string {
  return floor === 0 ? 'Never wait' : `${Math.round(floor * 100)}% battery`;
}

function capLabel(gb: IndexCap): string {
  return gb === 0 ? 'No ceiling' : `${gb} GB`;
}

function choicesFor(
  picking: Picking,
  prefs: ReturnType<typeof usePreferencesStore.getState>,
  ai: { contextPages: number; retentionDays: number },
): Choice[] {
  switch (picking) {
    case 'battery':
      return ([0, 0.2, 0.5] as IndexBatteryFloor[]).map((floor) => ({
        value: String(floor),
        label: batteryLabel(floor),
        note:
          floor === 0 ? 'Index whenever there is something to index, on any charge.' : undefined,
        selected: prefs.indexBatteryFloor === floor,
      }));
    case 'cap':
      return ([0, 1, 2, 5] as IndexCap[]).map((gb) => ({
        value: String(gb),
        label: capLabel(gb),
        note: gb === 0 ? 'Index everything, however large the library gets.' : undefined,
        selected: prefs.indexCapGb === gb,
      }));
    case 'pages':
      return [2, 4, 6, AI_CONTEXT_PAGES].map((pages) => ({
        value: String(pages),
        label: `${pages} pages`,
        note:
          pages === AI_CONTEXT_PAGES
            ? 'The most a question may carry. About 64 KB of a book.'
            : pages === 2
              ? 'The least that answers anything. Cheapest, and narrowest.'
              : undefined,
        selected: ai.contextPages === pages,
      }));
    case 'retention':
      return [7, 30].map((days) => ({
        value: String(days),
        label: `${days} days`,
        note:
          days === 7
            ? 'Deleted a week after a conversation starts.'
            : 'Long enough to come back to a book mid-chapter.',
        selected: ai.retentionDays === days,
      }));
    default:
      return [];
  }
}

function applyChoice(
  picking: Picking,
  value: string,
  set: ReturnType<typeof usePreferencesStore.getState>['set'],
  updateAi: ReturnType<typeof useMutation<typeof api.settings.updateAi>>,
): void {
  switch (picking) {
    case 'battery':
      return set({ indexBatteryFloor: Number(value) as IndexBatteryFloor });
    case 'cap':
      return set({ indexCapGb: Number(value) as IndexCap });
    case 'pages':
      void updateAi({ contextPages: Number(value) });
      return;
    case 'retention':
      void updateAi({ retentionDays: Number(value) });
      return;
    default:
      return;
  }
}

/** The sentence under Pause, which is the only live number on this screen. */
function currentLine(counts: NonNullable<ReturnType<typeof useIndexStatus>['data']>): string {
  if (counts.current !== null && counts.current.total !== null) {
    return `${counts.current.done} of ${counts.current.total} passages · ${counts.queued} waiting`;
  }
  if (counts.held > 0) {
    return `${counts.queued} waiting · ${counts.held} held`;
  }
  return `${counts.queued} waiting`;
}

const CONTENT = { paddingBottom: 40 } as const;
