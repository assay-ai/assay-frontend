"use client";

/**
 * The app's one signing surface.
 *
 * Before this hook, `signTransaction` appeared **0 times** in the whole
 * frontend, and both wallet-touching call sites each sniffed `window.solana`
 * with a hand-written interface. That gap blocked both the buyer's deposit
 * and the provider's stake.
 *
 * **One wallet source, not two.** Privy's embedded wallet and an external
 * wallet (Phantom, Solflare, an org's cold wallet) both arrive here through
 * Privy's `useWallets()` — both are a `ConnectedStandardSolanaWallet` and
 * both expose the same Wallet Standard `signMessage`/`signTransaction`. That
 * is why this repo does NOT install `@solana/wallet-adapter-react`: it would
 * be a second provider tree and a problem of reconciling two wallet sources
 * that could point at the same address.
 *
 * **Partial signing is the default, not an API you have to go find.**
 * `signTransaction` takes a `Uint8Array` and returns a signed `Uint8Array`;
 * there is no `feePayer` parameter and no requirement that the fee payer be
 * the wallet doing the signing. `SolanaSignTransactionFeature`'s semantics
 * really are *"add my signature to this transaction and hand it back"*.
 * Verified against the package's type declarations
 * (`@privy-io/react-auth@3.37.4`, `dist/dts/solana.d.ts`), not against docs.
 *
 * **Two things this hook refuses to decide for the caller.**
 *
 * 1. *Which* wallet signs. `providers/index.tsx` sets
 *    `createOnLogin: "users-without-wallets"`, so every authenticated user has
 *    an embedded wallet, and Privy composes the list embedded-first the instant
 *    `ready` flips. "The first wallet" is therefore always the embedded one,
 *    which is right for *"sign as me"* and catastrophic for *"prove you hold
 *    this address"*: the provider payout-address proof verifies the signature
 *    against the address the provider typed
 *    (`provider-payout-address.service.ts`), so signing with the embedded
 *    wallet fails 100% of the time for an org or cold wallet. Pass
 *    `{ address }` and the hook selects by it or hands back no signer.
 *
 * 2. *Which chain* a transaction is for. Privy defaults `chain` to
 *    `"solana:mainnet"` when the caller omits it — verified in
 *    `dist/esm/solana.mjs`, where `chain:s.chain||"solana:mainnet"` appears in
 *    both `useSignTransaction` and `useSignAndSendTransaction`. The chain id is
 *    not part of the signed payload, so the signature stays valid, but an
 *    external wallet simulates against the cluster it is told, and a devnet
 *    deposit simulated against mainnet shows the user "this transaction is
 *    likely to fail" at the moment they are moving money. Some wallets refuse
 *    outright. So `signTransaction` takes the CAIP-2 chain id as a **required**
 *    argument: the defect was that omission silently meant mainnet, and a
 *    required parameter turns omission into a compile error.
 *
 * **Broadcasting is part of this surface, not a gap in it.** The provider's
 * stake transactions are built unsigned by the backend and there is nowhere to
 * hand a signed one back: `stake-intent-builder.port.ts:20-21` has no `send`,
 * no `submit` and no `signature`, on purpose, so the wallet that signs is also
 * the only thing that can put the transaction on chain. Privy's
 * `useSignAndSendTransaction` does that without this app ever holding an RPC
 * URL — an external wallet broadcasts through its own endpoint via the wallet
 * standard's `solana:signAndSendTransaction`, the embedded wallet through
 * Privy's. Adding a `Connection` here would mean a `NEXT_PUBLIC_` RPC URL, and
 * a keyed endpoint would put its API key in the bundle; that is the same
 * reasoning that keeps the blockhash a parameter in
 * `libs/chains/solana/deposit-transaction.ts` instead of a fetch.
 */

import {
  useSignMessage as useEvmSignMessage,
  useSignTransaction as useEvmSignTransaction,
  useSignTypedData as useEvmSignTypedData,
  useWallets as useEvmWallets,
} from "@privy-io/react-auth";
import type { ConnectedWallet } from "@privy-io/react-auth";
import {
  useSignAndSendTransaction,
  useSignMessage,
  useSignTransaction,
  useWallets,
} from "@privy-io/react-auth/solana";
import type { PrivyStandardWallet } from "@privy-io/react-auth/solana";
import { useMemo } from "react";

import { base58Encode } from "@/features/m41/base58";
import type {
  Eip155TypedDataRequest,
  Eip155UnsignedTransaction,
  Eip712Domain,
  Eip712Field,
  SignedChainTransaction,
  UnsignedChainTransaction,
} from "@/interfaces/chain-transaction";
import { isSolanaTransaction } from "@/interfaces/chain-transaction";
import { broadcast, fillTransaction } from "@/libs/chains/evm/deposit-transaction";
import { hexToBytes } from "@/libs/chains/evm/hex";
import { sendFromInjectedWallet } from "@/libs/chains/evm/injected-send";
import { isEvmChain } from "@/libs/chains/registry";
import { base64ToBytes, toBase64 } from "@/libs/chains/solana/base64";
import { SOLANA_DEVNET_CAIP2, SOLANA_MAINNET_CAIP2 } from "@/libs/chains/solana/chains";

