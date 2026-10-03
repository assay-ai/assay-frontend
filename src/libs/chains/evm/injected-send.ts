/**
 * Sends one transaction through an injected wallet (MetaMask, Rabby, …) and
 * returns its hash.
 *
 * Injected wallets implement `eth_sendTransaction` and NOT
 * `eth_signTransaction`: they sign and broadcast in one step, and there is no
 * way to get signed-unsent bytes out of them. So where the embedded wallet
 * path signs here and broadcasts from the page, this path lets the WALLET
 * broadcast and hands back only the hash — which the deposit then reports to
 * `POST /deposits/:id/broadcast`, where the backend reads the transaction from
 * the chain rather than trusting anything this page says about it.
 *
 * Only `from`, `to`, `data` and a zero `value` are sent. The wallet fills
 * nonce, gas and fees from its own RPC; filling them here from the page's RPC
 * would be overridden by most wallets anyway, and a stale nonce is worse than
 * none.
 */
export interface Eip1193Like {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export async function sendFromInjectedWallet(input: {
  readonly provider: Eip1193Like;
  /** Privy's `ConnectedWallet.switchChain` — adds the chain from `supportedChains` if missing. */
  readonly switchChain: (chainId: number) => Promise<void>;
  readonly chainId: string;
  readonly from: string;
  readonly to: string;
  readonly data: `0x${string}`;
}): Promise<`0x${string}`> {
  const [namespace, reference] = input.chainId.split(":");
  const numeric = Number(reference);
  if (namespace !== "eip155" || !Number.isSafeInteger(numeric)) {
    throw new Error(`sendFromInjectedWallet: ${input.chainId} is not an eip155 chain`);
  }

  // Before the send, never after: a wallet still on another network would
  // broadcast this calldata THERE, to whatever lives at `to` on that chain.
  await input.switchChain(numeric);

  const hash = await input.provider.request({
    method: "eth_sendTransaction",
    params: [{ from: input.from, to: input.to, data: input.data, value: "0x0" }],
  });

  if (typeof hash !== "string" || !TX_HASH_RE.test(hash)) {
    throw new Error(
      `The wallet answered eth_sendTransaction with something that is not a transaction hash ` +
        `(${JSON.stringify(hash)}).`,
    );
  }
  return hash as `0x${string}`;
}
