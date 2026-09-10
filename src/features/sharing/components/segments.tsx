import React from 'react';

import { Box } from '@/components/ui/box';
import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
import { Skeleton } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { ArrowLeft } from 'lucide-react-native';

/**
 * The shell every sharing screen wears.
 *
 * Lifted from `navigator-screen.tsx` rather than reinvented, down to the
 * measurements — a back arrow, a glyph, two lines of title, something small on
 * the right, an optional row of chips, and a rule. Four new screens with four
 * slightly different headers would be four screens that look like four
 * different applications.
 *
 * The chip row keeps the two fixes the navigator paid for on a device:
 * `shrink-0` in the className rather than `flexShrink` in a `style` prop, which
 * would replace the class-derived styles instead of merging with them; and
 * `flexGrow: 0` on the content container, without which the row is measured
 * against the scroller and every label loses its last character.
 */
export function ScreenHeader({
  glyph,
  title,
  subtitle,
  trailing,
  onBack,
  backLabel = 'Back',
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  title: string;
  subtitle?: string | null;
  trailing?: React.ReactNode;
  onBack: () => void;
  backLabel?: string;
}) {
  return (
    <HStack className="items-center px-4 pt-3 pb-3">
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={backLabel}
        className="h-9 w-9 items-center justify-center rounded-md data-[active=true]:bg-hover">
        <Icon as={ArrowLeft} size="lg" className="text-foreground" />
      </Pressable>
      <Icon as={glyph} size="md" className="ml-1.5 text-fg-muted" />
      <VStack className="ml-2.5 flex-1">
        <Text size="md" numberOfLines={1} className="font-semibold text-foreground">
          {title}
        </Text>
        {subtitle == null ? null : (
          <Text size="xs" numberOfLines={1} className="mt-0.5 text-fg-subtle">
            {subtitle}
          </Text>
        )}
      </VStack>
      {trailing}
    </HStack>
  );
}

export type SegmentSpec = { key: string; label: string };