export type SignerKind = "embedded" | "external";

export interface Signer {
  /** The signing wallet's address — base58 on `solana`, `0x…` on `eip155`. */
  readonly address: string;
  readonly kind: SignerKind;
  /**
   * The chain this signer is BOUND to.
   *
   * Not decoration. `signTransaction`/`signAndSend` compare it against the
   * payload's own `chainId` and refuse a mismatch by name, so a screen holding
   * one chain's signer cannot hand it another chain's bytes — see
   * `assertChainMatches`.
   */
  readonly chainId: string;
  /** Returns the raw signature. The call site base58/hex-encodes it if the API needs that. */
  readonly signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  /**
   * Adds this wallet's signature and hands the transaction back **unsent**.
   *
   * Takes the unsigned-transaction union, not a bare `Uint8Array`: the payload names its own
   * chain, which is what lets the binding be checked instead of trusted. The
   * result is base64 on `solana` — every caller hands it straight to an API
   * that takes `transactionBase64`, and the encoding was being done at three
   * call sites.
   */
  readonly signTransaction: (tx: UnsignedChainTransaction, options?: WalletPromptOptions) => Promise<SignedChainTransaction>;
  /**
   * The EIP-712 surface. `eip155` only — the Solana branch throws
   * `CHAIN_OPERATION_UNSUPPORTED`, because there is no Solana analogue and a
   * signature over some other byte layout is one no verifier on either chain
   * checks.
   */
  /*
    `relayed` is not read by signing — it tells a caller who submits. A proof
    challenge has no submitter at all, so the field is not demanded here.
  */
  readonly signTypedData: (
    request: Omit<Eip155TypedDataRequest, "relayed">,
    options?: SignTypedDataOptions,
  ) => Promise<`0x${string}`>;
  /**
   * Signs **and broadcasts**. The platform has no submit endpoint and must not
   * grow one — `stake-intent-builder.port.ts:20-21` removed `send`/`submit`
   * from the port on purpose, so the owner's own wallet is the only thing that
   * puts a transaction on chain.
   *
   * Returns the transaction reference: a base58 signature on `solana`. Privy
   * hands back `{ signature: Uint8Array }`; every explorer, RPC and receipt in
   * this project speaks base58, and `String(bytes)` produces a comma-joined
   * byte list that looks enough like a signature to be pasted into a report and
   * never resolve. Converting once, here, is what stops that.
   */
  readonly signAndSend: (tx: UnsignedChainTransaction, options?: WalletPromptOptions) => Promise<string>;
}

/**
 * Options of {@link Signer.signTypedData}, `signTransaction` and `signAndSend`.
 *
 * `showWalletUIs` forces Privy's own confirmation screen for an embedded
 * wallet (spec R-WEB-5), whatever the dashboard's default. It is typed as the
 * literal `true`: no call site can hide the confirmation through this door,
 * and `scripts/check-wallet-ui.js` refuses `showWalletUIs: false` anywhere.
 * The `AuthorizeDelegate` and `SetLimits` call sites pass it explicitly. An
 * injected wallet (MetaMask, …) always shows its own prompt.
 */
export interface WalletPromptOptions extends WalletPromptText {
  showWalletUIs: true;
}

/**
 * What Privy's own confirmation screen says, so the prompt names the amount
 * the sheet showed (lot 1 D14). Only the fields the installed SDK
 * (`@privy-io/react-auth` 3.37) documents are used:
 *
 * - a signature (`signTypedData`, `signMessage`): `SignMessageModalUIOptions`
 *   `title` and `description`;
 * - a transaction (`signTransaction`, `signAndSend`):
 *   `SendTransactionModalUIOptions` has no title, so `title` becomes
 *   `transactionInfo.action` (the details row) and `description` its
 *   `description`.
 *
 * An injected wallet (MetaMask, …) shows its own prompt and never sees these.
 */
export interface WalletPromptText {
  title?: string;
  description?: string;
}

/** {@link WalletPromptOptions} for `signTypedData`. */
export type SignTypedDataOptions = WalletPromptOptions;

/** The text fields that are set, and nothing for the ones that are not. */
function promptText(options: WalletPromptText): WalletPromptText {
  return {
    ...(options.title ? { title: options.title } : {}),
    ...(options.description ? { description: options.description } : {}),
  };
}

/** Privy's `uiOptions` for a signature: forced on when asked, else left to Privy's default. */
function privyUi(options: WalletPromptOptions | undefined): {
  uiOptions?: { showWalletUIs: true; title?: string; description?: string };
} {
  if (options?.showWalletUIs !== true) return {};
  const text = promptText(options);
  return { uiOptions: { showWalletUIs: true, ...text } };
}

/** The details row of Privy's Send Transaction screen. */
interface PrivyTransactionInfo {
  action: string;
}

