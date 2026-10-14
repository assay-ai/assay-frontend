"use client";

import {
  useConnectWallet,
  useCreateWallet,
  useLogin,
  usePrivy,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { CopyValue } from "@/features/chain-slashes/copy-value";
import { personalSign, toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import type { OperatorSessionEnd } from "@/libs/operator-session";
import { requestOperatorChallenge, verifyOperatorSignature } from "@/services/operator.service";

import {
  SESSION_HOURS,
  isNotAnOperator,
  privyWalletStep,
  sessionEndMessage,
  signInErrorMessage,
  signInWithWallet,
} from "./sign-in";

/**
 * `/operator` when nobody is signed in. Two ways in, both ending in the same
 * EIP-4361 signature; the operator is always the WALLET ADDRESS that signs.
 *
 *  1. **Sign in with Privy** (email or social). Opens Privy's login if needed,
 *     then signs with the user's Privy embedded EVM wallet — created if the
 *     account has none, as the app does on login. One click, apart from
 *     Privy's own modals. The operator address is the embedded wallet's.
 *  2. **Connect wallet**: an injected wallet (MetaMask, or a hardware wallet
 *     behind one) through Privy's `useConnectWallet`, no Privy login needed.
 *
 * The address is shown before signing and again after a 403, with a copy
 * button, so a new operator can send it to an OPS_ADMIN to be added.
 *
 * Signing in here does not sign anyone in to the buyer or provider app, and
 * operator sign-out never signs out of Privy.
 */
export function OperatorSignInScreen({
  lastEnd,
  onSignedIn,
}: {
  lastEnd: OperatorSessionEnd | null;
  onSignedIn: () => void;
}) {
  const { ready, authenticated, user } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { connectWallet } = useConnectWallet();
  // Privy v3 registers these callbacks on the provider; calling the hook with no
  // argument crashes PrivyProvider ("Cannot destructure property 'onSuccess'").
  const { createWallet } = useCreateWallet({ onSuccess: () => {}, onError: () => {} });

  /** The user chose "Sign in with Privy" and the flow is not finished. */
  const [privyPending, setPrivyPending] = React.useState(false);
  const { login } = useLogin({ onError: () => setPrivyPending(false) });
  const creating = React.useRef(false);

  /** `"privy"` or an external wallet's address while its prompt is open. */
  const [signingWith, setSigningWith] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** The address that signed correctly but is not an operator (403). */
  const [notOperator, setNotOperator] = React.useState<string | null>(null);

  const accountHasEmbeddedWallet =
    user?.linkedAccounts.some(
      (account) =>
        account.type === "wallet" && account.walletClientType === "privy" && account.chainType === "ethereum",
    ) ?? false;
  const step = privyWalletStep({ ready, authenticated, walletsReady, wallets, accountHasEmbeddedWallet });
  const embedded = step.step === "sign" ? step.wallet : null;
  const externalWallets = wallets.filter((wallet) => wallet.walletClientType !== "privy");

  const signIn = React.useCallback(
    async (wallet: ConnectedWallet, via: string) => {
      setError(null);
      setNotOperator(null);
      setSigningWith(via);
      try {
        const provider = await wallet.getEthereumProvider();
        await signInWithWallet(wallet.address, {
          challenge: requestOperatorChallenge,
          sign: (message) => personalSign(provider, wallet.address, message),
          verify: verifyOperatorSignature,
        });
        onSignedIn();
      } catch (e) {
        if (isNotAnOperator(e)) setNotOperator(toChecksumAddress(wallet.address));
        setError(signInErrorMessage(e));
      } finally {
        setSigningWith(null);
      }
    },
    [onSignedIn],
  );

  // Carry "Sign in with Privy" through login and wallet creation to the signature.
  React.useEffect(() => {
    if (!privyPending) return;
    if (step.step === "create" && !creating.current) {
      creating.current = true;
      createWallet()
        .catch((e: unknown) => {
          setPrivyPending(false);
          setError(`Your Privy wallet could not be created: ${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => {
          creating.current = false;
        });
    } else if (step.step === "sign") {
      setPrivyPending(false);
      void signIn(step.wallet, "privy");
    }
  }, [privyPending, step, createWallet, signIn]);

  function startPrivy() {
    setError(null);
    setNotOperator(null);
    setPrivyPending(true);
    if (step.step === "login") login();
  }

  const notice = sessionEndMessage(lastEnd);
  const busy = signingWith !== null || privyPending;

  return (
    <div className="flex w-full max-w-[560px] flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-heading-md text-01">Operator console</h1>
        <p className="text-body-13 text-02">
          Sign in with the wallet your operator administrator registered for you. This is separate
          from the platform session: signing out here does not sign you out of Assay.
        </p>
      </div>

      {notice ? (
        <p className="text-body-13 text-warning-600" role="status">
          {notice}
        </p>
      ) : null}

      {notOperator ? (
        <div role="alert" className="flex w-full flex-col gap-2 rounded-md border border-danger-20 bg-danger-10 p-3">
          <p className="text-label-13 text-01">This wallet is not an Assay operator</p>
          <p className="text-body-13 text-02">
            It signed correctly, but it is not an active operator. Send this address to an operator
            administrator (OPS_ADMIN) to be added, then sign in again.
          </p>
          <AddressLine address={notOperator} />
        </div>
      ) : error ? (
        <p className="text-body-13 text-danger-600" role="alert">
          {error}
        </p>
      ) : null}

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>1. Sign in with Privy</PanelTitle>
            <PanelDescription>email or social login · uses your Privy embedded wallet</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-3 p-4 tablet:p-5">
          {embedded ? (
            <div className="flex flex-col gap-1">
              <span className="text-label-13 text-02">Your operator address (Privy embedded wallet)</span>
              <AddressLine address={toChecksumAddress(embedded.address)} />
            </div>
          ) : authenticated ? (
            <p className="text-body-13 text-02">
              Your Privy wallet is being prepared; its address appears here before anything is signed.
            </p>
          ) : (
            <p className="text-body-13 text-02">
              Opens the Privy login. Your operator address is your Privy wallet&rsquo;s, shown before
              you sign.
            </p>
          )}
          <Button
            type="button"
            className="self-start"
            disabled={!ready || (busy && signingWith !== "privy")}
            loading={signingWith === "privy" || privyPending}
            onClick={startPrivy}
          >
            Sign in with Privy
          </Button>
        </PanelBody>
      </Panel>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>2. Connect wallet</PanelTitle>
            <PanelDescription>MetaMask or another browser wallet; a hardware wallet works through it</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="flex flex-col gap-3 p-4 tablet:p-5">
          {!walletsReady ? (
            <p className="text-body-13 text-03">Looking for connected wallets…</p>
          ) : externalWallets.length === 0 ? (
            <p className="text-body-13 text-02">No browser wallet is connected yet.</p>
          ) : (
            <ul className="flex w-full flex-col gap-2">
              {externalWallets.map((wallet) => (
                <li
                  key={`${wallet.walletClientType}:${wallet.address}`}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-md border border-01 p-3"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-label-13 text-01">
                      {wallet.meta?.name || wallet.walletClientType || "Wallet"}
                    </span>
                    <AddressLine address={toChecksumAddress(wallet.address)} />
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    loading={signingWith === wallet.address}
                    disabled={busy && signingWith !== wallet.address}
                    onClick={() => void signIn(wallet, wallet.address)}
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
            disabled={busy}
            // Through an arrow: handing `connectWallet` the click event drops the chain filter.
            onClick={() => connectWallet({ walletChainType: "ethereum-only" })}
          >
            Connect wallet
          </Button>
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
            <li>The message can be used once, within five minutes, and only on this console.</li>
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

/** A full address, never shortened, with a copy button. */
function AddressLine({ address }: { address: string }) {
  return (
    <CopyValue
      value={address}
      display={address}
      label="address"
      className="max-w-full text-mono-12 text-01 [&>span:first-child]:break-all [&>span:first-child]:whitespace-normal"
    />
  );
}
