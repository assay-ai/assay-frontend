/**
 * Where the provider's independent penalty check reads the chain — pinned in
 * the frontend bundle on purpose.
 *
 * ## Why this does not come from `GET /chains`
 *
 * Every other chain fact in this app (RPC, explorer, settlement asset) is
 * served by the backend, and that is right for screens that only *act* through
 * the backend. This screen exists for the opposite case: **our backend is
 * compromised and its emails and pages cannot be trusted.** A backend that can
 * name the RPC this page reads through can also name an RPC that answers "no
 * penalties", and the check would pass while the stake is being slashed. So the
 * four facts the read depends on — chain, RPC, contract, first block — are
 * fixed at build time and travel with the frontend, not with the API. The
 * explorer is pinned for the same reason: a served explorer could be a clone
 * that shows whatever the forger wants.
 *
 * The values come from the EVM deployment record
 * (`assay-evm/deployments/46630.json`, `contracts.AssayStake.proxy`) and its
 * broadcast (`broadcast/Deploy.s.sol/46630/run-latest.json`: the proxy's
 * CREATE2 landed in block `0x8743934` = 141,834,548). The RPC and explorer are
 * the ones `providers/index.tsx` already writes out for the same chain.
 *
 * ## Two stacks on the same chain
 *
 * The develop and production backends both run on Robinhood testnet, each
 * with its own contracts. `NEXT_PUBLIC_EVM_DEPLOYMENT` picks the set at build
 * time; the deploy workflow derives it from the branch (`main` →
 * `production`), never from an environment variable the API could influence.
 * Unset (local and e2e builds) means the develop set.
 *
 * ## Also the trust anchor for every signature and call
 *
 * The same record pins the escrow, config and settlement token, so every
 * EIP-712 request and contract call the app signs is checked against these
 * values and never against anything the API served (`libs/chains/evm/signing-guard.ts`).
 * A chain with no entry here is a chain the app refuses to sign for.
 *
 * The stake asset's scale is NOT pinned: it is read from the contract
 * (`ASSET()` then the token's `decimals()`). `fallbackAssetDecimals` is used
 * only if that read fails, and the deployment record says 6 (USDG).
 */
export interface StakeDeployment {
  /** CAIP-2. */
  readonly chainId: string;
  /** Shown to people. */
  readonly displayName: string;
  /** A public JSON-RPC endpoint the browser reads through directly. */
  readonly rpcUrl: string;
  /** Block explorer base; links are built with `URL`, see `explorerTxUrl`. */
  readonly explorerBaseUrl: string | null;
  /** The AssayStake proxy. */
  readonly stakeContract: `0x${string}`;
  /** The AssayEscrow proxy: the EIP-712 verifying contract for buyer requests and payout proofs. */
  readonly escrowContract: `0x${string}`;
  /** The AssayConfig proxy (the arbiter's `setBlocked`). */
  readonly configContract: `0x${string}`;
  /** The settlement token (USDG) that deposits approve and stake. */
  readonly settlementToken: `0x${string}`;
  /** The proxy's deployment block — no slash can be older than this. */
  readonly deployBlock: bigint;
  /** The AssayConfig proxy's deployment block — no verifier key event is older than this. */
  readonly configDeployBlock: bigint;
  /** Only if `ASSET().decimals()` cannot be read. */
  readonly fallbackAssetDecimals: number;
  /** Only if `ASSET().symbol()` cannot be read. */
  readonly fallbackAssetSymbol: string;
}

const ROBINHOOD_TESTNET = {
  chainId: "eip155:46630",
  displayName: "Robinhood Chain testnet",
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
  settlementToken: "0xDbbC156dD414f43f2c952C1Be0f16A0B9a826Cd3",
  fallbackAssetDecimals: 6,
  fallbackAssetSymbol: "USDG",
} as const;

/** The develop stack's contracts (api-dev). */
export const ROBINHOOD_TESTNET_DEV_STAKE: StakeDeployment = {
  ...ROBINHOOD_TESTNET,
  stakeContract: "0xAfe1e699d188Ab5042B693978E889D7c5085F710",
  escrowContract: "0x343606d8Db3872EEC5Ea56cb43b9F4606Bfdf71f",
  configContract: "0x7d4F60198a1519074ce1E316911E2f130643231c",
  deployBlock: BigInt(141_834_548),
  configDeployBlock: BigInt(141_834_514),
};

/** The production trial stack's contracts (api), deployed from the same commit as develop's. */
export const ROBINHOOD_TESTNET_PRODUCTION_STAKE: StakeDeployment = {
  ...ROBINHOOD_TESTNET,
  stakeContract: "0x33De8AD7a1A2Ce9817bB18Cc17b76C23f92B4cFd",
  escrowContract: "0xE68A6E2810027dB5da48c2110bd3993eD8177115",
  configContract: "0xB33Cdac203cC50099a64a9316C71A1c17C11C66C",
  deployBlock: BigInt(141_936_083),
  configDeployBlock: BigInt(141_936_054),
};

export const ROBINHOOD_TESTNET_STAKE: StakeDeployment =
  process.env.NEXT_PUBLIC_EVM_DEPLOYMENT === "production"
    ? ROBINHOOD_TESTNET_PRODUCTION_STAKE
    : ROBINHOOD_TESTNET_DEV_STAKE;

/** Every chain this page can check. One today. */
export const STAKE_DEPLOYMENTS: readonly StakeDeployment[] = [ROBINHOOD_TESTNET_STAKE];

export function stakeDeploymentFor(chainId: string | null | undefined): StakeDeployment | null {
  if (!chainId) return null;
  return STAKE_DEPLOYMENTS.find((deployment) => deployment.chainId === chainId) ?? null;
}

/** A link to one transaction on the pinned explorer, or `null` when there is none. */
export function explorerTxLink(deployment: StakeDeployment, txHash: string): string | null {
  if (!deployment.explorerBaseUrl) return null;
  const url = new URL(deployment.explorerBaseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/tx/${encodeURIComponent(txHash)}`;
  return url.toString();
}

/** A link to one address on the pinned explorer, or `null` when there is none. */
export function explorerAddressLink(deployment: StakeDeployment, address: string): string | null {
  if (!deployment.explorerBaseUrl) return null;
  const url = new URL(deployment.explorerBaseUrl);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/address/${encodeURIComponent(address)}`;
  return url.toString();
}