/** Privy's `uiOptions` for a transaction: the same, in the Send Transaction screen's fields. */
function privyTxUi(options: WalletPromptOptions | undefined): {
  uiOptions?: { showWalletUIs: true; description?: string; transactionInfo?: PrivyTransactionInfo };
} {
  if (options?.showWalletUIs !== true) return {};
  const text = promptText(options);
  const details = text.title ? { transactionInfo: { action: text.title } } : {};
  const description = text.description ? { description: text.description } : {};
  return { uiOptions: { showWalletUIs: true, ...description, ...details } };
}

/**
 * The same signer, with `text` on every confirmation it asks for. A sheet
 * wraps the signer of one wallet step with it, so the feature code that signs
 * stays as it is and still forces the confirmation (`showWalletUIs: true`);
 * text a call passes itself wins.
 */
export function withWalletPrompt(signer: Signer, text: WalletPromptText | undefined): Signer {
  if (!text || (!text.title && !text.description)) return signer;
  const merge = <O extends WalletPromptOptions | undefined>(options: O): O =>
    (options ? { ...promptText(text), ...options } : options) as O;
  return {
    ...signer,
    signTransaction: (tx, options) => signer.signTransaction(tx, merge(options)),
    signTypedData: (request, options) => signer.signTypedData(request, merge(options)),
    signAndSend: (tx, options) => signer.signAndSend(tx, merge(options)),
  };
}

export const CHAIN_OPERATION_UNSUPPORTED = "CHAIN_OPERATION_UNSUPPORTED";

/**
 * A signer is bound to one chain, and refuses a payload for another.
 *
 * The chain id is not part of a signed Solana payload, so a wallet asked to
 * sign an EVM-destined byte string will happily do it and hand back a
 * signature that is valid over the wrong thing. Nothing downstream notices
 * until the chain rejects it, by which point the user has approved a prompt.
 * Comparing the two ids costs nothing and turns that into a thrown sentence
 * before any wallet is asked for anything.
 */
export function assertChainMatches(chainId: string, tx: Pick<UnsignedChainTransaction, "chainId">): void {
  if (tx.chainId !== chainId) {
    throw new Error(
      `useSigner: this signer is bound to ${JSON.stringify(chainId)}, but the payload names ` +
        `${JSON.stringify(tx.chainId)}. A signer is per chain; get one for the payload's chain.`,
    );
  }
}

/**
 * Five states, not two — and they are evaluated PER CHAIN, so
 * `hydrating` on EVM while Solana is `ready` is representable and no screen
 * can collapse the pair into "no wallet".
 *
 * `chain-unknown` is new and comes FIRST, before `hydrating`. Several screens
 * learn their chain from a response (`chainIdOfAccount(query.data?.account)`),
 * so they render before they know one; answering "hydrating" there says
 * something is in progress that is not, and answering "no wallet" puts the
 * user in a state no button of theirs can fix. There is deliberately **no
 * default chain**: defaulting to Solana is exactly the silent default
 * `toSolanaChain` exists to prevent, one level up.
 *
 * `hydrating` is not `no-wallet`: Privy has not finished building the wallet
 * list yet, and telling a user who *has* a wallet that they have none is a
 * state they cannot escape.
 *
 * `address-not-connected` is not `no-wallet` either, and this is the one that
 * matters for the payout-address proof. "You have no wallet connected" and "you
 * have wallets, but none of them is the address you typed" need opposite
 * instructions: *connect a wallet* versus *connect the wallet that holds
 * 7xKX…, or fix the address*. Collapsing them into one state is how a provider
 * ends up staring at "your signature is invalid" with nothing pointing at
 * wallet selection. `requested` carries the address so the UI can name it.
 */
export type UseSignerResult =
  | { readonly status: "chain-unknown"; readonly signer: null }
  | { readonly status: "hydrating"; readonly signer: null }
  | { readonly status: "no-wallet"; readonly signer: null }
  | { readonly status: "address-not-connected"; readonly signer: null; readonly requested: string }
  | { readonly status: "ready"; readonly signer: Signer };

// ── chain ────────────────────────────────────────────────────────────────

/**
 * Privy's own `SolanaChain` is declared but **not exported** from
 * `@privy-io/react-auth/solana` — importing it is `error TS2459`. So it is
 * re-declared here. Keep it in step with Privy's accepted values, not with this
 * app's supported networks.
 */
type SolanaChain = "solana:mainnet" | "solana:devnet" | "solana:testnet";

/**
 * CAIP-2 chain id → Privy's shorthand.
 *
 * The keys come from `@/libs/chains/solana/chains`, which is the one place the
 * deployment's CAIP-2 ids are written down. They used to be bare literals
 * here; the deposit client needs the devnet id too, and a second copy of a
 * truncated base58 genesis hash is a copy that can drift silently.
 *
 * There is no `solana:testnet` row because the backend registry has no testnet
 * chain id to key it on. `SolanaChain` still lists it because Privy accepts it;
 * a mapping only appears here once there is a real CAIP-2 id to map from.
 *
 * A `Map`, not an object literal, because the lookup key is attacker-adjacent
 * data off the wire: an object literal answers `"constructor"` and `"toString"`
 * from `Object.prototype`, so a chain id of `"constructor"` would resolve to a
 * function instead of throwing.
 */
