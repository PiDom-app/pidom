import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Theme control, ported from the mobile app's theme-store + web gluestack
 * provider (src/components/ui/gluestack-ui-provider/index.web.tsx + script.ts).
 *
 * Three real modes: light, dark, system. The choice persists to localStorage
 * under the same key the mobile app uses (`pidom.theme`). The `.dark` / `.light`
 * class on <html> is what the token blocks in design/global.css resolve against;
 * the pre-paint script in index.html sets it before first paint to avoid a flash.
 */
export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'pidom.theme';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyMode(mode: ThemeMode): void {
  const resolved = mode === 'system' ? systemTheme() : mode;
  const el = document.documentElement;
  el.classList.remove(resolved === 'light' ? 'dark' : 'light');
  el.classList.add(resolved);
  el.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(
    () => (localStorage.getItem(STORAGE_KEY) as ThemeMode | null) ?? 'system',
  );

  const setMode = useCallback((next: ThemeMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    setModeState(next);
    applyMode(next);
  }, []);

  useEffect(() => {
    applyMode(mode);
    if (mode !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyMode('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  return <ThemeContext.Provider value={{ mode, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
