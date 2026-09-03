import React, { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';

import { GluestackUIProvider } from '@/components/ui/gluestack-ui-provider';
import { themeColors, type ThemeName } from '@/design/tokens';
import { useThemeStore } from '@/stores/theme-store';

/**
 * Applies the stored theme choice.
 *
 * `GluestackUIProvider`'s `mode` does the actual work on both platforms: on
 * native it calls `Appearance.setColorScheme`, which is what NativeWind v5
 * resolves `@media (prefers-color-scheme: dark)` against; on web it toggles the
 * `.dark` / `.light` class the same tokens are defined under.
 *
 * The one thing it does not cover is the window background behind the React
 * tree, which shows through during navigation transitions and over-scroll. That
 * is set here from the token mirror.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const resolved = useResolvedTheme();
  const mode = useThemeStore((state) => state.mode);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(themeColors[resolved].background);
  }, [resolved]);

  return <GluestackUIProvider mode={mode}>{children}</GluestackUIProvider>;
}

/**
 * The theme actually in effect, with `system` resolved against the OS.
 *
 * React Native reports an unset OS preference as `'unspecified'` rather than
 * `null`, and light is the right default for a reader: a document is dark ink
 * on a light page unless someone says otherwise.
 */
export function useResolvedTheme(): ThemeName {
  const mode = useThemeStore((state) => state.mode);
  const systemScheme = useColorScheme();

  if (mode !== 'system') {
    return mode;
  }
  return systemScheme === 'dark' ? 'dark' : 'light';
}
