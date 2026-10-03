import { describe, expect, it } from "vitest";

import type { Chain } from "@/interfaces/chain";

import { assertRequirementsChain, depositChoice } from "./deposit-chain";

const SOLANA = {
  chainId: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  displayName: "Solana devnet",
} as Chain;
const EVM = { chainId: "eip155:46630", displayName: "Robinhood Chain testnet" } as Chain;

describe("depositChoice", () => {
  it("is a stated fact when the deployment offers exactly one chain", () => {
    // Asking someone to choose between one option is not a choice; the value
    // still travels on the request, so the backend never infers.
    expect(depositChoice([SOLANA])).toEqual({ kind: "fixed", chain: SOLANA });
  });

  it("is an open choice with NO pre-selection when there are two", () => {
    const choice = depositChoice([SOLANA, EVM]);
    expect(choice.kind).toBe("choose");
    // The whole point. A deposit is irreversible and unbridgeable; a default
    // is a mechanism for putting money somewhere it can never leave except
    // back to the buyer. There is no `selected` field for a default to live in.
    expect(choice).not.toHaveProperty("selected");
    expect(choice).not.toHaveProperty("default");
    // And no single chain is readable off it either — the `fixed` shape's own
    // field. A screen that reached for `choice.chain` and got Solana would be
    // the silent default wearing a different name.
    expect(choice).not.toHaveProperty("chain");
    expect((choice as { options: readonly Chain[] }).options).toEqual([SOLANA, EVM]);
  });

  it("says none-offered rather than inventing a chain", () => {
    // `useChains()` is empty while loading and on error. A screen that
    // defaulted to Solana here would offer a chain a deployment may have off,
    // and the refusal would arrive at the moment money moves.
    expect(depositChoice([])).toEqual({ kind: "none-offered" });
  });

  it("keeps every option, in the API's order, when there are three", () => {
    /*
      Two is the case the plan argues; three is the case a `chains.length === 2`
      implementation would get wrong, and `[chains[0], chains[1]]` would pass
      every assertion above. The order is the API's — `GET /chains` serves
      exactly what `ENABLED_CHAINS` names, in that order, and a screen that
      re-sorted would put a different chain first than the operator did.
    */
    const THIRD = { chainId: "eip155:84532", displayName: "Base Sepolia" } as Chain;
    const choice = depositChoice([SOLANA, EVM, THIRD]);
    expect(choice).toEqual({ kind: "choose", options: [SOLANA, EVM, THIRD] });
  });

  it("a caller cannot read a chain out of a two-chain choice", () => {
    const choice = depositChoice([SOLANA, EVM]);
    // The compile-time half: `choice.chain` does not exist on the `choose`
    // member, so a screen cannot accidentally take one. This line is the test.
    // @ts-expect-error — there is no chain on a choice that has not been made
    expect(choice.chain).toBeUndefined();
  });
});

describe("assertRequirementsChain", () => {
  const SOLANA_ID = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

  it("passes when the intent names the chain the buyer chose", () => {
    expect(() => assertRequirementsChain(SOLANA_ID, SOLANA_ID)).not.toThrow();
  });

  it("refuses, before signing, when the intent was minted on another chain", () => {
    /*
      Older backends accept `chainId` and ignore it (their
      `CreateDepositBodyDto` has no such field). With two chains enabled that
      is a deposit landing where the screen never said.
    */
    expect(() => assertRequirementsChain("eip155:46630", SOLANA_ID)).toThrow(
      /created on solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1, not the eip155:46630/,
    );
  });

  it("has nothing to check against the older response, and says so by passing", () => {
    // Not a silent success for a wrong chain — a response that carries no
    // chain makes no claim to disagree with. The seam is this line.
    expect(() => assertRequirementsChain("eip155:46630", undefined)).not.toThrow();
  });
});
