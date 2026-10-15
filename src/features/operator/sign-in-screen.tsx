"use client";

import {
  useConnectWallet,
  useCreateWallet,
  useLogin,
  usePrivy,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import { Check, Copy } from "lucide-react";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { Button } from "@/components/ui/button";
import { personalSign, toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import { demoEnabled } from "@/libs/demo/demo-api";
import { DEMO_OPERATOR_TOKEN_PREFIX, type DemoOperatorPreset } from "@/libs/demo/fixtures-operator";
import { saveOperatorSession, type OperatorSessionEnd } from "@/libs/operator-session";
import { requestOperatorChallenge, verifyOperatorSignature } from "@/services/operator.service";

import {
  SESSION_HOURS,
  accessRequestText,
  isNotAnOperator,
  privyWalletStep,
  readSignInMethod,
  sessionEndMessage,
  signInErrorMessage,
  signInWithWallet,
  writeSignInMethod,
  type SignInMethod,
} from "./sign-in";

/**
 * `/operator…` when nobody is signed in. One primary way in — "Sign in with
 * your wallet", which opens Privy (email or a wallet in one modal) and signs
 * with the Privy wallet — and a small "Use a browser wallet instead" for an
 * injected wallet (MetaMask, or a hardware wallet behind one). Whichever was
 * used last in this browser is offered first next time.
 *
 * Either way the operator is the WALLET ADDRESS that signs one EIP-4361
 * message: no transaction, no gas. A wallet that signs but is not an operator
 * gets its address and a "Copy access request" to send to an admin.
 *
 * Signing in here does not sign anyone in to the buyer or provider app, and
 * operator sign-out never signs out of Privy.
 */

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const DEMO_PRESETS: readonly { id: DemoOperatorPreset; label: string }[] = [
  { id: "lead", label: "Lead adjudicator" },
  { id: "support", label: "Support / on-call" },
  { id: "admin", label: "Admin" },
];

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

  const [method, setMethod] = React.useState<SignInMethod>("privy");
  React.useEffect(() => setMethod(readSignInMethod(storage())), []);

  /** The user chose the Privy path and it is not finished. */
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
      (account) => account.type === "wallet" && account.walletClientType === "privy" && account.chainType === "ethereum",
    ) ?? false;
  const step = privyWalletStep({ ready, authenticated, walletsReady, wallets, accountHasEmbeddedWallet });
  const externalWallets = wallets.filter((wallet) => wallet.walletClientType !== "privy");

  const signIn = React.useCallback(
    async (wallet: ConnectedWallet, via: SignInMethod, key: string) => {
      setError(null);
      setNotOperator(null);
      setSigningWith(key);
      try {
        const provider = await wallet.getEthereumProvider();
        await signInWithWallet(wallet.address, {
          challenge: requestOperatorChallenge,
          sign: (message) => personalSign(provider, wallet.address, message),
          verify: verifyOperatorSignature,
        });
        writeSignInMethod(storage(), via);
        onSignedIn();
      } catch (e) {
        if (isNotAnOperator(e)) setNotOperator(toChecksumAddress(wallet.address));
        else setError(signInErrorMessage(e));
      } finally {
        setSigningWith(null);
      }
    },
    [onSignedIn],
  );

  // Carry the Privy path through login and wallet creation to the signature.
  React.useEffect(() => {
    if (!privyPending) return;
    if (step.step === "create" && !creating.current) {
      creating.current = true;
      createWallet()
        .catch((e: unknown) => {
          setPrivyPending(false);
          setError(`Your wallet could not be created: ${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => {
          creating.current = false;
        });
    } else if (step.step === "sign") {
      setPrivyPending(false);
      void signIn(step.wallet, "privy", "privy");
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

  const privyButton = (primary: boolean) => (
    <Button
      type="button"
      variant={primary ? "primary" : "secondary"}
      className="w-full"
      disabled={!ready || (busy && signingWith !== "privy")}
      loading={signingWith === "privy" || privyPending}
      onClick={startPrivy}
    >
      {primary ? "Sign in with your wallet" : "Sign in with email or your Privy wallet"}
    </Button>
  );

  const browserWallets = (
    <div className="flex w-full flex-col gap-2">
      {walletsReady && externalWallets.length > 0 ? (
        <ul className="flex w-full flex-col gap-2">
          {externalWallets.map((wallet) => (
            <li
              key={`${wallet.walletClientType}:${wallet.address}`}
              className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-01 bg-01 p-3"
            >
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-label-13 text-01">{wallet.meta?.name || "Browser wallet"}</span>
                <CopyChip value={toChecksumAddress(wallet.address)} label="wallet address" className="self-start" />
              </span>
              <Button
                type="button"
                size="sm"
                loading={signingWith === wallet.address}
                disabled={busy && signingWith !== wallet.address}
                onClick={() => void signIn(wallet, "wallet", wallet.address)}
              >
                Sign in
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant={method === "wallet" && externalWallets.length === 0 ? "primary" : "secondary"}
        className="w-full"
        disabled={busy}
        // Through an arrow: handing `connectWallet` the click event drops the chain filter.
        onClick={() => connectWallet({ walletChainType: "ethereum-only" })}
      >
        {externalWallets.length > 0 ? "Connect another browser wallet" : "Connect a browser wallet"}
      </Button>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[440px] flex-col gap-5 pt-6 tablet:pt-16">
      <div className="flex flex-col items-start gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.png" alt="" aria-hidden="true" className="size-8 rounded-md" />
        <h1 className="text-heading-md text-01">Assay operator console</h1>
        <p className="text-body-13 text-02">Sign in with the wallet your admin registered for you. You sign one message; nothing is sent on chain.</p>
      </div>

      {notice ? (
        <p className="rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-warning-700" role="status">
          {notice}
        </p>
      ) : null}

      {notOperator ? <NotAnOperator address={notOperator} /> : null}
      {error ? (
        <p className="text-body-13 text-danger-600" role="alert">
          {error}
        </p>
      ) : null}

      {method === "privy" ? (
        <div className="flex w-full flex-col gap-3">
          {privyButton(true)}
          <details className="group w-full">
            <summary className="cursor-pointer list-none text-center text-label-13 text-primary-600 hover:underline">
              Use a browser wallet instead
            </summary>
            <div className="pt-3">{browserWallets}</div>
          </details>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-3">
          <p className="text-label-13 text-01">Last time you used a browser wallet</p>
          {browserWallets}
          <details className="group w-full">
            <summary className="cursor-pointer list-none text-center text-label-13 text-primary-600 hover:underline">
              Use email or your Privy wallet instead
            </summary>
            <div className="pt-3">{privyButton(false)}</div>
          </details>
        </div>
      )}

      <details className="w-full rounded-lg border border-01 bg-01 px-3.5 py-2.5">
        <summary className="cursor-pointer select-none text-label-13 text-02">What happens when I sign?</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-body-13 text-02">
          <li>Your wallet shows a short &ldquo;Sign in to the Assay operator console&rdquo; message. Signing proves you hold the wallet.</li>
          <li>It is not a transaction: nothing moves and it costs no gas.</li>
          <li>
            Your session lasts {SESSION_HOURS} h; the top bar shows when it ends. Signing out of the console does not sign you out of
            Assay.
          </li>
        </ul>
      </details>

      {demoEnabled() ? (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-dashed border-02 p-3.5">
          <p className="text-label-13 text-01">Demo console</p>
          <p className="text-body-xs text-03">Sample data, no wallet. Pick a role to see the console as that person.</p>
          <div className="flex flex-wrap gap-2">
            {DEMO_PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  saveOperatorSession({
                    token: `${DEMO_OPERATOR_TOKEN_PREFIX}${preset.id}`,
                    expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString(),
                  });
                  onSignedIn();
                }}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A wallet that signed but is not an operator: its address and a request to copy. */
function NotAnOperator({ address }: { address: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(accessRequestText(address));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the address stays visible to copy by hand */
    }
  };
  return (
    <div role="alert" className="flex w-full flex-col gap-2 rounded-lg border border-danger-20 bg-danger-10 p-3.5">
      <p className="text-label-13 text-01">This wallet is not an Assay operator</p>
      <p className="text-body-13 text-02">It signed correctly but is not on the team. Send this to an admin, then sign in again once they have added you.</p>
      <CopyChip value={address} label="wallet address" className="self-start" />
      <Button type="button" size="sm" variant="secondary" className="self-start" icon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} onClick={() => void copy()}>
        {copied ? "Copied" : "Copy access request"}
      </Button>
    </div>
  );
}
