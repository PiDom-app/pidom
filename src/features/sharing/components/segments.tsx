import React from 'react';

import { Divider } from '@/components/ui/divider';
import { HStack } from '@/components/ui/hstack';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { ScrollView } from '@/components/ui/scroll-view';
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
    <HStack className="items-start px-6 py-3" space="sm">
      <Icon as={glyph} size="xs" className={`mt-0.5 ${colour}`} />
      <Text size="xs" className={`flex-1 ${colour}`}>
        {children}
      </Text>
    </HStack>
  );
}

/** The empty state, in the shape the navigator's uses. */
export function Empty({
  glyph,
  title,
  body,
}: {
  glyph: React.ComponentProps<typeof Icon>['as'];
  title: string;
  body: string;
}) {
  return (
    <VStack className="flex-1 items-center px-10 pt-16">
      <Icon as={glyph} size="xl" className="text-fg-subtle" />
      <Text size="md" className="mt-4 text-center font-semibold text-foreground">
        {title}
      </Text>
      <Text size="sm" className="mt-1.5 max-w-[286px] text-center text-fg-muted">
        {body}
      </Text>
    </VStack>
  );
}

/** A labelled run of rows. Separated by a rule, not boxed in a card. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack>
      <Text size="xs" className="px-6 pt-6 pb-2 uppercase tracking-wider text-fg-subtle">
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
  paddingHorizontal: 24,
  paddingBottom: 12,
  gap: 6,
} as const;
