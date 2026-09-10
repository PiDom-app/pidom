import { FlashList } from "@shopify/flash-list";
import type { SQLiteDatabase } from "expo-sqlite";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowUpDown,
  Check,
  ChevronLeft,
  LayoutGrid,
  List,
  Search,
  TextSearch,
  X,
} from "lucide-react-native";
import React, { useCallback, useDeferredValue, useMemo, useState } from "react";
import { useWindowDimensions } from "react-native";

import { Screen } from "@/components/layout/screen";
import { Box } from "@/components/ui/box";
import { Center } from "@/components/ui/center";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { Icon } from "@/components/ui/icon";
import { Input, InputField, InputIcon, InputSlot } from "@/components/ui/input";
import { Menu, MenuItem, MenuItemLabel } from "@/components/ui/menu";
import { Pressable } from "@/components/ui/pressable";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { SEARCH_TERM_MAX } from "@convex/model/limits";

import { DocumentActions } from "../components/document-actions";
import { DocumentRow, DocumentTile } from "../components/document-tile";
import * as Documents from "../local/repository/documents";
import { useLocalQuery } from "../local/use-local-query";
import type { LibraryDocument } from "../data/types";
import { useCoverSync } from "../data/use-cover-sync";
import { useLibraryActions } from "../data/use-library-actions";
import { useLibraryStatus } from "../data/use-library-status";

/**
 * The whole library, behind "View all".
 *
 * Three controls, and they do not all compose: **the filter chooses the index,
 * so the sort only applies with no filter active.** That is a real constraint
 * rather than a missing feature — a filter plus an unrelated sort means a
 * `.filter()` over a sorted index, which reads the whole table to fill a page
 * and returns pages of wildly uneven size. When a filter is on, the sort
 * control says so instead of lying about what it did.
 *
 * "On this device" is the fourth chip and no longer the odd one out. It used to
 * thin a page the server had already returned, because the filesystem could not
 * be an index there; now every one of these reads the device's own database, so
 * it is a predicate like the rest — and the whole screen, search included, works
 * with no connection.
 */

type Sort = "recent" | "opened" | "title";
type Filter = "all" | "favorites" | "finished" | "device";
type Mode = "grid" | "list";

/** How many rows a page asks for. */
const PAGE = 24;

/** What this screen is built from. A write to anything else is not its business. */
const TABLES = ["documents", "documentFiles"] as const;

const SORT_LABELS: Record<Sort, string> = {
  recent: "Recently added",
  opened: "Recently opened",
  title: "Title",
};

const FILTER_CHIPS: { key: Filter | "device"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "favorites", label: "Favourites" },
  { key: "device", label: "On this device" },
  { key: "finished", label: "Finished" },
];

/** Three columns, 24px page padding, 12px gutters. */
const GRID_COLUMNS = 3;
const GRID_PAGE_PADDING = 24;
const GRID_GUTTER = 12;

/**
 * A tile sized to the screen it is on rather than to one phone.
 *
 * The hardcoded 106 this replaces was measured on a 390pt device. On a 320pt
 * phone three columns have 90.7pt each and a 106pt tile overflows its cell;
 * on a tablet it leaves the grid stranded at the left.
 */
function gridTileWidth(windowWidth: number): number {
  const usable =
    windowWidth - GRID_PAGE_PADDING * 2 - GRID_GUTTER * (GRID_COLUMNS - 1);
  return Math.floor(usable / GRID_COLUMNS);
}

