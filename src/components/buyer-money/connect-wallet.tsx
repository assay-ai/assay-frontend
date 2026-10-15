"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { Wallet } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";

/**
 * "Connect wallet" as a button, for the moment a sign button is disabled only
 * because the right wallet is not connected. Rendered only when needed, so the
 * Privy hook never runs outside a wallet flow.
 */
export function ConnectWalletButton({ label = "Connect wallet", className }: { label?: string; className?: string }) {
  const { connectWallet } = useConnectWallet();
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      icon={<Wallet aria-hidden="true" />}
      className={className}
      onClick={() => connectWallet({ walletChainType: "ethereum-and-solana" })}
    >
      {label}
    </Button>
  );
}

/** The blocker sentence with the button under it. */
export function ConnectWalletNote({ text }: { text: React.ReactNode }) {
  return (
    <span className="flex flex-col items-start gap-2">
      <span>{text}</span>
      <ConnectWalletButton />
    </span>
  );
}
