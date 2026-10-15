"use client";

import { Banknote, CirclePause, Gavel, House, Inbox, Landmark, RadioTower, Settings, Wrench } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

import { PROVIDER_NAV_ITEMS, type ProviderSectionId } from "./provider-nav-config";

/**
 * The provider console's rail. 248px labelled at desktop (1440), a 64px icon
 * rail from tablet (834), hidden below tablet (the phone gets the top bar and
 * the tab bar instead, see `provider-tab-bar.tsx`).
 *
 * The sections come from `provider-nav-config.ts` (Home, Inbox, Tools,
 * Penalties, Money, Stake, Account), so the rail, the phone tab bar and the
 * tests cannot disagree. A provider's listings sit under Tools, by tool name,
 * so a binding is one click away without a uuid in sight.
 */

export const PROVIDER_NAV_ICONS: Record<ProviderSectionId, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  home: House,
  inbox: Inbox,
  tools: Wrench,
  penalties: Gavel,
  money: Banknote,
  stake: Landmark,
  account: Settings,
};

function CountBadge({ count, tone = "danger" }: { count: number; tone?: "danger" | "primary" }) {
  return (
    <span
      className={cn(
        "flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1",
        "tablet:absolute tablet:right-1 tablet:top-0.5 desktop:static",
        tone === "danger" ? "bg-danger-500" : "bg-primary-400",
      )}
    >
      <span className="font-mono text-mono-2xs font-semibold leading-none text-on-color">{count > 99 ? "99+" : count}</span>
    </span>
  );
}

function Row({
  icon,
  label,
  mono = false,
  nested = false,
  active = false,
  count,
  href,
  linkAs: LinkComponent = "a",
}: {
  icon: React.ReactNode;
  label: string;
  mono?: boolean;
  nested?: boolean;
  active?: boolean;
  count?: number;
  href: string;
  linkAs?: React.ElementType;
}) {
  const accessibleLabel = typeof count === "number" && count > 0 ? `${label}, ${count} need you` : label;
  return (
    <LinkComponent
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={accessibleLabel}
      title={label}
      className={cn(
        "relative flex min-h-[36px] w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
        "tablet:justify-center tablet:px-0 desktop:justify-start desktop:px-2.5",
        nested && "desktop:pl-7",
        active ? "border-01 bg-01" : "hover:bg-01",
      )}
    >
      <span className={cn("shrink-0 [&_svg]:h-[15px] [&_svg]:w-[15px]", active ? "text-01" : "text-03")}>{icon}</span>
      <span
        className={cn(
          "hidden min-w-0 flex-1 truncate leading-none desktop:inline",
          active ? "font-semibold text-01" : "text-02",
          mono ? "text-body-xs" : active ? "text-label-13" : "text-body-13",
        )}
      >
        {label}
      </span>
      {typeof count === "number" && count > 0 ? <CountBadge count={count} /> : null}
    </LinkComponent>
  );
}

export interface SidebarBindingItem {
  id: string;
  /** The tool's name. */
  label: string;
  status: "live" | "paused";
  href: string;
}

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  /** A section id, or a binding id when a binding's page is open. */
  activeItemId?: string;
  /** Badge counts per section (Penalties needing action, unread Inbox). */
  counts?: Partial<Record<ProviderSectionId, number>>;
  /** The provider's listings, shown under Tools. */
  bindings: SidebarBindingItem[];
  /** Above the rows: the "Get listed 2/6" pill until the provider is live. */
  header?: React.ReactNode;
  /** Pinned to the bottom of the rail: the theme toggle. */
  footer?: React.ReactNode;
  /** Pass Next's `Link` to avoid full reloads. */
  linkAs?: React.ElementType;
}

/** At most this many listings in the rail; the rest are on the Tools page. */
const MAX_RAIL_BINDINGS = 6;

const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  ({ className, activeItemId, counts = {}, bindings, header, footer, linkAs, ...props }, ref) => {
    return (
      <nav
        ref={ref}
        aria-label="Provider console"
        className={cn(
          "hidden flex-col gap-0.5 rounded-lg border border-01 bg-02 p-3",
          "tablet:flex tablet:w-16 desktop:w-[248px]",
          className,
        )}
        {...props}
      >
        {header ? <div className="hidden pb-2 desktop:block">{header}</div> : null}
        {PROVIDER_NAV_ITEMS.map((item) => {
          const Icon = PROVIDER_NAV_ICONS[item.id];
          return (
            <React.Fragment key={item.id}>
              <Row
                icon={<Icon />}
                label={item.label}
                href={item.href}
                count={counts[item.id]}
                active={activeItemId === item.id}
                linkAs={linkAs}
              />
              {item.id === "tools"
                ? bindings.slice(0, MAX_RAIL_BINDINGS).map((binding) => (
                    <div key={binding.id} className="hidden desktop:block">
                      <Row
                        icon={binding.status === "live" ? <RadioTower /> : <CirclePause />}
                        label={binding.label}
                        mono
                        nested
                        href={binding.href}
                        active={activeItemId === binding.id}
                        linkAs={linkAs}
                      />
                    </div>
                  ))
                : null}
            </React.Fragment>
          );
        })}
        {footer ? <div className="mt-auto flex justify-center pt-3 desktop:justify-start">{footer}</div> : null}
      </nav>
    );
  },
);
Sidebar.displayName = "Sidebar";

export { Sidebar };
