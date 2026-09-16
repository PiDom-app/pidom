/**
 * Ask, full screen.
 *
 * It was a sheet, and a sheet was the wrong surface. `docs/design.md` sets out
 * the rule it broke: **a control must not hang off a box whose height is the
 * reader's data**, which is why the navigator became a route after Contents at
 * 355 rows and Bookmarks at one moved its segmented control two-thirds up the
 * screen between them and the next tap landed on the backdrop. A transcript is
 * exactly that data. Pinning the sheet to a fixed 70% was a way of living with
 * the problem rather than the answer to it; a route is the answer, and it is the
 * one this document already gives for every other surface that holds a list.
 *
 * The component is gluestack's Chat AI, vendored into `src/components/ui/chat-ai`
 * and audited on the way in the way `docs/design.md` requires — two `styled`
 * imports repointed at the shim, and three colour classes that named nothing
 * (`bg-slate-900`, `bg-slate-800`, `bg-yellow-500`) pointed at tokens. Its
 * `PromptInput` positions itself `absolute bottom-4` and rides the keyboard on
 * `useReanimatedKeyboardAnimation`, which is a layout that wants a whole screen
 * and was fighting the sheet for its last few hundred pixels.
 *
 * What has not changed is the boundary. The device still chooses the passages
 * and still sends page numbers; `AiBoundary` on the canvas and
 * `docs/security.md` have the whole of it.
 */
import * as Clipboard from 'expo-clipboard';
import { useQuery } from 'convex/react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Ban,
  Copy,
  Cpu,
  Highlighter,
  Quote,
  Sparkles,
  TextSearch,
  WifiOff,
} from 'lucide-react-native';
import React, { memo, useCallback, useMemo } from 'react';
import { Text as RNText, TouchableOpacity, View } from 'react-native';

import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  Message,
  MessageAction,
  MessageContent,
  MessageResponse,
  MessageToolbar,
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type AttachmentData,
  type ConversationRenderItem,
} from '@/components/ui/chat-ai';
import { Box } from '@/components/ui/box';
import { Button, ButtonText } from '@/components/ui/button';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { Screen } from '@/components/layout/screen';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useLibraryStatus } from '@/features/library/data/use-library-status';
import { useAnnotations } from '@/features/reader/use-annotations';
import { useReaderDocument } from '@/features/reader/use-reader-document';
import { ScreenHeader } from '@/features/sharing/components/segments';
import { useReaderStore } from '@/stores/reader-store';

import type { Passage } from '../retrieve/retrieve';
import { useAsk, type AskBlock } from './use-ask';

/**
 * One attachment chip, memoised the way the component's own example does.
 *
 * `onRemove` is wrapped so the identity is stable per attachment — without it
 * every keystroke in the composer re-renders every chip, which on a grid of six
 * is six image decodes a character.
 */
const AttachmentItem = memo(function AttachmentItem({
  attachment,
  onRemove,
}: {
  attachment: AttachmentData;
  onRemove: (id: string) => void;
}) {
  const handleRemove = useCallback(() => onRemove(attachment.id), [onRemove, attachment.id]);

  return (
    <Attachment data={attachment} onRemove={handleRemove}>
      <AttachmentPreview />
      <AttachmentRemove />
    </Attachment>
  );
});

function PromptInputAttachmentsDisplay() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) {
    return null;
  }

  return (
    <Attachments variant="grid" className="mb-4">
      {(attachments.files as AttachmentData[]).map((attachment) => (
        <AttachmentItem key={attachment.id} attachment={attachment} onRemove={attachments.remove} />
      ))}
    </Attachments>
  );
}

