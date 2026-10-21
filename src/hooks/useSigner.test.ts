import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The mock below is the one thing in this file that is not a pure function, and
  it exists for one reason: `signAndSendTransaction` **broadcasts**. Its two
  decisions — which chain the wallet is told, and what the returned signature is
  encoded as — cannot be extracted into a pure function without extracting the
  Privy call itself, and both are the kind of mistake that only shows up on a
  block explorer. So the Privy module is replaced with a recorder and the hook
  is rendered for real (`react-dom/server` in the node environment, no DOM and
  no testing-library), which keeps `useMemo` honest.

  Everything above the `useSigner` heading below is still fixture-driven and
  mock-free; the mock is inert for those tests.
*/
/** The EVM half of the Privy surface — the ROOT entry, not `/solana`. */
const privyEvm = vi.hoisted(() => ({
  ready: true,
  wallets: [] as Array<{ address: string; walletClientType: string }>,
  /** Every `(params, options)` pair `signTypedData` was handed, in call order. */
  typedDataCalls: [] as Array<{ params: unknown; options: unknown }>,
  typedDataSignature: "0xdeadbeef",
  /** Every `(params, options)` pair the EVM `signMessage` was handed. */
  messageCalls: [] as Array<{ params: unknown; options: unknown }>,
  messageSignature: "0x0102ff",
  /** Every `(params, options)` pair the EVM `signTransaction` was handed. */
  transactionCalls: [] as Array<{ params: unknown; options: unknown }>,
  signedTransaction: "0x02f8aa",
}));

vi.mock("@privy-io/react-auth", () => ({
  useWallets: () => ({ ready: privyEvm.ready, wallets: privyEvm.wallets }),
  useSignMessage: () => ({
    signMessage: async (params: unknown, options: unknown) => {
      privyEvm.messageCalls.push({ params, options });
      return { signature: privyEvm.messageSignature };
    },
  }),
  useSignTypedData: () => ({
    signTypedData: async (params: unknown, options: unknown) => {
      privyEvm.typedDataCalls.push({ params, options });
      return { signature: privyEvm.typedDataSignature };
    },
  }),
  useSignTransaction: () => ({
    signTransaction: async (params: unknown, options: unknown) => {
      privyEvm.transactionCalls.push({ params, options });
      return { signature: privyEvm.signedTransaction };
    },
  }),
}));

/*
  The page-origin RPC the eip155 `signAndSend` fills and broadcasts through.
  Recorded rather than faked into success, so the tests below can assert the
  wallet signed the REFILLED fields and the chain received the signed bytes.
*/
const evmRpc = vi.hoisted(() => ({
  fillCalls: [] as Array<{ chainId: string; from: string; to: string; data: string }>,
  broadcastCalls: [] as Array<{ chainId: string; raw: string }>,
  txHash: "0xfeedface",
}));

vi.mock("@/libs/chains/evm/deposit-transaction", () => ({
  fillTransaction: async (input: { chainId: string; from: string; to: string; data: string }) => {
    evmRpc.fillCalls.push(input);
    return {
      namespace: "eip155",
      chainId: input.chainId,
      kind: "transaction",
      from: input.from,
      to: input.to,
      data: input.data,
      value: "0",
      nonce: "9",
      gasLimit: "200000",
      maxFeePerGas: "10000000",
      maxPriorityFeePerGas: "0",
    };
  },
  broadcast: async (chainId: string, raw: string) => {
    evmRpc.broadcastCalls.push({ chainId, raw });
    return evmRpc.txHash;
  },
}));

const privy = vi.hoisted(() => ({
  /** Every input `signAndSendTransaction` was handed, in call order. */
  sendCalls: [] as Array<{ transaction: Uint8Array; wallet: unknown; chain?: string }>,
  /** What the next send resolves with — Privy returns **bytes**, not a string. */
  sendResult: new Uint8Array(),
  /** Every input `signTransaction` was handed, in call order. */
  signCalls: [] as Array<{ transaction: Uint8Array; wallet: unknown; chain?: string }>,
  /** The bytes `signTransaction` hands back. */
  signResult: new Uint8Array(),
  wallets: [] as Array<{ address: string; standardWallet: unknown }>,
}));

vi.mock("@privy-io/react-auth/solana", () => ({
  useWallets: () => ({ ready: true, wallets: privy.wallets }),
  useSignMessage: () => ({ signMessage: async () => ({ signature: new Uint8Array() }) }),
  useSignTransaction: () => ({
    signTransaction: async (input: (typeof privy.signCalls)[number]) => {
      privy.signCalls.push(input);
      return { signedTransaction: privy.signResult };
    },
  }),
  useSignAndSendTransaction: () => ({
    signAndSendTransaction: async (input: (typeof privy.sendCalls)[number]) => {
      privy.sendCalls.push(input);
      return { signature: privy.sendResult };
    },
  }),
}));

import {
  assertChainMatches,
  isEmbeddedWallet,
  isUserRejection,
  pickWallet,
  resolveSignerState,
  toSolanaChain,
  useSigner,
  withWalletPrompt,
  type SelectableWallet,
  type Signer,
  type UseSignerResult,
} from "@/hooks/useSigner";
import type {
  Eip155TypedDataRequest,
  Eip155UnsignedTransaction,
  SolanaUnsignedTransaction,
} from "@/interfaces/chain-transaction";
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2 } from "@/libs/chains/solana/chains";

/*
  The tests that follow reach for no mock at all, and there is no
  testing-library in this repo. What is worth locking is the *decision* the
  signing surface makes — which
  wallet signs, which chain the signature declares, and whether a thrown error
  was the user saying no — and all three were extracted as pure functions so
  they could be tested against fixtures. A test that asserts a mocked
  `useWallets()` returns what the test told it to would assert nothing.

  The selection rule is load-bearing beyond convenience: the provider payout
  proof verifies the signature against the address the provider typed, so
  returning the embedded wallet when a different address was requested does not
  degrade the flow, it fails it outright.
*/

const EMBEDDED_A = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const EMBEDDED_B = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const EXTERNAL_COLD = "DnTdUmwEBCitxN4tgUfaXrWRSC1JrZgTMD2uPsHC5i73";
const EXTERNAL_HOT = "AtW955vMKUkYMef861U1ZhPQsqbj2D4Xyb5HnFcm3S6E";

