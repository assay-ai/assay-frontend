import { Search } from "lucide-react";
import * as React from "react";

import { AlertBadge } from "@/components/ui/alert-badge";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/utils";

import { AgentSwitcher, type AgentEnvironment } from "./agent-switcher";

/**
 * Top Bar: 56px tall, `$bg-01` fill, 1px `$border-01` bottom hairline.
 *
 * Composes three other layout components (Agent Switcher, Alert
 * Badge, Avatar) plus a local, unexported search-field shell that stands in
 * for the design's `Search` component. Top Bar exposes a `search` slot:
 * pass the real Search component and this fallback is not rendered.
 *
 * Responsive behaviour (Foundations "Breakpoints", Navigation row):
 * - mobile (<834, no doc "balance" data exists on this node, so omitted):
 *   nav and search hidden, only brand + environment/alert/avatar cluster.
 * - tablet (834–1439): "labels hidden below 3 items" — read as: only the
 *   first 3 nav items are shown, the rest wait for desktop. Search stays
 *   hidden (not enough room for a 240px field once the sidebar accounts for
 *   its own rail).
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
}

const DEFAULT_NAV_ITEMS: TopBarNavItem[] = [
  { id: "overview", label: "Overview", href: "/" },
  { id: "spend", label: "Spend", href: "/spend" },
  { id: "guarantee", label: "Guarantee", href: "/guarantee" },
  { id: "funding", label: "Funding", href: "/funding" },
  { id: "limits", label: "Limits", href: "/limits" },
  { id: "approvals", label: "Approvals", href: "/approvals" },
  { id: "explore", label: "Explore", href: "/explore/providers" },
  { id: "agents", label: "Agents", href: "/agents" },
];

export interface TopBarProps extends React.HTMLAttributes<HTMLElement> {
  navItems?: TopBarNavItem[];
  activeNavId?: string;
  /** Rendered as an <a>; consumer supplies routing (Next Link, etc.) via `linkAs`. */
  linkAs?: React.ElementType;
  environments?: AgentEnvironment[];
  environment: string;
  onEnvironmentChange?: (id: string) => void;
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
      environments,
      environment,
      onEnvironmentChange,
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
          <span className="text-mono-sm font-mono font-semibold tracking-[-0.2px] text-01">GoAssay.AI</span>
        </div>

        <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center gap-1">
          {navItems.map((item, index) => {
            const active = item.id === activeNavId;
            return (
              <LinkComponent
                key={item.id}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-[11px] py-[7px] text-label-13 font-sans transition-colors",
                  active ? "bg-03 text-01" : "text-02 hover:bg-03",
                  "hidden",
                  index < 3 && "tablet:inline-flex",
                  "desktop:inline-flex"
                )}
              >
                {item.label}
              </LinkComponent>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-2.5">
          <AgentSwitcher environments={environments} value={environment} onValueChange={onEnvironmentChange} />
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