export function AskScreen() {
  const router = useRouter();
  const showToast = useAppToast();
  const { id, page } = useLocalSearchParams<{ id?: string; page?: string }>();

  const { profileId, ready } = useLibraryStatus();
  const { document } = useReaderDocument(id);
  const { keep } = useAnnotations({ documentId: id });
  const settings = useQuery(api.settings.mine, ready ? {} : 'skip');
  const requestJump = useReaderStore((state) => state.requestJump);

  const near = page === undefined ? null : Number.parseInt(page, 10);

  const ask = useAsk({
    profileId,
    documentId: id ?? null,
    page: Number.isFinite(near) ? near : null,
    allowCloud: settings?.ai.allowCloud ?? false,
    // A document this reader owns is always theirs to ask about. One shared
    // with them is the owner's call, and the server is the authority — this is
    // the screen agreeing with what `mayAsk` would say rather than deciding it.
    ownerAllows:
      (document?.ownedByMe ?? true) || (settings?.sharing.allowAiOnSharedDocuments ?? false),
    open: true,
  });

  /**
   * A citation, taken.
   *
   * The reader came here from the reader and is going back to it, so this is a
   * `requestJump` and a `back` rather than a push: a second copy of a 400-page
   * document mounted behind this one is what `navigator-screen.tsx` avoids by
   * pushing rather than presenting, and the same argument applies coming home.
   */
  const goToPage = useCallback(
    (target: number) => {
      if (id !== undefined) {
        requestJump(id, target);
      }
      router.back();
    },
    [id, requestJump, router],
  );

  /**
   * An answer, kept.
   *
   * Straight through `useAnnotations`, which is the path a passage selected in
   * the reader already takes — so it syncs, it survives, and the month does not
   * apply to it. That is the whole mental model this feature asks somebody to
   * hold: the conversation is temporary, what you took out of it is yours.
   *
   * Against the page the answer's first citation points at, because an
   * annotation with no page is an annotation the navigator cannot place. With
   * no citations it goes against wherever the reader was.
   */
  const keepAnswer = useCallback(
    (text: string) => {
      if (id === undefined) {
        return;
      }
      keep({
        page: ask.sources[0]?.startPage ?? (Number.isFinite(near) ? (near as number) : 1),
        text,
      });
    },
    [id, keep, ask.sources, near],
  );

  const copyAnswer = useCallback(
    (text: string) => {
      Clipboard.setStringAsync(text)
        .then(() => showToast({ id: 'ask-copied', tone: 'success', title: 'Copied' }))
        .catch(() => showToast({ id: 'ask-copied', tone: 'error', title: "Couldn't copy" }));
    },
    [showToast],
  );

  const renderMessage: ConversationRenderItem = useCallback(
    ({ item: message, index }) => (
      <Message role={message.role} index={index} message={message}>
        <MessageContent>
          <MessageResponse message={message} />
        </MessageContent>

        {message.role === 'assistant' ? (
          <>
            <Sources sources={ask.sources} onGoToPage={goToPage} />
            {/* Two actions, both of which do something. The component ships
                three slots and a third glyph wired to nothing would be the
                `showReadingActivity` mistake `docs/security.md` has a paragraph
                about — a control that reads as a feature and is none. */}
            <MessageToolbar className="mt-[2px]">
              <MessageAction onPress={() => keepAnswer(textOf(message))} tooltip="Keep">
                <Icon as={Highlighter} size="sm" className="text-fg-muted" />
              </MessageAction>
              <MessageAction onPress={() => copyAnswer(textOf(message))} tooltip="Copy">
                <Icon as={Copy} size="sm" className="text-fg-muted" />
              </MessageAction>
            </MessageToolbar>
          </>
        ) : null}
      </Message>
    ),
    [ask.sources, goToPage, keepAnswer, copyAnswer],
  );

  const handleSubmit = useCallback(
    ({ text }: { text: string }) => {
      if (text.trim().length === 0) {
        return;
      }
      void ask.send(text);
    },
    [ask],
  );

  const title = document?.title ?? 'Your library';

  return (
    <Screen edges={['top']}>
      <ScreenHeader
        glyph={Sparkles}
        title="Ask"
        subtitle={title}
        onBack={() => router.back()}
        trailing={
          ask.block.kind === 'offline' ? (
            <Icon as={WifiOff} size="md" className="text-warn" />
          ) : settings === undefined ? null : (
            <HStack className="items-center rounded-md bg-surface px-2 py-1" space="xs">
              <Text size="2xs" className="text-fg-subtle">
                {`${settings.ai.retentionDays} days`}
              </Text>
            </HStack>
          )
        }
      />
      <Divider className="bg-hairline" />

      {/* The three states that are a screen rather than a transcript. Each has
          something the reader can still do, which is why none of them is an
          error: `docs/design.md`'s rule that a single message sits in the
          middle while a list starts at the top. */}
      {ask.block.kind === 'consent' ||
      ask.block.kind === 'owner-refuses' ||
      ask.block.kind === 'model' ? (
        <Blocked block={ask.block} onOpenSettings={() => router.push('/intelligence')} />
      ) : (
        <Box className="flex-1 bg-background">
          <Conversation className="flex-1">
            <ConversationContent messages={ask.messages} renderItem={renderMessage} />
            <ConversationScrollButton />
          </Conversation>

          <PromptInputProvider>
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputAttachmentsDisplay />
              <PromptInputBody>
                <PromptInputTextarea />
              </PromptInputBody>

              <PromptInputFooter>
                <PromptInputTools>
                  <PromptInputActionMenu>
                    <PromptInputActionMenuContent
                      trigger={(props) => (
                        <PromptInputActionMenuTrigger {...props} className="px-3">
                          <RNText className="text-3xl text-primary">+</RNText>
                        </PromptInputActionMenuTrigger>
                      )}
                    />
                  </PromptInputActionMenu>

                  <TouchableOpacity
                    onPress={() => router.push('/intelligence')}
                    accessibilityRole="button"
                    accessibilityLabel="Change the model"
                  >
                    <View className="h-10 items-center justify-center rounded-full bg-primary/10 px-3">
                      <RNText className="text-primary">{modelLabel(settings?.ai.model)}</RNText>
                    </View>
                  </TouchableOpacity>
                </PromptInputTools>

                <PromptInputSubmit />
              </PromptInputFooter>
            </PromptInput>
          </PromptInputProvider>
        </Box>
      )}

      {/* Offline and rate-limited keep the composer — the passages still run —
          so the sentence goes above it rather than instead of it. */}
      {ask.block.kind === 'offline' ? (
        <Notice
          glyph={WifiOff}
          tone="warn"
          body="No connection, so nothing is written for you. The passages your phone found on its own are above."
        />
      ) : null}
      {ask.block.kind === 'limited' ? (
        <Notice
          glyph={TextSearch}
          tone="warn"
          body={`The next answer is available in about ${Math.max(
            1,
            Math.round(ask.block.retryAfterMs / 60_000),
          )} minutes. Searching by meaning has no limit at all.`}
        />
      ) : null}
    </Screen>
  );
}

