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
 * (`assay-evm/deployments/46630.json`, `contracts.X402Stake.proxy`) and its
 * broadcast (`broadcast/Deploy.s.sol/46630/run-latest.json`: the proxy's
 * CREATE2 landed in block `0x7e49e9f` = 132,423,327). The RPC and explorer are
 * the ones `providers/index.tsx` already writes out for the same chain.
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
  /** The X402Stake proxy. */
  readonly stakeContract: `0x${string}`;
  /** The proxy's deployment block — no slash can be older than this. */
  readonly deployBlock: bigint;
  /** Only if `ASSET().decimals()` cannot be read. */
  readonly fallbackAssetDecimals: number;
  /** Only if `ASSET().symbol()` cannot be read. */
  readonly fallbackAssetSymbol: string;
}

export const ROBINHOOD_TESTNET_STAKE: StakeDeployment = {
  chainId: "eip155:46630",
  displayName: "Robinhood Chain testnet",
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  explorerBaseUrl: "https://explorer.testnet.chain.robinhood.com",
  stakeContract: "0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c",
  deployBlock: BigInt(132_423_327),
  fallbackAssetDecimals: 6,
  fallbackAssetSymbol: "USDG",
};

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
