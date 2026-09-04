import { FlashList } from '@shopify/flash-list';
import { useQuery } from 'convex/react';
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
import { useHome } from '../data/use-home';
import { localSearchAvailable, searchLocally } from '../local/text-index';

/**
 * Searching the words inside documents, rather than their titles.
 *
 * The library screen already searches titles, and that is a different question
 * with a different answer — so this is a second surface rather than a mode on
 * the first. It searches the text extracted from the copies in the account,
 * which is the only text the server can see.
 *
 * **A local-only document is absent from these results**, and the screen says so
 * rather than leaving a reader to wonder where their book went. That sentence is
 * the whole reason this screen has a footer.
 */
export function SearchInsideScreen() {
  const router = useRouter();
  const { ready, offline, profileId } = useLibraryStatus();
  const { documentId, term: seed } = useLocalSearchParams<{
    documentId?: string;
    term?: string;
  }>();
  const scope = documentId === undefined ? undefined : (documentId as Id<'documents'>);

  // Seeded once from the route, so arriving from the title search carries the
  // word the reader already typed. `useState`'s initialiser rather than an
  // effect: re-seeding on every render would fight their next keystroke.
  const [term, setTerm] = useState(() => (seed ?? '').slice(0, SEARCH_TERM_MAX));
  const trimmed = term.trim();

  // Two characters, because both indexes will happily match one against
  // everything and the answer is a page of noise.
  const long = trimmed.length >= 2;

  const online = useQuery(
    api.library.searchInside,
    ready && long && !offline
      ? { term: trimmed, ...(scope === undefined ? {} : { documentId: scope }) }
      : 'skip',
  );

  /**
   * The same search against the device's own index.
   *
   * Runs only when Convex is not answering, which is the whole reason the local
   * index exists — a book on this phone should be searchable on a plane. It is
   * a mirror of what the server extracted, so it can only know about documents
   * that were synced, extracted and then pulled down; `Unsearchable` below says
   * so, and says it differently when this is the index that answered.
   */
  const [local, setLocal] = useState<SearchHit[] | undefined>(undefined);
  useEffect(() => {
    if (!offline || !long || profileId === null) {
      setLocal(undefined);
      return;
    }
    let cancelled = false;
    setLocal(undefined);
    void searchLocally(profileId, trimmed, scope ?? null, SEARCH_LIMIT).then((rows) => {
      if (cancelled) {
        return;
      }
      setLocal(
        rows.map((row) => ({
          documentId: row.documentId as Id<'documents'>,
          // The local index stores no titles — they would be a second copy of
          // something that changes on rename. Filled in below from the library.
          title: '',
          page: row.page,
          snippet: row.snippet,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [offline, long, profileId, trimmed, scope]);

  // Titles for the local hits, from whatever the library already holds. The
  // cached home payload survives a cold launch offline, which is the situation
  // this whole path is for.
  const { sections } = useHome();
  const titles = useMemo(() => {
    const found = new Map<string, string>();
    for (const section of sections) {
      if (section.kind === 'documents') {
        for (const document of section.documents) {
          found.set(document.id, document.title);
        }
      }
    }
    return found;
  }, [sections]);

  const hits = useMemo(
    () =>
      offline
        ? local?.map((hit) => ({ ...hit, title: titles.get(hit.documentId) ?? 'A document' }))
        : online,
    [offline, local, online, titles],
  );

  // Only for a library-wide search. Searching inside one document the reader
  // picked needs no explanation of where their other documents are.
  const usage = useQuery(api.library.usage, ready && scope === undefined ? {} : 'skip');

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
          className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
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
            placeholder={scope === undefined ? 'Search inside your documents' : 'Search this document'}
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
        <HStack className="items-start px-6 pt-4" space="md">
          <Icon as={CloudOff} size="sm" className="mt-0.5 text-fg-subtle" />
          <Text size="xs" className="flex-1 text-fg-subtle">
            {localSearchAvailable()
              ? 'Searching the copy on this phone. Documents whose text has not been downloaded yet are not in these results.'
              : 'Searching inside documents needs a connection on this build.'}
          </Text>
        </HStack>
      ) : null}

      {summary === null ? null : (
        <Text size="2xs" className="px-6 pt-4 uppercase tracking-wider text-fg-subtle">
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
                Only documents downloaded to this phone are searched with no
                connection.
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
                className="border-b border-hairline px-6 py-3.5 data-[active=true]:bg-hover">
                <HStack className="items-center" space="md">
                  <Text
                    size="sm"
                    numberOfLines={1}
                    className="flex-1 font-semibold text-foreground">
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
    <VStack className="px-6 py-5" space="md">
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
