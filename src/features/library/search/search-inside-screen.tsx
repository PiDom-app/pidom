import { FlashList } from '@shopify/flash-list';
import { useQuery } from 'convex/react';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, CloudOff, ScanText, Search, Smartphone } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';

import { Screen } from '@/components/layout/screen';
import { Box } from '@/components/ui/box';
import { Center } from '@/components/ui/center';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Input, InputField } from '@/components/ui/input';
import { Pressable } from '@/components/ui/pressable';
import { Spinner } from '@/components/ui/spinner';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { SEARCH_LIMIT, SEARCH_TERM_MAX } from '@convex/model/limits';
import type { SearchHit } from '@convex/model/processing';

import { useLibraryStatus } from '../data/use-library-status';
import { useLocalQuery } from '../local/use-local-query';
import { localSearchAvailable, searchLocally } from '../local/text-index';

/**
 * Searching the words inside documents, rather than their titles.
 *
 * The library screen already searches titles, and that is a different question
 * with a different answer — so this is a second surface rather than a mode on
 * the first.
 *
 * **The device's own index is the primary now, not the fallback.** It used to
 * branch: the account when the socket was up, this phone when it was not. Two
 * paths, two shapes of answer, and the one that was exercised least was the one
 * that ran when a reader most needed it. The local index answers every search
 * and the account's answer is a wider net laid over it — the same rows, plus
 * any pages this phone has not mirrored yet.
 *
 * **A local-only document is absent from both**, and the screen says so rather
 * than leaving a reader to wonder where their book went: extraction reads the
 * copy in the account, because that is the only copy a server can see. That
 * sentence is the whole reason this screen has a footer.
 */
/** A row from the device's own index, before a title is put on it. */
type LocalHit = { documentId: string; page: number; snippet: string };

/** What the title lookup is built from. */
const CATALOGUE_TABLES = ['documents'] as const;

/** Every document this device knows of, by both of its names. */
async function readCatalogue(db: SQLiteDatabase) {
  return await db.getAllAsync<{ id: string; remoteId: string | null; title: string }>(
    'SELECT id, remoteId, title FROM documents WHERE deletedAt IS NULL',
  );
}

