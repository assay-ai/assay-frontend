import * as React from "react";

import { Radio } from "@/components/ui/radio";
import type { DepositChoice } from "@/features/funding/deposit-chain";

/**
 * The first question on the deposit screen: which chain.
 *
 * Split out of `app/(main)/funding/deposit/page.tsx` so it can be rendered by
 * a test. That is not tidiness — a one-token mutation (`rows.length === 0` →
 * `!rows`) once deleted a money row from a shipped page while every test,
 * `tsc` and the build all stayed green, and only a browser found it. This component branches on a list, so it carries the same shape,
 * and the page it came out of cannot be rendered by a test at all: it reads
 * `useSearchParams`, React Query and Privy.
 *
 * Three renderings, and the difference between them is the whole rule:
 *
 *   - `none-offered` renders NOTHING here. The page owns that state, because
 *     it also has to remove the amount field and the button — an empty picker
 *     above a live amount box is a screen inviting a deposit to nowhere.
 *   - `fixed` states the chain: one radio, checked and **disabled**. Asking
 *     someone to choose between one option is not a choice, and the value
 *     still travels on the request.
 *   - `choose` offers every option with **nothing checked**. A deposit is
 *     irreversible and unbridgeable, so a pre-selection is a mechanism for
 *     putting money somewhere it can never leave except back to the buyer.
 */
export interface DepositChainChoiceProps {
  readonly choice: DepositChoice;
  /** The chain the buyer picked, or `null`. Ignored when the choice is `fixed`. */
  readonly picked: string | null;
  readonly onPick: (chainId: string) => void;
  /** A submit in flight. The picker locks so a chain cannot change mid-deposit. */
  readonly busy?: boolean;
}

export function DepositChainChoice({ choice, picked, onPick, busy }: DepositChainChoiceProps) {
  if (choice.kind === "none-offered") return null;

  return (
    <div className="flex w-full flex-col gap-2" data-testid="deposit-chain-choice">
      <p className="text-body-sm font-semibold text-01">Chain</p>
      {choice.kind === "fixed" ? (
        <div className="flex flex-col gap-0.5">
          <Radio
            name="deposit-chain"
            value={choice.chain.chainId}
            checked
            disabled
            readOnly
            data-chain-id={choice.chain.chainId}
            label={choice.chain.displayName}
          />
          <span className="pl-[26px] text-body-xs text-03">
            {/*
              "the only chain this deployment settles on" was true while this
              picker was the deployment's whole enabled list. It is not any
              more: the list is now narrowed to the chains the BUYER holds an
              account on, so a two-chain deployment reaches `fixed` for every
              single-account buyer — and that caption then told them the
              deployment settles on one chain when it settles on two. Two
              chains are enabled on this stack today, so it was already false
              in a browser. This sentence is true in both cases.
            */}
            the chain this account deposits on
          </span>
        </div>
      ) : (
        <>
          {choice.options.map((option) => (
            <Radio
              key={option.chainId}
              name="deposit-chain"
              value={option.chainId}
              checked={picked === option.chainId}
              onChange={() => onPick(option.chainId)}
              disabled={busy}
              data-chain-id={option.chainId}
              label={option.displayName}
            />
          ))}
          <span className="text-body-xs text-03">
            Choose a chain first — a deposit cannot be moved between chains.
          </span>
        </>
      )}
    </div>
  );
}
