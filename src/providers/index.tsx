"use client";

import { Suspense } from "react";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";
import type { Chain } from "@/interfaces/chain";
import { evmChainsFrom, setEvmRpcUrls } from "@/libs/chains/evm/chains";
import { solanaDevnetRpc } from "@/libs/chains/solana/rpc";
import { demoEnabled } from "@/libs/demo/demo-api";

import { AccountBlockBridge } from "@/features/account-block/account-block-bridge";
import { PrivySessionBridge } from "@/providers/PrivySessionBridge";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useChains } from "@/hooks/useChains";

interface PrivyShellProps {
  children: React.ReactNode;
  /**
   * `GET /chains`, read by `ChainsGate` BEFORE Privy mounts.
   *
   * It has to be known before Privy's first render: Privy reads
   * `supportedChains` once when it mounts, and an eip155 chain missing from
   * that list makes the embedded wallet open no prompt at all — measured, the
   * deposit screen hung on "Approving the token in your wallet…" with no modal
   * and no error. Empty when the API could not be reached; EVM signing then
   * refuses by name and the rest of the app still loads.
   */
  chains: readonly Chain[];
}

type PrivyConfig = NonNullable<
  React.ComponentProps<typeof PrivyProvider>["config"]
>;
type ViemChain = NonNullable<PrivyConfig["supportedChains"]>[number];

/**
 * DEMO ONLY — the same build-time flag `libs/chains/demo-chains.ts` documents.
 *
 * Off, this file behaves exactly as it did: both wallet chain types in the
 * login modal, and no `supportedChains`, which is the state the long comment
 * inside the config argues for. On, it configures the one EVM chain so that an
 * external EVM wallet can connect and Privy does not fall back to probing.
 *
 * Privy still mounts in a demo build. On an origin the Privy app does not
 * allow (a local `out/` served on localhost), Privy logs "Origin not allowed"
 * and "iframe failed to load" warnings; they are harmless, because every demo
 * flow is simulated and never waits on a wallet. Not mounting Privy here is
 * not a safe fix: about twenty screens and `useSigner` call Privy hooks, which
 * throw outside a `PrivyProvider`, and the session bridge's sign-in and
 * sign-out handling reads Privy's `ready`/`authenticated`. Allow the origin in
 * the Privy dashboard to silence them instead.
 */
const DEMO_ROBINHOOD = demoEnabled();

/**
 * A viem `Chain` for 46630, written out rather than imported: viem is not a
 * dependency of this package, and adding one for a demo flag would change the
 * lockfile that the image builds `--frozen-lockfile` from. The cast is what
 * pays for that — keep the fields in step with `demo-chains.ts` by hand.
 */
const ROBINHOOD_CHAIN = {
  id: 46630,
  name: "Robinhood Chain testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: {
      name: "Blockscout",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
} as unknown as ViemChain;

