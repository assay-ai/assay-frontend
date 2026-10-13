import Link from "next/link";
import * as React from "react";

import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { UNREADABLE_NOTE } from "@/features/chain-read/chain-read";
import { stakedFigure, unbondingFigure } from "@/features/provider-stake/chain-stake";
import type { Chain } from "@/interfaces/chain";
import type { ProviderChainStake } from "@/interfaces";
import { chainDisplayName } from "@/services/chains.service";
import { cn } from "@/utils";

/**
 * The provider's collateral, **one row per chain — a list, never a sum**.
 *
 * ## Why this replaced two tiles
 *
 * `/provider/capital` drew "Staked" and "Unbonding" as single figures, read
 * off the top level of `GET /providers/me/stake`. The response moved that
 * whole block onto a per-chain array, so those two reads became `undefined`,
 * the page's `!data.chainReadable` banner fired, and a provider with $500.00
 * bonded on a chain that had just answered `chainReadable: true` was told the
 * chain could not be read.
 *
 * Correcting the type is what caught it. Correcting the *layout* is what stops
 * it coming back: a single tile has one slot, and the only way to fill one slot
 * from N chains is to pick one or add them up. A call is slashed in the
 * settlement contract of the chain it was paid on, so a sum across chains is
 * the one number that is never true — no single call is backed by it.
 *
 * ## Three states, and the row says which one it is
 *
 * ```text
 *  staked   $500.00   the source answered with this much
 *  staked   $0.00     the source answered, and the answer was ZERO
 *  staked   Unknown   `hasKnownStake: false` — no reading. Never a zero.
 *
 *  unbonding Unknown  `chainReadable: false` — this CHAIN did not answer
 * ```
 *
 * `staked` and `unbonding` key on two DIFFERENT flags, because they are two
 * different unknowns — the stake source and the chain read are separate
 * questions, and the DTO answers them separately. An outage marks the row it
 * happened on and no other: a response-wide banner would report a Solana RPC
 * failure against an EVM chain that answered fine.
 *
 * ## Not in the design
 *
 * The design draws four tiles and one chain. This panel and its copy are
 * ours; the design has no per-chain stake at all.
 */
export interface StakeByChainProps {
  readonly stake: readonly ProviderChainStake[];
  /** From `useChains()`. Display names only — an unnamed chain still gets a row. */
  readonly chains: readonly Chain[];
  /**
   * Where the `GET /providers/me/stake` read is. **Required, with no default.**
   *
   * `stake` is derived by `stakeChains(data)`, and `data` is `undefined` both
   * while the query is pending and after it fails — so an empty array reached
   * this component in three completely different situations and got one
   * sentence. Measured in Chrome, with the request held open, under a provider
   * carrying a confirmed $500.00 bonded stake:
   *
   * ```text
   * first paint  "No chain is enrolled for this organization yet, so there is
   *               nothing to read a stake from. This is not a stake of zero."
   * then         Solana devnet · Staked $500.00
   * ```
   *
   * The loading state was byte-identical to a factual claim, and the claim was
   * the opposite of the truth, on the screen a provider opens to check their
   * collateral. A default here would put that back one call site at a time, so
   * there is none: a caller has to say which of the three it is.
   */
  readonly status: "loading" | "error" | "ready";
}

