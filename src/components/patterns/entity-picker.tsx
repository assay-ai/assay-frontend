"use client";

import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

import { shortId } from "./copy-chip";
import { Skeleton } from "./page-state";

/**
 * Pick a tool, agent, provider, organization or wallet by what a person
 * knows — its name, email or address — never by typing a uuid or CAIP id.
 *
 *   const names = useEntityNames({ kinds: ["tool"] });
 *   <EntityPicker
 *     label="Tool"
 *     value={toolId}
 *     onChange={setToolId}
 *     options={Object.entries(...).map(([id, name]) => ({ id, label: name, detail: shortId(id) }))}
 *   />
 *
 *   // Server-side search (operator blocks): pass `search`, which is debounced.
 *   <EntityPicker label="Organization or wallet" search={(q) => lookupOrgs(q)} value={id} onChange={…} />
 *
 * A combobox (ARIA 1.2 pattern): type to filter, arrow keys to move, Enter to
 * pick, Escape to close. `value` is the id; the label shown comes from the
 * options (or `selectedLabel` when the option is not in the current list).
 * `multiple` is deliberately not supported: pick lists of tools use one
 * picker per add, which keeps each choice explicit.
 */
export interface EntityOption {
  id: string;
  /** What the person recognises: a name. */
  label: string;
  /** A muted second line: email, short address, "3 providers". Searched too. */
  detail?: string;
  disabled?: boolean;
}

export interface EntityPickerProps {
  label: string;
  value: string | null;
  onChange: (id: string | null, option: EntityOption | null) => void;
  /** A fixed list, filtered on the client. */
  options?: EntityOption[];
  /** Or a server search, called with the typed text (debounced 250ms). */
  search?: (query: string) => Promise<EntityOption[]>;
  /** The selected entity's label when it is not in `options` (e.g. after a server search). */
  selectedLabel?: string;
  placeholder?: string;
  /** Shown when nothing matches. Default "Nothing matches “…”". */
  emptyText?: (query: string) => string;
  error?: React.ReactNode;
  disabled?: boolean;
  /**
   * Draw the suggestions in the flow, pushing what follows down, instead of
   * over it. For a picker with controls right under it (the Block sheet's
   * "Why" chips), so an open list never covers them.
   */
  inline?: boolean;
  className?: string;
}

/** Pure: case-insensitive match on label and detail, best (prefix) matches first. */
export function filterEntityOptions(options: readonly EntityOption[], query: string): EntityOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  const hits = options.filter((o) => o.label.toLowerCase().includes(q) || o.detail?.toLowerCase().includes(q));
  return hits.sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)));
}

export function EntityPicker({
  label,
  value,
  onChange,
  options = [],
  search,
  selectedLabel,
  placeholder = "Search by name",
  emptyText = (query) => (query ? `Nothing matches “${query}”.` : "Nothing to pick yet."),
  error,
  disabled,
  inline = false,
  className,
}: EntityPickerProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [remote, setRemote] = React.useState<{ query: string; options: EntityOption[]; loading: boolean; ready: boolean }>({
    query: "",
    options: [],
    loading: false,
    ready: false,
  });

  React.useEffect(() => {
    if (!search || !open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setRemote((r) => ({ ...r, loading: true }));
      search(query)
        .then((found) => !cancelled && setRemote({ query, options: found, loading: false, ready: true }))
        .catch(() => !cancelled && setRemote({ query, options: [], loading: false, ready: true }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, query, open]);

  // A server search's answer belongs to the text it was asked for: until the
  // answer for what is typed now arrives, show it as loading rather than the
  // previous (e.g. unfiltered) list.
  const stale = Boolean(search) && (!remote.ready || remote.query !== query);
  const list = search ? (stale ? [] : remote.options) : filterEntityOptions(options, query);
  const selected = options.find((o) => o.id === value) ?? remote.options.find((o) => o.id === value);
  const shownLabel = selected?.label ?? selectedLabel ?? (value ? shortId(value) : "");

  const pick = (option: EntityOption) => {
    if (option.disabled) return;
    onChange(option.id, option);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(list.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter" && open && list[active]) {
      event.preventDefault();
      pick(list[active]!);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className={cn("relative flex w-full flex-col gap-1.5", className)}>
      <label htmlFor={`${id}-input`} className="text-label-13 text-01">
        {label}
      </label>
      <div
        className={cn(
          "flex w-full items-center gap-2 rounded-md border bg-01 px-3 py-2 focus-within:ring-2 focus-within:ring-primary-500",
          error ? "border-danger-500" : "border-02",
          disabled && "opacity-40",
        )}
      >
        <Search aria-hidden="true" className="size-4 shrink-0 text-03" />
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && list[active] ? `${id}-opt-${list[active]!.id}` : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          disabled={disabled}
          placeholder={shownLabel || placeholder}
          value={open ? query : shownLabel}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="w-full min-w-0 bg-transparent text-body-sm text-01 outline-none placeholder:text-03"
        />
        {value && !disabled ? (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => onChange(null, null)}
            className="rounded-sm p-0.5 text-03 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : (
          <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0 text-03" />
        )}
      </div>

      {open ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className={cn(
            "overflow-y-auto rounded-lg border border-01 bg-01 p-1",
            inline ? "max-h-[200px] w-full" : "absolute inset-x-0 top-full z-50 mt-1 max-h-[280px] shadow-soft",
          )}
        >
          {search && (remote.loading || stale) ? (
            <li className="flex flex-col gap-2 px-2.5 py-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3.5 w-1/3" />
            </li>
          ) : list.length === 0 ? (
            <li className="px-2.5 py-2 text-body-13 text-03">{emptyText(query)}</li>
          ) : (
            list.map((option, index) => (
              <li
                key={option.id}
                id={`${id}-opt-${option.id}`}
                role="option"
                aria-selected={option.id === value}
                aria-disabled={option.disabled || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => pick(option)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2",
                  index === active && "bg-02",
                  option.disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-sm text-01">{option.label}</span>
                  {option.detail ? (
                    // An address or id is set in mono; words ("Provider organization") are not.
                    <span className={cn("truncate text-03", /\s/.test(option.detail.trim()) ? "text-body-xs" : "font-mono text-mono-xs")}>
                      {option.detail}
                    </span>
                  ) : null}
                </span>
                {option.id === value ? <Check aria-hidden="true" className="size-4 shrink-0 text-primary-500" /> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}

      {error ? <p className="text-body-xs text-danger-600">{error}</p> : null}
    </div>
  );
}
