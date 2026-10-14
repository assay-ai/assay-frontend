"use client";

import { useConnectWallet, usePrivy, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { personalSign, toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import type { OperatorSessionEnd } from "@/libs/operator-session";
import { requestOperatorChallenge, verifyOperatorSignature } from "@/services/operator.service";

import { SESSION_HOURS, sessionEndMessage, signInErrorMessage, signInWithWallet } from "./sign-in";

/**
 * `/operator` when nobody is signed in: connect a wallet, sign the message.
 *
 * Wallets come through the app's one wallet stack, Privy: `useConnectWallet`
 * connects an injected wallet (MetaMask, or a hardware wallet behind one)
 * without a Privy login, and a user signed in with Privy also sees their
 * embedded wallet in the same `useWallets()` list. Either is asked to
 * `personal_sign` through its own EIP-1193 provider.
 *
 * Signing in here does not sign anyone in to the buyer or provider app, and
 * the reverse: the operator session is its own token under its own key.
 */
export function OperatorSignInScreen({
  lastEnd,
  onSignedIn,
}: {
  lastEnd: OperatorSessionEnd | null;
  onSignedIn: () => void;
}) {
  const { authenticated } = usePrivy();
  const { ready, wallets } = useWallets();
  const { connectWallet } = useConnectWallet();

  const [signingWith, setSigningWith] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function signIn(wallet: ConnectedWallet) {
    setError(null);
    setSigningWith(wallet.address);
    try {
      const provider = await wallet.getEthereumProvider();
      await signInWithWallet(wallet.address, {
        challenge: requestOperatorChallenge,
        sign: (message) => personalSign(provider, wallet.address, message),
        verify: verifyOperatorSignature,
      });
      onSignedIn();
    } catch (e) {
      setError(signInErrorMessage(e));
    } finally {
      setSigningWith(null);
    }
  }

  const notice = sessionEndMessage(lastEnd);

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-heading-md text-01">Operator console</h1>
        <p className="text-body-13 text-02">
          Sign in with the wallet your operator administrator registered for you. This is separate
          from the platform login and does not sign you in or out of it.
        </p>
      </div>

      {notice ? (
        <p className="text-body-13 text-warning-600" role="status">
          {notice}
        </p>
      ) : null}

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Your wallets</PanelTitle>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-3 p-4 tablet:p-5">
          {!ready ? (
            <p className="text-body-13 text-03">Looking for connected wallets…</p>
          ) : wallets.length === 0 ? (
            <p className="text-body-13 text-02">
              No wallet is connected in this browser yet.
            </p>
          ) : (
            <ul className="flex w-full flex-col gap-2">
              {wallets.map((wallet) => (
                <li
                  key={`${wallet.walletClientType}:${wallet.address}`}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-01 p-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-label-13 text-01">{walletLabel(wallet)}</span>
                    <span className="break-all font-mono text-mono-12 text-02">
                      {toChecksumAddress(wallet.address)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    loading={signingWith === wallet.address}
                    disabled={signingWith !== null && signingWith !== wallet.address}
                    onClick={() => void signIn(wallet)}
                  >
                    Sign in with this wallet
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <Button
            type="button"
            variant="secondary"
            className="self-start"
            disabled={signingWith !== null}
            // Through an arrow: handing `connectWallet` the click event drops the chain filter.
            onClick={() => connectWallet({ walletChainType: "ethereum-only" })}
          >
            Connect wallet
          </Button>
          {!authenticated ? (
            <p className="text-body-xs text-03">
              Use MetaMask or another browser wallet (a hardware wallet works through it). If you are
              signed in to Assay, your Privy embedded wallet is listed here too.
            </p>
          ) : null}

          {error ? (
            <p className="text-body-13 text-danger-600" role="alert">
              {error}
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>What signing does</PanelTitle>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-13 text-02">
            <li>
              Your wallet shows a short &ldquo;Sign in to the Assay operator console&rdquo; message.
              Signing it proves you control the wallet. Nothing else.
            </li>
            <li>
              It is not a transaction: nothing is sent on chain, no funds move, and it costs no gas.
            </li>
            <li>
              The message can be used once, within five minutes, and only on this console.
            </li>
            <li>
              Your session lasts {SESSION_HOURS} hours. After that, or if your access is removed,
              you are asked to sign in again. Sign out ends it at once.
            </li>
          </ul>
        </PanelBody>
      </Panel>
    </div>
  );
}

function walletLabel(wallet: ConnectedWallet): string {
  if (wallet.walletClientType === "privy") return "Privy embedded wallet";
  return wallet.meta?.name || wallet.walletClientType || "Wallet";
}
