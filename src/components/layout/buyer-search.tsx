"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

import { Search } from "@/components/ui/search";
import { useEntityNames } from "@/hooks/useEntityNames";
import { routes } from "@/libs/routes";

/** What the top-bar search can find, said once so the placeholder never promises more. */
export const BUYER_SEARCH_PLACEHOLDER = "Find a call by id or tool";

/** A call id: a ULID (26 Crockford base-32 characters) or a UUID. */
const CALL_ID = /^([0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Pure: where a search goes. A call id opens its receipt; a tool name (or id)
 * opens Calls filtered to that tool; anything else opens Calls unfiltered.
 */
export function searchTarget(query: string, tools: ReadonlyMap<string, string>): string {
  const text = query.trim();
  if (!text) return routes.calls();
  if (CALL_ID.test(text)) return routes.receipt(text);
  const needle = text.toLowerCase();
  for (const [id, name] of tools) {
    if (id.toLowerCase() === needle || name.toLowerCase() === needle) return routes.calls({ tool: id });
  }
  for (const [id, name] of tools) {
    if (name.toLowerCase().includes(needle) || id.toLowerCase().includes(needle)) return routes.calls({ tool: id });
  }
  return routes.calls();
}

/** The buyer top bar's search: Enter goes to the receipt or the filtered call list. ⌘K / Ctrl+K focuses it. */
export function BuyerSearch() {
  const router = useRouter();
  const names = useEntityNames({ kinds: ["tool"] });
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [value, setValue] = React.useState("");

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form
      role="search"
      className="hidden w-[260px] desktop:flex"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(searchTarget(value, names.index.tool));
        setValue("");
        inputRef.current?.blur();
      }}
    >
      <Search
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={BUYER_SEARCH_PLACEHOLDER}
        aria-label="Find a call by id or tool"
      />
    </form>
  );
}
