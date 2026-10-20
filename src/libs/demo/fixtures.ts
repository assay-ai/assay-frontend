import { demoMinutesAgo } from "./demo-clock";
import { BUYER_FIXTURES, demoBuyerLedger, demoMoneyMinor } from "./fixtures-buyer";
import { compositeFixtures } from "./fixtures-composite";
import { freshAtLeast, freshStage } from "./fresh-account";
import { EXPLORE_FIXTURES } from "./fixtures-explore";
import { OPERATOR_FIXTURES } from "./fixtures-operator";
import { PROVIDER_FIXTURES, providerNotifications } from "./fixtures-provider";
import { PUBLIC_FIXTURES } from "./fixtures-public";
import { contractNotices } from "./fixtures-refusals-contracts";
import { T4_FIXTURES, t4Notifications } from "./fixtures-t4";
import { DEMO_WEATHER_TOOLSET, demoToolsetNotifications, TOOLSET_FIXTURES } from "./fixtures-toolsets";

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
  /** `data` is the request body of a write (empty for a read), so a stand-in can echo it. */
  readonly body: (path: string, query: Record<string, unknown>, data?: Record<string, unknown>) => unknown;
}

/** The one chain this demo settles on — the same id `demo-chains.ts` serves. */
export const DEMO_CHAIN_ID = "eip155:46630";

/** CAIP-19 for the USDG the 46630 faucet mints. */
export const DEMO_ASSET = `${DEMO_CHAIN_ID}/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec`;

/** The buyer's own account, CAIP-10, and the address every screen shortens. */
export const DEMO_BUYER_ADDRESS = "0x7a3f9C2b4E81aD5f0b9C6d2E8F1a4B7c3D5e9F20";
export const DEMO_BUYER_ACCOUNT = `${DEMO_CHAIN_ID}:${DEMO_BUYER_ADDRESS}`;

/**
 * Money on the wire is minor units plus a scale — never a float — and the
 * asset it is in. The asset matters: the settle sheet compares the escrow's
 * balance and ceilings with the debts by asset, and an escrow fixture with no
 * `asset` matched no debt, so its pre-check never showed (review 2026-10-17).
 */
export function money(major: string): { amount: string; asset: string; decimals: number; currency: string } {
  const [whole, fraction = ""] = major.split(".");
  const minor = `${whole}${fraction.padEnd(6, "0").slice(0, 6)}`;
  return { amount: String(BigInt(minor)), asset: DEMO_ASSET, decimals: 6, currency: "USD" };
}

/**
 * `now - minutes`, as the ISO string every list sorts on. "Now" is the demo
 * clock, fixed for the session (`demo-clock.ts`), so a fixture's date is the
 * same on every screen and after a reload. Something that happens on a click
 * (a mutation's `createdAt`) uses `justNow()` instead.
 */
export function minutesAgo(minutes: number): string {
  return demoMinutesAgo(minutes);
}

/** The real current time, for what a demo action does on a click. */
export function justNow(): string {
  return new Date().toISOString();
}

/**
 * Order matters only where two entries could match one path: the first match
 * wins, so a specific path must be listed before a regex that also covers it.
 */
const SINGLE_ROUTE_FIXTURES: readonly DemoFixture[] = [
  {
    /*
      One organization's notifications serve two consoles. The provider Inbox
      asks for `provider.*` events (the real server filters on `event`), so
      that read gets the provider's notices; every other read falls through to
      the buyer's.
    */
    method: "GET",
    match: "/notifications",
    body: (path, query) => {
      const events = ([] as unknown[]).concat(query.event ?? []);
      if (events.length > 0 && events.some((event) => typeof event === "string" && event.startsWith("provider."))) {
        // T3: the provider's tool_version.* notices ride along (the Inbox asks for them by name).
        const provider = providerNotifications() as { items: unknown[]; pageInfo: unknown };
        return { ...provider, items: [...t4Notifications("PROVIDER"), ...contractNotices("PROVIDER"), ...provider.items] };
      }
      const buyer = BUYER_FIXTURES.find((fixture) => fixture.method === "GET" && fixture.match === "/notifications");
      const feed = (buyer ? buyer.body(path, query) : { items: [], pageInfo: { nextCursor: null, hasMore: false } }) as { items: unknown[]; pageInfo: unknown };
      // `?connect=update-available`: a tool set "prod" uses has a new version (FR-17).
      return { ...feed, items: [...demoToolsetNotifications(), ...t4Notifications("BUYER"), ...contractNotices("BUYER", DEMO_WEATHER_TOOLSET), ...feed.items] };
    },
  },
  // T4 first: it answers a few paths the files below also match (receipts, the public handle, catalogues).
  ...T4_FIXTURES,
  ...TOOLSET_FIXTURES,
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
    body: () => {
      // A fresh demo account (?fresh=) has nothing until its first deposit
      // (stage "bind" opens a $20 escrow), matching the escrow fixture.
      const stage = freshStage();
      const fresh = stage ? (freshAtLeast(stage, "bind") ? "20.00" : "0") : null;
      // A buyer debt's price stays held too, as on `/escrow` and `/holds` (see `demoBuyerLedger`).
      const ledger = demoBuyerLedger();
      const available = fresh ? money(fresh) : demoMoneyMinor(ledger.available);
      const total = fresh ? money(fresh) : demoMoneyMinor(ledger.balance);
      return {
        balances: [
          {
            chainId: DEMO_CHAIN_ID,
            accountId: DEMO_BUYER_ACCOUNT,
            asset: DEMO_ASSET,
            decimals: 6,
            available,
            held: fresh ? money("0") : demoMoneyMinor(ledger.held),
            total,
            chainBalance: total,
            spendable: available,
            withdrawable: available,
            chainReadable: true,
          },
        ],
      };
    },
  },
];

/** One single-route fixture's answer, or `undefined` when none matches (first match wins, as in `demo-api.ts`). */
function singleRouteAnswer(path: string, query: Record<string, unknown> = {}): unknown {
  const fixture = SINGLE_ROUTE_FIXTURES.find(
    (f) => f.method === "GET" && (f.match instanceof RegExp ? f.match.test(path) : f.match === path),
  );
  return fixture?.body(path, query);
}

/** The composite reads first: each is made of the single-route answers below it. */
export const DEMO_FIXTURES: readonly DemoFixture[] = [...compositeFixtures(singleRouteAnswer), ...SINGLE_ROUTE_FIXTURES];
