"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as React from "react";

import { useChainTerms } from "@/hooks/useChainTerms";
import { definitionOf, GLOSSARY, type GlossaryKey } from "@/libs/glossary";
import { cn } from "@/utils";

/**
 * A word from the glossary, with its one-sentence definition on hover, focus
 * or tap.
 *
 *   <Term k="escrow">escrow</Term>
 *   <Term k="binding" />            // renders the glossary's own term ("Listing")
 *
 * The definition is always in the DOM (`hidden`) and wired to the trigger
 * with `aria-describedby`, so a screen reader reads it as the term's
 * description whether or not the tooltip is open — and never as part of the
 * surrounding sentence. The tooltip is the visual layer on top: it opens on
 * hover and keyboard focus like any tooltip, and also on tap, because a touch
 * screen has no hover and the people who most need a definition are on
 * phones as often as not.
 *
 * Inside another control (a button row, a link, a checklist step title) use
 * `inline`: it renders a non-interactive span with the definition as its
 * title and description, because a button inside a button is invalid HTML.
 */
export interface TermProps {
  k: GlossaryKey;
  /** Non-interactive, for use inside buttons and links. */
  inline?: boolean;
  children?: React.ReactNode;
  className?: string;
}

/** Whether an element's focus is keyboard focus; false where the selector is not supported. */
export function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return false;
  }
}

export function Term({ k, inline = false, children, className }: TermProps) {
  const { terms } = useChainTerms();
  const entry = { term: GLOSSARY[k].term, definition: definitionOf(k, terms) };
  const id = React.useId();
  const [open, setOpen] = React.useState(false);

  if (inline) {
    return (
      <span
        title={entry.definition}
        className={cn("underline decoration-03 decoration-dotted underline-offset-[3px]", className)}
      >
        {children ?? entry.term}
      </span>
    );
  }

  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root open={open} onOpenChange={setOpen}>
        <TooltipPrimitive.Trigger asChild>
          <button
            type="button"
            aria-describedby={id}
            onClick={(event) => {
              event.preventDefault();
              setOpen((value) => !value);
            }}
            onFocus={(event) => {
              // A sheet focuses its first focusable element when it opens; when that is a term in its
              // description, the definition would sit over the sheet's text until the pointer moved.
              // Open on focus only for keyboard focus (focus-visible); hover and tap still open it.
              if (!isFocusVisible(event.currentTarget)) event.preventDefault();
            }}
            className={cn(
              "inline cursor-help rounded-sm p-0 align-baseline [font:inherit] [color:inherit] underline decoration-03 decoration-dotted underline-offset-[3px]",
              "hover:decoration-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              className,
            )}
          >
            {children ?? entry.term}
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            sideOffset={6}
            collisionPadding={16}
            className={cn(
              "z-50 max-w-[280px] rounded-md border border-01 bg-01 px-3 py-2 shadow-lifted",
              "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            )}
          >
            <span className="block text-label-xs text-01">{entry.term}</span>
            <span className="mt-0.5 block text-body-xs text-02">{entry.definition}</span>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
      {/* `hidden`, not `sr-only`: aria-describedby still reads a hidden element, but an sr-only one is
          also part of the sentence it sits in, so the definition was read (and copied) mid-paragraph. */}
      <span id={id} hidden>
        {entry.definition}
      </span>
    </TooltipPrimitive.Provider>
  );
}
