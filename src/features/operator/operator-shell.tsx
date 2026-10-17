"use client";

import { Activity, Check, CircleHelp, Gavel, House, Keyboard, LogOut, Moon, Scale, ShieldBan, Sun, Timer, Users, Wrench } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { OperatorIdentity } from "@/interfaces/operator";
import { toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import { STAKE_DEPLOYMENTS } from "@/libs/chains/evm/stake-slashes/deployments";
import type { DemoOperatorPreset } from "@/libs/demo/fixtures-operator";
import { formatClock } from "@/libs/utc-time";
import { useTheme } from "@/providers/ThemeProvider";
import { cn } from "@/utils";

import { needsYouBadgeText } from "./inbox";
import { activeOperatorNav, operatorNavFor, type OperatorNavId } from "./nav";
import { RoleCapabilities, RoleCapabilitiesPanel, roleLimitText, rolePillText } from "./role-intro";
import { roleTitle } from "./roles";

/**
 * The operator console's chrome, matching the buyer shell: a 56px top bar
 * from `md` (logo, the sections, then your role pill and the account menu on
 * the right), and below it a compact top bar (brand and avatar: each page has
 * its own H1) with the bottom tab bar. The Home item carries the "Needs you"
 * count — and only that count.
 *
 * The brand carries a "Testnet" tag while every chain the console signs for is
 * a testnet, and the account menu names the chains (operator review
 * 2026-10-16b, P2-12): which network an action lands on is never hidden.
 *
 * The role pill opens "What can I do?". The account menu holds who you are,
 * the session end, the theme, Keyboard shortcuts and — in the demo — the role
 * switch. The session end shows in the bar only in its last 30 minutes.
 */

const ICONS: Record<OperatorNavId, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  home: House,
  penalties: Gavel,
  blocks: ShieldBan,
  arbiter: Scale,
  tools: Wrench,
  team: Users,
  activity: Activity,
};

export interface OperatorShellProps {
  identity: OperatorIdentity;
  pathname: string;
  needsYou: number;
  expiresAt: string | null;
  onSignOut: () => void;
  /** Demo only: the role being shown, and how to switch it. */
  demo?: { current: DemoOperatorPreset | null; onSwitch: (preset: DemoOperatorPreset) => void } | null;
  /** Opens the keyboard shortcut list. */
  onShortcuts?: () => void;
}

const DEMO_ROLES: readonly { id: DemoOperatorPreset; label: string }[] = [
  { id: "lead", label: "Lead adjudicator" },
  { id: "support", label: "Support / on-call" },
  { id: "admin", label: "Admin" },
];

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      title={`${needsYouBadgeText(count)}: approvals and disputes, as on Home`}
      className="ml-1.5 rounded-full bg-danger-500 px-1.5 py-px text-[11px] font-semibold leading-4 tabular-nums text-on-color"
    >
      <span aria-hidden="true">{count > 99 ? "99+" : count}</span>
      <span className="sr-only">, {needsYouBadgeText(count)}</span>
    </span>
  );
}

/**
 * "Session ends 18:40" — red in the last 15 minutes. `within` (minutes)
 * hides it until then: the bar shows it only near the end.
 */
export function SessionChip({ expiresAt, within, className }: { expiresAt: string | null; within?: number; className?: string }) {
  const [now, setNow] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!expiresAt || now === null) return null;
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return null;
  if (within !== undefined && end - now > within * 60_000) return null;
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
      Session ends {formatClock(expiresAt)} UTC
    </span>
  );
}

/** The chains the console builds and signs calls for: pinned in the bundle, never served. The tag hides at 768-1023px, where the nav needs the room; the menu still names the chain. */
const CHAIN_NAMES = STAKE_DEPLOYMENTS.map((deployment) => deployment.displayName);
const ALL_TESTNET = STAKE_DEPLOYMENTS.length > 0 && STAKE_DEPLOYMENTS.every((deployment) => /testnet/i.test(deployment.displayName));

function NetworkTag() {
  if (!ALL_TESTNET) return null;
  return (
    <span title={`On-chain actions use ${CHAIN_NAMES.join(", ")}`} className="rounded-sm bg-warning-10 px-1.5 py-0.5 text-label-xs text-warning-700 md:max-lg:hidden">
      Testnet
    </span>
  );
}

