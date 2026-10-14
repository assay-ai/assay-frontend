"use client";

import { Banknote, CirclePause, FileDiff, House, Inbox, Landmark, RadioTower, Settings } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Sidebar. 248px wide at desktop, `$bg-02` fill, `$radius-lg`,
 * 1px `$border-01`.
 *
 * Responsive behaviour: per the design's Foundations "Breakpoints"
 * (Navigation row: "Provider console rail collapses to icons" at tablet), the sidebar is a 64px icon rail from 834px and a full
 * 248px labeled sidebar from 1440px. Below 834 the design gives the
 * provider console no sidebar at all (mobile navigation is a bottom tab
 * bar, a separate component) — this component renders `hidden` below
 * the tablet breakpoint.
 *
 * The design has three row "shapes":
 * - Primary nav (Home, Inbox): sans label, optional trailing count badge.
 * - Bindings (search_web / ais_lookup / vessel_hist in the design): mono
 *   label, icon reflects live-vs-paused status. This is per-agent content,
 *   so it's a data prop, not a fixed list.
 * - Operations (Capital, Money, Policy changes, Account): sans label,
 *   optional trailing count badge — same shape as primary nav.
 *
 * Both "primary nav" and "operations" ARE fixed structurally (the design
 * names them), so those seven rows are hardcoded; only their href/count/
 * active state and the bindings list are props.
 */

function CountBadge({ count }: { count: number }) {
  return (
    <span
      className="hidden h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-danger-500 px-1 desktop:flex"
      aria-hidden="true"
    >
      <span className="text-mono-2xs font-mono font-semibold leading-none text-on-color">{count}</span>
    </span>
  );
}

function Row({
  icon,
  label,
  mono = false,
  active = false,
  count,
  href,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  mono?: boolean;
  active?: boolean;
  count?: number;
  href?: string;
  onClick?: () => void;
}) {
  const Comp: React.ElementType = href ? "a" : "button";
  const extraProps: Record<string, unknown> = href ? { href } : { type: "button" };
  return (
    <Comp
      {...extraProps}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
      className={cn(
        "flex min-h-[36px] w-full items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors",
        "tablet:justify-center tablet:px-0 desktop:justify-start desktop:px-2.5",
        active ? "border-01 bg-01" : "hover:bg-01"
      )}
    >
      <span className={cn("shrink-0 [&_svg]:h-[15px] [&_svg]:w-[15px]", active ? "text-01" : "text-03")}>
        {icon}
      </span>
      <span
        className={cn(
          "hidden min-w-0 flex-1 truncate leading-none desktop:inline",
          mono ? "font-mono" : "font-sans",
          active && "font-semibold",
          active ? "text-01" : "text-02",
          mono ? "text-mono-13" : active ? "text-label-13" : "text-body-13"
        )}
      >
        {label}
      </span>
      {typeof count === "number" && count > 0 && <CountBadge count={count} />}
    </Comp>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="hidden px-2.5 pb-1.5 pt-3.5 desktop:block">
      <span className="text-mono-2xs font-mono uppercase tracking-[1.2px] text-03">{children}</span>
    </div>
  );
}

export interface SidebarBindingItem {
  id: string;
  label: string;
  status: "live" | "paused";
  href?: string;
}

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  activeItemId?: string;
  onNavigate?: (id: string) => void;
  homeHref?: string;
  inboxHref?: string;
  inboxCount?: number;
  bindingsGroupLabel?: string;
  bindings: SidebarBindingItem[];
  operationsGroupLabel?: string;
  capitalHref?: string;
  moneyHref?: string;
  policyChangesHref?: string;
  policyChangesCount?: number;
  accountHref?: string;
  /** Pinned to the bottom of the rail, below the nav rows — the shell's theme toggle. */
  footer?: React.ReactNode;
}

const Sidebar = React.forwardRef<HTMLElement, SidebarProps>(
  (
    {
      className,
      activeItemId,
      onNavigate,
      homeHref,
      inboxHref,
      inboxCount = 0,
      bindingsGroupLabel = "BINDINGS",
      bindings,
      operationsGroupLabel = "OPERATIONS",
      capitalHref,
      moneyHref,
      policyChangesHref,
      policyChangesCount = 0,
      accountHref,
      footer,
      ...props
    },
    ref
  ) => {
    return (
      <nav
        ref={ref}
        aria-label="Provider console"
        className={cn(
          "hidden flex-col gap-0.5 rounded-lg border border-01 bg-02 p-3",
          "tablet:flex tablet:w-16 desktop:w-[248px]",
          className
        )}
        {...props}
      >
        <Row
          icon={<House />}
          label="Home"
          href={homeHref}
          active={activeItemId === "home"}
          onClick={() => onNavigate?.("home")}
        />
        <Row
          icon={<Inbox />}
          label="Inbox"
          href={inboxHref}
          count={inboxCount}
          active={activeItemId === "inbox"}
          onClick={() => onNavigate?.("inbox")}
        />

        <GroupLabel>{bindingsGroupLabel}</GroupLabel>
        {bindings.map((binding) => (
          <Row
            key={binding.id}
            icon={binding.status === "live" ? <RadioTower /> : <CirclePause />}
            label={binding.label}
            mono
            href={binding.href}
            active={activeItemId === binding.id}
            onClick={() => onNavigate?.(binding.id)}
          />
        ))}

        <GroupLabel>{operationsGroupLabel}</GroupLabel>
        <Row
          icon={<Landmark />}
          label="Capital"
          href={capitalHref}
          active={activeItemId === "capital"}
          onClick={() => onNavigate?.("capital")}
        />
        <Row
          icon={<Banknote />}
          label="Money"
          href={moneyHref}
          active={activeItemId === "money"}
          onClick={() => onNavigate?.("money")}
        />
        <Row
          icon={<FileDiff />}
          label="Policy changes"
          href={policyChangesHref}
          count={policyChangesCount}
          active={activeItemId === "policy-changes"}
          onClick={() => onNavigate?.("policy-changes")}
        />
        <Row
          icon={<Settings />}
          label="Account"
          href={accountHref}
          active={activeItemId === "account"}
          onClick={() => onNavigate?.("account")}
        />
        {footer ? <div className="mt-auto flex justify-center pt-3 desktop:justify-start">{footer}</div> : null}
      </nav>
    );
  }
);
Sidebar.displayName = "Sidebar";

export { Sidebar };
