"use client";

import { Moon, Sun } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { useTheme } from "@/providers/ThemeProvider";

/**
 * The design draws no theme control anywhere, so this one is ours and kept to
 * the smallest thing that does the job: one icon button in each shell's
 * existing action cluster. State and persistence live in ThemeProvider.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { themeType, setTheme } = useTheme();
  const label = themeType === "light" ? "Switch to dark theme" : "Switch to light theme";

  return (
    <IconButton
      type="button"
      className={className}
      onClick={() => setTheme(themeType === "light" ? "dark" : "light")}
      aria-label={label}
      title={label}
      icon={themeType === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    />
  );
}
