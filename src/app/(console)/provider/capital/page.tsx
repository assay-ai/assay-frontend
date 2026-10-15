"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { ArrowUpFromLine, Fuel, PenLine, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Field } from "@/components/ui/field";
import { MetricTile } from "@/components/ui/metric-tile";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, type TableColumn } from "@/components/ui/table";
import { StakeByChain } from "@/components/provider/stake-by-chain";
import { formatCount } from "@/features/buyer/period";
import {
  latestObservedAt,
  stakeActionChain,
  hasAmbiguousStakeChain,
  stakeChains,
  stakeDecimals,
} from "@/features/provider-stake/chain-stake";
import { runStakeIntent, type StakeExpectation } from "@/features/provider-stake/run-stake-intent";
import { useChains } from "@/hooks/useChains";
import type { Chain } from "@/interfaces/chain";
import {
  missingRequirementNote,
  readableDerivation,
} from "@/features/provider-stake/derivation";
import { isUserRejection, useSigner, type UseSignerResult } from "@/hooks/useSigner";
import type {
  ProviderStake,
  ProviderStakeRequirementItem,
  StakeIntent,
  ToolBindingSummary,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { describeChainRefusal } from "@/libs/chains/status-labels";
import { isEvmChain } from "@/libs/chains/registry";
import { listSlaWindows } from "@/services/provider-sla-windows.service";
import {
  createOpenStakeIntent,
  createStakeDepositIntent,
  revalidateProviderStake,
} from "@/services/provider-stake.service";
import { listToolBindings } from "@/services/provider-tool-bindings.service";
import { isSolanaTransaction } from "@/interfaces/chain-transaction";
import { chainIdOfAccount } from "@/utils/chain";
import { exceedsScale, formatMoney, toAtomic } from "@/utils/money";
import { labelForEndpoint, shortBindingId } from "@/utils/provider-label";

/**
 * Stake and exposure — route `/provider/capital`.
 *
 * Page Header · a per-chain stake panel · two Tiles · a Row of two panels
 * (Requirement by binding, Exposure) · a Note, straight down the frame's
 * `Main`. The sidebar, the 16px gap and the [22,26] padding are the
 * `(console)` layout's; nothing here draws a shell.
 *
 * ## The stake became a list, and this screen did not notice for a while
 *
 * `GET /providers/me/stake` moved `staked`, `observedAt`, `unbonding`,
 * `hasKnownStake`, `chainReadable` and `stakeAuthority` onto a **per-chain
 * array**. This page kept reading them at the top level, where every one of
 * them was then `undefined` — and `!undefined` is `true`, so the outage banner
 * fired unconditionally and told a provider with a confirmed **$500.00**
 * bonded on a chain reporting `chainReadable: true` that the chain could not
 * be read, with all four figures as em dashes. It did not throw, and 311
 * tests, a clean `tsc` and a 56/56 build all stayed green.
 *
 * The fix is the type (`ProviderStake`), which turned this and five other
 * screens into compile errors, plus two structural changes here:
 *
 * - The **response-wide outage banner is gone.** An outage is an outage of one
 *   network; `StakeByChain` marks the row it happened on and no other.
 * - The **Staked and Unbonding tiles are gone**, replaced by that panel. A
 *   tile has one slot, and filling one slot from N chains means picking a row
 *   or adding them up — the pick is always somebody's wrong chain, and the sum
 *   is never true of any single call. Required and Headroom stay tiles because
 *   they are denominated in the stake floor's one asset and are about that one
 *   chain; see `requirementChain`.
 *
 * ## The rule is `max`, and the frame says both things
 *
 * The design contradicts itself. The Required tile's sub-line and the
 * panel's sub-line both say **sum**; the panel's own totals row
 * says "the maximum, not the sum, applies per binding floor". The
 * wire settles it — `GET /providers/me/stake` returns
 * `requirementRule: "max"`, `requirement[0].derivation` reads
 * `max(floor 50.000000, 1000 × 0.250000) = 250.000000`, and `requirementTotal`
 * is that same 250, not a sum. So the word in those two captions is printed
 * from `requirementRule` rather than transcribed, and the totals row keeps its
 * sentence verbatim because it was already right. The design's two `sum` captions want correcting at source.
 *
 * ## Absent is not zero, and `formatMoney(null)` is "$0.00"
 *
 * That is the trap this screen is most exposed to. `formatMoney` answers
 * `"$0.00"` for a null Money, which on this screen would tell a provider their
 * stake floor is nothing — the one wrong answer that reads as good news. Every
 * figure here therefore goes through `money()`, which returns an em dash for a
 * null and never reaches `formatMoney` with one.
 *
 * `requirement[]` carries **ACTIVE PAID/FREEMIUM bindings only**. A PAUSED paid
 * binding is simply absent from it, and absent means "no requirement is
 * computed", not "$0 required" — it gets a dash. A FREE binding is absent for
 * the opposite reason: it genuinely requires nothing, which is a real zero, and
 * the frame's own FREE row writes `$0.00`. Two absences, two
 * different renderings.
 *
 * ## What has no source
 *
 * - **The Exposure panel's first three rows are slash-cap arithmetic.** They
 *   are a projection of a worst case, not a measurement of anything. There is
 *   no economic-parameters endpoint (no slash cap, no per-window ceiling, no
 *   30-day roll-up), so all three render the unknown treatment.
 * - **There is no measured exposure figure any more, on this frame or on the
 *   wire.** Lean v3 removed the exposure authority and the `exposed` /
 *   `exposure_updated_at` fields it wrote; a withdrawal is bounded
 *   arithmetically by the program instead. So this panel is a projection and
 *   says so — there is no present-liability number it is standing in for.
 * - **The header's "last observed slot 291,004,112"** — no slot number is on
 *   the wire. `observedAt` is, so the stamp is a time rather than a slot.
 * - **Auto-sweep has no endpoint.** The switch is rendered disabled rather than
 *   drawn "On", because a control that cannot act is the same failure as a
 *   search box that silently ignores you.
 * - **Request unstake is disabled.** Unstaking and withdrawing are the exit
 *   path, and `/provider/exit` already builds both of those intents against
 *   the same endpoints. Wiring a second copy here would be two screens racing
 *   on one unbonding clock.
 *
 * ## Opening a stake account, then funding it
 *
 * The order is enforced by the program, not by this screen:
 * `open_stake` is deliberately not `init_if_needed`, so a deposit against a
 * PDA that does not exist answers `409 PROVIDER_STAKE_ACCOUNT_NOT_OPEN`, and a
 * second open answers `409 PROVIDER_STAKE_ACCOUNT_ALREADY_OPEN`. Both are
 * surfaced here as *information* — "that is already done" is not a failure.
 *
 * **Both actions render unconditionally, and that is deliberate.** Nothing on
 * the wire says whether the stake PDA exists. `hasKnownStake` means "the stake
 * *source* has a reading for this provider ON THIS CHAIN", not "the account is
 * open" — with the source still `mode=config`, a provider listed in the seed
 * file reads `true` with no PDA on chain at all. Hiding "Open stake account"
 * behind it would hide the one button the whole flow starts with, on exactly
 * the provider who needs it. So both are offered and the backend answers.
 *
 * They act on **one** chain, resolved by `stakeActionChain` and never by
 * `stake[0]`: the transaction names that chain's stake authority as fee payer
 * and sole signer, so an index would build a transaction for a chain the
 * provider did not choose and it would look correct until it was signed. With
 * no unambiguous chain the buttons are disabled and a sentence says why.
 *
 * ## The wallet, and which one
 *
 * The console signs. `useSigner` is scoped to the **stake authority's
 * own address**, read out of the CAIP-10 `stakeAuthority`: the transaction's
 * fee payer and only signer is that account, so signing with the embedded
 * wallet would produce bytes the chain rejects. `signAndSendTransaction`
 * broadcasts from the provider's browser — the platform has no submit endpoint
 * and must never grow one (`stake-intent-builder.port.ts:20-21`).
 */

const DASH = "—";

/**
 * The one money formatter this screen uses.
 *
 * `formatMoney(null)` returns `"$0.00"`. On a stake screen that is not a
 * cosmetic slip: it is the difference between "we have not computed a floor for
 * you" and "your floor is nothing". A wave-A agent shipped exactly that.
 */
function money(value: Parameters<typeof formatMoney>[0], decimals = 2): string {
  if (!value) return DASH;
  return formatMoney(value, { decimals });
}

/** `2026-08-21 06:57 UTC`, the stamp every other console header uses. */
function utcStamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

interface RequirementRow {
  id: string;
  binding: string;
  mode: string;
  price: string;
  derivation: string;
  required: string;
}

/**
 * One row per binding the provider owns, not one per `requirement[]` entry.
 *
 * The frame draws three rows including a FREE one, and `requirement[]` would
 * never contain it. Driving the table off the binding list and joining the
 * requirement in keeps a paused paid binding visible — which is the row a
 * provider most needs to see, because it is the one whose traffic already
 * stopped.
 */
function requirementRows(
  bindings: ToolBindingSummary[],
  requirement: ProviderStakeRequirementItem[],
  chains: readonly Chain[]
): RequirementRow[] {
  const byBinding = new Map(requirement.map((item) => [item.bindingId, item]));

  return bindings.map((binding) => {
    const item = byBinding.get(binding.id);
    const label = labelForEndpoint(binding.endpoint) || shortBindingId(binding.id);

    if (item) {
      return {
        id: binding.id,
        binding: label,
        mode: item.pricingMode,
        price: money(item.price, 4),
        // The wire's arithmetic, printed at the point of the claim; an asset
        // mismatch is said in plain words instead of ids and a reason code.
        derivation: readableDerivation(item.derivation, chains),
        // `minimum: null` means "priced in an asset the floor is not
        // denominated in" — the gate refuses it rather than converting. Not a
        // zero.
        required: money(item.minimum),
      };
    }

    if (binding.pricingMode === "FREE") {
      return {
        id: binding.id,
        binding: label,
        mode: binding.pricingMode,
        price: DASH,
        derivation: "free bindings require no stake",
        // A real zero: nothing is required, and the frame writes it as one.
        required: "$0.00",
      };
    }

    // A PAID/FREEMIUM binding missing from `requirement[]` is not live (or the
    // read predates it going live). No requirement is computed for it, so there is no figure — and $0.00 here
    // would read as "you need no stake", which is the opposite of the truth
    // the moment it is resumed.
    return {
      id: binding.id,
      binding: label,
      mode: binding.pricingMode,
      price: money(binding.price, 4),
      derivation: missingRequirementNote(binding.status),
      required: DASH,
    };
  });
}

/** The Headroom tile is the design's warning tile only when there is no buffer. */
function headroomIsZero(stake: ProviderStake | undefined): boolean {
  return Boolean(stake?.headroom && stake.headroom.amount === "0");
}

/*
  `stakeDecimals` moved to `@/features/provider-stake/chain-stake` when the
  stake became per chain: its old body read `stake.staked` at the top level,
  which is now `undefined`, and it would have silently fallen back to the
  constant on every response.
*/

/**
 * The chain-native address out of a CAIP-10 `stakeAuthority`
 * (`solana:<genesis>:<address>`).
 *
 * `""` when there is none, and never `undefined`: `useSigner()` with no address
 * falls back to the **embedded** wallet, which is not the account these
 * transactions name as fee payer and sole signer. An empty string matches no
 * wallet, so the hook answers `address-not-connected` — which is the truth —
 * instead of handing back a wallet whose signature the chain will reject.
 */
function authorityAddress(stakeAuthority: string | null | undefined): string {
  if (!stakeAuthority) return "";
  const segments = stakeAuthority.split(":");
  return segments.length >= 3 ? segments[segments.length - 1] : stakeAuthority;
}

export default function ProviderCapitalPage() {
  const stake = useQuery({
    queryKey: ["provider", "stake"],
    // Revalidated past the browser's HTTP cache: provider GETs carry an hour
    // of stale-while-revalidate, and a body from before a binding was resumed
    // left an ACTIVE binding out of the requirement table (BUG-R16-V3-01).
    queryFn: revalidateProviderStake,
  });

  /* Shared with the `(console)` layout's rail — same key, so no second trip. */
  const bindings = useQuery({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
  });

  /*
    "Open windows" is the only Exposure row with an honest source. An SLA
    window IS the slash window the three cap rows above it are about, and
    `status: "OPEN"` is what "open" means (`IN_PROGRESS` in an earlier API).
    Windows are per-binding, so this is every open window across
    every binding this provider owns, not a single provider-wide window.
  */
  const windows = useQuery({
    queryKey: ["provider", "sla-windows", "open"],
    queryFn: () => listSlaWindows({ limit: 20, status: "OPEN" }),
  });

  const data = stake.data;
  const observedAt = latestObservedAt(data);
  /* Display names for the per-chain panel. An unnamed chain still gets a row. */
  const { chains } = useChains();
  const rule = data?.requirementRule ?? "max";
  const openWindows = windows.data?.items ?? [];

  const rows = requirementRows(bindings.data?.items ?? [], data?.requirement ?? [], chains);

  const columns: TableColumn<RequirementRow>[] = [
    {
      key: "binding",
      header: "Binding",
      mono: true,
      // The frame sets only the identity cell at 600; Table has no per-column
      // weight, so it rides on the value.
      cell: (row) => <span className="font-semibold">{row.binding}</span>,
    },
    { key: "mode", header: "Mode", width: 130, align: "end", mono: true, cell: (r) => r.mode },
    { key: "price", header: "Price", width: 120, align: "end", mono: true, cell: (r) => r.price },
    {
      key: "derivation",
      header: "Derivation",
      width: 280,
      align: "end",
      mono: true,
      // The frame's own totals row runs a 51-character sentence through this
      // 280px cell and lets it bleed, so the column is not an ellipsis column.
      // It is also the one cell whose whole purpose is to be readable in full:
      // an ellipsised `max(floor 50.000000, 1000 ×…` audits nothing.
      noTruncate: true,
      cell: (r) => r.derivation,
    },
    {
      key: "required",
      header: "Required",
      width: 120,
      align: "end",
      mono: true,
      cell: (r) => r.required,
    },
  ];

  const total = {
    label: "Total",
    values: {
      mode: DASH,
      price: DASH,
      // Verbatim from the design, and the half of it that is right.
      derivation: "the maximum, not the sum, applies per binding floor",
      // `requirementTotal` is the max over the per-binding minima. `null` is
      // "nothing to stake against", not "$0 required".
      required: money(data?.requirementTotal),
    } as Partial<Record<string, React.ReactNode>>,
  };

  const error = [stake.error, bindings.error, windows.error].find(
    (e): e is ApiError => e instanceof ApiError
  );

  /*
    ONE chain the header's two buttons act on, resolved by a stated rule and
    never by `stake[0]` — see `stakeActionChain`. These transactions name that
    chain's stake authority as fee payer and sole signer, so an index here
    builds a transaction for a chain the provider did not choose and it looks
    correct on every screen until it is signed.
  */
  const actionChain = stakeActionChain(data);
  const ambiguousChain = Boolean(data) && actionChain === null && hasAmbiguousStakeChain(data);
  const noAuthority = data ? actionChain?.stakeAuthority == null : true;
  /*
    eip155 has no stake account: `X402Stake` keys a mapping on the provider and
    the first deposit writes it. The backend refuses OPEN_STAKE there with
    PROVIDER_STAKE_ACCOUNT_NOT_NEEDED; the button is simply not offered.
  */
  const actionChainId = chainIdOfAccount(actionChain?.stakeAuthority);
  const opensAccount = actionChainId === null || !isEvmChain(actionChainId);

  /*
    Scoped to the stake authority, not to "me" — see the module docstring. One
    hook for the whole screen: the sheet is handed the result rather than
    calling `useSigner` a second time, so the header's disabled state and the
    sheet's copy can never disagree about which wallet is available.
  */
  const authority = authorityAddress(actionChain?.stakeAuthority);
  /*
    The chain is the stake authority's own — `stakeAuthority` is CAIP-10, so it
    names the chain this stake account lives on. `null` until the query answers
    (and for a provider with no proved authority), which is `chain-unknown`:
    "Preparing…", not "you have no wallet".
  */
  const signerState = useSigner({
    chainId: chainIdOfAccount(actionChain?.stakeAuthority),
    address: authority,
  });
  const signerReady = signerState.status === "ready";

  const [action, setAction] = React.useState<StakeAction | null>(null);
  const [broadcast, setBroadcast] = React.useState<BroadcastResult | null>(null);
  const queryClient = useQueryClient();

  return (
    <>
      {/* Page Header — row, gap 16, space-between, centred. */}
      <header className="flex w-full flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Capital</h1>
          <p className="font-mono text-mono-12 text-03">
            {/*
              The design writes "chain is authoritative · last observed slot
              291,004,112". No slot number exists on any provider endpoint;
              `observedAt` does, so the clause names a time. The first half is
              the design's, the second half is ours.
            */}
            {/*
              The MOST RECENT observation across every chain, not `stake[0]`'s.
              With two chains the first row's stamp would silently become the
              whole page's, and it is the older one exactly when one chain is
              lagging — the case the stamp exists to reveal. Each row carries
              its own stamp in the panel below.
            */}
            {observedAt
              ? `chain is authoritative · last observed ${utcStamp(observedAt)}`
              : "chain is authoritative · nothing observed yet"}
          </p>
          <Link href="/provider/capital/penalties" className="self-start text-body-13 text-02 underline">
            Penalties on chain
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {/*
            NOT ON THE FRAME, and it renders in every state on purpose: nothing
            on the wire says whether the stake PDA exists (`hasKnownStake` is
            about the stake *source*, not the account), so the only authority on
            "already open" is the backend's own 409. See the module docstring.
          */}
          {opensAccount ? (
            <Button
              variant="secondary"
              icon={<Plus />}
              type="button"
              disabled={noAuthority || !signerReady}
              onClick={() => setAction("OPEN_STAKE")}
            >
              Open stake account
            </Button>
          ) : null}
          {/*
            Still disabled, and deliberately. Unstake and withdraw are the exit
            path and `/provider/exit` builds both against the same endpoints;
            a second copy here would be two screens on one unbonding clock.
          */}
          <Button variant="secondary" disabled icon={<ArrowUpFromLine />}>
            Request unstake
          </Button>
          {/*
            Live now. Disabled only for the three states in which it genuinely
            cannot act — no proved authority (every intent answers
            409 PROVIDER_STAKE_AUTHORITY_UNPROVEN), no wallet for that authority
            connected in this browser, or an action already open, which is the
            window in which a build or a signature can be in flight. The reason
            is spelled out under the panels rather than left to be discovered by
            clicking nothing.
          */}
          <Button
            icon={<Plus />}
            type="button"
            disabled={noAuthority || !signerReady || action !== null}
            onClick={() => setAction("DEPOSIT")}
          >
            Deposit
          </Button>
        </div>
      </header>

      {error ? (
        <Banner
          tone="danger"
          title="Your stake position could not be loaded"
          description={describeChainRefusal(error)}
        />
      ) : null}

      {/*
        The signature, kept on the page after the sheet closes. It is the only
        receipt the provider has — the platform never sees this transaction, it
        was broadcast by their own wallet — and it is what they take to an
        explorer while the tiles below still read the pre-transaction chain
        state. Saying so is the point: silence here reads as "it did not work".
      */}
      {broadcast ? (
        <Banner
          tone="primary"
          title={
            broadcast.kind === "OPEN_STAKE"
              ? "Your stake account was broadcast"
              : `A deposit of ${formatMoney(broadcast.amount, { decimals: 2 })} was broadcast`
          }
          description={`Signature ${broadcast.signature}. Your wallet sent this, not the platform. The figures below are read from the chain when the stake source next observes it, so they will not move immediately.`}
        />
      ) : null}

      {/*
        THE RESPONSE-WIDE OUTAGE BANNER IS GONE, and its absence is the fix.

        It read `!data.chainReadable` — a top-level field the backend had
        already moved onto the per-chain entries. `undefined` is falsy, so it
        fired on every load, and a provider with $500.00 bonded on a chain that
        had just answered `chainReadable: true` was told the chain could not be
        read while every figure rendered as an em dash.

        A response-wide flag was the wrong shape even when it existed: an RPC
        outage is an outage of ONE network, and reporting it against a chain
        that answered fine is a fabricated incident. `StakeByChain` marks the
        row it happened on, and only that row.
      */}

      {/*
        A grace period is per binding, never per provider — one provider can
        hold three at once with three deadlines. `graceSummary` is enough to
        draw one banner and says so in its own docstring; `requirement[].grace`
        stays the source of truth for the per-binding detail. The frame draws
        no banner for this state at all, so this whole block, and its copy, are
        ours. NOTE: unexercised — no seeded provider is in grace.
      */}
      {data?.graceSummary ? (
        <Banner
          tone={
            data.requirement.some((item) => item.grace?.expired) ? "danger" : "warning"
          }
          title={
            data.requirement.some((item) => item.grace?.expired)
              ? "A grace period has run out"
              : `${formatCount(data.graceSummary.bindingsInGrace)} binding${
                  data.graceSummary.bindingsInGrace === 1 ? " is" : "s are"
                } below the minimum`
          }
          description={`Earliest deadline ${utcStamp(data.graceSummary.earliestExpiresAt)}. Paid traffic stops on a binding when its own clock expires.`}
        />
      ) : null}

      {/*
        Stake by chain — NOT on the frame, which draws one "Staked" tile and
        one chain. A tile has one slot, and the only ways to fill one slot from
        N chains are to pick one or to add them up: the pick is always the
        first row and always somebody's wrong chain, and the sum is the one
        number that is never true, because a call is slashed in the settlement
        contract of the chain it was paid on and no single call is backed by
        the total. So the two chain-derived tiles became a list.
      */}
      {/*
        `status` is REQUIRED and is passed from the query, not inferred from
        the array. `stakeChains(data)` answers `[]` in three unrelated
        situations — pending, failed, and an organization with no chain
        enrolled — and the panel used to give all three the same sentence: "No
        chain is enrolled for this organization yet… This is not a stake of
        zero." Measured in Chrome with the request held open, under a provider
        carrying $500.00 bonded, that sentence was the FIRST thing painted.
      */}
      <StakeByChain
        stake={stakeChains(data)}
        chains={chains}
        status={stake.isPending ? "loading" : stake.isError ? "error" : "ready"}
      />

      {/*
        Tiles — the two figures that are NOT per chain.

        `requirementTotal`, `headroom`, `shortfall` and `recommendedBuffer` are
        all denominated in the stake floor's single asset and are therefore
        about that ONE chain — they compare against that chain's entry above
        and nothing else. Fanning them across chains here would print a floor
        against a chain it was never computed for. Making the requirement per
        chain needs the per-chain floor threaded through the backend service
        and is recorded as deferred work there; it is not this screen's to
        approximate.
      */}
      <section className="grid w-full grid-cols-1 gap-3.5 mobile:grid-cols-2">
        <MetricTile
          label="Required"
          value={money(data?.requirementTotal)}
          // `YKx9x/J2XR8` says "sum over active paid bindings". The rule is
          // `max`; the word is printed from `requirementRule`.
          sub={`${rule} over active paid bindings`}
        />
        <MetricTile
          label="Headroom"
          value={money(data?.headroom)}
          sub={
            headroomIsZero(data)
              ? // Verbatim `iK2iM/J2XR8` — and true exactly when it is drawn,
                // i.e. when there is no buffer at all.
                "no buffer — we recommend 1.5×"
              : data?.recommendedBuffer
                ? // Not in the design, which only draws the zero case.
                  `we recommend 1.5× — ${money(data.recommendedBuffer)}`
                : "we recommend 1.5×"
          }
          // MetricTile has `default` and `teal` and no warning tone; the frame
          // paints this tile $warning-10 / $warning-20 / $warning-600. The gap
          // is a known gap. Applied here the way the binding-detail screen already
          // reaches the value node, and only in the state the frame drew it.
          className={
            headroomIsZero(data)
              ? "border-warning-20 bg-warning-10 [&>p:nth-child(2)]:text-warning-600"
              : undefined
          }
        />
      </section>

      {/*
        Row — the wide requirement panel beside a 520px Exposure panel.

        The frame's own arithmetic does not close. Beside a 520px Exposure
        panel the requirement panel measures 598px (measured, not estimated),
        while the requirement table's own columns need 880px: Mode 130 + Price
        120 + Derivation 280 + Required 120, plus four 12px gaps and 24px of
        row padding, plus a legible Binding column. The panel therefore renders
        with its **Required column clipped away entirely** — screenshot the
        node on its own and the $50.00 figures are simply not on the canvas.

        So the row keeps every design width and becomes side-by-side only where
        it fits: 248 rail + 52 padding + 880 + 16 gap + 520 = 1716px. Below
        that the two panels stack, which is the arrangement in which every
        column the frame draws is actually visible. Widening the panel in the
        design or trimming the widths would let them sit side by side.
      */}
      <section className="flex w-full flex-col gap-4 min-[1716px]:flex-row">
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Requirement by binding</PanelTitle>
              {/* The design says "sum"; the rule comes off the wire. */}
              <PanelDescription>
                {`rule: ${rule} over active paid bindings, floor $50 each`}
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          {/*
            Body — padding [6, 10, 10, 10], plus a horizontal scroll
            the frame does not have and needs.

            The frame's own column widths do not fit the frame's own panel.
            Beside a 520px Exposure panel the requirement panel is 604px wide,
            while Mode + Price + Derivation + Required alone are 650px before
            gaps and padding — so the panel renders with the **Required column
            clipped away entirely** and the totals sentence overlapping the
            Price cell. Reproducing
            that faithfully would hide the one figure the panel exists to
            state, so the table keeps every design width and scrolls instead.
          */}
          <PanelBody className="overflow-x-auto px-2.5 pb-2.5 pt-1.5">
            {rows.length > 0 ? (
              <Table
                className="min-w-[880px]"
                columns={columns}
                rows={rows}
                total={total}
                caption="Requirement by binding"
              />
            ) : (
              /*
                The design draws no empty state — it has three rows. This copy is
                not from the design, and it is the `?persona=new-provider` branch: an
                unregistered organization gets 200 with an empty
                `requirement[]`, not a 404.
              */
              <p className="px-3 py-6 text-body-13 text-02">
                No binding requires stake yet. A requirement is computed per active
                paid binding, so this stays empty until you publish one.
              </p>
            )}
          </PanelBody>
        </Panel>

        {/* Exposure — fixed 520 in the frame, and only where the row
            is actually a row; stacked it fills the width instead of leaving
            600px of nothing beside it. */}
        <Panel className="shrink-0 min-[1716px]:w-[520px]">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Exposure</PanelTitle>
              <PanelDescription>capped, and capped again</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          {/* Body — padding [8, 20, 18, 20]. */}
          <PanelBody className="px-5 pb-[18px] pt-2">
            {/*
              The three cap rows are the slash-cap projection the design draws: a
              worst case, not a measured liability. The program has no measured
              liability to show — the exposure authority and the field it wrote
              are gone. No endpoint exposes an economic parameter (slash cap,
              per-window ceiling, 30-day roll-up) either, so all three carry the
              unknown treatment. The formulas beneath them are the frame's own
              words and stay verbatim: they state the policy, which is the part
              that is known.
            */}
            <ExposureRow
              term="Max loss, any one window"
              formula="max($5, 100 × price)"
              value={DASH}
            />
            <ExposureRow
              term="Max loss, all bindings, 24h"
              formula="10% of total stake, per provider, per day"
              value={DASH}
            />
            <ExposureRow
              term="Max loss, 30 days"
              formula="if every window breached, which they will not"
              value={DASH}
            />
            <ExposureRow
              term="Open windows"
              /*
                The frame writes `w_4482 (218/400) · w_4483 (44/400)`.
                `minVerifiedCalls` IS the 400 the design means — real
                per window, not the `totalCalls` stand-in this used before the
                gate was published — so the bracket is now verified-over-gate,
                matching the design exactly. `label` (`w_4482`), not
                `windowId` (a uuid), is what is quotable.
              */
              formula={
                windows.isLoading
                  ? DASH
                  : openWindows.length > 0
                    ? openWindows
                        .map((w) => `${w.label} (${w.verifiedCalls}/${w.minVerifiedCalls})`)
                        .join(" · ")
                    : "none open"
              }
              value={windows.isLoading ? DASH : formatCount(openWindows.length)}
            />

            {/* Sweep — a top rule, then the label and the switch. */}
            <div className="flex w-full items-center gap-3 border-t border-02 pt-3.5">
              <p className="min-w-0 flex-1 text-body-sm text-01">
                Auto-sweep earnings to stake when below minimum
                <span className="block text-body-xs text-03">
                  there is nothing to sweep — every call pays your own wallet as it settles
                </span>
              </p>
              {/*
                Drawn "On" in the frame. It was already disabled because no
                endpoint stores the preference or applies it; the program removes
                the thing it would have acted on as well — a provider's share
                is paid to their own token account inside the settling
                transaction, so no balance accrues here to sweep. The control
                stays visible rather than being deleted because the frame draws
                it and its absence would read as a rendering fault; the caption
                is what stops it reading as a feature that is merely off.
              */}
              <Switch
                disabled
                checked={false}
                readOnly
                aria-label="Auto-sweep earnings to stake when below minimum"
                label={DASH}
              />
            </div>
          </PanelBody>
        </Panel>
      </section>

      {/*
        Note — $primary-10 on $primary-20, a fuel icon, one sentence at
        13/400. Banner's title node is 13/600, so only the type is overridden.

        The frame paints the sentence **$primary-700**, and that is deliberately
        NOT applied. `theme.scss` keeps the accent ramps mode-independent on the
        claim that they "hold contrast on both grounds"; primary-700 (#3a3a9e)
        on the dark ground does not — measured at roughly 2:1 against the
        note's own background, and legible only by knowing what it says. The
        frame is a light-mode frame, where the same token is correct. Rather
        than invent a dark-mode substitute on one screen, the sentence keeps
        Banner's theme-aware `$text-01`, which is what every other banner in
        the console renders. The ramp is a design-system defect.
      */}
      <Banner
        tone="primary"
        icon={<Fuel />}
        className="items-start [&>div>p]:whitespace-normal [&>div>p]:text-body-13"
        title="Before you sign a deposit you are shown what it needs: the stake amount, the network fee for gas, and your balance of both. Gas is not sponsored for providers; you pay the network fee yourself."
      />

      {/*
        Not in the design. Both header buttons above can be disabled, and a
        disabled control that does not say why is the same dead end as one that
        refuses silently. Two different causes, two different next actions.
      */}
      {data && ambiguousChain ? (
        /*
          Two or more chains and no unambiguous one to act on — see
          `stakeActionChain`. The buttons are disabled rather than defaulting to
          `stake[0]`: these transactions name one chain's stake authority as
          fee payer and sole signer, so a first-row pick builds a transaction
          for a chain the provider did not choose and it looks correct right up
          to the signature. `/provider/exit` builds the same intents; a
          per-chain control on this header is the real answer and is not built.
        */
        <p data-testid="stake-chain-ambiguous" className="text-body-13 text-03">
          You have stake authority on more than one chain, and this header can only act on one.
          Opening and funding a stake account is per chain — use the{" "}
          <Link href="/provider/exit" className="underline">
            Leaving
          </Link>{" "}
          screen, which builds the same transactions against the chain you name.
        </p>
      ) : data && noAuthority ? (
        <p className="text-body-13 text-03">
          No stake authority has been proved on this chain yet, so a stake account cannot be
          opened or funded from here. Proving one is a wallet signature, on the{" "}
          <Link href="/provider/exit" className="underline">
            Leaving
          </Link>{" "}
          screen.
        </p>
      ) : data && !signerReady ? (
        <p className="text-body-13 text-03">
          {signerState.status === "chain-unknown"
            ? /*
                Never "you have no wallet". The stake authority has not been
                read yet, so no chain is known and there is nothing for the
                provider to connect — a wallet sentence here is one they cannot
                act on.
              */
              "Preparing…"
            : signerState.status === "hydrating"
              ? "Reading the wallets connected in this browser…"
              : /*
                The stake authority is usually an org or cold wallet, so "you
                have no wallet" is almost never the true sentence here — "the
                wallet that holds this address is not connected" is. The
                address is named so it can be looked for.
              */
                `The wallet that holds ${authority} is not connected in this browser, and it is the only key that can sign for this stake account. Connect it to open or fund one.`}
        </p>
      ) : null}

      <StakeActionSheet
        action={action}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
        stake={data}
        opensAccount={opensAccount}
        signerState={signerState}
        onSigned={(signed) => {
          setBroadcast(signed);
          /*
            Invalidated, and the banner above is why that is not enough on its
            own.

            Provider GETs carry `Cache-Control: private, max-age=10,
            stale-while-revalidate=3600`, so the refetch this triggers can be
            served the PRE-WRITE body straight out of the BROWSER's HTTP cache
            for up to an hour — React Query never sees it, the response is a
            200. That is a defect that once made the operator console show stale state.

            And here even a perfect refetch would show the old figure: `staked`
            is read off the chain, the transaction has only just been
            broadcast, and the stake source is polled rather than subscribed.
            There is nothing on the intent response to seed a truthful new
            figure from, so nothing is invented into the cache — the banner
            carries the signature and says the tiles have not caught up yet,
            which is the one statement that is true in both cases.
          */
          queryClient.invalidateQueries({ queryKey: ["provider", "stake"] });
        }}
      />
    </>
  );
}

/** One "Max loss …" line: term over formula on the left, figure on the right. */
function ExposureRow({
  term,
  formula,
  value,
}: {
  term: string;
  formula: string;
  value: string;
}) {
  return (
    <div className="flex w-full items-center gap-4 py-[11px]">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-body-sm text-01">{term}</p>
        <p className="truncate font-mono text-mono-xs text-03">{formula}</p>
      </div>
      <p className="shrink-0 font-mono text-mono-sm font-semibold text-01">{value}</p>
    </div>
  );
}

/* ── open, then deposit ──────────────────────────────────────────────────── */

/**
 * The two intents this screen builds. `UNSTAKE` and `WITHDRAW` are the exit
 * path and live on `/provider/exit`; they are absent here on purpose.
 */
type StakeAction = "OPEN_STAKE" | "DEPOSIT";

/** What the provider's own wallet put on chain, kept after the sheet closes. */
interface BroadcastResult {
  kind: StakeAction;
  /** base58, from `signAndSendTransaction`. */
  signature: string;
  /** `null` for OPEN_STAKE, which carries no amount. */
  amount: StakeIntent["amount"];
}

/** Where the sheet is. Only `preflight` and `idle` are states to act from. */
type SheetPhase = "idle" | "building" | "preflight" | "signing" | "done";

/**
 * Build the intent, show its preflight, then hand the bytes to the wallet.
 *
 * **Two presses, never one.** The intent response carries a `preflight` saying
 * what the transaction needs and what the authority holds — and gas is *not*
 * sponsored for providers, by design. Telling someone they are ~0.01 SOL short
 * before a wallet opens is a sentence they can act on; letting the prompt open
 * and the chain refuse turns the same fact into an opaque rejection with a
 * cost attached. So the preflight is rendered and the signature is a separate,
 * deliberate press.
 *
 * The platform never sees the signed bytes. `runStakeIntent` decodes the
 * base64, derives the chain from `intent.account` and calls
 * `signAndSendTransaction`; the provider's wallet broadcasts. There is no
 * submit endpoint and there must never be one.
 */
function StakeActionSheet({
  action,
  onOpenChange,
  stake,
  opensAccount,
  signerState,
  onSigned,
}: {
  action: StakeAction | null;
  onOpenChange: (open: boolean) => void;
  stake: ProviderStake | undefined;
  /** False on eip155: no account to open, and a deposit is approve + deposit. */
  opensAccount: boolean;
  signerState: UseSignerResult;
  onSigned: (result: BroadcastResult) => void;
}) {
  const decimals = stakeDecimals(stake);
  const [amount, setAmount] = React.useState("");
  const [phase, setPhase] = React.useState<SheetPhase>("idle");
  const [intent, setIntent] = React.useState<StakeIntent | null>(null);
  /* What was asked for when `intent` was built; it is signed only if it says this. */
  const [requested, setRequested] = React.useState<StakeExpectation | null>(null);
  /** A refusal the platform stated. Its own code and sentence, never reworded. */
  const [refusal, setRefusal] = React.useState<ApiError | null>(null);
  /** Anything the wallet or the browser said. Never blank when it is set. */
  const [walletDetail, setWalletDetail] = React.useState<string | null>(null);
  const [declined, setDeclined] = React.useState(false);

  // Every press starts from a clean sheet — a preflight built for a previous
  // amount, or a previous refusal, must not sit under a new attempt.
  React.useEffect(() => {
    setPhase("idle");
    setIntent(null);
    setRefusal(null);
    setWalletDetail(null);
    setDeclined(false);
    setAmount("");
  }, [action]);

  /*
    Parsed and scaled with decimal.js and `toAtomic`, which refuses an
    over-precise amount rather than rounding it. `parseFloat(x) * 1e6` is wrong
    on ordinary money — `parseFloat("8.29") * 1e6` is `8289999.999999999` — and
    a screen that signs a different number than the one it shows is the failure
    this whole path is arranged against.
  */
  const parsed = React.useMemo(() => {
    const trimmed = amount.trim();
    if (trimmed === "" || !/^\d*\.?\d*$/.test(trimmed)) return null;
    try {
      return new Decimal(trimmed);
    } catch {
      return null;
    }
  }, [amount]);

  const amountError =
    action !== "DEPOSIT"
      ? undefined
      : parsed === null
        ? "Enter an amount."
        : parsed.lte(0)
          ? "Enter an amount greater than zero."
          : exceedsScale(parsed, decimals)
            ? // The wording; `toAtomic` refuses the same amount itself, so this
              // arm is what turns a thrown RangeError into a sentence.
              `The stake asset goes to ${decimals} decimal places. Trim the amount.`
            : undefined;

  async function build() {
    if (action === null || amountError) return;
    setPhase("building");
    setRefusal(null);
    setWalletDetail(null);
    setDeclined(false);
    try {
      const ask: StakeExpectation =
        action === "OPEN_STAKE"
          ? { kind: "OPEN_STAKE", amount: null }
          : { kind: "DEPOSIT", amount: toAtomic(parsed!, decimals) };
      const built =
        ask.amount === null
          ? // No argument, not an empty object — `open_stake` carries no amount
            // and moves no tokens.
            await createOpenStakeIntent()
          : await createStakeDepositIntent({ amount: ask.amount });
      setRequested(ask);
      setIntent(built);
      setPhase("preflight");
    } catch (e) {
      setPhase("idle");
      if (e instanceof ApiError) {
        setRefusal(e);
      } else {
        const detail = (e instanceof Error ? e.message : String(e)).trim();
        setWalletDetail(detail || "The request failed with no message. Nothing was built.");
      }
    }
  }

  async function sign() {
    if (intent === null || requested === null || signerState.status !== "ready") return;
    setPhase("signing");
    setWalletDetail(null);
    setDeclined(false);
    try {
      const { signature } = await runStakeIntent(intent, signerState.signer, requested);
      setPhase("done");
      onSigned({ kind: intent.kind === "OPEN_STAKE" ? "OPEN_STAKE" : "DEPOSIT", signature, amount: intent.amount });
      onOpenChange(false);
    } catch (e) {
      // Back to `preflight`, not to `idle`: the built transaction is still
      // valid until its blockhash expires, so a declined prompt is retryable
      // without paying for a second build.
      setPhase("preflight");
      if (isUserRejection(e)) {
        setDeclined(true);
      } else {
        const detail = (e instanceof Error ? e.message : String(e)).trim();
        setWalletDetail(detail || "The wallet returned an error with no message. Nothing was sent.");
      }
    }
  }

  const deposit = action === "DEPOSIT";

  return (
    <Sheet open={action !== null} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{deposit ? "Deposit stake" : "Open a stake account"}</SheetTitle>
          <SheetDescription>
            {deposit
              ? opensAccount
                ? "Moves stake in from the wallet that holds your stake authority. The account has to exist first — a deposit into one that does not exist is refused."
                : "Moves stake in from the wallet that holds your stake authority. There is no account to open on this chain — your first deposit creates your stake. Your wallet asks twice: once to approve the stake contract for this amount, then for the deposit itself."
              : "Creates the on-chain account your stake lives in. It carries no amount and moves no tokens; you pay its rent, quoted below before you sign."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
          {deposit ? (
            <Field
              label="Amount"
              id="stake-deposit-amount"
              placeholder="0.00"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={phase !== "idle"}
              hint={
                stake?.shortfall && stake.shortfall.amount !== "0"
                  ? `You are ${money(stake.shortfall)} below the minimum; ${money(stake.recommendedBuffer)} is the 1.5× buffer we recommend.`
                  : `${money(stake?.recommendedBuffer)} is the 1.5× buffer we recommend against your current requirement.`
              }
              error={amount.trim() !== "" ? amountError : undefined}
            />
          ) : null}

          {phase === "idle" || phase === "building" ? (
            <Button
              type="button"
              icon={<Plus />}
              loading={phase === "building"}
              disabled={Boolean(amountError)}
              onClick={build}
            >
              {deposit ? "Check what this needs" : "Build the transaction"}
            </Button>
          ) : null}

          {/*
            A refusal is information, not a crash — and for these two codes it
            is the authoritative answer to a question no endpoint exposes:
            nothing on the wire says whether the stake PDA exists. So "already
            open" reads as done, and "not open" points at the button that fixes
            it, rather than both arriving as red failures.
          */}
          {refusal ? (
            <Banner
              tone={
                refusal.code === "PROVIDER_STAKE_ACCOUNT_ALREADY_OPEN" ||
                refusal.code === "PROVIDER_STAKE_ACCOUNT_NOT_OPEN" ||
                refusal.code === "PROVIDER_STAKE_ACCOUNT_NOT_NEEDED"
                  ? "warning"
                  : "danger"
              }
              title={
                refusal.code === "PROVIDER_STAKE_ACCOUNT_ALREADY_OPEN"
                  ? "Your stake account is already open"
                  : refusal.code === "PROVIDER_STAKE_ACCOUNT_NOT_OPEN"
                    ? "There is no stake account to deposit into yet"
                    : refusal.code === "PROVIDER_STAKE_ACCOUNT_NOT_NEEDED"
                      ? "There is no stake account to open on this chain"
                      : "That request was refused"
              }
              description={
                refusal.code === "PROVIDER_STAKE_ACCOUNT_ALREADY_OPEN"
                  ? "Nothing was built and nothing was charged. Close this and use Deposit."
                  : refusal.code === "PROVIDER_STAKE_ACCOUNT_NOT_OPEN"
                    ? "Close this and use Open stake account first. It is not created automatically, because you pay its rent."
                    : refusal.code === "PROVIDER_STAKE_ACCOUNT_NOT_NEEDED"
                      ? "Nothing was built. Close this and use Deposit — your first deposit creates your stake."
                      : describeChainRefusal(refusal)
              }
            />
          ) : null}

          {intent ? <StakePreflight intent={intent} /> : null}

          {intent ? (
            <>
              <Button
                type="button"
                icon={<PenLine />}
                loading={phase === "signing"}
                disabled={!canSign(intent) || phase === "done"}
                onClick={sign}
              >
                Sign in your wallet and broadcast
              </Button>
              <p className="text-body-13 text-03">
                Your wallet broadcasts this. The platform holds no key of yours and never sees the signed transaction.
              </p>
            </>
          ) : null}

          {declined ? (
            <p className="text-body-13 text-warning-600">
              Nothing was sent — the wallet prompt was closed or declined.{" "}
              {opensAccount
                ? "The transaction above is still valid until its blockhash expires, so you can sign it."
                : "If you had already approved, that approval is kept, so the next attempt asks for one signature."}
            </p>
          ) : null}
          {walletDetail ? <p className="text-body-13 text-danger-600">{walletDetail}</p> : null}

          {signerState.status !== "ready" ? (
            <p className="text-body-13 text-warning-600">
              No connected wallet holds this stake authority, so nothing here can be signed.
              <span className="mt-2.5 block">
                <ConnectWalletAction />
              </span>
            </p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Whether the preflight allows a signature.
 *
 * `hasEnoughStakeAsset` is **not** read on its own, and that is the whole
 * subtlety: the backend sets it `false` whenever the token balance is unknown,
 * and an absent token account reads as unknown
 * (`stake-intent-builder.service.ts:279`). An OPEN_STAKE requires zero of the
 * stake asset, so gating on the flag alone would refuse to open a stake account
 * for exactly the provider who has never held USDC — a gate answering a
 * different question than the one asked. It is consulted only when the
 * transaction actually moves the asset.
 */
function canSign(intent: StakeIntent): boolean {
  const { preflight } = intent;
  if (!preflight.hasEnoughGas) return false;
  if (preflight.requiredStakeAsset.amount === "0") return true;
  return preflight.hasEnoughStakeAsset;
}

/**
 * What the transaction needs, and what the authority holds, before any prompt.
 *
 * `stakeAssetBalance: null` means **there is no token account** — which is not
 * zero and must not render as `$0.00`. "You have no USDC" and "you have no
 * account to hold USDC in" are two different errands, and only one of them is
 * fixed by acquiring USDC.
 */
function StakePreflight({ intent }: { intent: StakeIntent }) {
  const { preflight } = intent;
  const needsAsset = preflight.requiredStakeAsset.amount !== "0";
  /*
    Four places is right for SOL (0.0100). ETH on an L2 costs millionths —
    measured on eip155:46630, a stake deposit's ceiling is 0.0000047 ETH — and
    four places would print it as 0.0000, a "free" that is not.
  */
  const gasPlaces = preflight.requiredGas.decimals >= 18 ? 8 : 4;
  /*
    Narrowed once. `transaction` is a three-member union, and only the
    `solana` member has a fee payer or base64 wire bytes — the two things this
    panel prints. Reading them off the union directly would print `undefined`
    on the screen where a provider is deciding whether to sign.
  */
  const solanaTx =
    intent.transaction && isSolanaTransaction(intent.transaction) ? intent.transaction : null;

  return (
    <div className="flex w-full flex-col gap-2.5 rounded-lg border border-02 p-[15px]">
      <p className="text-body-sm font-semibold text-01">Before you sign</p>

      {needsAsset ? (
        <>
          <PreflightRow label="Stake asset required" value={money(preflight.requiredStakeAsset)} />
          <PreflightRow
            label="Your balance"
            value={
              preflight.stakeAssetBalance === null
                ? "no token account"
                : money(preflight.stakeAssetBalance)
            }
            bad={!preflight.hasEnoughStakeAsset}
          />
        </>
      ) : null}

      {/*
        Gas is quoted with no `$`. It is the chain's native asset, which is
        deliberately absent from the platform's asset registry, so there is no
        rate to price it at and inventing one would be a made-up figure on a
        money screen.
      */}
      <PreflightRow
        label="Gas budget (a ceiling, not a quote)"
        value={formatMoney(preflight.requiredGas, { decimals: gasPlaces, symbol: "" })}
      />
      <PreflightRow
        label="Your gas balance"
        value={formatMoney(preflight.gasBalance, { decimals: gasPlaces, symbol: "" })}
        bad={!preflight.hasEnoughGas}
      />

      {!preflight.hasEnoughGas ? (
        <p className="text-body-13 text-danger-600">
          Not enough gas in {solanaTx?.feePayer ?? "the stake authority"} to send this.{" "}
          {preflight.gasNotSponsoredReason}
        </p>
      ) : null}
      {needsAsset && !preflight.hasEnoughStakeAsset ? (
        <p className="text-body-13 text-danger-600">
          {preflight.stakeAssetBalance === null
            ? "The stake authority has no token account for the stake asset yet, so it holds none. Sending it some will create one."
            : "The stake authority does not hold enough of the stake asset for this deposit."}
        </p>
      ) : null}
      {preflight.hasEnoughGas ? (
        // The platform's own sentence, printed rather than reworded — it is the
        // answer to "why am I paying for this?" and it is not ours to phrase.
        <p className="text-body-13 text-03">{preflight.gasNotSponsoredReason}</p>
      ) : null}

      {/*
        Narrowed, not assumed. `base64` is the `solana` member's encoding; the
        eip155 members carry `0x` calldata or an EIP-712 struct, and a code
        block titled "base64" over either would be a label that is simply
        false. There is no eip155 branch here because no deployment enables one
        yet — the block is omitted rather than guessed at.
      */}
      {solanaTx ? (
        <CodeBlock title="unsigned transaction · base64" code={solanaTx.transactionBase64} />
      ) : null}
    </div>
  );
}

function PreflightRow({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex w-full items-center gap-4">
      <p className="min-w-0 flex-1 text-body-13 text-02">{label}</p>
      <p
        className={`shrink-0 font-mono text-mono-sm ${bad ? "text-danger-600" : "text-01"}`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * The only route from "wallet installed" to "wallet connected".
 *
 * `useWallets()` returns *connected* wallets, so `address-not-connected` cannot
 * be escaped from inside the signing surface — `useSigner` selects a wallet and
 * deliberately never connects one. A twin lives in `features/m41/steps.tsx`
 * and one in the exit screen; they are duplicated rather than shared because
 * importing either module would pull a whole unrelated feature into this
 * route's bundle for twelve lines.
 *
 * `walletChainType` is passed explicitly even though `appearance.walletChainType`
 * now sets the same value: a connect modal that silently follows a
 * global default is one config edit away from offering a namespace this screen
 * cannot use, and the failure is a user who connects a wallet and is then told
 * it is not connected.
 *
 * `"ethereum-and-solana"` and not `"solana-only"`, because a provider's stake
 * and payout addresses are per chain and this button is how they connect
 * either one. The literal is the package's: `"solana-and-ethereum"` is not one of the three values Privy accepts.
 */
function ConnectWalletAction() {
  const { connectWallet } = useConnectWallet();

  return (
    <Button
      variant="secondary"
      size="sm"
      icon={<Wallet />}
      // Through an arrow: `connectWallet` also accepts a MouseEvent in this
      // position, and handing it the event silently drops the chain filter.
      onClick={() => connectWallet({ walletChainType: "ethereum-and-solana" })}
    >
      Connect a wallet
    </Button>
  );
}
