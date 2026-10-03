import { useThemeSettings } from "@/hooks/useThemeSettings";
import { createContext, ReactNode, useContext, useState } from "react";

export type ThemeType = "light" | "dark";

/**
 * Light-only, by product decision: the design was drawn light and does not
 * hold up in dark.
 *
 * Dark is deliberately NOT deleted — the `[data-theme='dark']` token block in
 * theme.scss, this provider, `useThemeSettings` and `ThemeToggle` all still
 * work. This constant is the one lever: set it to `null` and dark returns
 * exactly as it was, toggle included.
 *
 * While it is set, a stored preference is neither read nor overwritten, so
 * unlocking gives each person back the choice they had made.
 */
export const LOCKED_THEME: ThemeType | null = "light";

type ThemeContextType = {
  themeType: ThemeType;
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

type ThemeProviderProps = {
  children: ReactNode;
};

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeType, setThemeType] = useState<ThemeType>(LOCKED_THEME ?? "light");

  useThemeSettings({
    themeType,
    setTheme: (theme: ThemeType) => setThemeType(theme as ThemeType),
  });

  return (
    <ThemeContext.Provider
      value={{
        themeType,
        // A caller holding the context could otherwise walk straight past the
        // lock. Ignoring the call keeps every path through the app agreeing on
        // one theme.
        setTheme: LOCKED_THEME ? () => {} : setThemeType,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