function embedded(address: string): SelectableWallet {
  return { address, standardWallet: { isPrivyWallet: true } };
}

function external(address: string): SelectableWallet {
  return { address, standardWallet: { name: "Phantom" } };
}

describe("isEmbeddedWallet", () => {
  it("reads Privy's discriminator off the standard wallet", () => {
    expect(isEmbeddedWallet(embedded(EMBEDDED_A))).toBe(true);
    expect(isEmbeddedWallet(external(EXTERNAL_HOT))).toBe(false);
  });

  it("treats a falsy or missing flag as external rather than throwing", () => {
    expect(isEmbeddedWallet({ address: EXTERNAL_HOT, standardWallet: {} })).toBe(false);
    expect(
      isEmbeddedWallet({ address: EXTERNAL_HOT, standardWallet: { isPrivyWallet: false } }),
    ).toBe(false);
    /* The old `in` check threw on these two; an optional read does not. */
    expect(isEmbeddedWallet({ address: EXTERNAL_HOT, standardWallet: null })).toBe(false);
    expect(isEmbeddedWallet({ address: EXTERNAL_HOT, standardWallet: undefined })).toBe(false);
  });
});

describe("pickWallet with a requested address", () => {
  it("returns the wallet holding that exact address, past the embedded one", () => {
    /* Privy composes the list embedded-first, so this ordering is the real one. */
    const wallets = [embedded(EMBEDDED_A), external(EXTERNAL_HOT), external(EXTERNAL_COLD)];
    expect(pickWallet(wallets, EXTERNAL_COLD)?.address).toBe(EXTERNAL_COLD);
  });

  it("returns the embedded wallet when the embedded wallet is what was asked for", () => {
    const wallets = [embedded(EMBEDDED_A), external(EXTERNAL_HOT)];
    const picked = pickWallet(wallets, EMBEDDED_A);
    expect(picked?.address).toBe(EMBEDDED_A);
    expect(isEmbeddedWallet(picked!)).toBe(true);
  });

  it("returns null rather than falling back when nothing matches", () => {
    const wallets = [embedded(EMBEDDED_A), external(EXTERNAL_HOT)];
    expect(pickWallet(wallets, EXTERNAL_COLD)).toBeNull();
  });

  it("matches base58 case-sensitively", () => {
    const wallets = [external(EXTERNAL_COLD)];
    expect(pickWallet(wallets, EXTERNAL_COLD.toLowerCase())).toBeNull();
    expect(pickWallet(wallets, EXTERNAL_COLD.toUpperCase())).toBeNull();
  });

  it("does not trim the requested address", () => {
    const wallets = [external(EXTERNAL_COLD)];
    expect(pickWallet(wallets, ` ${EXTERNAL_COLD}`)).toBeNull();
    expect(pickWallet(wallets, `${EXTERNAL_COLD}\n`)).toBeNull();
  });

  it("returns null on an empty list", () => {
    expect(pickWallet([], EXTERNAL_COLD)).toBeNull();
  });

  it("takes the first match when the same address is connected twice", () => {
    const first = external(EXTERNAL_COLD);
    const second = external(EXTERNAL_COLD);
    expect(pickWallet([first, second], EXTERNAL_COLD)).toBe(first);
  });
});

describe("pickWallet with no requested address", () => {
  it("prefers the embedded wallet even when it is not first in the list", () => {
    const wallets = [external(EXTERNAL_HOT), external(EXTERNAL_COLD), embedded(EMBEDDED_A)];
    expect(pickWallet(wallets)?.address).toBe(EMBEDDED_A);
  });

  it("takes the first embedded wallet when there are several", () => {
    const wallets = [embedded(EMBEDDED_A), embedded(EMBEDDED_B), external(EXTERNAL_HOT)];
    expect(pickWallet(wallets)?.address).toBe(EMBEDDED_A);
  });

  it("falls back to the first external wallet when there is no embedded one", () => {
    const wallets = [external(EXTERNAL_HOT), external(EXTERNAL_COLD)];
    expect(pickWallet(wallets)?.address).toBe(EXTERNAL_HOT);
  });

  it("returns null on an empty list", () => {
    expect(pickWallet([])).toBeNull();
  });

  it("treats an explicit undefined the same as an omitted address", () => {
    const wallets = [external(EXTERNAL_HOT), embedded(EMBEDDED_A)];
    expect(pickWallet(wallets, undefined)?.address).toBe(EMBEDDED_A);
  });
});

