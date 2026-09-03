import React from 'react';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Box } from '@/components/ui/box';

/**
 * The root of a full-screen route.
 *
 * `SafeAreaView` comes from `react-native-safe-area-context` and is not
 * className-interop'd, so it needs a real style object to fill its parent.
 * That is the one inline style in the app, and it lives here so no screen file
 * has to repeat it — everything else stays in className.
 *
 * `edges` defaults to the top only. A screen that runs content to the bottom
 * of the display, or has a control sitting there, passes `['top', 'bottom']`.
 */
const FILL = { flex: 1 } as const;

export function Screen({
  children,
  edges = ['top'],
  className,
}: {
  children: React.ReactNode;
  edges?: readonly Edge[];
  className?: string;
}) {
  return (
    <Box className={`flex-1 bg-background ${className ?? ''}`}>
      <SafeAreaView style={FILL} edges={edges}>
        {children}
      </SafeAreaView>
    </Box>
  );
}
