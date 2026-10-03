"use client";

import { Moon, Sun } from "lucide-react";
import * as React from "react";

import { IconButton } from "@/components/ui/icon-button";
import { LOCKED_THEME } from "@/providers/ThemeProvider";

const STORAGE_KEY = "app-theme";

/**
 * Light and dark are both supported. Light is currently the only one the
 * app will serve — see `LOCKED_THEME` in ThemeProvider for why and for how
 * to lift it.
 *
 * The design draws no theme control anywhere — every frame is light, and the
 * app shipped hardcoded to dark. This control is therefore OURS, not the
 * design's, and it is deliberately the smallest thing that can do the job: one
 * icon button in the top bar's existing action cluster.
 *
 * The attribute is written directly rather than through React state because
 * the inline script in the document head has already set it before first paint
 * (see src/app/layout.tsx). Going through state here would make the two
 * disagree for one render, which is the flash the script exists to prevent.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = React.useState<"light" | "dark">("dark");

  React.useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(current === "light" ? "light" : "dark");
  }, []);

  const toggle = React.useCallback(() => {
    const next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage disabled; the choice simply will not persist */
    }
    setTheme(next);
  }, []);

  // A control that offers a choice the app will not honour is worse than no
  // control. Rendered again the moment LOCKED_THEME goes back to null. The
  // return sits below every hook so the hook order does not change with it.
  if (LOCKED_THEME) return null;

  return (
    <IconButton
      type="button"
      className={className}
      onClick={toggle}
      aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
      icon={theme === "light" ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    />
  );
}