/** One of several. A chip, not a sliding control: the labels carry counts and change width. */
export function Segments({
  segments,
  active,
  onSelect,
}: {
  segments: SegmentSpec[];
  active: string;
  onSelect: (key: string) => void;
}) {
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={SEGMENTS}
        contentContainerStyle={SEGMENTS_CONTENT}>
        {segments.map((segment) => {
          const on = segment.key === active;
          return (
            <Pressable
              key={segment.key}
              onPress={() => onSelect(segment.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={segment.label}
              className={
                on
                  ? 'shrink-0 rounded-md bg-primary-tint px-3 py-1.5'
                  : 'shrink-0 rounded-md px-3 py-1.5 data-[active=true]:bg-hover'
              }>
              <Text size="xs" className={on ? 'text-primary' : 'text-fg-muted'}>
                {segment.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Divider className="bg-hairline" />
    </>
  );
}

/**
 * A line the reader need not act on.
 *
 * The `library-notice` shape without the tap: a small glyph, a sentence, and no
 * border. It is where the awkward truths go — that a downloaded copy cannot be
 * recalled, that a group share needs no answer — because those belong in front
 * of somebody before they act rather than in a dialog afterwards.
 */
export function Notice({
  glyph,
  children,
  tone = 'subtle',
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  children: React.ReactNode;
  tone?: 'subtle' | 'destructive';
}) {
  const colour = tone === 'destructive' ? 'text-destructive' : 'text-fg-subtle';
  return (
    <HStack className="items-start px-4 py-2" space="sm">
      <Icon as={glyph} size="xs" className={`mt-0.5 ${colour}`} />
      <Text size="xs" className={`flex-1 ${colour}`}>
        {children}
      </Text>
    </HStack>
  );
}

/**
 * The empty state, centred in whatever space is left.
 *
 * It went through `pt-16`, then `pt-8` and left-aligned, and neither was right.
 * A fixed top padding is a guess about screen height: it put "No groups yet" a
 * third of the way down a tall phone and immediately under the header on a
 * short one, and the left-aligned version read as a paragraph somebody forgot
 * to finish rather than as the state of the screen.
 *
 * `flex-1` with `justify-center` has no guess in it. There is exactly one thing
 * on the screen, so it sits in the middle of the screen, and it stays there
 * whatever the device.
 *
 * **The parent has to have height for that to mean anything.** Inside a
 * `ScrollView` the content container is sized by its children, so `flex-1`
 * collapses and this pins to the top again — which is why the scrolling screens
 * that render it set `flexGrow: 1` on their content style. Rendered as a direct
 * child of `Screen`, it needs nothing.
 */
export function Empty({
  glyph,
  title,
  body,
  action,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  title: string;
  body: string;
  /** The one thing to do about it, when there is one. */
  action?: React.ReactNode;
}) {
  return (
    <VStack className="flex-1 items-center justify-center px-8 py-10">
      <Icon as={glyph} size="xl" className="text-fg-subtle" />
      <Text size="md" className="mt-3.5 text-center font-semibold text-foreground">
        {title}
      </Text>
      <Text size="sm" className="mt-1.5 max-w-[300px] text-center text-fg-muted">
        {body}
      </Text>
      {action === undefined ? null : <Box className="mt-4">{action}</Box>}
    </VStack>
  );
}

/**
 * A row that has not arrived yet.
 *
 * Sharing answered "loading" with a spinner in the middle of the screen, eight
 * times over. The rest of the app answers it with the shape of what is coming —
 * `library-skeleton.tsx` keeps the real headings and greys only the covers — so
 * nothing moves when the answer lands, and the reader can already see they are
 * waiting for a list of people rather than for a screen.
 */
export function PersonRowSkeleton() {
  return (
    <HStack className="items-center px-4 py-2" space="md">
      <Skeleton className="h-10 w-10 rounded-full" />
      <VStack className="flex-1" space="xs">
        <Skeleton className="h-3 w-1/2 rounded-md" />
        <Skeleton className="h-2.5 w-1/3 rounded-md" />
      </VStack>
    </HStack>
  );
}

/** The same, for a document row: a cover-shaped block rather than a face. */
export function ShareRowSkeleton() {
  return (
    <HStack className="items-center px-4 py-2" space="md">
      <Skeleton className="h-14 w-10 rounded-md" />
      <VStack className="flex-1" space="xs">
        <Skeleton className="h-3 w-4/5 rounded-md" />
        <Skeleton className="h-2.5 w-2/5 rounded-md" />
      </VStack>
    </HStack>
  );
}

/**
 * Several of them, which is what a list looks like.
 *
 * Four rows rather than one: a single skeleton row reads as a row, and the
 * point is to show that a *list* is coming.
 */
export function ListSkeleton({
  kind = 'person',
  rows = 4,
}: {
  kind?: 'person' | 'share';
  rows?: number;
}) {
  return (
    <VStack className="pt-1">
      {Array.from({ length: rows }, (_, index) =>
        kind === 'person' ? (
          <PersonRowSkeleton key={index} />
        ) : (
          <ShareRowSkeleton key={index} />
        ),
      )}
    </VStack>
  );
}

/** A labelled run of rows. Separated by a rule, not boxed in a card. */
/**
 * A labelled run of rows, at the density the rest of the app uses.
 *
 * `pt-2.5 pb-1` rather than `pt-6 pb-2`, and the callers' dividers drop their
 * `mt-4` to `mt-2` — the rows above them already carry `py-3` of their own. It sounds like fiddling and it is not: those three values
 * are added together at every section boundary, and at the old numbers a
 * settings screen spent 40dp between one row and the next heading. The
 * reference is `search-inside-screen.tsx`, whose results are `py-3.5` rows
 * separated by a hairline and nothing else — the densest list here, and the one
 * nobody has ever called cramped.
 *
 * A heading belongs to the rows under it rather than to the rule over it, which
 * is why almost all of the space is above it.
 */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack>
      <Text size="xs" className="px-4 pt-2.5 pb-1 uppercase tracking-wider text-fg-subtle">
        {title}
      </Text>
      {children}
    </VStack>
  );
}

const SEGMENTS = { flexGrow: 0 } as const;
const SEGMENTS_CONTENT = {
  flexGrow: 0,
  alignItems: 'center',
  paddingHorizontal: 16,
  paddingBottom: 12,
  gap: 6,
} as const;
