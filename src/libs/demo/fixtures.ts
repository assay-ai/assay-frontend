import { BUYER_FIXTURES } from "./fixtures-buyer";
import { EXPLORE_FIXTURES } from "./fixtures-explore";
import { OPERATOR_FIXTURES } from "./fixtures-operator";
import { PROVIDER_FIXTURES } from "./fixtures-provider";
import { PUBLIC_FIXTURES } from "./fixtures-public";

/**
 * The stage set — DEMO ONLY. See `demo-api.ts` for the rules these obey.
 *
 * One entry per API path the demo needs to look alive. `match` is the path
 * with no query string; `body` receives that path so a fixture can answer
 * per-id. Keep every figure internally consistent: the same call appears in
 * spend, in receipts and in the escrow's held total, and a viewer who adds
 * them up should not catch us.
 */
export interface DemoFixture {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly match: string | RegExp;
  /** `body` is the request body, for a POST/PATCH fixture that echoes a field (e.g. a key's name). */
  readonly body: (path: string, query: Record<string, unknown>, body?: unknown) => unknown;
  /**
   * Vestigial. It marked the routes whose real answer had to be overridden
   * rather than merely filled; every fixture now answers before the network
   * reaches the API at all, so the distinction no longer has anywhere to
   * apply. Kept because three fixture files set it, and removing it is a
   * rename across all of them for no behaviour change.
   */
  readonly override?: "empty" | "always";
}

/** The one chain this demo settles on — the same id `demo-chains.ts` serves. */
export const DEMO_CHAIN_ID = "eip155:46630";

/** CAIP-19 for the USDG the 46630 faucet mints. */
export const DEMO_ASSET = `${DEMO_CHAIN_ID}/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec`;

/** The buyer's own account, CAIP-10, and the address every screen shortens. */
export const DEMO_BUYER_ADDRESS = "0x7a3f9C2b4E81aD5f0b9C6d2E8F1a4B7c3D5e9F20";
export const DEMO_BUYER_ACCOUNT = `${DEMO_CHAIN_ID}:${DEMO_BUYER_ADDRESS}`;

/** Money on the wire is minor units plus a scale — never a float. */
export function money(major: string): { amount: string; decimals: number; currency: string } {
  const [whole, fraction = ""] = major.split(".");
  const minor = `${whole}${fraction.padEnd(6, "0").slice(0, 6)}`;
  return { amount: String(BigInt(minor)), decimals: 6, currency: "USD" };
}

/** `now - minutes`, as the ISO string every list sorts on. */
export function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * Order matters only where two entries could match one path: the first match
 * wins, so a specific path must be listed before a regex that also covers it.
 */
export const DEMO_FIXTURES: readonly DemoFixture[] = [
  ...BUYER_FIXTURES,
  ...EXPLORE_FIXTURES,
  ...PROVIDER_FIXTURES,
  ...PUBLIC_FIXTURES,
  ...OPERATOR_FIXTURES,
  {
    /*
      A MetaMask-only Privy identity has no Solana wallet, so the API's link
      lookup truthfully never resolves and the buyer sits behind "Setting up
      your wallet" forever. The demo says it landed — on the chain this demo
      is about.
    */
    method: "POST",
    match: "/auth/wallet/link",
    body: () => ({ linked: true, account: DEMO_BUYER_ACCOUNT, chainId: DEMO_CHAIN_ID }),
  },
  {
    method: "GET",
    match: "/balances",
    override: "always",
    body: () => ({
      balances: [
        {
          chainId: DEMO_CHAIN_ID,
          accountId: DEMO_BUYER_ACCOUNT,
          asset: DEMO_ASSET,
          decimals: 6,
          available: money("482.15"),
          held: money("17.85"),
          total: money("500.00"),
          chainBalance: money("500.00"),
          spendable: money("482.15"),
          withdrawable: money("482.15"),
          chainReadable: true,
        },
      ],
    }),
  },
];
