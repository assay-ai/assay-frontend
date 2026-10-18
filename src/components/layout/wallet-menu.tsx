"use client";

import { SkeletonRows } from "@/components/patterns/page-state";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, LogOut, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { appNavigate } from "@/features/oauth/strict-pages";
import * as React from "react";

import { PauseAllConfirm, usePauseAll } from "@/components/buyer-money/pause-all";
import { useFreeOnlyChain } from "@/components/buyer-money/use-buyer-money";
import { ACCOUNT_MENU_LINKS } from "@/components/layout/nav-config";
import { BalanceRows, WalletChainRows } from "@/components/layout/wallet-menu-rows";
import { Avatar } from "@/components/ui/avatar";
import type { FullBalance } from "@/features/g30/balance";
import { useChains } from "@/hooks/useChains";
import { useConnectedAddresses } from "@/hooks/useSigner";
import { clearSessionToken } from "@/libs/ApiClient";
import { demoEnabled } from "@/libs/demo/demo-api";
import { getBalances } from "@/services";
import { cn } from "@/utils";

/**
 * The account menu behind the top bar's avatar.
 *
 * The avatar was inert — `TopBar` took an `avatarName` and drew a circle, and
 * there was nowhere in the buyer shell that answered *which wallet am I signed
 * in as*. Every screen that needs the wallet (deposit, withdraw, stake) reads
 * it through `useSigner`, so the shell can too; this is that hook's one
 * non-signing consumer.
 *
 * **Two numbers that are not the same number, shown as two things.** The
 * address is on chain and the balance is not: `GET /balances` is the
 * platform's ledger position for this account — what routing and spending
 * actually draw on — while the wallet named just above it holds whatever
 * USDC is sitting in its own token account, which the platform neither reads
 * nor can spend. They diverge in normal operation: a deposit that has settled
 * on chain is `DEPOSIT_PENDING` in the ledger until the scheduler's sweep
 * credits it, so for those minutes the wallet is down and `available` has not
 * moved yet. Labelling the section "Platform balance" and linking Funding is
 * the whole defence against reading one as the other.
 *
 * **No RPC call.** Showing the wallet's own token balance would mean a
 * browser-side RPC read, and the endpoint this app can put in a bundle is
 * public devnet, which rate-limits — `libs/chains/solana/chains.ts` says in as many
 * words not to build a poll on it. A menu that opens on every page is a poll.
 *
 * **Five signer states, not two.** `hydrating` is not "no wallet": telling a
 * user who has a wallet that they have none is a state with no button that
 * fixes it. See `useSigner`'s module doc — every row renders each one
 * distinctly, and per chain.
 *
 * **One wallet row per chain, never one "your wallet".** The rows and
 * the balance pairs live in `wallet-menu-rows.tsx`: `useSigner` is a hook, so
 * "one signer per chain" has to be one component per chain, and the extraction
 * is also what lets a test render them without Radix or a `PrivyProvider`.
 *
 * **No hardcoded explorer.** `EXPLORER_CLUSTER` and a template literal pinned
 * to `explorer.solana.com/?cluster=devnet` are gone; each row builds its link
 * from the `explorerBaseUrl` the API served for that chain.
 */

const ITEM_CLASS = cn(
  "flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 outline-none",
  "text-body-sm text-01 data-[highlighted]:bg-02",
);