const SOLANA_CHAIN_BY_CAIP2: ReadonlyMap<string, SolanaChain> = new Map([
  [SOLANA_MAINNET_CAIP2, "solana:mainnet"],
  [SOLANA_DEVNET_CAIP2, "solana:devnet"],
] satisfies ReadonlyArray<readonly [string, SolanaChain]>);

/**
 * Throws on anything unrecognised, naming the value. Deliberately no default:
 * a silent default is the entire defect this exists to close — it is what made
 * every devnet signature declare mainnet.
 */
export function toSolanaChain(chainId: string): SolanaChain {
  const chain = SOLANA_CHAIN_BY_CAIP2.get(chainId);
  if (chain === undefined) {
    throw new Error(
      `useSigner: unknown CAIP-2 chain id ${JSON.stringify(chainId)}. ` +
        `Known ids: ${[...SOLANA_CHAIN_BY_CAIP2.keys()].join(", ")}.`,
    );
  }
  return chain;
}

// ── wallet selection ─────────────────────────────────────────────────────

/**
 * The part of a `ConnectedStandardSolanaWallet` selection actually reads.
 *
 * Structural on purpose: the real class satisfies it, and so does a plain
 * object literal, which is what lets `pickWallet` be tested against fixtures
 * instead of against a mock of Privy's hooks.
 */
export interface SelectableWallet {
  readonly address: string;
  /**
   * Solana only — Privy's Wallet Standard object. **Absent on an EVM
   * `ConnectedWallet`**, which is why it is optional: one selection rule has
   * to accept both wallet lists, and the alternative (two `pickWallet`s) is
   * two places for the "never fall back to the embedded wallet" rule to live.
   */
  readonly standardWallet?: unknown;
  /**
   * EVM only — Privy's own client type. `"privy"` is the embedded wallet;
   * `"metamask"`, `"rainbow"`, … are external. Absent on the Solana list.
   */
  readonly walletClientType?: string;
}

/**
 * `isPrivyWallet` is a getter on Privy's `PrivyStandardWallet` class and is
 * absent from the `SolanaStandardWallet` interface every wallet implements.
 * An `instanceof` check is unavailable because the class has no runtime export
 * — only a type one. So the discriminator is the property itself, read through
 * a narrowing cast. (`in` was used here before; it is not safer — it *throws*
 * when `standardWallet` is nullish, where an optional read does not.)
 */
export function isEmbeddedWallet(wallet: SelectableWallet): boolean {
  const standard = wallet.standardWallet as { isPrivyWallet?: boolean } | null | undefined;
  if (standard?.isPrivyWallet === true) return true;
  /*
    The EVM half. `ConnectedWallet` has no `standardWallet` at all — its
    discriminator is `walletClientType`, and `"privy"` is the value Privy
    stamps on its own embedded wallet. Pinned below so a rename stops
    compiling rather than silently making every EVM wallet look external,
    which would flip `pickWallet`'s no-address preference to "whichever came
    first".
  */
  return wallet.walletClientType === "privy";
}

/**
 * The whole selection rule, pure and exported so it can be tested.
 *
 * - **With a requested address:** the connected wallet whose address matches
 *   **exactly** — base58, case-sensitive, no normalisation and no trimming.
 *   Solana addresses are case-significant, and a caller that wants trimming
 *   should trim its own input where the user typed it, not have this function
 *   quietly accept something the backend will reject. No match is `null`, never
 *   a fallback: handing back the wrong wallet is what breaks the proof.
 * - **With no requested address:** the embedded wallet if there is one — it is
 *   the wallet the backend linked to `agents.primary_account_id` at first
 *   login, so signing with it is signing as the identity the platform knows —
 *   otherwise the first connected external wallet, meaning *some* connected
 *   external wallet, not one the user picked.
 */
export function pickWallet<W extends SelectableWallet>(
  wallets: readonly W[],
  requestedAddress?: string,
): W | null {
  if (requestedAddress !== undefined) {
    return wallets.find((wallet) => wallet.address === requestedAddress) ?? null;
  }
  return wallets.find(isEmbeddedWallet) ?? wallets[0] ?? null;
}

// ── EIP-712, adapted to Privy's own shape ────────────────────────────────

/**
 * The wire's `Eip712Domain` in the shape Privy's `SignTypedDataParams` wants.
 *
 * Two conversions, both measured against `@privy-io/react-auth@3.37.4`'s
 * `TypedMessage<MessageTypes>` and neither of them cosmetic:
 *
 * 1. **`chainId` is a decimal STRING on the wire and a `number` in Privy.**
 *    The domain separator is hashed from it, so a wrong value is a signature
 *    valid over nothing that fails only on chain. Converted here with a
 *    `Number.isSafeInteger` guard rather than an unchecked `Number()`, because
 *    the wire type is a u256 and the failure of a silent overflow is exactly
 *    the "looks like success" shape this file exists to refuse.
 * 2. **`salt` is a string on the wire and an `ArrayBuffer` in Privy.** There is
 *    no lossless conversion without knowing the encoding, and passing the
 *    domain on *without* it changes the domain separator. So a salted domain
 *    is REFUSED by name. Nothing sends one today; the day
 *    something does, this throw is where the encoding gets decided.
 */