export function SearchInsideScreen() {
  const router = useRouter();
  const { ready, offline, profileId } = useLibraryStatus();
  const { documentId, term: seed } = useLocalSearchParams<{
    documentId?: string;
    term?: string;
  }>();
  const scope = documentId === undefined || documentId === '' ? null : documentId;

  // Seeded once from the route, so arriving from the title search carries the
  // word the reader already typed. `useState`'s initialiser rather than an
  // effect: re-seeding on every render would fight their next keystroke.
  const [term, setTerm] = useState(() => (seed ?? '').slice(0, SEARCH_TERM_MAX));
  const trimmed = term.trim();

  // Two characters, because both indexes will happily match one against
  // everything and the answer is a page of noise.
  const long = trimmed.length >= 2;

  /**
   * Titles, from the device's own library.
   *
   * The local index stores none — they would be a second copy of something that
   * changes on a rename — and the account's answer carries its own, under ids
   * this device may file differently. One map, keyed both ways, so a hit from
   * either index finds the title the reader would recognise.
   */
  const { data: catalogue } = useLocalQuery(profileId, CATALOGUE_TABLES, readCatalogue);
  const titles = useMemo(() => {
    const found = new Map<string, { id: string; title: string }>();
    for (const row of catalogue ?? []) {
      found.set(row.id, row);
      if (row.remoteId !== null) {
        found.set(row.remoteId, row);
      }
    }
    return found;
  }, [catalogue]);

  /**
   * The account's id for the document being searched, if it has one.
   *
   * A document imported on this phone and not yet synced has none, and would
   * have nothing to search there anyway — extraction reads the copy in the
   * account, which is the only copy a server can see.
   */
  const remoteScope = useMemo(
    () =>
      scope === null ? null : ((catalogue ?? []).find((row) => row.id === scope)?.remoteId ?? null),
    [scope, catalogue],
  );

  /**
   * The account's answer, when there is one.
   *
   * Scoped by the *account's* id for the document, which a document imported on
   * this phone and not yet synced does not have — and would have nothing to
   * search anyway, for the same reason it has no text status.
   */
  const online = useQuery(
    api.library.searchInside,
    ready && long && !offline && (scope === null || remoteScope !== null)
      ? {
          term: trimmed,
          ...(remoteScope === null ? {} : { documentId: remoteScope as Id<'documents'> }),
        }
      : 'skip',
  );

  /**
   * The same search against the device's own index, always.
   *
   * A mirror of what the server extracted, so it can only know about documents
   * that were synced, extracted and then pulled down here; the footer says so.
   */
  const [local, setLocal] = useState<LocalHit[] | undefined>(undefined);
  useEffect(() => {
    if (!long || profileId === null) {
      setLocal(undefined);
      return;
    }
    let cancelled = false;
    void searchLocally(profileId, trimmed, scope, SEARCH_LIMIT).then((rows) => {
      if (!cancelled) {
        setLocal(
          rows.map((row) => ({ documentId: row.documentId, page: row.page, snippet: row.snippet })),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [long, profileId, trimmed, scope]);

  /**
   * One list, from whichever indexes answered.
   *
   * Merged on the pair the reader can actually distinguish — a document and a
   * page — so a page both found is one row rather than two. The account's
   * snippet wins where they overlap: it searched the whole document rather than
   * whatever this phone has mirrored so far.
   */
  const hits = useMemo<SearchHit[] | undefined>(() => {
    if (!long) {
      return undefined;
    }
    if (local === undefined && online === undefined) {
      return undefined;
    }

    const merged = new Map<string, SearchHit>();

    for (const hit of local ?? []) {
      const known = titles.get(hit.documentId);
      merged.set(`${known?.id ?? hit.documentId}:${hit.page}`, {
        documentId: (known?.id ?? hit.documentId) as Id<'documents'>,
        title: known?.title ?? 'A document',
        page: hit.page,
        snippet: hit.snippet,
      });
    }

    for (const hit of online ?? []) {
      const known = titles.get(hit.documentId);
      merged.set(`${known?.id ?? hit.documentId}:${hit.page}`, {
        ...hit,
        documentId: (known?.id ?? hit.documentId) as Id<'documents'>,
        title: known?.title ?? hit.title,
      });
    }

    // In page order within a document, which is reading order. Both indexes
    // return by relevance, and stepping through a book by relevance is not
    // something a reader can follow.
    return [...merged.values()].sort((a, b) => a.title.localeCompare(b.title) || a.page - b.page);
  }, [long, local, online, titles]);

  // Only for a library-wide search. Searching inside one document the reader
  // picked needs no explanation of where their other documents are.
  const usage = useQuery(api.library.usage, ready && scope === null ? {} : 'skip');

  const summary = useMemo(() => {
    if (hits === undefined || hits.length === 0) {
      return null;
    }
    const books = new Set(hits.map((hit) => hit.documentId)).size;
    return `${hits.length} ${hits.length === 1 ? 'page' : 'pages'} in ${books} ${
      books === 1 ? 'document' : 'documents'
    }`;
  }, [hits]);

  return (
    <Screen edges={['top', 'bottom']}>
      <HStack className="items-center gap-2.5 px-4 pt-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
        >
          <Icon as={ArrowLeft} size="lg" className="text-foreground" />
        </Pressable>
        <Input className="h-10 flex-1">
          <Box className="pl-3">
            <Icon as={Search} size="sm" className="text-fg-subtle" />
          </Box>
          <InputField
            value={term}
            onChangeText={setTerm}
            maxLength={SEARCH_TERM_MAX}
            placeholder={scope === null ? 'Search inside your documents' : 'Search this document'}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            className="text-foreground"
          />
        </Input>
      </HStack>

      {/* Said before the results rather than under them: offline, this list is
          drawn from the copy on this phone, and a reader owed an explanation for
          a short answer should get it before they read the answer. */}
      {offline ? (
        <HStack className="items-start px-4 pt-4" space="md">
          <Icon as={CloudOff} size="sm" className="mt-0.5 text-fg-subtle" />
          <Text size="xs" className="flex-1 text-fg-subtle">
            {localSearchAvailable()
              ? 'Searching the copy on this phone. Documents whose text has not been downloaded yet are not in these results.'
              : 'Searching inside documents needs a connection on this build.'}
          </Text>
        </HStack>
      ) : null}

      {summary === null ? null : (
        <Text size="2xs" className="px-4 pt-2.5 pb-1 uppercase tracking-wider text-fg-subtle">
          {summary}
        </Text>
      )}

      <Box className="mt-3 flex-1">
        {trimmed.length < 2 ? (
          <Prompt scoped={scope !== undefined} />
        ) : hits === undefined ? (
          <Center className="flex-1 pb-24">
            <Spinner />
          </Center>
        ) : hits.length === 0 ? (
          <Center className="flex-1 px-10 pb-24">
            <Text size="sm" className="text-center text-fg-muted">
              {`Nothing matching “${trimmed}”.`}
            </Text>
            {offline ? (
              <Text size="xs" className="mt-2 text-center text-fg-subtle">
                Only documents downloaded to this phone are searched with no connection.
              </Text>
            ) : null}
          </Center>
        ) : (
          <FlashList
            data={hits}
            keyExtractor={(hit) => `${hit.documentId}-${hit.page}`}
            renderItem={({ item }) => (
              <Pressable
                onPress={() =>
                  // Straight to the page. `page` is read by the reader on open,
                  // the same way `currentPage` is.
                  router.push({
                    pathname: '/reader',
                    params: { id: item.documentId, page: String(item.page) },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`${item.title}, page ${item.page}`}
                className="border-b border-hairline px-4 py-2.5 data-[active=true]:bg-hover"
              >
                <HStack className="items-center" space="md">
                  <Text
                    size="sm"
                    numberOfLines={1}
                    className="flex-1 font-semibold text-foreground"
                  >
                    {item.title}
                  </Text>
                  <Text size="2xs" className="text-fg-subtle">
                    {`page ${item.page}`}
                  </Text>
                </HStack>
                <Text size="xs" numberOfLines={2} className="mt-1 text-fg-muted">
                  {item.snippet}
                </Text>
              </Pressable>
            )}
            ListFooterComponent={
              // `usage` is a Convex query, so offline there is nothing to
              // count and the banner above has already said why.
              usage === undefined ? null : (
                <Unsearchable localOnly={usage.localOnlyCount} scans={usage.scanCount} />
              )
            }
          />
        )}
      </Box>
    </Screen>
  );
}

/** What to say before there is anything to search for. */
function Prompt({ scoped }: { scoped: boolean }) {
  return (
    <Center className="flex-1 px-10 pb-24">
      <Icon as={ScanText} size="xl" className="text-fg-subtle" />
      <Text size="sm" className="mt-4 text-center text-fg-muted">
        {scoped
          ? 'Type a word or a phrase to find the pages it appears on.'
          : 'Type a word or a phrase to find the pages it appears on, across every document in your account.'}
      </Text>
    </Center>
  );
}

/**
 * The two honest caveats, under the results rather than over them.
 *
 * A reader whose book is missing from a search deserves the reason, and there
 * are exactly two: it is not in the account, or it is a scan with no text in
 * it. Both come off `library.usage`, which was already scanning the owner's
 * documents to total up storage — so the footer costs no query of its own.
 */
function Unsearchable({ localOnly, scans }: { localOnly: number; scans: number }) {
  if (localOnly === 0 && scans === 0) {
    return null;
  }
  return (
    <VStack className="px-4 py-5" space="md">
      {scans === 0 ? null : (
        <HStack className="items-start" space="lg">
          <Icon as={ScanText} size="md" className="mt-0.5 text-fg-subtle" />
          <VStack className="flex-1">
            <Text size="xs" className="text-fg-muted">
              {`${scans} ${scans === 1 ? 'document has' : 'documents have'} no text in ${scans === 1 ? 'it' : 'them'}`}
            </Text>
            <Text size="2xs" className="mt-0.5 text-fg-subtle">
              They are scans. There is nothing to search until they are run through OCR.
            </Text>
          </VStack>
        </HStack>
      )}
      {localOnly === 0 ? null : (
        <HStack className="items-start" space="lg">
          <Icon as={Smartphone} size="md" className="mt-0.5 text-fg-subtle" />
          <VStack className="flex-1">
            <Text size="xs" className="text-fg-muted">
              {`${localOnly} ${localOnly === 1 ? 'document is' : 'documents are'} on this phone only`}
            </Text>
            <Text size="2xs" className="mt-0.5 text-fg-subtle">
              Searching inside a document reads the copy in your account. Turn on “Available on all
              devices” for one and it joins these results.
            </Text>
          </VStack>
        </HStack>
      )}
    </VStack>
  );
}
