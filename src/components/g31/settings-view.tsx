"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { PageState } from "@/components/patterns/page-state";
import { Panel, PanelBody, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { demoEnabled } from "@/libs/demo/demo-api";

import { KeyValueRow, PageHeader } from "./chrome";

/**
 * Account › Settings: only what is real. Email, how you sign in and your
 * wallets come from Privy (the sign-in provider); nothing here is editable on
 * Assay yet, so there is no Save button and there are no switches that cannot
 * save. Close account sits at the bottom.
 */

const LOGIN_METHOD: Record<string, string> = {
  email: "Email code",
  wallet: "Wallet",
  google_oauth: "Google",
  apple_oauth: "Apple",
  github_oauth: "GitHub",
  twitter_oauth: "X (Twitter)",
  discord_oauth: "Discord",
  passkey: "Passkey",
  phone: "Phone",
};

interface LinkedAccountLike {
  type: string;
  address?: string;
  chainType?: string;
  walletClientType?: string;
}

function walletLabel(account: LinkedAccountLike): string {
  const chain = account.chainType === "solana" ? "Solana" : account.chainType === "ethereum" ? "EVM" : null;
  const kind = account.walletClientType === "privy" ? "created for you" : account.walletClientType ?? null;
  return [chain, kind].filter(Boolean).join(" · ") || "Wallet";
}

export function SettingsView() {
  const { ready, user } = usePrivy();
  const accounts = (user?.linkedAccounts ?? []) as LinkedAccountLike[];
  const email = user?.email?.address ?? null;
  const methods = [...new Set(accounts.map((a) => LOGIN_METHOD[a.type]).filter(Boolean))];
  const wallets = accounts.filter((a) => a.type === "wallet" && a.address);
  // DEMO ONLY: there is no sign-in session to read, so say so instead of "not available".
  const demo = demoEnabled();

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader title="Settings" />

      {!ready && !demo ? (
        <PageState kind="loading" rows={3} label="Loading your account" />
      ) : (
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Your account</PanelTitle>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="px-5 pb-[18px] pt-2">
            {email ? <KeyValueRow label="Email" value={<span className="break-all">{email}</span>} /> : null}
            {methods.length > 0 ? <KeyValueRow label="Signs in with" value={methods.join(", ")} /> : null}
            {wallets.map((wallet, index) => (
              <KeyValueRow
                key={wallet.address}
                label={index === 0 ? (wallets.length === 1 ? "Wallet" : "Wallets") : ""}
                sub={walletLabel(wallet)}
                value={<CopyChip value={wallet.address!} label="wallet address" display={`${wallet.address!.slice(0, 6)}…${wallet.address!.slice(-4)}`} />}
                divider={index < wallets.length - 1}
              />
            ))}
            {wallets.length > 0 ? (
              <p className="pt-2 text-body-xs text-03" data-testid="wallets-purpose">
                Your wallet signs deposits, withdrawals and changes to your on-chain limits. Your Assay balance is not
                kept in it: it sits on chain in an escrow only your wallet controls, so money left in the wallet is not
                part of your balance.
              </p>
            ) : null}
            {!email && methods.length === 0 && wallets.length === 0 ? (
              <p className="py-3 text-body-13 text-02">
                {demo
                  ? "Demo: nobody is signed in here. On a live site this shows your email, how you sign in and your wallets."
                  : "Your sign-in details are not available right now."}
              </p>
            ) : null}
          </PanelBody>
        </Panel>
      )}

      <Link
        href="/settings/close"
        className="flex w-full items-center gap-3 rounded-xl border border-01 bg-01 px-5 py-4 hover:bg-02 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-label-sm text-01">Close account</span>
          <span className="text-body-13 text-03">Withdraw your money and export your records first.</span>
        </div>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-03" />
      </Link>
    </div>
  );
}
