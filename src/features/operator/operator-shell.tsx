"use client";

import { Activity, Gavel, House, LogOut, ShieldBan, Timer, Users, Scale } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OperatorIdentity } from "@/interfaces/operator";
import { toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import { formatClock } from "@/libs/local-time";
import { cn } from "@/utils";

import { activeOperatorNav, operatorNavFor, operatorTitleFor, type OperatorNavId } from "./nav";
import { roleTitle } from "./roles";

/**
 * The operator console's chrome, matching the buyer shell: a 56px top bar
 * from `md` (logo, the sections, then the account menu and the theme toggle
 * on the right), and below it a compact top bar with the bottom tab bar. The
 * Home item carries the "Needs you" count — and only that count.
 */

const ICONS: Record<OperatorNavId, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  home: House,
  penalties: Gavel,
  blocks: ShieldBan,
  arbiter: Scale,
  team: Users,
  activity: Activity,
};

export interface OperatorShellProps {
  identity: OperatorIdentity;
  pathname: string;
  needsYou: number;
  expiresAt: string | null;
  onSignOut: () => void;
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 rounded-full bg-danger-500 px-1.5 py-px font-mono text-mono-2xs font-semibold text-on-color">
      {count > 99 ? "99+" : count}
      <span className="sr-only"> waiting for you</span>
    </span>
  );
}

/** "Session ends 18:40" — red in the last 15 minutes. */
export function SessionChip({ expiresAt, className }: { expiresAt: string | null; className?: string }) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!expiresAt || now === null) return null;
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return null;
  const soon = end - now < 15 * 60_000;
  return (
    <span
      title={`Your operator session ends at ${new Date(end).toUTCString()}. Sign in again after that.`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-label-xs",
        soon ? "bg-danger-10 text-danger-700" : "bg-03 text-02",
        className,
      )}
    >
      <Timer aria-hidden="true" className="size-3" />
      Session ends {formatClock(expiresAt)}
    </span>
  );
}

function AccountMenu({ identity, expiresAt, onSignOut }: Pick<OperatorShellProps, "identity" | "expiresAt" | "onSignOut">) {
  const wallet = identity.walletAddress ? toChecksumAddress(identity.walletAddress) : null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${identity.displayName}`}
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <Avatar name={identity.displayName} size="md" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[280px]">
        <DropdownMenuLabel className="flex flex-col gap-1 py-2">
          <span className="truncate text-label-13 text-01">{identity.displayName}</span>
          <span className="truncate text-body-xs text-02">{roleTitle(identity.roles)}</span>
          {wallet ? <CopyChip value={wallet} label="wallet address" className="self-start" /> : null}
          <SessionChip expiresAt={expiresAt} className="mt-1 self-start" />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} className="gap-2">
          <LogOut aria-hidden="true" className="size-4" />
          Sign out of the console
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OperatorTopBar({ identity, pathname, needsYou, expiresAt, onSignOut }: OperatorShellProps) {
  const items = operatorNavFor(identity.roles);
  const active = activeOperatorNav(pathname);
  return (
    <header className="flex h-14 w-full items-center gap-6 border-b border-01 bg-01 px-5">
      <Link href="/operator" className="flex shrink-0 items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.png" alt="" aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-md object-cover" />
        <span className="text-[17px] font-medium leading-none tracking-[-0.025em] text-01">Assay</span>
        <span className="rounded-sm bg-03 px-1.5 py-0.5 text-label-xs text-02">Operator</span>
      </Link>
      <nav aria-label="Operator console" className="flex min-w-0 flex-1 items-center gap-1">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.id === active ? "page" : undefined}
            className={cn(
              "inline-flex items-center rounded-md px-[11px] py-[7px] text-label-13 transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
              item.id === active ? "bg-03 text-01" : "text-02 hover:bg-03",
            )}
          >
            {item.label}
            {item.id === "home" ? <Badge count={needsYou} /> : null}
          </Link>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-2.5">
        <SessionChip expiresAt={expiresAt} className="hidden desktop:inline-flex" />
        <AccountMenu identity={identity} expiresAt={expiresAt} onSignOut={onSignOut} />
        <ThemeToggle />
      </div>
    </header>
  );
}

export function OperatorMobileTopBar({ identity, pathname, expiresAt, onSignOut }: OperatorShellProps) {
  return (
    <header className="flex w-full items-center gap-3 border-b border-01 bg-01 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <p className="truncate text-label-md text-01">{operatorTitleFor(pathname)}</p>
        <p className="truncate font-mono text-mono-xs text-03">Operator · {roleTitle(identity.roles)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <AccountMenu identity={identity} expiresAt={expiresAt} onSignOut={onSignOut} />
        <ThemeToggle />
      </div>
    </header>
  );
}

export function OperatorBottomTabs({ identity, pathname, needsYou }: Pick<OperatorShellProps, "identity" | "pathname" | "needsYou">) {
  const items = operatorNavFor(identity.roles);
  const active = activeOperatorNav(pathname);
  return (
    <nav
      aria-label="Operator console"
      className="fixed inset-x-0 bottom-0 z-40 flex w-full items-stretch border-t border-01 bg-01 px-1 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2"
    >
      {items.map((item) => {
        const Icon = ICONS[item.id];
        const isActive = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <span className="relative flex size-5 items-center justify-center">
              <Icon aria-hidden="true" className={cn("size-5", isActive ? "text-primary-500" : "text-03")} />
              {item.id === "home" && needsYou > 0 ? (
                <span className="absolute -right-2 -top-1.5 rounded-full bg-danger-500 px-1 font-mono text-mono-2xs font-semibold leading-[14px] text-on-color">
                  {needsYou > 9 ? "9+" : needsYou}
                </span>
              ) : null}
            </span>
            <span className={cn("max-w-full truncate text-label-xs", isActive ? "text-primary-500" : "text-03")}>
              {item.label}
              {item.id === "home" && needsYou > 0 ? <span className="sr-only">, {needsYou} waiting for you</span> : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
