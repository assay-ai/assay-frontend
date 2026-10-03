"use client";

import { useEffect, useRef } from "react";

import { Banner, BannerAction } from "@/components/ui/banner";
import { retryWalletLink, useWalletLink } from "@/features/auth/wallet-link";

export interface WalletSetupBannerProps {
  /**
   * Re-run whatever this screen loads. Called ONCE, when the wallet link
   * lands — the screen's request failed only because there was no account
   * yet, so the same request now succeeds.
   */
  onLinked?: () => void;
}

/**
 * What a brand-new account sees instead of "The overview could not be loaded".
 *
 * Rendered by a screen in place of its error banner when the failure was
 * `AUTH_WALLET_NOT_LINKED` — see `isWalletNotLinked`. It is a `Banner`, not a
 * gate: the screen stays mounted and its own empty state stays on the page,
 * which is what lets `onLinked` simply refetch instead of remounting a tree.
 *
 * Two states, because they need opposite things from the reader. While the
 * API is still being asked, there is nothing to do but wait a few seconds.
 * Once the attempt has given up, waiting is the wrong advice — an identity
 * with no Solana wallet at all never resolves on its own.
 */
export function WalletSetupBanner({ onLinked }: WalletSetupBannerProps) {
  const status = useWalletLink();
  const notified = useRef(false);

  useEffect(() => {
    if (status !== "linked" || notified.current) return;
    notified.current = true;
    onLinked?.();
  }, [status, onLinked]);

  if (status === "linked") return null;

  if (status === "unavailable") {
    return (
      <Banner
        tone="warning"
        title="We could not find a wallet on this account"
        description="Your sign-in worked. Connect or create a wallet in your Privy account, then try again — spending and funding stay unavailable until one is linked."
        action={<BannerAction onClick={retryWalletLink}>Try again</BannerAction>}
      />
    );
  }

  return (
    <Banner
      tone="primary"
      title="Setting up your wallet"
      description="Your account is ready. We are waiting for your wallet to finish linking — this takes a few seconds, and the page updates itself."
    />
  );
}
