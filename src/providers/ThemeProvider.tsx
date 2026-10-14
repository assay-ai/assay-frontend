"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";

import { THEME_STORAGE_KEY } from "./theme-storage";

export type ThemeType = "light" | "dark";

type ThemeContextType = {
  themeType: ThemeType;
  /** An explicit choice: applied and remembered, so it outranks the system setting from then on. */
  setTheme: (theme: ThemeType) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function useTheme() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

function storedTheme(): ThemeType | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null;
  }
}

function apply(theme: ThemeType) {
  document.documentElement.setAttribute("data-theme", theme);
}

/**
 * Light and dark, both drawn from the landing page's palette (see theme.scss).
 *
 * A stored choice wins; without one the system setting decides and keeps
 * deciding, live, until the person picks. The first paint is already right:
 * the inline script in the root layout sets `data-theme` before React runs, so
 * this provider adopts that attribute on mount instead of re-deciding.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeType, setThemeType] = useState<ThemeType>("light");

  useEffect(() => {
    setThemeType(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = (event: MediaQueryListEvent) => {
      if (storedTheme()) return;
      const next: ThemeType = event.matches ? "dark" : "light";
      apply(next);
      setThemeType(next);
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, []);

  const setTheme = useCallback((theme: ThemeType) => {
    apply(theme);
    setThemeType(theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage disabled; the choice simply will not persist */
    }
  }, []);

  return <ThemeContext.Provider value={{ themeType, setTheme }}>{children}</ThemeContext.Provider>;
}