function AccountMenu({ identity, expiresAt, onSignOut, demo, onShortcuts }: Pick<OperatorShellProps, "identity" | "expiresAt" | "onSignOut" | "demo" | "onShortcuts">) {
  const wallet = identity.walletAddress ? toChecksumAddress(identity.walletAddress) : null;
  const { themeType, setTheme } = useTheme();
  const limit = roleLimitText(identity);
  const [capsOpen, setCapsOpen] = React.useState(false);
  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${identity.displayName}`}
        className="-m-1.5 inline-flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <Avatar name={identity.displayName} size="md" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[280px]">
        <DropdownMenuLabel className="flex flex-col gap-1 py-2">
          <span className="truncate text-label-13 text-01">{identity.displayName}</span>
          <span className="truncate text-body-xs text-02">
            {roleTitle(identity.roles)}
            {limit ? ` · ${limit} per action` : ""}
          </span>
          {wallet ? <CopyChip value={wallet} label="wallet address" className="self-start" /> : null}
          {CHAIN_NAMES.length > 0 ? <span className="text-body-xs text-03">Chain: {CHAIN_NAMES.join(", ")}</span> : null}
          <SessionChip expiresAt={expiresAt} className="mt-1 self-start" />
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCapsOpen(true)} className="touch-target gap-2">
          <CircleHelp aria-hidden="true" className="size-4" />
          What can I do?
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme(themeType === "light" ? "dark" : "light")} className="touch-target gap-2">
          {themeType === "light" ? <Moon aria-hidden="true" className="size-4" /> : <Sun aria-hidden="true" className="size-4" />}
          {themeType === "light" ? "Dark theme" : "Light theme"}
        </DropdownMenuItem>
        {onShortcuts ? (
          <DropdownMenuItem onSelect={onShortcuts} className="touch-target gap-2">
            <Keyboard aria-hidden="true" className="size-4" />
            Keyboard shortcuts
            <span className="ml-auto text-body-xs text-03">?</span>
          </DropdownMenuItem>
        ) : null}
        {demo ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-label-xs text-03">Switch demo role</DropdownMenuLabel>
            {DEMO_ROLES.map((role) => (
              <DropdownMenuItem key={role.id} onSelect={() => demo.onSwitch(role.id)} className="touch-target gap-2">
                <Check aria-hidden="true" className={cn("size-4", demo.current === role.id ? "text-primary-600" : "invisible")} />
                {role.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} className="touch-target gap-2">
          <LogOut aria-hidden="true" className="size-4" />
          Sign out of the console
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Sheet open={capsOpen} onOpenChange={setCapsOpen}>
      <SheetContent aria-describedby={undefined}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle>What can I do?</SheetTitle>
        </SheetHeader>
        <div className="px-1.5 pb-4">
          <RoleCapabilitiesPanel identity={identity} />
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}

function Brand() {
  return (
    <Link href="/operator" className="flex shrink-0 items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/logo.png" alt="" aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-md object-cover" />
      <span className="text-[17px] font-medium leading-none tracking-[-0.025em] text-01">Assay</span>
      <span className="rounded-sm bg-03 px-1.5 py-0.5 text-label-xs text-02">Operator</span>
      <NetworkTag />
    </Link>
  );
}

export function OperatorTopBar({ identity, pathname, needsYou, expiresAt, onSignOut, demo, onShortcuts }: OperatorShellProps) {
  const items = operatorNavFor(identity.roles);
  const active = activeOperatorNav(pathname);
  return (
    <header className="flex h-14 w-full items-center gap-4 border-b border-01 bg-01 px-5 lg:gap-6">
      <Brand />
      <nav aria-label="Operator console" className="flex min-w-0 flex-1 items-center gap-0.5 lg:gap-1">
        {items.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            aria-current={item.id === active ? "page" : undefined}
            className={cn(
              // 40px tall on a tablet or any touch screen; a desktop with a mouse keeps the compact 34px. The bar stays 56px.
              "touch-target inline-flex items-center rounded-md px-[11px] py-[7px] text-label-13 transition-colors max-lg:min-h-10",
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
        <SessionChip expiresAt={expiresAt} within={30} />
        {/* The pill needs ~240px more than the nav leaves at tablet width
            (768-1023px), where it would sit on top of the last nav items; the
            account menu carries the role and "What can I do?" there. */}
        <RoleCapabilities identity={identity}>
          <button
            type="button"
            className="hidden max-w-[260px] truncate rounded-full lg:inline-block border border-01 px-2.5 py-1 text-label-xs text-02 hover:bg-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {rolePillText(identity)}
          </button>
        </RoleCapabilities>
        <AccountMenu identity={identity} expiresAt={expiresAt} onSignOut={onSignOut} demo={demo} onShortcuts={onShortcuts} />
      </div>
    </header>
  );
}

export function OperatorMobileTopBar({ identity, expiresAt, onSignOut, demo, onShortcuts }: OperatorShellProps) {
  return (
    <header className="flex h-12 w-full items-center gap-3 border-b border-01 bg-01 px-4">
      <div className="min-w-0 flex-1">
        <Brand />
      </div>
      <SessionChip expiresAt={expiresAt} within={30} />
      <AccountMenu identity={identity} expiresAt={expiresAt} onSignOut={onSignOut} demo={demo} onShortcuts={onShortcuts} />
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
                <span aria-hidden="true" className="absolute -right-2 -top-1.5 rounded-full bg-danger-500 px-1 text-[10px] font-semibold leading-[14px] tabular-nums text-on-color">
                  {needsYou > 9 ? "9+" : needsYou}
                </span>
              ) : null}
            </span>
            <span className={cn("max-w-full truncate text-label-xs", isActive ? "text-primary-500" : "text-03")}>
              {item.label}
              {item.id === "home" && needsYou > 0 ? <span className="sr-only">, {needsYouBadgeText(needsYou)}</span> : null}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