export function WalletMenu({ className }: { className?: string }) {
  const [open, setOpen] = React.useState(false);
  const pause = usePauseAll();
  const [confirmPause, setConfirmPause] = React.useState(false);
  /*
    The avatar's initials and colour are derived from the wallet address, which
    exists only in the browser — so the server renders "?" on an indigo circle
    and the client's first render wanted "3" on a green one. React hydration
    compares the FIRST client render against the server HTML and threw #418
    (a real error in this build's console, not a theoretical one). Deferring
    the seed to after mount makes the first client render identical to the
    server's; the real identity lands one frame later.
  */
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { ready, authenticated, user, logout } = usePrivy();
  /*
    The enabled set, once. Every wallet row and every balance label is named
    from it — never from a constant in this bundle.
  */
  const chainsResult = useChains();
  /*
    A count and an identity seed, not a signer: "how many wallets do I have" is
    not a per-chain question. The rows below each hold their own
    `useSigner({ chainId })`.
  */
  const addresses = useConnectedAddresses();
  const email = user?.email?.address ?? null;

  /*
    Same `["balances"]` key the Funding screens use, so opening the menu on
    /funding reads their cache instead of firing a second request. `enabled`
    keeps it from firing at all on the screens that do not need it: an
    unauthenticated read 401s, and a 401 signs the user out
    (`PrivySessionBridge`), so a menu that fetched eagerly during Privy's
    hydration would log people out for opening the app.
  */
  const balancesQuery = useQuery<{ balances: FullBalance[] }>({
    queryKey: ["balances"],
    queryFn: () => getBalances() as Promise<{ balances: FullBalance[] }>,
    // DEMO ONLY: no Privy session exists, and the demo answers /balances itself.
    enabled: open && (demoEnabled() || (ready && authenticated)),
    retry: 0,
    networkMode: "always" as const,
  });
  // A chain that serves free calls only takes no deposit: no "Add funds" there.
  const freeOnly = useFreeOnlyChain({ enabled: open && (demoEnabled() || (ready && authenticated)) });


  /*
    The same three steps `PrivySessionBridge` runs on a 401, in the same order
    and for the same reason: a cleared local token with a live Privy session
    silently re-authenticates on the next mount. `logout()` is awaited here —
    unlike the 401 path, nothing is racing a redirect.
  */
  const signOut = React.useCallback(async () => {
    clearSessionToken();
    queryClient.clear();
    try {
      await logout();
    } catch {
      // Best effort: a failed Privy logout must not strand the user signed in
      // locally with a cleared token.
    }
    // From a strict page (the consent page) a full load: sign-in's captcha does not run under its policy.
    appNavigate(router, "/login", { replace: true });
  }, [logout, queryClient, router]);

  return (
    <>
    <PauseAllConfirm
      open={confirmPause}
      onOpenChange={setConfirmPause}
      pausing={!pause.paused}
      onConfirm={() => pause.mutation.mutateAsync(!pause.paused)}
    />
    <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          // Gated on `mounted` for the same reason the avatar seed is: an
          // attribute that differs between the server HTML and the first client
          // render is a hydration mismatch too.
          /*
            A COUNT, not "wallet 7xKX…". With two namespaces there is no single
            "your wallet", and naming one of them in the label is the same
            defect the per-chain rows exist to avoid. Still gated on `mounted`: the label
            is derived from browser-only state and an attribute that differs
            between the server HTML and the first client render is a hydration
            mismatch (React #418 was a real error in this build's console).
          */
          aria-label={
            !mounted || addresses.length === 0
              ? "Account"
              : addresses.length === 1
                ? `Account, wallet ${addresses[0]}`
                : `Account, ${addresses.length} wallets`
          }
          className={cn(
            "rounded-full outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
            className,
          )}
        >
          <Avatar
            name={mounted ? (email ?? addresses[0] ?? "") : ""}
            // The face is the wallet's: seeded by address, so it never changes with the email.
            seed={mounted ? addresses[0] : undefined}
            size="md"
          />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="end"
          sideOffset={6}
          className={cn(
            "z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-[264px] overflow-y-auto rounded-lg border border-01 bg-01 p-1 shadow-soft",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
          )}
        >
          <div className="px-2.5 pb-1.5 pt-2">
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3.5 w-3.5 text-03" aria-hidden="true" />
              <span className="text-label-xs uppercase tracking-[0.4px] text-03">
                {/*
                  "Wallets", plural and unqualified. It used to read "Embedded
                  wallet" / "External wallet" for the ONE signer this menu had;
                  with a signer per chain those two facts are per row, and a
                  single heading naming one of them describes the wrong wallet
                  as soon as the second namespace has one. The cluster badge
                  that sat on the right is gone for the same reason — it said
                  "devnet" over every chain, from a constant.
                */}
                Wallets
              </span>
            </div>
            {email && <p className="mt-1 truncate text-body-xs text-02">{email}</p>}
          </div>

          {chainsResult.status === "loading" ? (
            <p className="px-2.5 py-2 text-body-sm text-02">Reading the chain list…</p>
          ) : chainsResult.chains.length === 0 ? (
            /*
              `.length`, never the array — an array is always truthy. And the
              two empty cases are NOT the same sentence: "we could not ask" has
              a retry and "this deployment offers no chain" does not.
            */
            <p className="px-2.5 py-2 text-body-sm text-02">
              {chainsResult.status === "error"
                ? "We could not read which chains are available."
                : "No chains are available yet."}
            </p>
          ) : (
            <WalletChainRows chains={chainsResult.chains} />
          )}

          <div className="-mx-1 my-1 h-px bg-03" role="separator" />

          <div className="px-2.5 pb-0.5 pt-1">
            <span className="text-label-xs uppercase tracking-[0.4px] text-03">
              Platform balance
            </span>
          </div>
          {balancesQuery.isPending && open ? (
            <SkeletonRows rows={1} className="px-2.5 py-1.5" />
          ) : balancesQuery.isError ? (
            <p className="px-2.5 py-1.5 text-body-xs text-danger-500">Balance unavailable.</p>
          ) : (
            <BalanceRows balances={balancesQuery.data?.balances} chains={chainsResult.chains} />
          )}

          <div className="-mx-1 my-1 h-px bg-03" role="separator" />

          {freeOnly.freeOnly ? (
            <p className="px-2.5 py-1.5 text-body-xs text-03" data-testid="wallet-menu-free-only">
              Free calls only on {freeOnly.chainName ?? "this chain"}: no funds needed.
            </p>
          ) : (
            <DropdownMenuPrimitive.Item asChild className={ITEM_CLASS}>
              <Link href="/funding?action=deposit">
                <span className="flex-1">Add funds</span>
              </Link>
            </DropdownMenuPrimitive.Item>
          )}
          {pause.available ? (
            <DropdownMenuPrimitive.Item
              onSelect={() => setConfirmPause(true)}
              className={cn(ITEM_CLASS, pause.paused ? "text-01" : "text-danger-500")}
            >
              <span className="flex-1">{pause.paused ? "Resume paid calls" : "Pause all paid calls"}</span>
            </DropdownMenuPrimitive.Item>
          ) : null}

          <div className="-mx-1 my-1 h-px bg-03" role="separator" />

          {/*
            The rare pages: the top bar keeps to the five sections, and these
            live here on every width (the mobile top bar carries this menu too).
          */}
          {ACCOUNT_MENU_LINKS.map((link) => (
            <DropdownMenuPrimitive.Item key={link.id} asChild className={ITEM_CLASS}>
              {link.external ? (
                <a href={link.href} target="_blank" rel="noopener noreferrer">
                  <span className="flex-1">{link.label}</span>
                  <ExternalLink className="h-3.5 w-3.5 text-03" aria-hidden="true" />
                </a>
              ) : (
                <Link href={link.href}>
                  <span className="flex-1">{link.label}</span>
                </Link>
              )}
            </DropdownMenuPrimitive.Item>
          ))}

          <div className="-mx-1 my-1 h-px bg-03" role="separator" />

          <DropdownMenuPrimitive.Item
            onSelect={() => void signOut()}
            className={cn(ITEM_CLASS, "text-danger-500")}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="flex-1">Log out</span>
          </DropdownMenuPrimitive.Item>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
    </>
  );
}
