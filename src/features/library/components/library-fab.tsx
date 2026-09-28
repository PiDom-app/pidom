import { FilePlus2, FolderPlus, Plus } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Box } from '@/components/ui/box';
import { Icon } from '@/components/ui/icon';
import { Pressable } from '@/components/ui/pressable';
import { Text } from '@/components/ui/text';
import { palette } from '@/design/tokens';

/**
 * The one control that adds to the library: a corner "+" that opens a small
 * speed-dial.
 *
 * It floats over the list rather than living in it, because "add" is not one
 * more row of content — it is the single thing a reader does to this screen from
 * anywhere in it. The two actions behind it are the only two the app can
 * actually do offline: pull a PDF off the device, and name a collection to hold
 * them. Neither waits on the network, so neither is hidden when there is none.
 *
 * The floating shadow reads on both themes, so its colour is black on either —
 * a cast shadow, not a surface, which is the one thing `tokens.ts` still keeps
 * as a literal for the native `shadow*` props that cannot take a className.
 */
export function LibraryFab({
  onImport,
  onNewCollection,
}: {
  onImport: () => void;
  onNewCollection: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  // The "+" turns into an "×" by rotating through 45°, so one glyph carries both
  // states and the icon never swaps mid-gesture.
  const spin = useSharedValue(0);
  useEffect(() => {
    spin.value = withTiming(open ? 1 : 0, { duration: 160 });
  }, [open, spin]);
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 45}deg` }],
  }));

  const close = () => setOpen(false);
  const runImport = () => {
    close();
    onImport();
  };
  const runNewCollection = () => {
    close();
    onNewCollection();
  };

  return (
    // `box-none` lets taps fall through to the list everywhere except on the
    // scrim and the button themselves.
    <Box className="absolute inset-0" pointerEvents="box-none">
      {open ? (
        <AnimatedPressable
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(140)}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
          className="absolute inset-0 bg-overlay/60"
        />
      ) : null}

      <Box
        className="absolute items-end"
        style={{ right: 20, bottom: insets.bottom + 20 }}
        pointerEvents="box-none"
      >
        {open ? (
          <Animated.View
            entering={FadeInDown.duration(160)}
            exiting={FadeOutDown.duration(120)}
            className="mb-2 items-end"
          >
            <SpeedAction label="Import PDF" icon={FilePlus2} onPress={runImport} />
            <SpeedAction label="New collection" icon={FolderPlus} onPress={runNewCollection} />
          </Animated.View>
        ) : null}

        <Pressable
          onPress={() => setOpen((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Close' : 'Add to library'}
          accessibilityState={{ expanded: open }}
          className="h-14 w-14 items-center justify-center rounded-full bg-primary data-[active=true]:bg-primary-hover"
          style={FAB_SHADOW}
        >
          <Animated.View style={iconStyle}>
            <Icon as={Plus} size="xl" className="text-primary-foreground" />
          </Animated.View>
        </Pressable>
      </Box>
    </Box>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A labelled circle in the speed-dial. The whole row is one tap target. */
function SpeedAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: React.ComponentProps<typeof Icon>['as'];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="mb-4 flex-row items-center justify-end gap-3"
    >
      <Box className="h-9 items-center justify-center rounded-lg border border-border bg-elevated px-3.5">
        <Text size="sm" className="font-medium text-foreground">
          {label}
        </Text>
      </Box>
      <Box
        className="h-12 w-12 items-center justify-center rounded-full border border-border bg-elevated"
        style={ACTION_SHADOW}
      >
        <Icon as={icon} size="md" className="text-foreground" />
      </Box>
    </Pressable>
  );
}

// Native `shadow*`/`elevation` take values, not classNames. Black on both
// themes because a cast shadow is an absence of light, not a surface colour.
const FAB_SHADOW = {
  elevation: 8,
  shadowColor: palette.canvas,
  shadowOpacity: 0.4,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 8 },
} as const;

const ACTION_SHADOW = {
  elevation: 4,
  shadowColor: palette.canvas,
  shadowOpacity: 0.3,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
} as const;
