"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Toaster } from "sonner";

import { BuyerBannerStack } from "@/components/buyer-money/buyer-banners";
import { PauseAllButton } from "@/components/buyer-money/pause-all";
import { AlertFill, CheckCircle } from "@/components/icons";
import { BottomTabBar } from "@/components/layout/bottom-tab-bar";
import { MobileTopBar } from "@/components/layout/mobile-top-bar";
import { BuyerSectionTabs } from "@/components/layout/section-tabs";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { BUYER_NAV_ITEMS, sectionFor } from "@/components/layout/nav-config";
import { AlertsMenu } from "@/components/layout/alerts-menu";
import { BuyerSearch } from "@/components/layout/buyer-search";
import { TopBar } from "@/components/layout/top-bar";
import { WalletMenu } from "@/components/layout/wallet-menu";
import { TestnetChip } from "@/components/patterns/testnet-chip";
import { routes } from "@/libs/routes";
import { SettleDebtProvider } from "@/features/buyer-debt/settle-debt-sheet";
import { getUnreadCount } from "@/services";
import { useTheme } from "@/providers/ThemeProvider";

/**
 * The buyer shell.
 *
 * Two chromes, one breakpoint (768): below it a bottom tab bar with the five
 * sections and a top bar shrunk to title + account menu; from 768 up the top
 * bar with the same five sections inline. Sections, their tabs and the
 * account menu's links all come from `nav-config.ts`.
 *
 * Both are always in the DOM and hidden with `md:` rather than swapped on a
 * measured width, so the first paint is correct at either size and there is no
 * layout jump after hydration.
 */

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/spend": "Spend",
  "/spend/calls": "Calls",
  "/guarantee": "Not charged",
  "/funding": "Funding",
  "/limits": "Spending limits",
  "/alerts": "Alerts",
  "/approvals": "Approvals",
  "/explore": "Explore",
  "/agents": "Agents & keys",
  "/audit-log": "Activity log",
  "/statements": "Statements",
  "/team": "Team",
  "/settings": "Settings",
  "/settings/close": "Close account",
  "/connect": "Connect",
  "/connect/preview": "MCP server",
  "/toolsets/mine": "Tool sets",
  "/onboarding": "Get started",
};

/** Longest prefix wins, so /funding/withdraw beats /funding. */
function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  const match = Object.keys(TITLES)
    .filter((href) => href !== "/" && pathname.startsWith(href))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return TITLES[match];
  if (pathname.startsWith("/receipts/view")) return "Receipt";
  return "Assay";
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

  const activeNavId = sectionFor(pathname) ?? undefined;

  return (
    <div className="flex min-h-screen flex-col bg-01">
      <div className="hidden md:block">
        <TopBar
          linkAs={Link}
          activeNavId={activeNavId}
          alertCount={alertCount}
          onAlertsClick={openAlerts}
          alerts={<AlertsMenu count={alertCount} />}
          search={<BuyerSearch />}
          avatar={<WalletMenu />}
          actions={
            <div className="flex items-center gap-1.5">
              {/* Test money is never left to a chain name in small print. */}
              <TestnetChip />
              <PauseAllButton />
              <ThemeToggle />
            </div>
          }
        />
      </div>

      <div className="md:hidden">
        <MobileTopBar
          title={titleFor(pathname)}
          alertCount={alertCount}
          onAlertsClick={openAlerts}
          alerts={<AlertsMenu count={alertCount} variant="mobile" />}
          onSearch={() => router.push(routes.calls())}
          avatar={
            <>
              <TestnetChip compact />
              {/* The same theme switch as the desktop bar, so the choice is reachable at every width. */}
              <ThemeToggle />
              <WalletMenu />
            </>
          }
        />
      </div>

      {/*
        The padding keeps the last row clear of the fixed tab bar at mobile widths:
        the bar's own height plus the home-indicator inset it pads itself by.
      */}
      <main className="flex w-full flex-1 flex-col bg-02 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
        {/* The section's own tabs (Activity, Money, Controls), from nav-config. */}
        <BuyerSectionTabs section={sectionFor(pathname)} />
        {/*
          Shell level, above every buyer screen: blocked, then owed, then
          paused by you — most severe first (`BuyerBannerStack`). The settle
          sheet lives here too, so a call row, a receipt or Spend can open it.
        */}
        <SettleDebtProvider>
          <BuyerBannerStack />
          {children}
        </SettleDebtProvider>
      </main>

      {/* Pinned to the viewport, so the tabs stay in reach while the page scrolls. */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-01 pb-[env(safe-area-inset-bottom)] md:hidden">
        <BottomTabBar
          linkAs={Link}
          active={sectionFor(pathname)}
          hrefs={Object.fromEntries(BUYER_NAV_ITEMS.map((item) => [item.id, item.href]))}
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
