/**
 * One conversation about one document, from the screen's side.
 *
 * Three things happen here that are worth knowing about.
 *
 * **The passages are chosen before the question is sent.** `retrieve` runs on
 * the device against the local index, and what goes over the wire is the page
 * numbers it picked — never the text. See `retrieve/retrieve.ts:pagesFor` and
 * the `AiBoundary` artboard.
 *
 * **The thread is made lazily.** Opening Ask costs nothing; asking costs a
 * thread. A reader who opens Ask, reads the suggestions and leaves
 * again has not created anything, which matters because a thread is a durable
 * object with a month of life in it.
 *
 * **What is streaming is a query.** `useThreadMessages` with `stream: true`
 * subscribes to the deltas the agent writes into the component's tables, so an
 * answer arrives a word at a time over the same reactive socket as everything
 * else — no SSE, nothing React Native handles differently from a list of
 * bookmarks.
 */
import { toUIMessages, useThreadMessages, type UIMessage } from '@convex-dev/agent/react';
import { useMutation } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { AI_CONTEXT_PAGES } from '@convex/model/limits';
import { useAppToast } from '@/components/feedback/use-app-toast';
import { useHasNetwork } from '@/lib/connectivity';
import { log } from '@/lib/logger';

import { cacheConversation, cachedConversation } from '../store';
import { pagesFor, retrieve, semanticSearchAvailable, type Passage } from '../retrieve/retrieve';

const SCOPE = 'ask';

/**
 * Why Ask cannot answer, when it cannot.
 *
 * Each of these is a screen on the canvas rather than an error state, because
 * every one of them has something the reader can still do. `offline` offers the
 * passages, `consent` offers the switch, `model` offers the download.
 */
export type AskBlock =
  | { kind: 'ready' }
  | { kind: 'offline' }
  | { kind: 'consent' }
  | { kind: 'owner-refuses' }
  | { kind: 'model' }
  | { kind: 'not-indexed' }
  | { kind: 'limited'; retryAfterMs: number };

export type AskState = {
  block: AskBlock;
  messages: UIMessage[];
  /** The passages the last question used, for the sources list. */
  sources: Passage[];
  sending: boolean;
  send: (question: string) => Promise<void>;
  /** Fills the composer without sending, for the suggested questions. */
  thinking: boolean;
};