export function StakeByChain({ stake, chains, status }: StakeByChainProps) {
  return (
    <Panel className="w-full">
      <PanelHeader>
        <PanelTitles>
          <PanelTitle>Stake by chain</PanelTitle>
          {/*
            The sentence exists for the same reason `BALANCE_EXPLAINER` does on
            the buyer's side: an interface that simply omits a total people
            expect reads as a bug, and the reason it is absent is the whole
            design.
          */}
          <PanelDescription>
            collateral is held on one chain and slashed on that chain — these are never combined
          </PanelDescription>
        </PanelTitles>
      </PanelHeader>
      <PanelBody className="px-5 pb-[18px] pt-2">
        {status === "loading" ? (
          /*
            Said as a wait, not as a fact. It must not be mistakable for either
            of the two sentences below — one of which claims nothing is
            enrolled, and the other that nobody could look.
          */
          <p data-testid="stake-by-chain-loading" className="py-3 text-body-sm text-03">
            Reading your stake from the chain…
          </p>
        ) : status === "error" ? (
          <p data-testid="stake-by-chain-error" className="py-3 text-body-sm text-warning-700">
            We could not read your stake just now. This is not a stake of zero and it is not an
            organization without a chain — it is a failed read, and the figure is unknown until it
            answers.
          </p>
        ) : stake.length === 0 ? (
          /*
            Length, not truthiness. `stake ? … : "—"` is the crash that already
            shipped in `providers-view.tsx` — every array is truthy, the empty
            one included, so the dash was dead code and `formatMoney` was handed
            an array.
          */
          <p data-testid="stake-by-chain-empty" className="py-3 text-body-sm text-02">
            No chain is enrolled for this organization yet, so there is nothing to read a stake
            from. This is not a stake of zero.
          </p>
        ) : (
          stake.map((entry) => {
            const staked = stakedFigure(entry);
            const unbonding = unbondingFigure(entry);
            return (
              <div
                key={entry.chainId}
                data-testid="stake-chain-row"
                data-chain-id={entry.chainId}
                className="flex w-full flex-col gap-2 border-b border-02 py-3 last:border-b-0"
              >
                <div className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-body-sm text-01">
                      {chainDisplayName(chains, entry.chainId)}
                    </span>
                    <span className="font-mono text-mono-xs text-03">
                      {entry.observedAt
                        ? `observed ${entry.observedAt.slice(0, 10)} ${entry.observedAt.slice(11, 16)} UTC`
                        : /*
                            Never a fabricated stamp. "No reading" is the state
                            the figure beside it is already saying.
                          */
                          "no reading taken"}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-5">
                    <Figure label="Staked" figure={staked} />
                    <Figure label="Unbonding" figure={unbonding} />
                  </div>
                </div>

                {entry.chainReadable !== true ? (
                  <p
                    data-testid="stake-chain-unreadable"
                    data-chain-id={entry.chainId}
                    className="text-body-xs leading-[1.55] text-warning-700"
                  >
                    {UNREADABLE_NOTE} The requirement below is computed off your bindings and is
                    unaffected.
                  </p>
                ) : entry.stakeAuthority === null ? (
                  /*
                    `chainReadable: true` with nothing to read. `ChainEnrolment`
                    calls this "enrolled, not yet funded", and under the single
                    figure this chain appeared as nothing at all. It is the one
                    state a provider can actually fix, so it gets a sentence
                    rather than a dash.
                  */
                  <p
                    data-testid="stake-chain-no-authority"
                    data-chain-id={entry.chainId}
                    className="text-body-xs leading-[1.55] text-03"
                  >
                    {entry.staked && entry.staked.amount !== "0"
                      ? "No stake authority has been proved on this chain yet, so this stake cannot be managed from here."
                      : "No stake authority has been proved on this chain, so there is no stake account to read."}{" "}
                    Proving one is a wallet signature, on the{" "}
                    <Link href="/provider/exit" className="underline">
                      Leaving
                    </Link>{" "}
                    screen.
                  </p>
                ) : null}
              </div>
            );
          })
        )}
      </PanelBody>
    </Panel>
  );
}

/** One labelled figure, coloured by its state so an outage is visible, not inferred. */
function Figure({
  label,
  figure,
}: {
  label: string;
  figure: { state: string; text: string };
}) {
  return (
    <span className="flex flex-col items-end gap-0.5">
      <span className="text-body-xs text-03">{label}</span>
      <span
        data-chain-read={figure.state}
        className={cn(
          "font-mono text-mono-sm font-semibold",
          /*
            One class, chosen. Never two colour classes left to `cn()` to
            reconcile — `tailwind-merge` silently drops custom token classes in
            this project, and a dropped colour here makes the unreadable state
            render identically to a read one.
          */
          figure.state === "unreadable" ? "text-warning-600" : "text-01",
        )}
      >
        {figure.text}
      </span>
    </span>
  );
}