/* ── The three screens that are not a transcript ───────────────────────────── */

function Blocked({ block, onOpenSettings }: { block: AskBlock; onOpenSettings: () => void }) {
  if (block.kind === 'consent') {
    return <Consent onOpenSettings={onOpenSettings} />;
  }

  const model = block.kind === 'model';
  return (
    <VStack className="flex-1 items-center justify-center px-8">
      <Icon as={model ? Cpu : Ban} size="xl" className="text-fg-subtle" />
      <Text size="md" className="mt-3.5 text-center font-semibold text-foreground">
        {model ? 'The search model is not on this phone' : 'The owner has not allowed this'}
      </Text>
      <Text size="sm" className="mt-1.5 max-w-[300px] text-center text-fg-muted">
        {model
          ? 'Ask finds the right pages here, on the device, before anything is sent. That needs the model — 129 MB, once, over Wi-Fi.'
          : 'This document was shared with you. Sending its pages to a model is the owner’s decision, and they have not made it.'}
      </Text>
      {model ? (
        <Button size="lg" className="mt-4 h-11" onPress={onOpenSettings}>
          <ButtonText>Download the model</ButtonText>
        </Button>
      ) : null}
    </VStack>
  );
}

/**
 * The gate, asked once, and the second control is a real one.
 *
 * Refusing is not a dead end: searching by meaning has been running on the phone
 * the whole time and needs nobody's permission, so a reader who says no keeps
 * the half of the feature that never needed it. See `AskConsent`.
 */