export function useAsk({
  profileId,
  documentId,
  page,
  allowCloud,
  ownerAllows,
  open,
}: {
  profileId: string | null;
  documentId: string | null;
  /** Where the reader is, so a question prefers passages near them. */
  page: number | null;
  allowCloud: boolean;
  /** `false` when the document is somebody else's and they have not allowed it. */
  ownerAllows: boolean;
  open: boolean;
}): AskState {
  const online = useHasNetwork();
  const showToast = useAppToast();

  const [threadId, setThreadId] = useState<string | null>(null);
  const [sources, setSources] = useState<Passage[]>([]);
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [limited, setLimited] = useState<number | null>(null);
  const [cached, setCached] = useState<UIMessage[]>([]);

  const startThread = useMutation(api.ai.startThread);
  const ask = useMutation(api.ai.ask);

  // `skip` until there is a thread, so opening Ask opens no subscription.
  const live = useThreadMessages(api.ai.messages, threadId === null ? 'skip' : { threadId }, {
    initialNumItems: 20,
    stream: true,
  });

  const messages = useMemo(
    () => (live.results.length === 0 ? cached : toUIMessages(live.results)),
    [live.results, cached],
  );

  /**
   * The last few turns, read back when the screen opens with no connection.
   *
   * The conversation lives in the account and is deleted there after a month;
   * this is so a screen reopened in a tunnel shows the answer that was just
   * read rather than nothing. It is a bound, not a store — see
   * `repository/chunks.ts:cacheMessages`.
   */
  useEffect(() => {
    if (!open || profileId === null || threadId === null || online) {
      return;
    }
    let live = true;
    void cachedConversation(profileId, threadId).then((rows) => {
      if (!live || rows.length === 0) {
        return;
      }
      setCached(
        rows.map((row) => ({
          id: `${threadId}:${row.ordinal}`,
          role: row.role === 'user' ? 'user' : 'assistant',
          parts: [{ type: 'text', text: row.body }],
        })) as unknown as UIMessage[],
      );
    });
    return () => {
      live = false;
    };
  }, [open, profileId, threadId, online]);

  /** And written back whenever the live conversation moves. */
  useEffect(() => {
    if (profileId === null || threadId === null || live.results.length === 0) {
      return;
    }
    void cacheConversation(
      profileId,
      threadId,
      toUIMessages(live.results).map((message, ordinal) => ({
        ordinal,
        role: message.role,
        body: message.parts
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join('')
          .trim(),
      })),
    );
  }, [profileId, threadId, live.results]);

  const block = useMemo<AskBlock>(() => {
    if (limited !== null) {
      return { kind: 'limited', retryAfterMs: limited };
    }
    if (profileId !== null && !semanticSearchAvailable(profileId)) {
      return { kind: 'model' };
    }
    if (!allowCloud) {
      return { kind: 'consent' };
    }
    if (!ownerAllows) {
      return { kind: 'owner-refuses' };
    }
    if (!online) {
      return { kind: 'offline' };
    }
    return { kind: 'ready' };
  }, [limited, profileId, allowCloud, ownerAllows, online]);

  const send = useCallback(
    async (question: string) => {
      const asked = question.trim();
      if (profileId === null || asked.length === 0 || sending) {
        return;
      }

      setSending(true);
      setThinking(true);
      try {
        // Retrieval first, always — it is the half that works with no
        // connection and the half the passages come from either way.
        const passages = await retrieve(profileId, asked, {
          scope: documentId,
          near: page,
          limit: 6,
        });
        setSources(passages);

        if (block.kind === 'offline') {
          // The passages are the answer. Nothing is sent, nothing is queued,
          // and the screen says so — see `AskOffline`.
          return;
        }
        if (block.kind !== 'ready') {
          return;
        }

        let thread = threadId;
        if (thread === null) {
          const started = await startThread({
            ...(documentId === null ? {} : { documentId: documentId as Id<'documents'> }),
            title: asked,
          });
          thread = started.threadId;
          setThreadId(thread);
        }

        await ask({
          threadId: thread,
          prompt: asked,
          ...(documentId === null ? {} : { documentId: documentId as Id<'documents'> }),
          pages: pagesFor(passages, AI_CONTEXT_PAGES),
        });
      } catch (error) {
        const data = (error as { data?: { code?: string; retryAfter?: number } }).data;
        // Never the question and never the answer. They are the reader's own
        // words about their own document; `docs/security.md` has the rule and
        // `selection-bar.tsx` holds to it for a selection.
        log.debug(SCOPE, 'a question was refused', data?.code ?? 'unknown');

        if (data?.code === 'RATE_LIMITED') {
          setLimited(data.retryAfter ?? 60_000);
          return;
        }
        if (data?.code === 'AI_NOT_ALLOWED' || data?.code === 'AI_OWNER_REFUSES') {
          // The screen already renders these as states; the refusal is the
          // server agreeing with what the screen was showing.
          return;
        }
        showToast({
          id: 'ask-failed',
          tone: 'error',
          title: 'That question did not go through',
          description: 'The passages below are what your phone found on its own.',
        });
      } finally {
        setSending(false);
        setThinking(false);
      }
    },
    [profileId, sending, documentId, page, block, threadId, startThread, ask, showToast],
  );

  // A new document is a new conversation. Reopening Ask on the same book
  // keeps the one that is there, which is what `AskThreads` is for.
  useEffect(() => {
    setThreadId(null);
    setSources([]);
    setLimited(null);
    setCached([]);
  }, [documentId]);

  return { block, messages, sources, sending, send, thinking };
}
