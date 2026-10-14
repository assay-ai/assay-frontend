"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Toaster } from "sonner";

import { AlertFill, CheckCircle } from "@/components/icons";
import { BottomTabBar, type TabBarTabId } from "@/components/layout/bottom-tab-bar";
import { MobileTopBar } from "@/components/layout/mobile-top-bar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { DEFAULT_NAV_ITEMS, TopBar } from "@/components/layout/top-bar";
import { WalletMenu } from "@/components/layout/wallet-menu";
import { AccountBlockBanner } from "@/features/account-block/account-block-banner";
import { getUnreadCount } from "@/services";
import { useTheme } from "@/providers/ThemeProvider";

/**
 * The buyer shell.
 *
 * Two chromes, one breakpoint (768). Foundations > Breakpoints is explicit: at 390 it
 * is a bottom tab bar with five slots and a top bar shrunk to title, and from
 * 768 up it is the top bar, whose overflow "More" menu keeps every section
 * reachable (see `nav-config.ts`). The design draws both, so
 * this renders both and lets CSS choose — a single desktop bar at every width
 * was the shell not being finished, not a decision.
 *
 * Both are always in the DOM and hidden with `md:` rather than swapped on a
 * measured width, so the first paint is correct at either size and there is no
 * layout jump after hydration.
 */

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/spend": "Spend",
  "/guarantee": "Guarantee",
  "/funding": "Funding",
  "/funding/deposit": "Deposit",
  "/funding/auto-top-up": "Auto top-up",
  "/funding/withdraw": "Withdraw",
  "/funding/escrow": "Escrow",
  "/funding/escrow/limits": "On-chain limits",
  "/limits": "Limits",
  "/alerts": "Alerts",
  "/approvals": "Approvals",
  "/explore/providers": "Explore",
  "/explore/tools": "Explore",
  "/agents": "Agents",
  "/audit-log": "Activity",
  "/statements": "Statements",
  "/team": "Team",
  "/settings": "Settings",
  "/settings/close": "Close account",
  "/connect": "Connect",
  "/onboarding": "Welcome",
};

/** Longest prefix wins, so /funding/withdraw beats /funding. */
function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const match = Object.keys(TITLES)
    .filter((href) => href !== "/" && pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return TITLES[match];
  if (pathname.startsWith("/receipts/")) return "Receipt";
  return "GoAssay.AI";
}

const TAB_FOR_PATH: { prefix: string; id: TabBarTabId }[] = [
  { prefix: "/spend", id: "spend" },
  { prefix: "/funding", id: "funding" },
  { prefix: "/limits", id: "limits" },
];

function tabFor(pathname: string): TabBarTabId {
  if (pathname === "/") return "overview";
  const hit = TAB_FOR_PATH.find((t) => pathname.startsWith(t.prefix));
  return hit ? hit.id : "more";
}

export default function BuyerLayout({ children }: { children: React.ReactNode }) {
  const { themeType } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  // The bell's badge. A failed read shows no badge rather than a wrong one.
  const unread = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: getUnreadCount,
    refetchInterval: 60_000,
    retry: 0,
  });
  const alertCount = unread.data?.count ?? 0;
  const openAlerts = () => router.push("/alerts");

  /*
    Longest href first, so /explore/providers beats /explore, and "/" only wins
    on an exact match — the earlier version skipped href === "/" entirely,
    which meant Overview never highlighted on the screen it owns.
  */
  const activeNavId = [...DEFAULT_NAV_ITEMS]
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))
    .find((item) =>
      item.href === "/" ? pathname === "/" : Boolean(item.href) && pathname.startsWith(item.href!),
    )?.id;

  return (
    <div className="flex min-h-screen flex-col bg-01">
      <div className="hidden md:block">
        <TopBar
          linkAs={Link}
          activeNavId={activeNavId}
          alertCount={alertCount}
          onAlertsClick={openAlerts}
          avatar={<WalletMenu />}
          actions={<ThemeToggle />}
        />
      </div>

      <div className="md:hidden">
        <MobileTopBar
          title={titleFor(pathname)}
          alertCount={alertCount}
          onAlertsClick={openAlerts}
          onSearch={() => router.push("/spend")}
          avatar={<WalletMenu />}
        />
      </div>

      {/* pb-24 keeps the last row clear of the fixed tab bar at mobile widths. */}
      <main className="flex w-full flex-1 flex-col pb-24 md:pb-0">
        {/* Shell level, above every buyer screen: see `features/account-block`. */}
        <AccountBlockBanner wrapperClassName="w-full px-4 pt-4 md:px-6" />
        {children}
      </main>

      <div className="md:hidden">
        <BottomTabBar
          linkAs={Link}
          active={tabFor(pathname)}
          hrefs={{
            overview: "/",
            spend: "/spend",
            funding: "/funding",
            limits: "/limits",
            more: "/settings",
          }}
        />
      </div>

      <Toaster
        theme={themeType}
        position="top-center"
        icons={{
          success: <CheckCircle className="mt-2 text-xl" />,
          error: <AlertFill className="mt-2 text-danger-500" />,
        }}
      />
    </div>
  );
}