export function toPrivyDomain(domain: Eip712Domain): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
} {
  if (domain.salt !== undefined) {
    throw new Error(
      `${CHAIN_OPERATION_UNSUPPORTED}: this EIP-712 domain carries a salt ` +
        `(${JSON.stringify(domain.salt)}), and Privy takes a salt as an ArrayBuffer. ` +
        `Dropping it would change the domain separator, so this is refused rather than signed.`,
    );
  }
  const chainId = Number(domain.chainId);
  if (!Number.isSafeInteger(chainId) || !/^\d+$/.test(domain.chainId)) {
    throw new Error(
      `useSigner: EIP-712 domain chainId ${JSON.stringify(domain.chainId)} is not a safe ` +
        `integer. The domain separator is hashed from it; a rounded value signs nothing.`,
    );
  }
  return {
    name: domain.name,
    version: domain.version,
    chainId,
    verifyingContract: domain.verifyingContract,
  };
}

/**
 * The wire's readonly field lists, copied into the mutable arrays Privy's
 * `MessageTypes` declares. A copy, not a cast: `readonly` is the wire's claim
 * that nothing here rewrites the struct definition, and casting it away would
 * hand Privy an array this module has promised not to change.
 */
export function toPrivyTypes(
  types: Record<string, readonly Eip712Field[]>,
): Record<string, Array<{ name: string; type: string }>> {
  return Object.fromEntries(
    Object.entries(types).map(([name, fields]) => [name, fields.map((field) => ({ ...field }))]),
  );
}

// ── the state machine ────────────────────────────────────────────────────

export interface SignerStateInput<W extends SelectableWallet> {
  readonly chainId: string | null;
  readonly ready: boolean;
  readonly wallets: readonly W[];
  readonly requested?: string;
  /** Built only when a wallet is selected; keeps this function testable without Privy. */
  readonly build: (wallet: W, chainId: string) => Signer;
}

/**
 * The whole five-state decision, pure and exported so it is tested without
 * mounting React. The hook below only feeds it.
 */
export function resolveSignerState<W extends SelectableWallet>(
  input: SignerStateInput<W>,
): UseSignerResult {
  /*
    `chain-unknown` first, and before `ready`. A screen that has not resolved
    its chain has not asked a question yet, and answering "hydrating" would
    make it look like something is in progress that is not.
  */
  if (input.chainId === null) return { status: "chain-unknown", signer: null };
  if (!input.ready) return { status: "hydrating", signer: null };
  if (input.wallets.length === 0) return { status: "no-wallet", signer: null };

  const wallet = pickWallet(input.wallets, input.requested);
  if (wallet === null) {
    /*
      With no requested address `pickWallet` falls back to `wallets[0]`, and
      the list is non-empty by the check above — so this branch is only
      reachable with one. The ternary is what lets the union stay total
      without casting `requested` to `string`.
    */
    return input.requested === undefined
      ? { status: "no-wallet", signer: null }
      : { status: "address-not-connected", signer: null, requested: input.requested };
  }
  return { status: "ready", signer: input.build(wallet, input.chainId) };
}

// ── errors ───────────────────────────────────────────────────────────────

/** EIP-1193's rejection code, which the Solana wallets adopted verbatim. */
const USER_REJECTED_CODE = 4001;

const USER_REJECTED_MESSAGE = /user (rejected|denied|declined)|(rejected|declined) the request/i;

/**
 * A declined prompt surfaces differently per wallet, so the signing surface
 * owns the vocabulary rather than leaving every call site to hand-roll
 * "anything thrown means declined" — which also swallows a real RPC failure.
 *
 * The embedded wallet rejects with Privy's `ProviderRpcError` carrying
 * `code === 4001` (`E4001_USER_REJECTED_REQUEST.eipCode` in the bundle). An
 * external wallet's error propagates **unwrapped** from the injected provider,
 * where the same 4001 is the convention but the message is sometimes all there
 * is. `cause` is walked a few links because wallet-standard adapters re-throw
 * wrapped.
 */
