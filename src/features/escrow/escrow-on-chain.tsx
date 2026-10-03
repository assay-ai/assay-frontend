import { ExternalLink } from "lucide-react";
import * as React from "react";

import { CodeBlock } from "@/components/ui/code-block";
import type { Chain } from "@/interfaces/chain";
import type { BuyerEscrow } from "@/interfaces";
import { explorerAddressUrl } from "@/libs/chains/explorer";
import { chainDisplayName, findChain } from "@/services/chains.service";

/**
 * "Where your money is" — the block whose whole job is to make the buyer not
 * have to trust this platform.
 *
 * ## Why it moved out of the page
 *
 * It used to be six lines of JSX inside `funding/escrow/page.tsx` ending in the
 * words *"you can look it up on any **Solana** explorer"*. On an `eip155`
 * escrow that sentence is simply false, and it is false at the one point on the
 * screen that exists to say "check this yourself" — so the buyer who takes it up
 * is sent to a chain their money is not on, and concludes the figures are wrong
 * rather than the sentence. A branch written inline in a page has no test that
 * can reach it; this file has `escrow-on-chain.dom.test.tsx`, which renders it
 * on both chains and reads the text out.
 *
 * ## The explorer comes from the API, never from a table here
 *
 * `chain.explorerBaseUrl` is served by `GET /chains`. There is
 * deliberately no map of namespace → explorer in this bundle: a build-time chain
 * table drifts from `ENABLED_CHAINS`, and the failure it produces is a user
 * pointed at a chain the deployment does not run. `libs/chains/explorer.ts`
 * builds the URL, because `explorerBaseUrl` may carry a query string
 * (`https://explorer.solana.com/?cluster=devnet`) that a template literal
 * silently destroys.
 *
 * `chain` is `null` when the chain list failed or has not answered — the state
 * `useChains` calls `error`/`loading`, both carrying an EMPTY list. Then this
 * renders the same sentence with **no link at all** and the chain's CAIP-2 label
 * in place of its name. That is the same ruling `TxReference` on the deposit
 * screen makes and for the same reason: a link to the wrong chain's explorer is
 * worse than no link. There is no `chains[0]` fallback anywhere in this
 * milestone.
 *
 * ## Why the addresses can be absent
 *
 * `escrowPda` and `escrowTokenAccount` are Solana facts and the backend sends
 * both as `null` on `eip155:46630`, where the balance is held by a settlement
 * contract keyed on the buyer's own address rather than in an account of its
 * own. So the address list can be empty, and the sentence has to stop promising
 * "the token account below" when there is nothing below. Measured against the
 * live API: an open EVM escrow answers `escrowPda: null`,
 * `escrowTokenAccount: null`, `balance: 400.00`.
 *
 * The API does not name the EVM escrow contract anywhere a browser session can
 * read it, so there is no per-address link to offer on that chain — the
 * paragraph's link to the chain's own explorer is what a buyer gets, and it is
 * at least the right chain. See the report for what closing that would need.
 */
export function EscrowOnChain({
  escrow,
  chain,
  chainName,
}: {
  readonly escrow: BuyerEscrow;
  /** The chain the SERVER answered for, or `null` when the chain list is not in hand. */
  readonly chain: Chain | null;
  /** `chain.displayName`, or the CAIP-2 label when the list is not in hand. */
  readonly chainName: string;
}) {
  /*
    Built as a list rather than two `&&` branches so that "is there anything to
    point at?" is one question with one answer, asked once. The sentence above
    the list and the list itself cannot then disagree — which is exactly how the
    EVM case broke: prose that said "below" over an empty space.
  */
  const addresses = [
    escrow.escrowPda ? { title: "Escrow account (PDA)", value: escrow.escrowPda } : null,
    escrow.escrowTokenAccount
      ? { title: "Token account holding the balance", value: escrow.escrowTokenAccount }
      : null,
  ].filter((row): row is { title: string; value: string } => row !== null);

  const explorer = chain ? (
    <a
      href={chain.explorerBaseUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="underline"
      data-testid="escrow-explorer-link"
    >
      {chainName}&rsquo;s explorer
    </a>
  ) : (
    <span data-testid="escrow-explorer-unlinked">{chainName}&rsquo;s explorer</span>
  );

  return (
    <section className="flex w-full flex-col gap-3.5 rounded-xl border border-01 bg-01 p-5 tablet:p-6">
      <div className="flex w-full flex-col gap-1">
        <h2 className="text-heading-sm text-01">Where your money is</h2>
        <p className="text-body-sm leading-[1.6] text-02">
          Your balance is not a row in our database.{" "}
          {addresses.length > 0 ? (
            <>
              It sits in the token account below, owned by an escrow only your wallet can withdraw
              from — so you can look it up on {explorer} and check the figures on this page for
              yourself, without asking us.
            </>
          ) : (
            <>
              It is held on {chainName}, in an escrow only your wallet can withdraw from — so you
              can check the figures on this page against {explorer} for yourself, without asking
              us.
            </>
          )}
        </p>
      </div>

      {addresses.map((row) => (
        <div key={row.title} className="flex w-full flex-col gap-1.5">
          <CodeBlock title={row.title} code={row.value} />
          {chain ? (
            <a
              href={explorerAddressUrl(chain, row.value)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-body-xs text-02 underline"
            >
              Open this account on {chainName}&rsquo;s explorer
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ))}

      {/*
        `observedAt` is `string | null` on the wire — null when there was no
        reading to take. This block only renders under `presence === "open"`,
        which implies a reading, but the guard stays: the alternative is a line
        that prints the word "null" at a buyer as a timestamp.
      */}
      {escrow.observedAt ? (
        <p className="font-mono text-mono-12 text-03">read from the chain at {escrow.observedAt}</p>
      ) : null}
    </section>
  );
}

/**
 * The page's half of this block, as a function instead of a line of JSX.
 *
 * It is two lookups, and both of them are the lookup this milestone keeps
 * getting wrong: `chains[0]` is the two-chain bug, and it is invisible in a
 * component test because the component is handed the chain it renders. So the
 * choosing lives here, where `escrow-on-chain.dom.test.tsx` can hand it a
 * two-chain list and a chain id and check which one comes back.
 *
 * `chainId` is `null` until `GET /escrow` answers — the chain is read off the
 * account the SERVER named, never off `?chain=`. "this chain" is what the rest
 * of the page already says in that state.
 */
export function escrowChainProps(
  chains: readonly Chain[],
  chainId: string | null,
): { chain: Chain | null; chainName: string } {
  if (chainId === null) return { chain: null, chainName: "this chain" };
  return { chain: findChain(chains, chainId), chainName: chainDisplayName(chains, chainId) };
}
