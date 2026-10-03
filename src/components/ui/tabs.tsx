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

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(component: string) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error(`<${component}> must be rendered inside <Tabs>`);
  return ctx;
}

export interface TabsProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  (
    { value, defaultValue, onValueChange, className, children, ...props },
    ref
  ) => {
    const [internal, setInternal] = React.useState(defaultValue ?? "");
    const isControlled = value !== undefined;
    const current = isControlled ? value : internal;

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

    return (
      <TabsContext.Provider value={contextValue}>
        <div ref={ref} className={cn(className)} {...props}>
          {children}
        </div>
      </TabsContext.Provider>
    );
  }
);
Tabs.displayName = "Tabs";

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, onKeyDown, children, ...props }, ref) => {
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    const tabs = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]:not(:disabled)'
      ) ?? []
    );
    if (tabs.length === 0) return;

    const currentIndex = tabs.findIndex(
      (tab) => tab === document.activeElement
    );
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex =
        currentIndex < 0 ? 0 : (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }

    event.preventDefault();
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  return (
    <div
      ref={mergeRefs(listRef, ref)}
      role="tablist"
      onKeyDown={handleKeyDown}
      className={cn(
        "flex w-full items-end gap-[26px] border-b border-01",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
TabsList.displayName = "TabsList";

export interface TabsTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ value, className, disabled, ...props }, ref) => {
    const { value: activeValue, setValue } = useTabsContext("TabsTrigger");
    const selected = activeValue === value;

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        id={`tab-${value}`}
        aria-selected={selected}
        aria-controls={`tabpanel-${value}`}
        tabIndex={selected ? 0 : -1}
        disabled={disabled}
        onClick={() => setValue(value)}
        className={cn(
          "flex items-center gap-1.5 border-b-2 pb-[10px] text-label-sm transition-colors",
          "disabled:pointer-events-none disabled:opacity-40",
          selected
            ? "border-b-[var(--text-01)] text-01"
            : "border-transparent text-02 hover:text-01",
          className
        )}
        {...props}
      />
    );
  }
);
TabsTrigger.displayName = "TabsTrigger";

export interface TabsContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  value: string;
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ value, className, ...props }, ref) => {
    const { value: activeValue } = useTabsContext("TabsContent");
    if (activeValue !== value) return null;

    return (
      <div
        ref={ref}
        role="tabpanel"
        id={`tabpanel-${value}`}
        aria-labelledby={`tab-${value}`}
        tabIndex={0}
        className={cn(className)}
        {...props}
      />
    );
  }
);
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