/**
 * `networkMode: "always"` is the important one, and it is not a preference.
 *
 * React Query's default is "online": when a fetch fails at the transport layer
 * it PAUSES the query instead of failing it. The observed result is
 * `status:"pending", fetchStatus:"paused"` forever, while the underlying
 * request has already rejected — so a screen whose data never arrives sits on
 * "Loading…" indefinitely and never reaches its error branch. That is the worst
 * possible failure for this product: a person waiting on a spinner cannot tell
 * whether they were charged.
 *
 * "always" makes a failed request an error the UI can render. `retry: 0` keeps
 * a dead API from being retried three times before the screen admits it.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      networkMode: "always",
      retry: 0,
    },
    mutations: {
      networkMode: "always",
    },
  },
});

function PrivyShell({ children, chains }: PrivyShellProps) {
  /*
    Seeded before the tree renders, so the first screen that builds an eip155
    transaction already has the endpoint. Idempotent: re-running it with the
    same list is a no-op, and a render with an empty list leaves EVM refusing
    by name rather than dialling "".
  */
  setEvmRpcUrls(chains);
  const evmChains = evmChainsFrom(chains);

  return (
        <PrivyProvider
          appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? ""}
          config={{
            /*
              One Privy identity, two embedded wallets. This is what makes `useSigner({ chainId: "eip155:…" })` able to
              answer `ready` at all — the EVM `useWallets()` list is empty for
              a user who has no EVM wallet, and every EVM screen would then
              read "no wallet connected" with no way for the user to fix it.
            */
            embeddedWallets: {
              solana: { createOnLogin: "users-without-wallets" },
              ethereum: { createOnLogin: "users-without-wallets" },
            },
            /*
              The literal is `'ethereum-and-solana'`. `"solana-and-ethereum"`
              is not one of the three values
              `PrivyClientConfig["appearance"]["walletChainType"]` accepts
              (`'ethereum-only' | 'solana-only' | 'ethereum-and-solana'`, read
              from `@privy-io/react-auth@3.37.4`'s own declarations); any
              other string would not compile.
            */
            appearance: {
              walletChainType: DEMO_ROBINHOOD
                ? "ethereum-only"
                : "ethereum-and-solana",
            },
            /*
              DEMO ONLY. Both keys are absent unless the flag is set, which is
              what the comment below asks for; with it set, the one chain this
              demo shows is the one Privy is told about.
            */
            ...(DEMO_ROBINHOOD
              ? {
                  supportedChains: [ROBINHOOD_CHAIN],
                  defaultChain: ROBINHOOD_CHAIN,
                }
              : {}),
            /*
              External wallets go through Privy's own Standard Wallet layer,
              not through `@solana/wallet-adapter-react`. `useWallets()` then
              returns BOTH embedded and external wallets under the same
              `ConnectedStandardSolanaWallet`, so `useSigner()` has exactly
              one interface to wrap instead of having to reconcile two wallet
              sources that could point at the same address. A provider's own
              wallet is typically an org wallet or a cold wallet, so this
              branch is not optional.
            */
            externalWallets: {
              solana: { connectors: toSolanaWalletConnectors() },
            },
            /*
              Privy REFUSES to sign without an RPC for the chain. Without this
              block, `signTransaction` throws `No RPC configuration found for
              chain solana:devnet` — and the visible symptom is a MetaMask
              error, because Privy then falls back to probing EVM connectors.
              That misdirection cost a debugging round: the MetaMask message is
              downstream noise, the missing RPC is the cause.

              This was found the first time `signTransaction` ever ran from a
              real caller — a green build and a green test suite said nothing
              about it.

              The URL is the PUBLIC devnet endpoint on purpose. A keyed RPC
              endpoint carries an API key,
              and `NEXT_PUBLIC_*` would put that key in the client bundle — the
              same trade `libs/chains/solana/deposit-transaction.ts` refused when it
              took its blockhash as a parameter rather than fetching one. The
              browser only needs this to sign and broadcast; every heavy read
              stays on the backend, which keeps the private endpoint.

              Public devnet 429s under load. That is acceptable for one
              transaction per user action and is NOT acceptable for polling —
              do not add a poll against this.
            */
            /*
              The hardcoded `solana:devnet` RPC below stays, deliberately.
              Removing it breaks Solana signing today — Privy refuses to sign
              without an RPC for the chain, and the visible symptom is a
              MetaMask error, not a missing-RPC one — and the replacement (a
              chain-keyed map built from `GET /chains`) needs an RPC URL that
              route does not serve and that this bundle must not carry, because
              the private endpoint has an API key.

              `supportedChains` is built from the chain list the SERVER fetched
              — `publicRpcUrl` per chain, per deployment, never a list in this
              bundle (see `libs/chains/evm/chains.ts` for why it could not be an
              env var). Spread only when non-empty: an empty array is not "no
              EVM", it is a config Privy then has to interpret. No
              `defaultChain`: a buyer's chain is their account's, and a default
              is exactly the silent choice this app avoids.
            */
            ...(evmChains.length > 0 ? { supportedChains: evmChains } : {}),
            solana: {
              rpcs: {
                "solana:devnet": {
                  ...solanaDevnetRpc(),
                  blockExplorerUrl: "https://explorer.solana.com",
                },
              },
            },
          }}
        >
          <PrivySessionBridge>
            <AccountBlockBridge>{children}</AccountBlockBridge>
          </PrivySessionBridge>
        </PrivyProvider>
  );
}

/**
 * Holds the app until `GET /chains` has answered, then mounts Privy with it.
 *
 * The app is a static export, so there is no server to read the list before
 * the first render (the root layout used to). Waiting here keeps the one
 * guarantee that mattered — Privy never mounts with a partial chain list —
 * and the query it waits on is the same `["chains"]` every screen reads, so
 * nothing asks twice. A failed read mounts with an empty list, as before.
 */
function ChainsGate({ children }: { children: React.ReactNode }) {
  const result = useChains();
  if (result.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-01" role="status" aria-label="Loading">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/logo.png" alt="" aria-hidden="true" className="h-8 w-8 animate-pulse rounded-md" />
      </div>
    );
  }
  return <PrivyShell chains={result.chains}>{children}</PrivyShell>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ChainsGate>
          {/*
            The one Suspense boundary every screen and layout needs for
            `useSearchParams` in a static export — record ids ride in the
            query string (see libs/routes.ts).
          */}
          <Suspense fallback={null}>{children}</Suspense>
        </ChainsGate>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