export function AllLibraryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ focus?: string }>();

  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [chip, setChip] = useState<Filter>("all");
  const [mode, setMode] = useState<Mode>("grid");
  const [acting, setActing] = useState<LibraryDocument | null>(null);

  const { profileId } = useLibraryStatus();
  const { fetchDocument } = useLibraryActions();
  const { width } = useWindowDimensions();
  const tileWidth = gridTileWidth(width);

  // Typing should not read the database per keystroke. `useDeferredValue` lets
  // the field stay responsive while the results catch up on their own.
  const searchTerm = useDeferredValue(term.trim());
  const searching = searchTerm !== "";

  /**
   * One page at a time, from this device.
   *
   * `usePaginatedQuery` against the account is gone, and with it the awkwardness
   * it caused: "on this device" was the one filter the server could not apply,
   * so a page was fetched and then thinned locally, which returned pages of
   * wildly uneven length and could hand back an empty screen with more to come.
   * Here it is one predicate like the others, and the whole screen works with no
   * connection.
   */
  const [limit, setLimit] = useState(PAGE);

  const read = useCallback(
    async (db: SQLiteDatabase) =>
      searching
        ? await Documents.searchTitles(db, searchTerm, limit)
        : await Documents.listDocuments(db, { sort, filter: chip, limit, offset: 0 }),
    [searching, searchTerm, sort, chip, limit],
  );

  const { data, loading } = useLocalQuery(profileId, TABLES, read);
  const documents = useMemo(() => data ?? [], [data]);

  const loadMore = useCallback(() => {
    // A page that came back short is the end of the library. Asking for another
    // would be a read that answers with the same rows.
    if (documents.length >= limit) {
      setLimit((current) => current + PAGE);
    }
  }, [documents.length, limit]);

  useCoverSync(documents);

  const openDocument = useCallback(
    (document: LibraryDocument) => {
      // Same rule as home: a tap on something the account has and this phone
      // does not means fetch it. Anything here opens.
      if (document.fileState !== "available" && document.isSynced) {
        void fetchDocument(document);
        return;
      }
      router.push({ pathname: "/reader", params: { id: document.id } });
    },
    [fetchDocument, router],
  );

  return (
    <Screen>
      <HStack className="items-center gap-1.5 px-4 pt-5">
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          className="-ml-2 h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
        >
          <Icon as={ChevronLeft} size="xl" className="text-foreground" />
        </Pressable>

        <Heading size="lg" className="flex-1 text-foreground">
          Library
        </Heading>

        <SortControl
          sort={sort}
          disabled={chip !== "all" || searching}
          onChange={setSort}
        />

        <HStack className="ml-1 gap-0.5 rounded-md bg-surface p-0.5">
          <ModeToggle
            icon={LayoutGrid}
            label="Grid"
            active={mode === "grid"}
            onPress={() => setMode("grid")}
          />
          <ModeToggle
            icon={List}
            label="List"
            active={mode === "list"}
            onPress={() => setMode("list")}
          />
        </HStack>
      </HStack>

      {/* Padding on a wrapper, not `mx-6` on the field. The vendored `Input`
          is `w-full`, so a horizontal margin makes it 100% *plus* 48px and the
          right edge runs off the screen. */}
      <Box className="mt-4 px-4">
        <Input className="h-11">
          <InputSlot className="pl-1">
            <InputIcon as={Search} className="text-fg-muted" />
          </InputSlot>
          <InputField
            value={term}
            onChangeText={setTerm}
            maxLength={SEARCH_TERM_MAX}
            autoFocus={params.focus === "search"}
            placeholder="Search your library"
            returnKeyType="search"
            className="text-foreground"
          />
          {term === "" ? null : (
            <InputSlot onPress={() => setTerm("")} className="pr-1">
              <InputIcon as={X} className="text-fg-muted" />
            </InputSlot>
          )}
        </Input>
      </Box>

      <HStack className="mt-3.5 h-11 items-center px-4" space="sm">
        {FILTER_CHIPS.map((entry) => (
          <Chip
            key={entry.key}
            label={entry.label}
            active={chip === entry.key}
            onPress={() => setChip(entry.key)}
          />
        ))}
      </HStack>

      {/* This box searches titles, which is a different question to "which page
          says this". The reader who meant the second one is one tap away rather
          than being told their library is empty. */}
      {searching ? (
        <Pressable
          onPress={() =>
            router.push({ pathname: "/search", params: { term: searchTerm } })
          }
          accessibilityRole="button"
          className="mt-1 flex-row items-center gap-2.5 border-b border-hairline px-4 py-2 data-[active=true]:bg-hover"
        >
          <Icon as={TextSearch} size="md" className="text-fg-muted" />
          <Text size="sm" numberOfLines={1} className="flex-1 text-primary">
            {`Search inside documents for “${searchTerm}”`}
          </Text>
        </Pressable>
      ) : null}

      {loading ? (
        <Center className="flex-1">
          <Spinner />
        </Center>
      ) : documents.length === 0 ? (
        <Center className="flex-1 px-10">
          <Text size="sm" className="text-center text-fg-subtle">
            {searching
              ? `No titles match “${searchTerm}”.`
              : chip === "device"
                ? "No documents are stored on this device yet."
                : "Nothing here yet."}
          </Text>
        </Center>
      ) : mode === "grid" ? (
        <FlashList
          key="grid"
          style={FILL}
          data={documents}
          numColumns={GRID_COLUMNS}
          keyExtractor={(document) => document.id}
          renderItem={({ item }) => (
            <Box className="pb-[18px]">
              <DocumentTile
                document={item}
                width={tileWidth}
                showProgress={item.progress > 0}
                onPress={openDocument}
                onLongPress={setActing}
              />
            </Box>
          )}
          contentContainerStyle={GRID_PADDING}
          onEndReached={() => {
            if (!searching) {
              loadMore();
            }
          }}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlashList
          key="list"
          style={FILL}
          data={documents}
          keyExtractor={(document) => document.id}
          renderItem={({ item }) => (
            <DocumentRow
              document={item}
              onPress={openDocument}
              onLongPress={setActing}
            />
          )}
          contentContainerStyle={LIST_PADDING}
          ItemSeparatorComponent={RowRule}
          onEndReached={() => {
            if (!searching) {
              loadMore();
            }
          }}
          showsVerticalScrollIndicator={false}
        />
      )}

      <DocumentActions document={acting} onClose={() => setActing(null)} />
    </Screen>
  );
}

