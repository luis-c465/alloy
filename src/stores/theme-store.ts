import { create } from "zustand";

import { DEFAULT_EDITOR_THEME_DARK, DEFAULT_EDITOR_THEME_LIGHT } from "~/lib/codemirror/editor-themes";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "alloy-theme";
const EDITOR_THEME_LIGHT_KEY = "alloy-editor-theme-light";
const EDITOR_THEME_DARK_KEY = "alloy-editor-theme-dark";
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";

interface ThemeStore {
  theme: ThemeMode;
  resolvedTheme: ResolvedTheme;
  editorThemeLight: string;
  editorThemeDark: string;
  setTheme: (theme: ThemeMode) => void;
  setEditorThemeLight: (theme: string) => void;
  setEditorThemeDark: (theme: string) => void;
  initTheme: () => void;
}

const isBrowser = (): boolean => (
  typeof window !== "undefined" && typeof document !== "undefined"
);

const isThemeMode = (value: string | null): value is ThemeMode => (
  value === "light" || value === "dark" || value === "system"
);

const readStoredTheme = (): ThemeMode => {
  if (!isBrowser()) {
    return "system";
  }

  const storedTheme = window.localStorage.getItem(STORAGE_KEY);
  return isThemeMode(storedTheme) ? storedTheme : "system";
};

const readStoredEditorTheme = (key: string, fallback: string): string => {
  if (!isBrowser()) {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
};

const getSystemTheme = (): ResolvedTheme => {
  if (!isBrowser()) {
    return "light";
  }

  return window.matchMedia(SYSTEM_THEME_QUERY).matches ? "dark" : "light";
};

const resolveTheme = (theme: ThemeMode): ResolvedTheme => (
  theme === "system" ? getSystemTheme() : theme
);

const applyResolvedTheme = (theme: ResolvedTheme) => {
  if (!isBrowser()) {
    return;
  }

  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
};

let removeSystemThemeListener: (() => void) | null = null;

const detachSystemThemeListener = () => {
  removeSystemThemeListener?.();
  removeSystemThemeListener = null;
};

const initialTheme = readStoredTheme();

export const useThemeStore = create<ThemeStore>()((set, get) => ({
  theme: initialTheme,
  resolvedTheme: resolveTheme(initialTheme),
  editorThemeLight: readStoredEditorTheme(EDITOR_THEME_LIGHT_KEY, DEFAULT_EDITOR_THEME_LIGHT),
  editorThemeDark: readStoredEditorTheme(EDITOR_THEME_DARK_KEY, DEFAULT_EDITOR_THEME_DARK),
  setTheme: (theme) => {
    const resolvedTheme = resolveTheme(theme);

    if (isBrowser()) {
      window.localStorage.setItem(STORAGE_KEY, theme);
    }

    applyResolvedTheme(resolvedTheme);
    set({ theme, resolvedTheme });

    detachSystemThemeListener();

    if (theme !== "system" || !isBrowser()) {
      return;
    }

    const mediaQuery = window.matchMedia(SYSTEM_THEME_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      if (get().theme !== "system") {
        return;
      }

      const nextResolvedTheme: ResolvedTheme = event.matches ? "dark" : "light";
      applyResolvedTheme(nextResolvedTheme);
      set({ resolvedTheme: nextResolvedTheme });
    };

    mediaQuery.addEventListener("change", handleChange);
    removeSystemThemeListener = () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  },
  setEditorThemeLight: (theme) => {
    if (isBrowser()) {
      window.localStorage.setItem(EDITOR_THEME_LIGHT_KEY, theme);
    }
    set({ editorThemeLight: theme });
  },
  setEditorThemeDark: (theme) => {
    if (isBrowser()) {
      window.localStorage.setItem(EDITOR_THEME_DARK_KEY, theme);
    }
    set({ editorThemeDark: theme });
  },
  initTheme: () => {
    const theme = readStoredTheme();
    get().setTheme(theme);
  },
}));
