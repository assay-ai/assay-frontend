"use client";

import { Plus } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Public Top Bar: 60px tall,
 * `$bg-01` fill, 1px `$border-01` bottom hairline. This is the marketing
 * shell (Why list here / Calculator / Catalogue), distinct
 * from the agent console's `Top Bar` (56px).
 *
 * The two right-side actions are instances of the design's `Button`
 * component — a *different*, current component that already uses
 * the live token names (`$primary-500`, `$text-on-color`,
 * `$radius-md`, `$shadow-hair`). The repo's existing `src/components/ui/
 * button.tsx` is NOT that component: it still references pre-token classes
 * (`bg-primary`, `text-on-color`, `bg-03`, …) that no longer
 * exist in `tailwind.config.js`, so importing it here would render
 * invisible buttons. Both CTAs are built inline against the design's
 * `Button` instead.
 *
 * Responsive behaviour follows the same Foundations "Breakpoints"
 * Navigation row as the agent Top Bar, except that below tablet the nav
 * links drop to a compact second row under the bar instead of disappearing,
 * so they stay reachable on phones.
 */

export interface PublicTopBarNavItem {
  id: string;
  label: string;
  href: string;
}

const DEFAULT_NAV_ITEMS: PublicTopBarNavItem[] = [
  { id: "why-list-here", label: "Why list here", href: "/why-list-here" },
  { id: "calculator", label: "Calculator", href: "/calculator" },
  { id: "catalogue", label: "Catalogue", href: "/catalogue" },
];

export interface PublicTopBarProps extends React.HTMLAttributes<HTMLElement> {
  navItems?: PublicTopBarNavItem[];
  linkAs?: React.ElementType;
  signInHref?: string;
  onSignInClick?: () => void;
  listToolHref?: string;
  onListToolClick?: () => void;
}

const PublicTopBar = React.forwardRef<HTMLElement, PublicTopBarProps>(
  (
    {
      className,
      navItems = DEFAULT_NAV_ITEMS,
      linkAs: LinkComponent = "a",
      signInHref = "/login",
      onSignInClick,
      listToolHref = "/provider/setup",
      onListToolClick,
      ...props
    },
    ref
  ) => {
    return (
      <header
        ref={ref}
        className={cn(
          "flex min-h-[60px] w-full flex-wrap items-center gap-x-[22px] border-b border-01 bg-01 px-7 tablet:h-[60px] tablet:flex-nowrap",
          className
        )}
        {...props}
      >
        <div className="flex shrink-0 items-center gap-2 py-[10px] tablet:py-0">
          <img src="/images/logo.png" alt="" aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-md object-cover" />
          <span className="text-mono-sm font-mono font-semibold text-01">GoAssay.AI</span>
        </div>

        <nav
          aria-label="Primary"
          className="order-last flex w-full basis-full items-center gap-[22px] overflow-x-auto pb-3 tablet:order-none tablet:w-auto tablet:basis-auto tablet:min-w-0 tablet:flex-1 tablet:overflow-visible tablet:pb-0"
        >
          {navItems.map((item) => (
            <LinkComponent
              key={item.id}
              href={item.href}
              className={cn(
                "inline-flex whitespace-nowrap text-body-13 font-sans text-02 hover:text-01"
              )}
            >
              {item.label}
            </LinkComponent>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2.5 py-[10px] tablet:py-0">
          <a
            href={signInHref}
            onClick={onSignInClick}
            className="rounded-md bg-transparent px-[14px] py-[9px] text-label-sm font-sans text-02 shadow-hair hover:text-01"
          >
            Sign in
          </a>
          <a
            href={listToolHref}
            onClick={onListToolClick}
            className="flex items-center gap-[7px] rounded-md bg-primary-400 px-[14px] py-[9px] text-label-sm font-sans text-on-primary shadow-hair hover:bg-primary-300"
          >
            <Plus className="h-[15px] w-[15px]" />
            List a tool
          </a>
        </div>
      </header>
    );
  }
);
PublicTopBar.displayName = "PublicTopBar";

export { PublicTopBar, DEFAULT_NAV_ITEMS as DEFAULT_PUBLIC_NAV_ITEMS };
