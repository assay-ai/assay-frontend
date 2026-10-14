import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Search } from "lucide-react";
import * as React from "react";

import { AlertBadge } from "@/components/ui/alert-badge";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/utils";

import { BUYER_NAV_ITEMS, type NavTier } from "./nav-config";

/**
 * Top Bar: 56px tall, `$bg-01` fill, 1px `$border-01` bottom hairline.
 *
 * Composes two other layout components (Alert Badge, Avatar) plus a local, unexported search-field shell that stands in
 * for the design's `Search` component. Top Bar exposes a `search` slot:
 * pass the real Search component and this fallback is not rendered.
 *
 * Responsive behaviour (Foundations "Breakpoints", Navigation row):
 * - mobile (<768): the shell hides this bar for the bottom tab bar.
 * - 768–1439: as many nav items as fit, in tiers (see `nav-config.ts`); the
 *   rest sit behind a "More" menu so no section is ever unreachable. Search
 *   stays hidden (not enough room for a 240px field).
 * - desktop (1440+): full nav (all 8 items) + search, exactly as designed.
 */

function DefaultSearchField({ placeholder }: { placeholder: string }) {
  return (
    <div className="hidden w-[240px] items-center gap-2 rounded-md border border-01 bg-02 px-3 py-2.5 desktop:flex">
      <Search className="h-[15px] w-[15px] shrink-0 text-03" />
      <span className="flex-1 truncate text-body-sm text-03">{placeholder}</span>
      <span className="text-mono-xs font-mono text-03">⌘K</span>
    </div>
  );
}

export interface TopBarNavItem {
  id: string;
  label: string;
  href: string;
  /** Width tier at which the item is inline; absent means desktop only. */
  tier?: NavTier;
}

const DEFAULT_NAV_ITEMS: TopBarNavItem[] = BUYER_NAV_ITEMS;

/*
  Literal class names, one per tier, because Tailwind only emits classes it can
  read in source. They mirror `TOP_BAR_TIERS` (768 / 834 / 1100 / 1440).
*/
const INLINE_CLASS: Record<NavTier, string> = {
  0: "md:inline-flex",
  1: "tablet:inline-flex",
  2: "min-[1100px]:inline-flex",
  3: "desktop:inline-flex",
};
const OVERFLOW_HIDDEN_CLASS: Record<NavTier, string> = {
  0: "md:hidden",
  1: "tablet:hidden",
  2: "min-[1100px]:hidden",
  3: "desktop:hidden",
};

export interface TopBarProps extends React.HTMLAttributes<HTMLElement> {
  navItems?: TopBarNavItem[];
  activeNavId?: string;
  /** Rendered as an <a>; consumer supplies routing (Next Link, etc.) via `linkAs`. */
  linkAs?: React.ElementType;
  alertCount: number;
  onAlertsClick?: () => void;
  avatarName?: string;
  avatarSrc?: string;
  searchPlaceholder?: string;
  /** Overrides the built-in search-field placeholder with a real Search component. */
  search?: React.ReactNode;
  /**
   * Replaces the plain avatar circle with an interactive one — the buyer shell
   * passes `WalletMenu`, which turns it into the account/wallet menu.
   *
   * A slot rather than an `onAvatarClick`, for the same reason `search` is a
   * slot: the menu owns a popover, a signer subscription and a balances query,
   * and none of that belongs to a component whose job is the design's 56px bar.
   * Absent, the design's non-interactive `Avatar` renders exactly as drawn.
   */
  avatar?: React.ReactNode;
  /**
   * Extra controls appended to the right-hand cluster, after the avatar.
   * The design draws no such slot; it exists because the theme toggle has to
   * live somewhere and inventing a second bar would be worse.
   */
  actions?: React.ReactNode;
}

const TopBar = React.forwardRef<HTMLElement, TopBarProps>(
  (
    {
      className,
      navItems = DEFAULT_NAV_ITEMS,
      activeNavId,
      linkAs: LinkComponent = "a",
      alertCount,
      onAlertsClick,
      avatarName = "",
      avatarSrc,
      searchPlaceholder = "Receipt, ULID, tool or tx…",
      search,
      avatar,
      actions,
      ...props
    },
    ref
  ) => {
    return (
      <header
        ref={ref}
        className={cn(
          "flex h-14 w-full items-center gap-6 border-b border-01 bg-01 px-5",
          className
        )}
        {...props}
      >
        <div className="flex shrink-0 items-center gap-2">
          <img src="/images/logo.png" alt="" aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-md object-cover" />
          <span className="text-[17px] font-medium leading-none tracking-[-0.025em] text-01">Assay</span>
        </div>

        <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center gap-1">
          {navItems.map((item) => {
            const active = item.id === activeNavId;
            const tier = item.tier ?? 3;
            return (
              <LinkComponent
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-[11px] py-[7px] text-label-13 font-sans transition-colors",
                  active ? "bg-03 text-01" : "text-02 hover:bg-03",
                  "hidden",
                  INLINE_CLASS[tier]
                )}
              >
                {item.label}
              </LinkComponent>
            );
          })}
          <DropdownMenuPrimitive.Root>
            <DropdownMenuPrimitive.Trigger asChild>
              <button
                type="button"
                className={cn(
                  "hidden items-center gap-1 rounded-md px-[11px] py-[7px] text-label-13 font-sans text-02 transition-colors hover:bg-03 md:inline-flex desktop:hidden",
                  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500"
                )}
              >
                More
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </DropdownMenuPrimitive.Trigger>
            <DropdownMenuPrimitive.Portal>
              <DropdownMenuPrimitive.Content
                align="start"
                sideOffset={6}
                className="z-50 min-w-[168px] overflow-hidden rounded-lg border border-01 bg-01 p-1 shadow-soft"
              >
                {navItems.map((item) => {
                  const active = item.id === activeNavId;
                  return (
                    <DropdownMenuPrimitive.Item
                      key={item.id}
                      asChild
                      className={cn(
                        "flex w-full cursor-pointer select-none items-center rounded-md px-2.5 py-2 text-body-sm outline-none data-[highlighted]:bg-02",
                        active ? "text-01" : "text-02",
                        OVERFLOW_HIDDEN_CLASS[item.tier ?? 3]
                      )}
                    >
                      <LinkComponent href={item.href} aria-current={active ? "page" : undefined}>
                        {item.label}
                      </LinkComponent>
                    </DropdownMenuPrimitive.Item>
                  );
                })}
              </DropdownMenuPrimitive.Content>
            </DropdownMenuPrimitive.Portal>
          </DropdownMenuPrimitive.Root>
        </nav>

        <div className="flex shrink-0 items-center gap-2.5">
          {search ?? <DefaultSearchField placeholder={searchPlaceholder} />}
          <AlertBadge count={alertCount} onClick={onAlertsClick} />
          {avatar ?? <Avatar name={avatarName} src={avatarSrc} size="md" />}
          {actions}
        </div>
      </header>
    );
  }
);
TopBar.displayName = "TopBar";

export { TopBar, DEFAULT_NAV_ITEMS };
