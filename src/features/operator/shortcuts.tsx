"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * The console's keyboard: `?` opens the list, j / k / Enter work through a
 * list's rows (`[data-inbox-row]`, the main action is its `[data-primary]`),
 * and `g` then a letter goes to a page. Ignored while typing, with a dialog
 * open, or with a modifier held.
 */

export const GO_TO: Readonly<Record<string, { label: string; href: string }>> = {
  h: { label: "Home", href: "/operator" },
  p: { label: "Penalties", href: "/operator/cases" },
  b: { label: "Blocks", href: "/operator/blocks" },
};

export const SHORTCUTS: readonly { keys: string[]; what: string }[] = [
  { keys: ["j"], what: "Next row" },
  { keys: ["k"], what: "Previous row" },
  { keys: ["Enter"], what: "The row's main action" },
  ...Object.entries(GO_TO).map(([key, page]) => ({ keys: ["g", key], what: `Go to ${page.label}` })),
  { keys: ["?"], what: "This list" },
];

function ignored(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target as HTMLElement | null;
  return Boolean(target && (target.closest("input, textarea, select, [contenteditable=true]") || target.closest("[role=dialog], [role=menu]")));
}

/** j/k/Enter over `[data-inbox-row]`. Mount once per page that lists rows. */
export function useKeyboardTriage(): void {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (ignored(event)) return;
      if (event.key !== "j" && event.key !== "k" && event.key !== "Enter") return;
      const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-inbox-row]"));
      if (rows.length === 0) return;
      const at = rows.findIndex((row) => row === document.activeElement);
      if (event.key === "Enter") {
        if (at === -1) return;
        event.preventDefault();
        const row = rows[at]!;
        (row.matches("[data-primary]") ? row : row.querySelector<HTMLElement>("[data-primary]"))?.click();
        return;
      }
      event.preventDefault();
      const next = event.key === "j" ? Math.min(rows.length - 1, at + 1) : Math.max(0, at === -1 ? 0 : at - 1);
      rows[next]!.focus();
      rows[next]!.scrollIntoView({ block: "nearest" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** `?` and `g …`, for the whole console. Mounted by the shell, which also opens it from the account menu. */
export function ConsoleShortcuts({ open, onOpenChange: setOpen }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  React.useEffect(() => {
    let pendingG = 0;
    const onKey = (event: KeyboardEvent) => {
      if (ignored(event)) return;
      if (event.key === "?") {
        event.preventDefault();
        setOpen(true);
        return;
      }
      if (event.key === "g") {
        pendingG = Date.now();
        return;
      }
      const page = GO_TO[event.key];
      if (page && Date.now() - pendingG < 1500) {
        event.preventDefault();
        pendingG = 0;
        router.push(page.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, setOpen]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>Anywhere in the console, while not typing in a field.</SheetDescription>
        </SheetHeader>
        <dl className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-[18px] pb-5 pt-4">
          {SHORTCUTS.map((shortcut) => (
            <React.Fragment key={shortcut.keys.join(" ")}>
              <dt className="flex gap-1">
                {shortcut.keys.map((key) => (
                  <kbd key={key} className="min-w-6 rounded border border-02 bg-02 px-1.5 py-0.5 text-center font-mono text-mono-12 text-01">
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="text-body-13 text-02">{shortcut.what}</dd>
            </React.Fragment>
          ))}
        </dl>
      </SheetContent>
    </Sheet>
  );
}
