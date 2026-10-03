import * as React from "react";

import { cn } from "@/utils";

/**
 * Panel, as drawn in the product design.
 *
 * The design's example content (a "Needs attention" panel with three item
 * rows) is demo content, not a second reusable node — the rows are plain
 * frames, not refs to their own component. Panel is therefore built as a
 * generic surface: a header (title + optional subtitle + optional single
 * action slot, e.g. an icon button) over a divider, and a body slot for
 * whatever list/table/content the screen needs.
 *
 * The design layers two shadows on the panel — `$shadow-hair` at
 * offset(0,1)/blur 2 and a second shadow at offset(0,2)/blur 6/spread -1.
 * `tailwind.config.js`'s `shadow-soft` utility is now transcribed straight
 * from the design as exactly that pair, so Panel uses the plain utility.
 */

const Panel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border border-01 bg-01 shadow-soft",
        className
      )}
      {...props}
    />
  )
);
Panel.displayName = "Panel";

const PanelHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex w-full items-center justify-between gap-4 border-b border-01 px-5 py-4",
        className
      )}
      {...props}
    />
  )
);
PanelHeader.displayName = "PanelHeader";

const PanelTitles = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)} {...props} />
  )
);
PanelTitles.displayName = "PanelTitles";

const PanelTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("truncate text-label-md text-01", className)} {...props} />
  )
);
PanelTitle.displayName = "PanelTitle";

const PanelDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("truncate text-body-xs text-03", className)} {...props} />
  )
);
PanelDescription.displayName = "PanelDescription";

/** Slot for the header's single trailing control, e.g. an icon button. */
const PanelAction = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex shrink-0 items-center", className)} {...props} />
  )
);
PanelAction.displayName = "PanelAction";

const PanelBody = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex w-full flex-col", className)} {...props} />
  )
);
PanelBody.displayName = "PanelBody";

export { Panel, PanelHeader, PanelTitles, PanelTitle, PanelDescription, PanelAction, PanelBody };