describe("toSolanaChain", () => {
  it("maps the backend registry's CAIP-2 ids to Privy's shorthand", () => {
    expect(toSolanaChain("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe("solana:mainnet");
    expect(toSolanaChain("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")).toBe("solana:devnet");
  });

  it("throws on an unknown chain id instead of defaulting to mainnet", () => {
    /* The silent mainnet default is the defect; a throw is the whole point. */
    expect(() => toSolanaChain("solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z")).toThrow(
      /unknown CAIP-2 chain id/i,
    );
  });

  it("names the offending value in the message", () => {
    expect(() => toSolanaChain("eip155:8453")).toThrow(/eip155:8453/);
  });

  it("rejects an empty string and a bare namespace", () => {
    expect(() => toSolanaChain("")).toThrow(/unknown CAIP-2 chain id/i);
    expect(() => toSolanaChain("solana")).toThrow(/unknown CAIP-2 chain id/i);
  });

  it("does not resolve inherited Object properties as chains", () => {
    /* A plain object literal as a lookup table answers "constructor" otherwise. */
    expect(() => toSolanaChain("constructor")).toThrow(/unknown CAIP-2 chain id/i);
    expect(() => toSolanaChain("toString")).toThrow(/unknown CAIP-2 chain id/i);
  });
});

describe("isUserRejection", () => {
  it("recognises the embedded wallet's ProviderRpcError", () => {
    expect(isUserRejection({ code: 4001, message: "The user rejected the request." })).toBe(true);
  });

  it("recognises an injected wallet's unwrapped 4001", () => {
    expect(isUserRejection({ code: 4001, message: "User rejected the request." })).toBe(true);
    expect(isUserRejection({ code: "4001" })).toBe(true);
  });

  it("recognises the message convention when there is no code", () => {
    expect(isUserRejection(new Error("User rejected the request"))).toBe(true);
    expect(isUserRejection(new Error("User declined the transaction"))).toBe(true);
    expect(isUserRejection("user denied signature")).toBe(true);
  });

  it("unwraps a re-thrown error one or more links down the cause chain", () => {
    const inner = { code: 4001, message: "User rejected the request." };
    expect(isUserRejection(new Error("signTransaction failed", { cause: inner }))).toBe(true);
  });

  it("does not call a real failure a rejection", () => {
    expect(isUserRejection(new Error("Blockhash not found"))).toBe(false);
    expect(isUserRejection({ code: -32603, message: "Internal JSON-RPC error" })).toBe(false);
    expect(isUserRejection({ code: 4100, message: "Unauthorized" })).toBe(false);
  });

  it("survives the values a catch block can actually receive", () => {
    expect(isUserRejection(null)).toBe(false);
    expect(isUserRejection(undefined)).toBe(false);
    expect(isUserRejection(4001)).toBe(false);
    expect(isUserRejection({})).toBe(false);
  });

  it("terminates on a self-referential cause chain", () => {
    const cyclic: { message: string; cause?: unknown } = { message: "boom" };
    cyclic.cause = cyclic;
    expect(isUserRejection(cyclic)).toBe(false);
  });
});

// ── useSigner().signAndSendTransaction ───────────────────────────────────

/**
 * base58 decode, test-local and deliberately not imported.
 *
 * `@/features/m41/base58` is encode-only, and asserting a round trip through
 * the *same* alphabet table it encoded with would prove only that the table is
 * self-consistent. This is written from the spec instead, so the assertion is
 * an independent check that the string really is base58 and really carries the
 * bytes Privy returned.
 */
function base58Decode(text: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (text.length === 0) return new Uint8Array(0);

  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;

  const bytes: number[] = [0];
  for (let i = zeros; i < text.length; i += 1) {
    const value = ALPHABET.indexOf(text[i]);
    if (value < 0) throw new Error(`not base58: ${JSON.stringify(text[i])}`);
    let carry = value;
    for (let j = 0; j < bytes.length; j += 1) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes.reverse()]);
}

/** A 64-byte ed25519 signature, deterministic, with a leading zero byte. */
const SIGNATURE_BYTES = Uint8Array.from(
  Array.from({ length: 64 }, (_, i) => (i === 0 ? 0 : (i * 7 + 3) % 256)),
);

// ── the dispatcher: five states, and a signer bound to one chain ──────────

/** Renders the hook for real and hands back what it returned. */
function renderSigner(options: { chainId: string | null; address?: string }): UseSignerResult {
  let captured: UseSignerResult | undefined;
  function Probe() {
    captured = useSigner(options);
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  return captured!;
}

function readySigner(options: { chainId: string | null; address?: string }): Signer {
  const result = renderSigner(options);
  if (result.status !== "ready") throw new Error(`expected a ready signer, got ${result.status}`);
  return result.signer;
}

/*
  Two fixture helpers, and the difference between them is what each suite is
  allowed to conclude.

  `state(...)` drives the exported pure state machine with a `build` that only
  records what it was handed. It can prove WHICH wallet was selected and WHICH
  chain was passed down — and nothing about what a real signer does, because
  the signer it hands back is the fixture's own.

  `signerFor(...)` renders the REAL hook against the mocked Privy module, so
  the `Signer` it returns is the one the app gets. Every assertion about a
  signing method's behaviour is made through this one.
*/

const embeddedWallet: SelectableWallet = embedded(EMBEDDED_A);
const externalWallet: SelectableWallet = external(EXTERNAL_COLD);

/** A minimal `Signer` that carries only what it was constructed with. */
function fixtureSigner(wallet: SelectableWallet, chainId: string): Signer {
  return {
    address: wallet.address,
    kind: isEmbeddedWallet(wallet) ? "embedded" : "external",
    chainId,
    signMessage: async () => new Uint8Array(),
    signTransaction: async () => ({ namespace: "solana", chainId, transactionBase64: "" }),
    signTypedData: async () => "0x",
    signAndSend: async () => "",
  };
}

function state(input: {
  chainId: string | null;
  ready: boolean;
  wallets: readonly SelectableWallet[];
  requested?: string;
}): UseSignerResult {
  return resolveSignerState({ ...input, build: fixtureSigner });
}

/** Renders the real hook against the mocked Privy module. */
function signerFor(input: {
  chainId: string | null;
  wallets: readonly SelectableWallet[];
  requested?: string;
}): UseSignerResult {
  privy.wallets = input.wallets.map((wallet) => ({
    address: wallet.address,
    standardWallet: wallet.standardWallet,
  }));
  return renderSigner({ chainId: input.chainId, address: input.requested });
}

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
const EVM_TESTNET = "eip155:46630";

const SOLANA_TX: SolanaUnsignedTransaction = {
  namespace: "solana",
  chainId: SOLANA_DEVNET,
  kind: "transaction",
  transactionBase64: "ZmFrZQ==",
  feePayer: "BuyerAccount111111111111111111111111111111",
  signers: ["BuyerAccount111111111111111111111111111111"],
  blockhash: "FakeBlockhash1111111111111111111111111111",
  lastValidBlockHeight: "312445678",
};

const TYPED_DATA: Eip155TypedDataRequest = {
  namespace: "eip155",
  chainId: EVM_TESTNET,
  kind: "typed-data",
  domain: {
    name: "Assay Settlement",
    version: "2",
    chainId: "46630",
    verifyingContract: "0x3333333333333333333333333333333333333333",
  },
  types: { SetLimits: [{ name: "maxVoucherAmount", type: "uint256" }] },
  primaryType: "SetLimits",
  message: { maxVoucherAmount: "100000000" },
  relayed: true,
};

describe("assertChainMatches — a signer refuses another chain's payload", () => {
  it("accepts a payload for the chain it is bound to", () => {
    expect(() => assertChainMatches(SOLANA_DEVNET, SOLANA_TX)).not.toThrow();
  });

  it("refuses a payload for a different chain, naming BOTH ids", () => {
    // The whole point of binding a signer to a chain. Without this, a screen
    // holding a Solana signer and an EVM intent asks the Solana wallet to sign
    // bytes it will happily sign — the chain id is not part of the signed
    // payload — producing a signature against the wrong network that fails
    // only on chain, after the user has approved it.
    expect(() => assertChainMatches(SOLANA_DEVNET, TYPED_DATA)).toThrow(/eip155:46630/);
    expect(() => assertChainMatches(SOLANA_DEVNET, TYPED_DATA)).toThrow(/solana:EtWT/);
  });
});

describe("signTypedData on solana — CHAIN_OPERATION_UNSUPPORTED", () => {
  it("throws, and names the code, rather than signing bytes nothing verifies", async () => {
    // Symmetrical with today's throw on eip155:*, and honest — there is
    // no Solana analogue of EIP-712, and producing a signature over some other
    // byte layout would be a signature no verifier on either chain checks.
    const result = signerFor({ chainId: SOLANA_DEVNET, wallets: [embeddedWallet] });
    expect(result.status).toBe("ready");
    await expect(result.signer!.signTypedData(TYPED_DATA)).rejects.toThrow(
      /CHAIN_OPERATION_UNSUPPORTED/,
    );
  });
});

describe("useSigner states — five, evaluated per chain", () => {
  it("is chain-unknown when the chain is not known yet, and that is not no-wallet", () => {
    // A screen that learns its chain from a response renders BEFORE it knows
    // one. Answering "no wallet" there puts the user in a state no button of
    // theirs can fix — the exact failure the existing four-state union was
    // built to avoid, one level up.
    expect(state({ chainId: null, ready: true, wallets: [embeddedWallet] }).status).toBe(
      "chain-unknown",
    );
  });

  it("is chain-unknown even before Privy is ready, so a screen with no chain never says 'connecting'", () => {
    expect(state({ chainId: null, ready: false, wallets: [] }).status).toBe("chain-unknown");
  });

  it("keeps address-not-connected distinct, and still carries the requested address", () => {
    // The payout-address proof. "You have no wallet connected" and "you have
    // wallets, but none is the address you typed" need opposite instructions.
    const result = state({
      chainId: SOLANA_DEVNET,
      ready: true,
      wallets: [embeddedWallet],
      requested: "SomeOtherAddress11111111111111111111111111",
    });
    expect(result.status).toBe("address-not-connected");
    expect(result).toHaveProperty("requested", "SomeOtherAddress11111111111111111111111111");
  });

  it("never falls back to the embedded wallet when an address was requested", () => {
    // The 100%-failure trap, restated as a test so the dispatcher cannot lose
    // it: pickWallet with a requested address returns null, never wallets[0].
    const result = state({
      chainId: SOLANA_DEVNET,
      ready: true,
      wallets: [embeddedWallet, externalWallet],
      requested: "NotEitherOfThem1111111111111111111111111111",
    });
    expect(result.signer).toBeNull();
  });

  it("selects the requested wallet exactly, with no normalisation", () => {
    const result = state({
      chainId: SOLANA_DEVNET,
      ready: true,
      wallets: [embeddedWallet, externalWallet],
      requested: externalWallet.address,
    });
    expect(result.status).toBe("ready");
    expect(result.signer!.address).toBe(externalWallet.address);
    expect(result.signer!.kind).toBe("external");
    // Assert the loser: the embedded wallet is first in the list and did NOT win.
    expect(result.signer!.address).not.toBe(embeddedWallet.address);
  });

  it("binds the signer to the chain it was asked for", () => {
    const result = state({ chainId: SOLANA_DEVNET, ready: true, wallets: [embeddedWallet] });
    expect(result.signer!.chainId).toBe(SOLANA_DEVNET);
  });

  it("says hydrating only once a chain is known, and no-wallet only once Privy is ready", () => {
    expect(state({ chainId: SOLANA_DEVNET, ready: false, wallets: [] }).status).toBe("hydrating");
    expect(state({ chainId: SOLANA_DEVNET, ready: true, wallets: [] }).status).toBe("no-wallet");
  });

  it("is no-wallet, not address-not-connected, when no address was requested", () => {
    // `pickWallet` with no requested address only returns null on an empty
    // list, so this branch must not invent a `requested` that nobody asked for.
    const result = state({ chainId: SOLANA_DEVNET, ready: true, wallets: [] });
    expect(result.status).toBe("no-wallet");
    expect(result).not.toHaveProperty("requested");
  });

  it("is evaluated per chain: the SAME inputs on two chains give two bound signers", () => {
    // Evaluated per chain. Two calls, two ids, two independent
    // states — neither can sign the other's payload.
    const solana = state({ chainId: SOLANA_DEVNET, ready: true, wallets: [embeddedWallet] });
    const evm = state({ chainId: EVM_TESTNET, ready: true, wallets: [embeddedWallet] });
    expect(solana.signer!.chainId).toBe(SOLANA_DEVNET);
    expect(evm.signer!.chainId).toBe(EVM_TESTNET);
    expect(solana.signer!.chainId).not.toBe(evm.signer!.chainId);
  });
});

// ── useSigner().signAndSend, through the real hook ───────────────────────

describe("useSigner().signAndSend", () => {
  beforeEach(() => {
    privy.sendCalls = [];
    privy.sendResult = SIGNATURE_BYTES;
    privy.wallets = [{ address: EMBEDDED_A, standardWallet: { isPrivyWallet: true } }];
  });

  it("passes the resolved chain to signAndSendTransaction and returns a base58 signature", async () => {
    const signature = await readySigner({ chainId: SOLANA_DEVNET_CAIP2 }).signAndSend(SOLANA_TX);

    expect(privy.sendCalls).toHaveLength(1);
    /* The base64 on the wire, decoded exactly once, on the way to the wallet. */
    expect(Array.from(privy.sendCalls[0].transaction)).toEqual([0x66, 0x61, 0x6b, 0x65]);
    expect(privy.sendCalls[0].chain).toBe("solana:devnet");
    /* Not the CAIP-2 id, and not omitted — omitted is Privy's mainnet default. */
    expect(privy.sendCalls[0].chain).not.toBe(SOLANA_DEVNET_CAIP2);
    expect(privy.sendCalls[0].wallet).toBe(privy.wallets[0]);

    /*
      Privy returns `{ signature: Uint8Array }`. The plausible wrong conversion
      — `String(bytes)` or `.toString()` — yields "0,10,17,…", which reads as a
      signature right up until someone pastes it into an explorer. So: base58
      alphabet only, and the bytes have to come back out.
    */
    expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(signature).not.toContain(",");
    expect(base58Decode(signature)).toEqual(SIGNATURE_BYTES);
  });

  it("forwards { showWalletUIs: true } as options.uiOptions on signAndSend and signTransaction (R-WEB-5)", async () => {
    privy.signCalls = [];
    privy.signResult = new Uint8Array([1, 2]);
    const signer = readySigner({ chainId: SOLANA_DEVNET_CAIP2 });
    await signer.signAndSend(SOLANA_TX, { showWalletUIs: true });
    expect(privy.sendCalls[0]).toMatchObject({ options: { uiOptions: { showWalletUIs: true } } });
    await signer.signTransaction(SOLANA_TX, { showWalletUIs: true });
    expect(privy.signCalls[0]).toMatchObject({ options: { uiOptions: { showWalletUIs: true } } });
  });

  it("throws rather than defaulting when the chain id is unknown", async () => {
    const signer = readySigner({ chainId: "solana:nonsense" });
    await expect(signer.signAndSend({ ...SOLANA_TX, chainId: "solana:nonsense" })).rejects.toThrow(
      /unknown CAIP-2 chain id/i,
    );
    /* The throw has to land BEFORE the wallet is asked to broadcast anything. */
    expect(privy.sendCalls).toHaveLength(0);
  });

  it("refuses a payload for another chain before the wallet is asked for anything", async () => {
    const signer = readySigner({ chainId: SOLANA_DEVNET_CAIP2 });
    await expect(signer.signAndSend(TYPED_DATA)).rejects.toThrow(/bound to/);
    expect(privy.sendCalls).toHaveLength(0);
  });

  it("tells the wallet the chain the CALLER asked for, not this build's default", async () => {
    /*
      The dispatcher's own binding, asserted through the rendered hook rather
      than through `resolveSignerState`.

      Measured: a `useSigner` that ignored its `chainId` argument and pinned
      every signer to `SOLANA_DEVNET_CAIP2` failed only ONE test in this file —
      and only because an unknown id then stopped throwing. Every state
      assertion above goes through `resolveSignerState` with a fixture `build`,
      so none of them can see what the HOOK passes down. This one can: two
      chains in the same namespace, and the id the wallet is told has to follow
      the argument.
    */
    privy.wallets = [{ address: EMBEDDED_A, standardWallet: { isPrivyWallet: true } }];

    const mainnet = renderSigner({ chainId: SOLANA_MAINNET_CAIP2 });
    expect(mainnet.status).toBe("ready");
    expect(mainnet.signer!.chainId).toBe(SOLANA_MAINNET_CAIP2);
    await mainnet.signer!.signAndSend({ ...SOLANA_TX, chainId: SOLANA_MAINNET_CAIP2 });
    expect(privy.sendCalls[0].chain).toBe("solana:mainnet");

    const devnet = renderSigner({ chainId: SOLANA_DEVNET_CAIP2 });
    expect(devnet.signer!.chainId).toBe(SOLANA_DEVNET_CAIP2);
    await devnet.signer!.signAndSend(SOLANA_TX);
    expect(privy.sendCalls[1].chain).toBe("solana:devnet");

    /* Assert the loser: the two calls did NOT declare the same cluster. */
    expect(privy.sendCalls[0].chain).not.toBe(privy.sendCalls[1].chain);
  });

  it("refuses a SOLANA payload built for a DIFFERENT solana chain", async () => {
    /*
      The case the typed-data fixture above cannot cover, and the one that
      actually costs money.

      Measured: deleting `assertChainMatches` from `signAndSend` failed only the
      test above, and it failed on `CHAIN_OPERATION_UNSUPPORTED` — the member
      narrowing, not the chain comparison. A typed-data payload is refused by
      two independent checks, so it proves neither. A mainnet transaction
      handed to a devnet signer passes the narrowing and reaches Privy with
      `chain: "solana:devnet"` on bytes built for mainnet, which the wallet then
      simulates against the wrong cluster and, if it broadcasts at all,
      broadcasts nowhere useful. Only the chain comparison stops that.
    */
    const signer = readySigner({ chainId: SOLANA_DEVNET_CAIP2 });
    await expect(
      signer.signAndSend({ ...SOLANA_TX, chainId: SOLANA_MAINNET_CAIP2 }),
    ).rejects.toThrow(/bound to/);
    /* Both ids named, so the message says which two chains disagreed. */
    await expect(
      signer.signAndSend({ ...SOLANA_TX, chainId: SOLANA_MAINNET_CAIP2 }),
    ).rejects.toThrow(/5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/);
    expect(privy.sendCalls).toHaveLength(0);
  });
});

describe("useSigner().signTransaction", () => {
  beforeEach(() => {
    privy.signCalls = [];
    privy.signResult = Uint8Array.from([9, 8, 7]);
    privy.wallets = [{ address: EMBEDDED_A, standardWallet: { isPrivyWallet: true } }];
  });

  it("returns the signed transaction as base64, tagged with its namespace and chain", async () => {
    const signed = await readySigner({ chainId: SOLANA_DEVNET_CAIP2 }).signTransaction(SOLANA_TX);

    expect(privy.signCalls).toHaveLength(1);
    expect(privy.signCalls[0].chain).toBe("solana:devnet");
    /*
      Base64 out, not raw bytes. Every caller hands this straight to an API
      that takes `transactionBase64`, and three call sites were each doing the
      encoding themselves.
    */
    expect(signed).toEqual({
      namespace: "solana",
      chainId: SOLANA_DEVNET_CAIP2,
      transactionBase64: "CQgH",
    });
  });

  it("refuses a payload for another chain", async () => {
    const signer = readySigner({ chainId: SOLANA_DEVNET_CAIP2 });
    await expect(signer.signTransaction(TYPED_DATA)).rejects.toThrow(/bound to/);
    expect(privy.signCalls).toHaveLength(0);
  });

  it("refuses a SOLANA payload built for a DIFFERENT solana chain", async () => {
    /* Same argument as `signAndSend`'s twin of this test. */
    const signer = readySigner({ chainId: SOLANA_DEVNET_CAIP2 });
    await expect(
      signer.signTransaction({ ...SOLANA_TX, chainId: SOLANA_MAINNET_CAIP2 }),
    ).rejects.toThrow(/bound to/);
    expect(privy.signCalls).toHaveLength(0);
  });
});

// ── the eip155 branch ────────────────────────────────────────────────────

const EVM_EMBEDDED = "0x1111111111111111111111111111111111111111";
const EVM_EXTERNAL = "0x83ab1234567890abcdef1234567890abcdef2913";

const evmEmbedded = { address: EVM_EMBEDDED, walletClientType: "privy" };
const evmExternal = { address: EVM_EXTERNAL, walletClientType: "metamask" };

const EVM_TX: Eip155UnsignedTransaction = {
  namespace: "eip155",
  chainId: EVM_TESTNET,
  kind: "transaction",
  from: EVM_EXTERNAL,
  to: "0x3333333333333333333333333333333333333333",
  data: "0xa9059cbb",
  value: "0",
  nonce: "7",
  gasLimit: "120000",
  maxFeePerGas: "1500000000",
  maxPriorityFeePerGas: "1000000",
};

/** Renders the real hook with the EVM half of the mocked Privy surface loaded. */
function evmSignerFor(input: {
  chainId: string;
  wallets: Array<{ address: string; walletClientType: string }>;
  requested?: string;
}): UseSignerResult {
  privyEvm.wallets = input.wallets;
  /*
    The SOLANA wallet list is emptied deliberately. If the dispatcher read the
    wrong list it would then answer `no-wallet` rather than silently signing
    with a Solana wallet on an EVM chain, and every assertion below would fail
    loudly instead of passing against the wrong namespace.
  */
  privy.wallets = [];
  return renderSigner({ chainId: input.chainId, address: input.requested });
}

describe("the eip155 branch", () => {
  beforeEach(() => {
    privyEvm.typedDataCalls = [];
    privyEvm.messageCalls = [];
    privyEvm.typedDataSignature = "0xdeadbeef";
    privyEvm.ready = true;
  });

  it("reads the EVM wallet list, not the Solana one", () => {
    // The dispatcher's first decision. A namespace switch that read one list
    // for both would hand an EVM chain a base58 wallet, and `{ address }`
    // would then name an address that does not exist on that chain.
    privy.wallets = [{ address: EMBEDDED_A, standardWallet: { isPrivyWallet: true } }];
    privyEvm.wallets = [evmExternal];
    const result = renderSigner({ chainId: EVM_TESTNET });
    expect(result.status).toBe("ready");
    expect(result.signer!.address).toBe(EVM_EXTERNAL);
    // Assert the loser: the Solana wallet was on the list and did NOT win.
    expect(result.signer!.address).not.toBe(EMBEDDED_A);
  });

  it("moves an injected wallet onto the domain's chain BEFORE it signs typed data", async () => {
    // MetaMask refuses eth_signTypedData_v4 when the domain's chainId is not
    // the wallet's active chain ("Provided chainId … must match the active
    // chainId"). A buyer left on Ethereum mainnet could not prove a payout
    // address, set escrow limits or withdraw on 46630 until this switch.
    privyEvm.typedDataCalls = [];
    const order: string[] = [];
    const external = {
      ...evmExternal,
      switchChain: async (id: number) => {
        order.push(`switch:${id}`);
      },
    };
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [external] });

    await state.signer!.signTypedData(TYPED_DATA);
    order.push(`signed:${privyEvm.typedDataCalls.length}`);

    expect(order).toEqual(["switch:46630", "signed:1"]);
  });

  it("does not ask the embedded wallet to switch — Privy signs for the chain it is given", async () => {
    const switched: number[] = [];
    const embedded = {
      ...evmEmbedded,
      switchChain: async (id: number) => {
        switched.push(id);
      },
    };
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [embedded] });

    await state.signer!.signTypedData(TYPED_DATA);

    expect(switched).toEqual([]);
  });

  it("signs typed data, passing the wallet address it is bound to", async () => {
    // The wrong-wallet trap, carried into the second namespace. Privy's EVM
    // useSignTypedData takes { address }; omitting it signs with "the first
    // wallet", which is the embedded one, which is the wrong one for every
    // proof against a typed-in address.
    const switched: number[] = [];
    const external = {
      ...evmExternal,
      switchChain: async (id: number) => {
        switched.push(id);
      },
    };
    const state = evmSignerFor({
      chainId: EVM_TESTNET,
      wallets: [evmEmbedded, external],
      requested: evmExternal.address,
    });
    expect(state.status).toBe("ready");
    const signature = await state.signer!.signTypedData(TYPED_DATA);
    expect(switched).toEqual([46630]);
    expect(signature).toBe("0xdeadbeef");
    expect(privyEvm.typedDataCalls).toHaveLength(1);
    expect(privyEvm.typedDataCalls[0].options).toEqual({ address: evmExternal.address });
    /* Assert the loser: NOT the embedded wallet, which is first in the list. */
    expect(privyEvm.typedDataCalls[0].options).not.toEqual({ address: evmEmbedded.address });
    /*
      The typed-data payload reaches Privy in EIP-712 shape.

      `chainId` is a NUMBER here and a decimal string on the wire. Measured
      against the installed package: `SignTypedDataParams = TypedMessage<…>`
      declares `domain.chainId?: number`, so the string the API sends cannot be
      passed through. The conversion is asserted rather than assumed, because a
      domain separator built from the wrong chain id is a signature that is
      valid over nothing and fails only on chain.
    */
    expect(privyEvm.typedDataCalls[0].params).toEqual({
      domain: {
        name: "Assay Settlement",
        version: "2",
        chainId: 46630,
        verifyingContract: "0x3333333333333333333333333333333333333333",
      },
      types: { SetLimits: [{ name: "maxVoucherAmount", type: "uint256" }] },
      primaryType: "SetLimits",
      message: { maxVoucherAmount: "100000000" },
    });
  });

  it("refuses a typed-data request for a DIFFERENT eip155 chain", async () => {
    // Two chains in one namespace is the case a namespace-only dispatcher
    // gets wrong: eip155:1 and eip155:46630 are both "eip155", and an EIP-712
    // domain separator is chain-specific, so a signature made against the
    // wrong one is valid over nothing.
    const state = evmSignerFor({ chainId: "eip155:1", wallets: [evmEmbedded] });
    await expect(state.signer!.signTypedData(TYPED_DATA)).rejects.toThrow(/eip155:46630/);
    expect(privyEvm.typedDataCalls).toHaveLength(0);
  });

  it("forwards { showWalletUIs: true } to Privy's uiOptions, next to the address (R-WEB-5)", async () => {
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await state.signer!.signTypedData(TYPED_DATA, { showWalletUIs: true });
    expect(privyEvm.typedDataCalls).toHaveLength(1);
    expect(privyEvm.typedDataCalls[0].options).toEqual({
      address: evmEmbedded.address,
      uiOptions: { showWalletUIs: true },
    });
  });

  it("puts the prompt's title and description on Privy's sign screen (lot 1 D14)", async () => {
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await state.signer!.signTypedData(TYPED_DATA, { showWalletUIs: true, title: "Set limits", description: "$1.00 a call" });
    expect(privyEvm.typedDataCalls[0].options).toEqual({
      address: evmEmbedded.address,
      uiOptions: { showWalletUIs: true, title: "Set limits", description: "$1.00 a call" },
    });
  });

  it("withWalletPrompt adds the text to every confirmation, and never drops showWalletUIs (lot 1 D14)", async () => {
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    const signer = withWalletPrompt(state.signer!, { title: "Deposit 20.00 USDG", description: "Into your escrow." });
    await signer.signTypedData(TYPED_DATA, { showWalletUIs: true });
    expect(privyEvm.typedDataCalls[0].options).toEqual({
      address: evmEmbedded.address,
      uiOptions: { showWalletUIs: true, title: "Deposit 20.00 USDG", description: "Into your escrow." },
    });
    privyEvm.transactionCalls = [];
    await signer.signTransaction({ ...EVM_TX, from: EVM_EMBEDDED }, { showWalletUIs: true });
    // A transaction screen has no title: it goes to the details row.
    expect(privyEvm.transactionCalls[0]!.options).toEqual({
      address: EVM_EMBEDDED,
      uiOptions: { showWalletUIs: true, description: "Into your escrow.", transactionInfo: { action: "Deposit 20.00 USDG" } },
    });
    // A call without options still asks Privy for its default, text or not.
    await signer.signTypedData(TYPED_DATA);
    expect(privyEvm.typedDataCalls[1].options).toEqual({ address: evmEmbedded.address });
  });

  it("without the option, passes no uiOptions (Privy's own default applies)", async () => {
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await state.signer!.signTypedData(TYPED_DATA);
    expect(privyEvm.typedDataCalls[0].options).toEqual({ address: evmEmbedded.address });
  });

  it("refuses a typed-data request whose DOMAIN names another chain than the signer's", async () => {
    // Frontend review 2026-10-15, F1: the wrapper said 46630 and the domain
    // said 1, and the embedded wallet signed for chain 1.
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await expect(
      state.signer!.signTypedData({ ...TYPED_DATA, domain: { ...TYPED_DATA.domain, chainId: "1" } }),
    ).rejects.toThrow(/domain names chain "1"/);
    expect(privyEvm.typedDataCalls).toHaveLength(0);
  });

  it("refuses a typed-data request carrying a salt, rather than dropping it", async () => {
    /*
      Measured: Privy's `SignTypedDataParams` declares `domain.salt?: ArrayBuffer`
      while the wire carries a string. There is no lossless conversion this
      module can make without knowing the encoding, and passing the domain
      through WITHOUT the salt produces a different domain separator — a
      signature over a struct nobody will verify, which reverts on chain after
      the user has approved it. A refusal is the only honest answer.
    */
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await expect(
      state.signer!.signTypedData({
        ...TYPED_DATA,
        domain: { ...TYPED_DATA.domain, salt: "0xabc" },
      }),
    ).rejects.toThrow(/salt/i);
    expect(privyEvm.typedDataCalls).toHaveLength(0);
  });

  it("refuses a domain chain id that is not a safe integer, rather than rounding it", async () => {
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await expect(
      state.signer!.signTypedData({
        ...TYPED_DATA,
        domain: { ...TYPED_DATA.domain, chainId: "99999999999999999999" },
      }),
    ).rejects.toThrow(/99999999999999999999/);
    expect(privyEvm.typedDataCalls).toHaveLength(0);
  });

  it("signs a message through the EVM wallet, bound to its address, and returns bytes", async () => {
    const state = evmSignerFor({
      chainId: EVM_TESTNET,
      wallets: [evmEmbedded, evmExternal],
      requested: evmExternal.address,
    });
    privyEvm.messageSignature = "0x0102ff";
    const bytes = await state.signer!.signMessage(new TextEncoder().encode("hello"));
    expect(privyEvm.messageCalls).toHaveLength(1);
    expect(privyEvm.messageCalls[0].params).toEqual({ message: "hello" });
    expect(privyEvm.messageCalls[0].options).toEqual({ address: evmExternal.address });
    /* Bytes on both chains, so no call site has to know which it is on. */
    expect(Array.from(bytes)).toEqual([0x01, 0x02, 0xff]);
  });

  describe("signAndSend", () => {
    beforeEach(() => {
      privyEvm.transactionCalls = [];
      evmRpc.fillCalls = [];
      evmRpc.broadcastCalls = [];
    });

    it("refills from the page's RPC, signs THAT, broadcasts it and returns the hash", async () => {
      // The intent's nonce and gas were read when it was built. A stake
      // deposit's `approve` lands between the build and this call and moves the
      // nonce, so signing the built fields would replace the approval or be
      // refused. Refilled fields are the only ones worth a signature.
      const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });

      const hash = await state.signer!.signAndSend({ ...EVM_TX, from: EVM_EMBEDDED });

      expect(hash).toBe(evmRpc.txHash);
      expect(evmRpc.fillCalls).toEqual([
        { chainId: EVM_TESTNET, from: EVM_EMBEDDED, to: EVM_TX.to, data: EVM_TX.data },
      ]);
      expect(privyEvm.transactionCalls[0]).toEqual({
        params: expect.objectContaining({ nonce: 9, gasLimit: 200000n, chainId: 46630, type: 2 }),
        options: { address: EVM_EMBEDDED },
      });
      /* Assert the loser: the built nonce (7) was NOT what the wallet signed. */
      expect(privyEvm.transactionCalls[0].params).not.toEqual(
        expect.objectContaining({ nonce: 7 }),
      );
      expect(evmRpc.broadcastCalls).toEqual([
        { chainId: EVM_TESTNET, raw: privyEvm.signedTransaction },
      ]);
    });

    it("forwards { showWalletUIs: true } to Privy on an embedded signAndSend: the non-relayed SetLimits path (R1-I2)", async () => {
      const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
      await state.signer!.signAndSend({ ...EVM_TX, from: EVM_EMBEDDED }, { showWalletUIs: true });
      expect(privyEvm.transactionCalls).toHaveLength(1);
      expect(privyEvm.transactionCalls[0]!.options).toEqual({
        address: EVM_EMBEDDED,
        uiOptions: { showWalletUIs: true },
      });
      expect(evmRpc.broadcastCalls).toHaveLength(1);
    });

    it("lets an injected wallet SEND it itself — on the right chain, no page-side fill or broadcast", async () => {
      // Until 2026-09-29 this refused: MetaMask/Rabby cannot sign without
      // sending. Sending is what this door asks for, so the wallet broadcasts
      // with its own nonce and RPC, and only the hash comes back.
      const hash = `0x${"ef".repeat(32)}`;
      const calls: string[] = [];
      const wallet = {
        ...evmExternal,
        switchChain: async (id: number) => {
          calls.push(`switchChain:${id}`);
        },
        getEthereumProvider: async () => ({
          request: async (args: { method: string; params?: unknown[] }) => {
            calls.push(`${args.method}:${JSON.stringify(args.params)}`);
            return hash;
          },
        }),
      };
      const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [wallet] });

      await expect(state.signer!.signAndSend(EVM_TX)).resolves.toBe(hash);

      expect(calls).toEqual([
        "switchChain:46630",
        `eth_sendTransaction:${JSON.stringify([
          { from: EVM_EXTERNAL, to: EVM_TX.to, data: EVM_TX.data, value: "0x0" },
        ])}`,
      ]);
      expect(evmRpc.fillCalls).toHaveLength(0);
      expect(evmRpc.broadcastCalls).toHaveLength(0);
    });

    it("still refuses an injected wallet's transaction from another address", async () => {
      const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmExternal] });
      await expect(
        state.signer!.signAndSend({ ...EVM_TX, from: EVM_EMBEDDED }),
      ).rejects.toThrow(/but the wallet is/);
    });

    it("refuses a transaction carrying value — refilling would drop it", async () => {
      const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
      await expect(
        state.signer!.signAndSend({ ...EVM_TX, from: EVM_EMBEDDED, value: "1" }),
      ).rejects.toThrow(/value/);
      expect(evmRpc.broadcastCalls).toHaveLength(0);
    });

    it("refuses a transaction from another address, and sends nothing", async () => {
      const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
      await expect(state.signer!.signAndSend(EVM_TX)).rejects.toThrow(/but the wallet is/);
      expect(evmRpc.broadcastCalls).toHaveLength(0);
    });
  });

  it("hands back a signed-but-unsent eip155 transaction from the embedded wallet", async () => {
    // The deposit's `depositFor`: the settle route takes these bytes and
    // `EvmFacilitator` verifies and broadcasts them.
    privyEvm.transactionCalls = [];
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await expect(
      state.signer!.signTransaction({ ...EVM_TX, from: EVM_EMBEDDED }),
    ).resolves.toEqual({
      namespace: "eip155",
      chainId: EVM_TESTNET,
      rawTransaction: privyEvm.signedTransaction,
    });
    // Fully specified, so Privy has nothing to look up; and bound to the wallet.
    expect(privyEvm.transactionCalls[0]).toEqual({
      params: expect.objectContaining({
        chainId: 46630,
        nonce: 7,
        gasLimit: 120000n,
        maxFeePerGas: 1500000000n,
        type: 2,
      }),
      options: { address: EVM_EMBEDDED },
    });
  });

  it("forwards { showWalletUIs: true } on an eip155 transaction to Privy's uiOptions (R-WEB-5)", async () => {
    privyEvm.transactionCalls = [];
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await state.signer!.signTransaction({ ...EVM_TX, from: EVM_EMBEDDED }, { showWalletUIs: true });
    expect(privyEvm.transactionCalls[0]!.options).toEqual({
      address: EVM_EMBEDDED,
      uiOptions: { showWalletUIs: true },
    });
  });

  it("refuses an external wallet by name — it cannot sign without sending", async () => {
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmExternal] });
    await expect(state.signer!.signTransaction(EVM_TX)).rejects.toThrow(
      /CHAIN_OPERATION_UNSUPPORTED: an external wallet/,
    );
  });

  it("refuses a transaction whose `from` is not the wallet signing it", async () => {
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await expect(state.signer!.signTransaction(EVM_TX)).rejects.toThrow(/but the wallet is/);
  });

  it("still refuses the Solana member on an eip155 signer", async () => {
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmEmbedded] });
    await expect(state.signer!.signAndSend(SOLANA_TX)).rejects.toThrow(/bound to/);
  });

  it("is evaluated per chain: EVM can be no-wallet while Solana is ready", () => {
    // Neither row may collapse the other into "no wallet".
    privy.wallets = [{ address: EMBEDDED_A, standardWallet: { isPrivyWallet: true } }];
    privyEvm.wallets = [];
    expect(renderSigner({ chainId: SOLANA_DEVNET_CAIP2 }).status).toBe("ready");
    expect(renderSigner({ chainId: EVM_TESTNET }).status).toBe("no-wallet");
  });

  it("treats Privy's own EVM client type as the embedded wallet", () => {
    // `standardWallet.isPrivyWallet` does not exist on an EVM ConnectedWallet;
    // `walletClientType === "privy"` is the discriminator there.
    expect(isEmbeddedWallet(evmEmbedded)).toBe(true);
    expect(isEmbeddedWallet(evmExternal)).toBe(false);
    const state = evmSignerFor({ chainId: EVM_TESTNET, wallets: [evmExternal, evmEmbedded] });
    /* No requested address: the embedded wallet wins even though it is second. */
    expect(state.signer!.address).toBe(EVM_EMBEDDED);
    expect(state.signer!.kind).toBe("embedded");
  });
});