export function isUserRejection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === "string") return USER_REJECTED_MESSAGE.test(current);
    if (typeof current !== "object") return false;

    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === USER_REJECTED_CODE || candidate.code === String(USER_REJECTED_CODE)) {
      return true;
    }
    if (typeof candidate.message === "string" && USER_REJECTED_MESSAGE.test(candidate.message)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

// ── hook ─────────────────────────────────────────────────────────────────

/**
 * @param options.chainId The CAIP-2 chain this signer is for. **Required, and
 * nullable rather than defaulted**: `null` means *not known yet* and yields
 * `chain-unknown`. A default of Solana would be the silent default this
 * module's own chain map exists to refuse.
 * @param options.address The address that must do the signing. Omit it for
 * *"sign as me"* (the deposit, the withdrawal acknowledgement); pass it
 * wherever the backend or a contract verifies the signature against a specific
 * address (the provider payout-address proof). Omitting it there fails 100% of
 * the time, because Privy composes the wallet list embedded-first.
 */
export function useSigner(options: { chainId: string | null; address?: string }): UseSignerResult {
  const { chainId, address: requested } = options;
  const solana = useWallets();
  const { signMessage } = useSignMessage();
  const { signTransaction } = useSignTransaction();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  /*
    Both namespaces' hooks run on every render. React admits no `if` around a
    hook call, and the alternative — two hooks in two components — would mean
    two wallet sources that can point at the same identity, which is the exact
    problem this file refused to take on when it declined
    `@solana/wallet-adapter-react`.
  */
  const evm = useEvmWallets();
  const { signMessage: evmSignMessage } = useEvmSignMessage();
  const { signTypedData: evmSignTypedData } = useEvmSignTypedData();
  const { signTransaction: evmSignTransaction } = useEvmSignTransaction();

  return useMemo<UseSignerResult>(
    () => {
      /*
        The namespace picks the wallet list, and each branch keeps its own
        wallet TYPE — `resolveSignerState` is generic precisely so the Solana
        branch can hand Privy a `ConnectedStandardSolanaWallet` and the EVM
        branch a `ConnectedWallet`, with no cast between them. Passing a union
        array through one call is what would need the cast, and a cast here is
        how a Solana wallet ends up being asked to sign an EIP-712 struct.
      */
      if (chainId !== null && isEvmChain(chainId)) {
        return resolveSignerState({
          chainId,
          ready: evm.ready,
          wallets: evm.wallets,
          requested,
          build: (wallet, boundChainId) => {
            /*
              `signTransaction` is embedded-only, refused by name otherwise.
              MetaMask and most injected wallets do not implement
              `eth_signTransaction` — they sign and send in one step — and
              Privy's `signTransaction` is embedded-only for the same reason.
              Injected wallets take `signAndSend` instead, and a deposit they
              send is settled by hash (`POST /deposits/:id/broadcast`).
            */
            const assertSignable = (tx: Eip155UnsignedTransaction): void => {
              if (!isEmbeddedWallet(wallet)) {
                throw new Error(
                  `${CHAIN_OPERATION_UNSUPPORTED}: an external wallet cannot sign a transaction ` +
                    `on ${boundChainId} without sending it. Use your Privy wallet for this.`,
                );
              }
              if (tx.from.toLowerCase() !== wallet.address.toLowerCase()) {
                throw new Error(
                  `useSigner: this transaction is from ${tx.from}, but the wallet is ${wallet.address}.`,
                );
              }
            };

            /** The one Privy signing call both eip155 transaction doors share. */
            const signFilled = async (tx: Eip155UnsignedTransaction, options?: WalletPromptOptions) => {
              const { signature } = await evmSignTransaction(
                {
                  from: tx.from,
                  to: tx.to,
                  data: tx.data,
                  value: BigInt(tx.value),
                  nonce: Number(tx.nonce),
                  gasLimit: BigInt(tx.gasLimit),
                  maxFeePerGas: BigInt(tx.maxFeePerGas),
                  maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
                  chainId: Number(boundChainId.slice(boundChainId.indexOf(":") + 1)),
                  // EIP-1559. Every field above is already filled, so Privy has
                  // nothing to look up and no RPC to call.
                  type: 2,
                },
                // `{ address }` for the reason `signTypedData` gives below.
                { address: wallet.address, ...privyTxUi(options) },
              );
              return signature as `0x${string}`;
            };

            return {
            address: wallet.address,
            kind: isEmbeddedWallet(wallet) ? "embedded" : "external",
            chainId: boundChainId,

            signMessage: async (message) => {
              /*
                Privy's EVM `signMessage` speaks strings; the port speaks bytes
                on both chains so no call site has to know which it is on.
              */
              const { signature } = await evmSignMessage(
                { message: new TextDecoder().decode(message) },
                { address: wallet.address },
              );
              return hexToBytes(signature);
            },

            signTransaction: async (tx, options) => {
              assertChainMatches(boundChainId, tx);
              /*
                Signed and handed back UNSENT — for the deposit's `depositFor`,
                which `POST /deposits/:id/settle` takes and `EvmFacilitator`
                verifies and broadcasts: the x402 `exact` shape the Solana
                deposit has always had. It is the same consumer the Solana
                branch below serves, not a new submit path — the facilitator
                can only broadcast the exact bytes signed here.
              */
              if (tx.namespace !== "eip155" || tx.kind !== "transaction") {
                throw new Error(`${CHAIN_OPERATION_UNSUPPORTED}: ${tx.kind} on ${boundChainId}`);
              }
              /*
                Embedded wallets only, refused by name otherwise. MetaMask and
                most injected wallets do not implement `eth_signTransaction` —
                they sign and send in one step — and Privy's `signTransaction`
                is embedded-only for the same reason. An injected wallet's
                deposit goes through `signAndSend` and is settled by hash.
              */
              assertSignable(tx);
              // Privy names it `signature`; it is the whole signed, serialized
              // transaction, which is what the settle route takes.
              return {
                namespace: "eip155",
                chainId: boundChainId,
                rawTransaction: await signFilled(tx, options),
              };
            },

            signTypedData: async (request, options) => {
              assertChainMatches(boundChainId, request);
              /*
                The wrapper's `chainId` is not what is signed; the domain's is.
                An embedded wallet never switches chain, so without this it
                would sign a domain for any chain the payload names (frontend
                review 2026-10-15, F1).
              */
              const boundReference = boundChainId.slice(boundChainId.indexOf(":") + 1);
              if (String(request.domain.chainId) !== boundReference) {
                throw new Error(
                  `useSigner: this signer is bound to ${JSON.stringify(boundChainId)}, but the EIP-712 ` +
                    `domain names chain ${JSON.stringify(String(request.domain.chainId))}. Nothing was signed.`,
                );
              }
              if (!isEmbeddedWallet(wallet)) {
                /*
                  MetaMask refuses `eth_signTypedData_v4` when the domain's
                  chainId is not its active chain. Every struct this platform
                  signs names the chain in its domain, so an injected wallet
                  left on another network could prove nothing, arm no escrow
                  limit and withdraw nothing until it is moved here first.
                */
                await wallet.switchChain(
                  Number(boundChainId.slice(boundChainId.indexOf(":") + 1)),
                );
              }
              const { signature } = await evmSignTypedData(
                {
                  domain: toPrivyDomain(request.domain),
                  types: toPrivyTypes(request.types),
                  primaryType: request.primaryType,
                  message: request.message,
                },
                /*
                  `{ address }` is not optional in spirit. Privy defaults to the
                  first wallet, which is the embedded one, and every EIP-712
                  request this platform makes is verified on chain against a
                  specific address (`AssayEscrow`'s `authNonce` is per buyer).
                  Signing as the wrong wallet produces a signature that reverts
                  BadSignature after the user approved it.

                  `uiOptions.showWalletUIs: true` when the caller asks for it
                  (R-WEB-5): Privy then always shows its confirmation, with the
                  typed data, before the embedded wallet signs.
                */
                { address: wallet.address, ...privyUi(options) },
              );
              return signature as `0x${string}`;
            },

            signAndSend: async (tx, options) => {
              assertChainMatches(boundChainId, tx);
              if (tx.namespace !== "eip155" || tx.kind !== "transaction") {
                throw new Error(`${CHAIN_OPERATION_UNSUPPORTED}: ${tx.kind} on ${boundChainId}`);
              }
              if (!isEmbeddedWallet(wallet)) {
                /*
                  An injected wallet (MetaMask, Rabby, …) cannot sign without
                  sending — but SENDING is exactly what this door asks for. So
                  it is handed only from/to/data and broadcasts with its own
                  RPC and nonce; the hash comes back. The page never holds
                  signed bytes, and nothing here is trusted downstream: a
                  deposit hash is re-read from the chain by the backend.
                */
                if (tx.from.toLowerCase() !== wallet.address.toLowerCase()) {
                  throw new Error(
                    `useSigner: this transaction is from ${tx.from}, but the wallet is ${wallet.address}.`,
                  );
                }
                if (tx.value !== "0") {
                  throw new Error(
                    `useSigner: refusing to send ${tx.value} wei of value on ${boundChainId}; ` +
                      `no transaction this platform builds carries value.`,
                  );
                }
                return sendFromInjectedWallet({
                  provider: await wallet.getEthereumProvider(),
                  switchChain: (id) => wallet.switchChain(id),
                  chainId: boundChainId,
                  from: wallet.address,
                  to: tx.to,
                  data: tx.data as `0x${string}`,
                });
              }
              assertSignable(tx);
              // Refilling reads nonce, gas and fees; it has no field for value,
              // and nothing this platform asks a wallet to send is payable.
              if (tx.value !== "0") {
                throw new Error(
                  `useSigner: refusing to send ${tx.value} wei of value on ${boundChainId}; ` +
                    `no transaction this platform builds carries value.`,
                );
              }
              /*
                Refilled from the page's own RPC, then signed and broadcast here
                rather than through Privy's `useSendTransaction`.

                Refilled, because the fields the intent was built with are stale
                by the time a wallet is asked: a stake deposit's `approve` lands
                between the build and this call and takes the nonce the intent
                named. Signed with the same embedded-only call the deposit uses,
                and broadcast from the page, so the Privy iframe never reaches an
                RPC at all — the arrangement already proved on the deposit path,
                and the one that keeps a public origin from calling a private
                address (Chrome Private Network Access).
              */
              const filled = await fillTransaction({
                chainId: boundChainId,
                from: tx.from,
                to: tx.to,
                data: tx.data as `0x${string}`,
              });
              return broadcast(boundChainId, await signFilled(filled, options));
            },
          };
          },
        });
      }

      return resolveSignerState({
        chainId,
        ready: solana.ready,
        wallets: solana.wallets,
        requested,
        build: (wallet, boundChainId) => ({
          address: wallet.address,
          kind: isEmbeddedWallet(wallet) ? "embedded" : "external",
          chainId: boundChainId,

          signMessage: async (message) => {
            const { signature } = await signMessage({ message, wallet });
            return signature;
          },

          signTransaction: async (tx, options) => {
            assertChainMatches(boundChainId, tx);
            if (!isSolanaTransaction(tx)) {
              /*
                Unreachable while `boundChainId` names a solana:* chain, and
                typed as total anyway: a union member that cannot occur here
                still has to compile, and a silent `as` is how the impossible
                case ships.
              */
              throw new Error(`${CHAIN_OPERATION_UNSUPPORTED}: ${tx.kind} on ${boundChainId}`);
            }
            const { signedTransaction } = await signTransaction({
              transaction: base64ToBytes(tx.transactionBase64),
              wallet,
              chain: toSolanaChain(boundChainId),
              ...(options ? { options: privyTxUi(options) } : {}),
            });
            /*
              Base64 out, not raw bytes. Every caller hands the result straight
              back to an API that takes `transactionBase64`, and the encoding was
              being done at three call sites. Doing it once here is the same
              argument the old `signAndSendTransaction` made for base58-encoding a
              signature: `String(bytes)` produces a comma-joined byte list that
              looks enough like the real thing to be pasted into a report.
            */
            return {
              namespace: "solana",
              chainId: boundChainId,
              transactionBase64: toBase64(signedTransaction),
            };
          },

          signTypedData: async () => {
            /*
              Symmetrical with the throw this hook used to make on eip155:*,
              and honest. There is no Solana analogue of EIP-712; signing some
              other byte layout would produce a signature no verifier on either
              chain checks, which is worse than a refusal because it looks like
              success.
            */
            throw new Error(
              `${CHAIN_OPERATION_UNSUPPORTED}: EIP-712 typed data has no Solana equivalent ` +
                `(chain ${boundChainId}).`,
            );
          },

          signAndSend: async (tx, options) => {
            assertChainMatches(boundChainId, tx);
            if (!isSolanaTransaction(tx)) {
              throw new Error(`${CHAIN_OPERATION_UNSUPPORTED}: ${tx.kind} on ${boundChainId}`);
            }
            /*
              `toSolanaChain` is evaluated as part of building the argument, so an
              unknown chain id throws BEFORE the wallet is asked for anything —
              there is no prompt to decline and nothing lands on chain.
            */
            const { signature } = await signAndSendTransaction({
              transaction: base64ToBytes(tx.transactionBase64),
              wallet,
              chain: toSolanaChain(boundChainId),
              ...(options ? { options: privyTxUi(options) } : {}),
            });
            return base58Encode(signature);
          },
        }),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see the comment above
    [chainId, solana.ready, solana.wallets, evm.ready, evm.wallets, requested],
  );
}

/**
 * Every wallet address connected in this browser, across BOTH namespaces, in
 * the order Privy composes them (embedded first within each list).
 *
 * The account menu needs a COUNT and an identity seed, not a signer — "how
 * many wallets do I have" is not a per-chain question and cannot be answered
 * by `useSigner`, which is bound to one chain by design. Reading the two Privy
 * lists here rather than in the menu keeps this file the single wallet source,
 * which is the whole reason `@solana/wallet-adapter-react` was declined: two
 * wallet sources that can point at the same identity.
 *
 * Deduplicated, because one address can legitimately appear twice — the same
 * external wallet connected through two connectors — and a menu that says
 * "3 wallets" for two is wrong in the one place a user checks who they are.
 */
export function useConnectedAddresses(): readonly string[] {
  const solana = useWallets();
  const evm = useEvmWallets();
  return useMemo(
    () => [
      ...new Set([
        ...solana.wallets.map((wallet) => wallet.address),
        ...evm.wallets.map((wallet) => wallet.address),
      ]),
    ],
    [solana.wallets, evm.wallets],
  );
}

/*
  A type pin, not a test. If Privy removes or renames `isPrivyWallet`, this
  stops compiling — which is exactly the failure a fixture test with a
  hand-written wallet object sails past, because the fixture keeps declaring the
  property long after the real wallet stops carrying it.
*/
type _PinIsPrivyWallet = PrivyStandardWallet["isPrivyWallet"] extends boolean ? true : never;
const _pin: _PinIsPrivyWallet = true;
void _pin;

/*
  The same pin for the EVM half. `isEmbeddedWallet` reads `walletClientType`
  off a `ConnectedWallet` because that list carries no `standardWallet` at all;
  if Privy renames or drops it, this stops compiling. Without the pin, the
  rename would make every EVM wallet read as "external", which is not an error
  anywhere — it silently changes which wallet `pickWallet` hands back when no
  address was requested.
*/
type _PinEvmClientType = ConnectedWallet["walletClientType"] extends string ? true : never;
const _pinEvm: _PinEvmClientType = true;
void _pinEvm;
