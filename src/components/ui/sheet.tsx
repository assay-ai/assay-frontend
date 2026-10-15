"use client";

import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Sheet, following the design's breakpoint rules for dialogs: bottom sheet at
 * mobile (390), centered dialog capped at 560px from tablet (834) up.
 *
 * Built on @radix-ui/react-dialog, which supplies focus trapping,
 * escape-to-close and scroll locking for free — none of that is hand-rolled
 * here.
 *
 * Every sheet shows a visible Close ("X") button by default: Escape, the
 * backdrop and the grabber were the only ways out before, and testers could not
 * find them (the centered tablet+ form has no swipe gesture at all). Pass
 * `showCloseButton={false}` only while closing must be refused (e.g. a wallet
 * prompt is open). `SheetTitle` keeps clear of the button with right padding.
 */

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-overlay-dark backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> {
  /** Default true. Turn off only while the sheet must not close (a signature in flight). */
  showCloseButton?: boolean;
}

const SheetContent = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ className, children, showCloseButton = true, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] w-full flex-col overflow-y-auto rounded-t-xl border border-01 bg-01 tablet:inset-x-auto tablet:inset-y-auto tablet:left-1/2 tablet:top-1/2 tablet:bottom-auto tablet:w-full tablet:max-w-[560px] tablet:-translate-x-1/2 tablet:-translate-y-1/2 tablet:rounded-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom tablet:data-[state=closed]:slide-out-to-bottom-0 tablet:data-[state=open]:slide-in-from-bottom-0 tablet:data-[state=closed]:zoom-out-95 tablet:data-[state=open]:zoom-in-95",
        className
      )}
      {...props}
    >
      <div className="flex w-full shrink-0 justify-center pb-1.5 pt-2.5 tablet:hidden" aria-hidden="true">
        <div className="h-1 w-9 rounded-full bg-04" />
      </div>
      {children}
      {showCloseButton && (
        <SheetPrimitive.Close className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-03 transition-colors hover:bg-02 hover:text-01 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      )}
    </SheetPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = SheetPrimitive.Content.displayName;

const SheetHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex w-full flex-col gap-2.5 px-[18px] pt-2", className)} {...props} />
  )
);
SheetHeader.displayName = "SheetHeader";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("pr-8 text-label-md text-01", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-body-13 text-02", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

const SheetFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div className={cn("flex w-full flex-col gap-2 px-[18px] pb-5 pt-4", className)} ref={ref} {...props} />
  )
);
SheetFooter.displayName = "SheetFooter";

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
