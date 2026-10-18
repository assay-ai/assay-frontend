"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { appNavigate } from "@/features/oauth/strict-pages";
import * as React from "react";

import { shortId } from "@/components/patterns/copy-chip";
import { Search } from "@/components/ui/search";
import { useEntityNames } from "@/hooks/useEntityNames";
import { formatRelative } from "@/libs/utc-time";
import { routes } from "@/libs/routes";
import { listToolCalls, type ToolCall } from "@/services/tool-calls.service";
import { cn } from "@/utils";

/** What the top-bar search can find, said once so the placeholder never promises more. */
export const BUYER_SEARCH_PLACEHOLDER = "Find a call by id or tool";

/** A call id: a ULID (26 Crockford base-32 characters) or a UUID. */
const CALL_ID = /^([0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface SearchSuggestion {
  id: string;
  kind: "tool" | "call";
  label: string;
  hint: string;
  href: string;
}

/**
 * Pure: what the search suggests for `query` — tools whose name contains it
 * (each opens Calls filtered to that tool), then recent calls whose id starts
 * with it (each opens its receipt), and a full call id even when it is not
 * among the recent calls. Nothing is opened until the person picks a row.
 */
export function searchSuggestions(
  query: string,
  tools: ReadonlyMap<string, string>,
  recentCalls: readonly Pick<ToolCall, "intentId" | "toolId" | "createdAt">[] = [],
  toolName: (id: string) => string = (id) => tools.get(id) ?? id,
): SearchSuggestion[] {
  const text = query.trim();
  if (!text) return [];
  const needle = text.toLowerCase();
  const out: SearchSuggestion[] = [];

  const toolHits = [...tools]
    .filter(([id, name]) => name.toLowerCase().includes(needle) || id.toLowerCase() === needle)
    .sort(([, a], [, b]) => Number(!a.toLowerCase().startsWith(needle)) - Number(!b.toLowerCase().startsWith(needle)) || a.localeCompare(b))
    .slice(0, 5);
  for (const [id, name] of toolHits) {
    out.push({ id: `tool:${id}`, kind: "tool", label: name, hint: "Calls to this tool", href: routes.calls({ tool: id }) });
  }

  if (needle.length >= 3) {
    const callHits = recentCalls.filter((call) => call.intentId.toLowerCase().startsWith(needle)).slice(0, 5);
    for (const call of callHits) {
      out.push({
        id: `call:${call.intentId}`,
        kind: "call",
        label: `Call ${shortId(call.intentId)}`,
        hint: `${toolName(call.toolId)} · ${formatRelative(call.createdAt)}`,
        href: routes.receipt(call.intentId),
      });
    }
  }

  if (CALL_ID.test(text) && !out.some((s) => s.kind === "call" && s.href === routes.receipt(text))) {
    out.push({ id: `call:${text}`, kind: "call", label: `Call ${shortId(text)}`, hint: "Open its receipt", href: routes.receipt(text) });
  }
  return out;
}

/**
 * The buyer top bar's search: a combobox. Typing lists matching tools and
 * calls; arrow keys move, Enter opens the highlighted row, Escape closes.
 * Enter with nothing listed does nothing — the list says why. ⌘K / Ctrl+K
 * focuses it.
 */
export function BuyerSearch() {
  const router = useRouter();
  const names = useEntityNames({ kinds: ["tool"] });
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const [value, setValue] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);

  const recent = useQuery({
    queryKey: ["tool-calls", "search-recent"],
    enabled: open,
    retry: 0,
    staleTime: 30_000,
    queryFn: () => listToolCalls({ limit: 100 }),
  });

  const suggestions = React.useMemo(
    () => searchSuggestions(value, names.index.tool, recent.data?.items ?? [], (id) => names.name("tool", id)),
    [value, names, recent.data],
  );

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

  const go = (suggestion: SearchSuggestion | undefined) => {
    if (!suggestion) return;
    appNavigate(router, suggestion.href);
    setValue("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const showList = open && value.trim() !== "";
  const activeId = showList && suggestions[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="relative hidden w-[260px] desktop:block">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          go(suggestions[active]);
        }}
      >
        <Search
          ref={inputRef}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActive((i) => (suggestions.length ? (i + 1) % suggestions.length : 0));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((i) => (suggestions.length ? (i - 1 + suggestions.length) % suggestions.length : 0));
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={BUYER_SEARCH_PLACEHOLDER}
          aria-label="Find a call by id or tool"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
        />
      </form>
      {showList ? (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[340px] overflow-hidden rounded-lg border border-01 bg-01 shadow-lg"
        >
          {suggestions.length === 0 ? (
            <p className="px-3.5 py-3 text-body-13 text-02">
              No tool or recent call matches “{value.trim()}”. Type part of a tool name, or a call id from a receipt.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Suggestions" className="flex flex-col py-1">
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    go(suggestion);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "flex cursor-pointer flex-col gap-0.5 px-3.5 py-2",
                    index === active ? "bg-03" : "",
                  )}
                >
                  <span className={cn("text-body-13 text-01", suggestion.kind === "tool" ? "font-mono" : "")}>
                    {suggestion.label}
                  </span>
                  <span className="text-body-xs text-03">{suggestion.hint}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
