import { Search as SearchIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Design: "Search", from the design's "Field Bench".
 *
 * Only one static instance is drawn: a search icon, placeholder copy
 * (the buyer bar says "Find a call by id or tool"), and a "⌘K" kbd hint — verbatim from the
 * bench. Note the ground is `$bg-02`/`$border-01` here, not the `$bg-01`/
 * `$border-02` that Field and Select's boxes use; that is a real, deliberate
 * difference in the design, not a mismatch.
 *
 * No typed/focused state is drawn. Hiding the "⌘K" hint on focus is
 * inferred, not read off the design — without it the hint would sit on top
 * of whatever the user types. It only hides on focus (`peer-focus`), not once
 * there is a value while unfocused — a tab-away-while-filled state would
 * still overlap; the static canvas gives no state to check that edge against.
 */
export interface SearchProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  /** Keyboard shortcut hint shown at the trailing edge, e.g. "⌘K". Verbatim default from the design; pass `null` to hide it. */
  shortcut?: React.ReactNode;
  /** Class name applied to the outer wrapper. */
  wrapperClassName?: string;
}

const Search = React.forwardRef<HTMLInputElement, SearchProps>(
  (
    {
      className,
      wrapperClassName,
      shortcut = "⌘K",
      disabled,
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    return (
      <div
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-01 bg-02 px-3 py-2.5",
          "has-[:focus]:border-[1.5px] has-[:focus]:border-primary-500",
          "has-[:disabled]:opacity-50",
          wrapperClassName
        )}
      >
        <SearchIcon aria-hidden="true" className="size-[15px] shrink-0 text-03" />
        <input
          ref={ref}
          type="search"
          disabled={disabled}
          aria-label={ariaLabel ?? "Search"}
          className={cn(
            "peer w-full min-w-0 flex-1 bg-transparent text-body-sm text-01 outline-none placeholder:text-03 disabled:cursor-not-allowed [&::-webkit-search-cancel-button]:appearance-none",
            className
          )}
          {...props}
        />
        {shortcut ? (
          <span
            aria-hidden="true"
            className="shrink-0 font-mono text-mono-xs text-03 peer-focus:hidden"
          >
            {shortcut}
          </span>
        ) : null}
      </div>
    );
  }
);
Search.displayName = "Search";

export { Search };
