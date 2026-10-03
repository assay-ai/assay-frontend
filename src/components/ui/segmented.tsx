"use client";

import * as React from "react";

import { cn } from "@/utils";

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === "function") ref(node);
      else (ref as React.MutableRefObject<T | null>).current = node;
    });
  };
}

interface SegmentedContextValue {
  value: string;
  setValue: (value: string) => void;
}

const SegmentedContext = React.createContext<SegmentedContextValue | null>(
  null
);

function useSegmentedContext(component: string) {
  const ctx = React.useContext(SegmentedContext);
  if (!ctx) {
    throw new Error(`<${component}> must be rendered inside <Segmented>`);
  }
  return ctx;
}

export interface SegmentedProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

/**
 * A single-select control (`role="radiogroup"` of `role="radio"` buttons) —
 * mutually exclusive, no associated content panel, unlike `Tabs`. Give it a
 * `value`/`defaultValue` that matches one of its items so roving focus has
 * an initial stop; an unmatched value leaves every item at `tabIndex={-1}`.
 */
const Segmented = React.forwardRef<HTMLDivElement, SegmentedProps>(
  (
    {
      value,
      defaultValue,
      onValueChange,
      className,
      onKeyDown,
      children,
      ...props
    },
    ref
  ) => {
    const [internal, setInternal] = React.useState(defaultValue ?? "");
    const isControlled = value !== undefined;
    const current = isControlled ? value : internal;
    const rootRef = React.useRef<HTMLDivElement | null>(null);

    const setValue = React.useCallback(
      (next: string) => {
        if (!isControlled) setInternal(next);
        onValueChange?.(next);
      },
      [isControlled, onValueChange]
    );

    const contextValue = React.useMemo(
      () => ({ value: current, setValue }),
      [current, setValue]
    );

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }

      const items = Array.from(
        rootRef.current?.querySelectorAll<HTMLButtonElement>(
          '[role="radio"]:not(:disabled)'
        ) ?? []
      );
      if (items.length === 0) return;

      const currentIndex = items.findIndex(
        (item) => item === document.activeElement
      );
      let nextIndex = currentIndex;

      if (event.key === "ArrowRight") {
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      } else if (event.key === "ArrowLeft") {
        nextIndex =
          currentIndex < 0
            ? 0
            : (currentIndex - 1 + items.length) % items.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = items.length - 1;
      }

      event.preventDefault();
      items[nextIndex]?.focus();
      items[nextIndex]?.click();
    };

    return (
      <SegmentedContext.Provider value={contextValue}>
        <div
          ref={mergeRefs(rootRef, ref)}
          role="radiogroup"
          onKeyDown={handleKeyDown}
          className={cn(
            "inline-flex items-center gap-0.5 rounded-md bg-03 p-[3px]",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </SegmentedContext.Provider>
    );
  }
);
Segmented.displayName = "Segmented";

export interface SegmentedItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

const SegmentedItem = React.forwardRef<HTMLButtonElement, SegmentedItemProps>(
  ({ value, className, disabled, ...props }, ref) => {
    const { value: activeValue, setValue } =
      useSegmentedContext("SegmentedItem");
    const selected = activeValue === value;

    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={selected}
        tabIndex={selected ? 0 : -1}
        disabled={disabled}
        onClick={() => setValue(value)}
        className={cn(
          "rounded-sm px-3 py-1.5 text-label-13 transition-colors",
          "disabled:pointer-events-none disabled:opacity-40",
          selected
            ? "bg-01 text-01"
            : "bg-transparent text-02 hover:text-01",
          className
        )}
        {...props}
      />
    );
  }
);
SegmentedItem.displayName = "SegmentedItem";

export { Segmented, SegmentedItem };
