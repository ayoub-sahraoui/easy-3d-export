/** Light/dark theme with system default; persisted locally. */

import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeState {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = 'modelport:theme';

function systemDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function apply(theme: Theme): 'light' | 'dark' {
  const resolved = theme === 'system' ? (systemDark() ? 'dark' : 'light') : theme;
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.documentElement.style.colorScheme = resolved;
  }
  return resolved;
}

const initial = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system';

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initial,
  resolved: apply(initial),
  setTheme: (theme) => {
    localStorage.setItem(STORAGE_KEY, theme);
    set({ theme, resolved: apply(theme) });
  },
}));

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useThemeStore.getState();
    if (theme === 'system') useThemeStore.setState({ resolved: apply('system') });
  });
}