/* ── controls ───────────────────────────────────────────────────────── */

function SortControl({
  sort,
  disabled,
  onChange,
}: {
  sort: Sort;
  disabled: boolean;
  onChange: (sort: Sort) => void;
}) {
  return (
    <Menu
      placement="bottom right"
      offset={6}
      trigger={({ ...props }) => (
        <Pressable
          {...props}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={
            disabled
              ? "Sorting is unavailable while a filter is on"
              : `Sort by ${SORT_LABELS[sort]}`
          }
          className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover"
        >
          <Icon
            as={ArrowUpDown}
            size="md"
            className={disabled ? "text-fg-disabled" : "text-foreground"}
          />
        </Pressable>
      )}
    >
      {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
        <MenuItem
          key={key}
          textValue={SORT_LABELS[key]}
          onPress={() => onChange(key)}
        >
          <MenuItemLabel className="text-sm flex-1 text-foreground">
            {SORT_LABELS[key]}
          </MenuItemLabel>
          {key === sort ? (
            <Icon as={Check} size="sm" className="text-primary" />
          ) : null}
        </MenuItem>
      ))}
    </Menu>
  );
}

function ModeToggle({
  icon,
  label,
  active,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>["as"];
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      className={`h-8 w-8 items-center justify-center rounded-md ${active ? "bg-hover" : ""}`}
    >
      <Icon
        as={icon}
        size="sm"
        className={active ? "text-foreground" : "text-fg-subtle"}
      />
    </Pressable>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className={`h-9 items-center justify-center rounded-md border px-3 ${
        active ? "border-primary bg-primary-tint" : "border-border"
      }`}
    >
      <Text size="xs" className={active ? "text-primary" : "text-fg-muted"}>
        {label}
      </Text>
    </Pressable>
  );
}

function RowRule() {
  return <Box className="ml-[82px] h-px bg-hairline" />;
}


const GRID_PADDING = {
  paddingHorizontal: 16,
  paddingTop: 4,
  paddingBottom: 32,
} as const;
const LIST_PADDING = { paddingBottom: 32 } as const;
// A vertical FlashList is a ScrollView underneath, and a ScrollView in a flex
// column with no flex of its own does not get a height to scroll within. Not a
// className: FlashList's own props take styles and are not interop'd.
const FILL = { flex: 1 } as const;