function Consent({ onOpenSettings }: { onOpenSettings: () => void }) {
  const router = useRouter();

  return (
    <ScrollView contentContainerStyle={CONTENT}>
      <VStack className="px-4 pt-5">
        <Text size="xl" className="font-semibold text-foreground">
          What leaves this phone
        </Text>
        <Text size="sm" className="mt-2 text-fg-muted">
          Searching by meaning has been running here the whole time. Answering in sentences cannot.
        </Text>
      </VStack>

      <Point
        glyph={Quote}
        title="Your question, and at most eight pages"
        body="Your phone picks the pages. It sends their numbers; your account reads them and passes the text on."
      />
      <Point
        glyph={Sparkles}
        title="Conversations are deleted after a month"
        body="Anything you keep — a passage, a note — is yours and stays."
      />
      <Point
        glyph={Ban}
        title="Never the whole document"
        body="Not the file, not the index, not a page you did not ask about."
        tone="ok"
      />

      <Box className="px-4 pt-5">
        <Button size="lg" className="h-11" onPress={onOpenSettings}>
          <ButtonText>Turn on Ask</ButtonText>
        </Button>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Just find the passages"
          className="mt-3 items-center rounded-md py-2.5 data-[active=true]:bg-hover"
        >
          <Text size="sm" className="text-fg-muted">
            Just find the passages
          </Text>
        </Pressable>
      </Box>
    </ScrollView>
  );
}

function Point({
  glyph,
  title,
  body,
  tone,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  title: string;
  body: string;
  tone?: 'ok';
}) {
  return (
    <HStack className="items-start px-4 pt-4" space="md">
      <Icon
        as={glyph}
        size="sm"
        className={tone === 'ok' ? 'mt-0.5 text-ok' : 'mt-0.5 text-fg-muted'}
      />
      <VStack className="flex-1">
        <Text size="sm" className={tone === 'ok' ? 'text-ok' : 'text-foreground'}>
          {title}
        </Text>
        <Text size="xs" className="mt-0.5 text-fg-subtle">
          {body}
        </Text>
      </VStack>
    </HStack>
  );
}

/**
 * Where an answer came from, as controls rather than as a footnote.
 *
 * An answer a reader cannot check against the book is an answer *about* a book
 * rather than *from* one, so every page it used is a chip that goes there.
 */
function Sources({
  sources,
  onGoToPage,
}: {
  sources: readonly Passage[];
  onGoToPage: (page: number) => void;
}) {
  const pages = useMemo(() => {
    const seen = new Set<number>();
    for (const passage of sources) {
      seen.add(passage.startPage);
    }
    return [...seen].sort((a, b) => a - b);
  }, [sources]);

  if (pages.length === 0) {
    return null;
  }

  return (
    <HStack className="mt-2 flex-wrap gap-1.5">
      {pages.map((target) => (
        <Pressable
          key={target}
          onPress={() => onGoToPage(target)}
          accessibilityRole="button"
          accessibilityLabel={`Go to page ${target}`}
          className="flex-row items-center gap-1 rounded-md bg-primary-tint px-2 py-1 data-[active=true]:bg-hover"
        >
          <Icon as={Quote} size="2xs" className="text-primary" />
          <Text size="xs" className="text-primary">
            {`page ${target}`}
          </Text>
        </Pressable>
      ))}
    </HStack>
  );
}

function Notice({
  glyph,
  body,
  tone,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  body: string;
  tone: 'warn';
}) {
  return (
    <HStack className="items-start px-4 py-2" space="sm">
      <Icon as={glyph} size="xs" className={tone === 'warn' ? 'mt-0.5 text-warn' : ''} />
      <Text size="xs" className="flex-1 text-warn">
        {body}
      </Text>
    </HStack>
  );
}

/** A message's words, with the non-text parts of it dropped. */
function textOf(message: { parts?: { type: string; text?: string }[] }): string {
  return (message.parts ?? [])
    .map((part) => (part.type === 'text' ? (part.text ?? '') : ''))
    .join('')
    .trim();
}

const CONTENT = { paddingBottom: 40, flexGrow: 1 } as const;

function modelLabel(model: string | undefined): string {
  if (model === undefined) {
    return 'Model';
  }
  const name = model.slice(model.indexOf('/') + 1);
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}
