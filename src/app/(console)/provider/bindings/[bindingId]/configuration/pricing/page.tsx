"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Check, ClockFading, TriangleAlert, X } from "lucide-react";
import { useParams } from "next/navigation";
import * as React from "react";

import { BindingNav } from "@/features/provider-binding/binding-nav";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import type { Money, PricingMode, ProviderStake, SlaWindow } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { getProviderMe } from "@/services/provider-profile.service";
import { listSlaWindows } from "@/services/provider-sla-windows.service";
import { getProviderStake } from "@/services/provider-stake.service";
import {
  getToolBinding,
  updateToolBinding,
} from "@/services/provider-tool-bindings.service";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";

import {
  majorInputFromMoney,
  minorUnitsFromMajorInput,
  Note,
  PageHeader,
  priceModeError,
  UNKNOWN,
} from "@/features/provider-binding/chrome";

/**
 * Pricing and tier.
 * Route `/provider/bindings/[bindingId]/configuration/pricing`.
 *
 * ## What the price actually moves
 *
 * The screen exists because a price is not a private number: it sets the stake
 * the provider must hold before the router will send them paid traffic. The
 * rule is `max(floor, multiplier × price)`, and `GET /providers/me/stake`
 * publishes it per binding as a line meant to be printed verbatim —
 * `max(floor 50.000000, 1000 × 0.250000) = 250.000000`. Both constants are
 * read out of that line; **nothing on this screen types a number in.** Several
 * design frames draw a flat `$50.00` for the minimum, which is only ever right
 * for a binding priced under $0.05 — at the seeded $0.25 the real requirement
 * is $250.00. The API wins.
 *
 * ## What has no source
 *
 * The design's "Derived consequences" table draws seven rows. Two of them can
 * be derived from the wire: `minimumStake` (above) and `tier eligibility`
 * (`GET /providers/me` → `tier`). The other five — semantic sample rate,
 * effective threshold, projected proposals/yr, worst case / window, net per 1M
 * calls — have **no endpoint anywhere in the provider API**: there is no
 * sampling-policy resource, no slash-cap projection, and no platform take rate
 * on the wire. Their rows are kept, because deleting them would hide from the
 * provider that the consequence exists, and their cells render the unknown
 * glyph rather than an invented figure. The design's own note strings for
 * those five ("at your measured 3.1% true rate", "after 10% take", …) are
 * measurements this build cannot make, so they are not printed as if it had.
 */

/** `derivation` is `max(floor 50.000000, 1000 × 0.250000) = 250.000000`. */
const DERIVATION = /max\(floor\s+([\d.]+)\s*,\s*([\d.]+)\s*[×x]\s*([\d.]+)\)/i;

interface StakeRule {
  floor: Decimal;
  multiplier: Decimal;
}

/**
 * The floor and the multiplier are platform constants, so any binding's
 * derivation line carries them — including when *this* binding is absent from
 * `requirement` (the list holds ACTIVE PAID/FREEMIUM bindings only, so a
 * PAUSED or FREE one never appears). Falling back to a sibling's line is what
 * lets the screen still answer "what would this price require".
 */
function stakeRuleFrom(stake: ProviderStake | undefined): StakeRule | null {
  for (const item of stake?.requirement ?? []) {
    const match = DERIVATION.exec(item.derivation);
    if (match) {
      return { floor: new Decimal(match[1]), multiplier: new Decimal(match[2]) };
    }
  }
  return null;
}

/** major-unit Decimal -> Money, so the figure still renders via `formatMoney`. */
function moneyFromMajor(value: Decimal, asset: string, decimals: number): Money {
  return {
    amount: value.mul(new Decimal(10).pow(decimals)).toFixed(0, Decimal.ROUND_UP),
    asset,
    decimals,
  };
}

/**
 * The next window boundary.
 *
 * Before per-binding SLA windows, a window was a rolling UTC calendar day with no deadline of
 * its own, so this rolled the newest window's own length forward until it
 * landed in the future — a guess dressed as a derivation. Now a real
 * `sla_windows` row carries its own `deadlineAt`, frozen at open, and this
 * binding's `sla-windows` query below is scoped with `?bindingId=`, so the
 * `OPEN` row (if there is one) IS this binding's actual next boundary — no
 * rolling required, and no assumption about a policy this client does not
 * own. With no `OPEN` window, there is nothing to report a boundary for.
 */
function nextWindowBoundary(windows: SlaWindow[] | undefined): string | null {
  const open = windows?.find((w) => w.status === "OPEN");
  if (!open) return null;

  const boundary = Date.parse(open.deadlineAt);
  if (!Number.isFinite(boundary)) return null;

  const iso = new Date(boundary).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * Only FREEMIUM has design copy, and it has two different strings — this
 * screen's "free preview + paid full" and the free-tier controls screen's "capped preview, paid full
 * result". Each screen prints its own. FREE and PAID are drawn nowhere, so
 * those two labels are ours.
 */
const MODE_LABEL: Record<PricingMode, string> = {
  FREE: "Free",
  FREEMIUM: "Freemium — free preview + paid full",
  PAID: "Paid",
};

interface ConsequenceRow extends TableRowData {
  name: string;
  from: string;
  to: string;
  note: string;
}

/**
 * The design's own column widths do not fit its own panel, and its render
 * proves it: at `width 620` with `from 150`, `to 150`, `note 240` plus 12px
 * gaps and 12px cell padding, the fixed columns consume every pixel and the
 * flexing row-label column collapses to zero — in the design render
 * "minimumStake" is drawn **on top of** "$50.00", and every other label
 * overlaps its own `from` value. Something has to give, and the row labels are
 * the one column that cannot: they are what each number is a number *of*.
 *
 * So the label column is given the ~180px its longest string
 * ("projected proposals/yr") needs and the three fixed columns are narrowed to
 * the widest figure each actually carries. The geometry is a deliberate divergence from
 * the design.
 */
const COLUMNS: TableColumn<ConsequenceRow>[] = [
  {
    key: "name",
    header: "",
    mono: true,
    cell: (row) => <span className="font-semibold">{row.name}</span>,
  },
  { key: "from", header: "from", width: 100, align: "end", mono: true, cell: (row) => row.from },
  { key: "to", header: "to", width: 100, align: "end", mono: true, cell: (row) => row.to },
  { key: "note", header: "note", width: 160, align: "end", mono: true, cell: (row) => row.note },
];

/** The five rows the design draws and no endpoint answers. */
const UNSOURCED = [
  "semantic sample rate",
  "effective threshold",
  "projected proposals/yr",
  "worst case / window",
  "net per 1M calls",
];

export default function PricingAndTierPage() {
  const params = useParams<{ bindingId: string }>();
  const bindingId = params.bindingId;
  const queryClient = useQueryClient();

  const bindingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
    enabled: Boolean(bindingId),
  });
  const stakeQuery = useQuery({
    queryKey: ["provider", "stake"],
    queryFn: getProviderStake,
  });
  const meQuery = useQuery({ queryKey: ["provider", "me"], queryFn: getProviderMe });
  const windowsQuery = useQuery({
    queryKey: ["provider", "sla-windows", "boundary", bindingId],
    queryFn: () => listSlaWindows({ bindingId, limit: 1 }),
  });

  const binding = bindingQuery.data;

  const [priceInput, setPriceInput] = React.useState("");
  const [mode, setMode] = React.useState<PricingMode | "">("");
  const [dirty, setDirty] = React.useState(false);

  // Seed the form from the server exactly once per revision, and re-seed after
  // a save — `version` moves on every price or mode write.
  const seededFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!binding) return;
    const stamp = `${binding.id}:${binding.version}`;
    if (seededFor.current === stamp) return;
    seededFor.current = stamp;
    setPriceInput(majorInputFromMoney(binding.price));
    setMode(binding.pricingMode);
    setDirty(false);
  }, [binding]);

  const parsedPrice = minorUnitsFromMajorInput(priceInput, binding?.price.decimals ?? 6);
  const priceError =
    (priceInput.trim() === "" && dirty ? "A price is required." : parsedPrice.error) ??
    (mode !== "" ? priceModeError(mode, priceInput, parsedPrice.amount) : null);

  const priceChanged = Boolean(binding) && parsedPrice.amount !== null && parsedPrice.amount !== binding!.price.amount;
  const modeChanged = Boolean(binding) && mode !== "" && mode !== binding!.pricingMode;
  const hasChanges = priceChanged || modeChanged;

  const rule = stakeRuleFrom(stakeQuery.data);
  const asset = binding?.price.asset;
  const decimals = binding?.price.decimals ?? 6;

  const requirementItem = stakeQuery.data?.requirement.find((item) => item.bindingId === bindingId);

  /** What this binding requires today. Prefer the server's own figure. */
  const minimumFrom: Money | null =
    requirementItem?.minimum ??
    (rule && binding
      ? moneyFromMajor(
          Decimal.max(rule.floor, rule.multiplier.mul(new Decimal(binding.price.amount).div(new Decimal(10).pow(decimals)))),
          binding.price.asset,
          decimals
        )
      : null);

  /** What the price now in the box would require. */
  const draftPriceMajor =
    parsedPrice.amount !== null ? new Decimal(parsedPrice.amount).div(new Decimal(10).pow(decimals)) : null;
  const minimumTo: Money | null =
    rule && draftPriceMajor && asset
      ? moneyFromMajor(Decimal.max(rule.floor, rule.multiplier.mul(draftPriceMajor)), asset, decimals)
      : null;

  const floorBinds = rule && draftPriceMajor ? rule.floor.gte(rule.multiplier.mul(draftPriceMajor)) : null;

  const rows: ConsequenceRow[] = [
    {
      id: "minimumStake",
      name: "minimumStake",
      from: minimumFrom ? formatMoney(minimumFrom) : UNKNOWN,
      to: minimumTo ? formatMoney(minimumTo) : UNKNOWN,
      note:
        floorBinds === null
          ? UNKNOWN
          : floorBinds
            ? "floor still binds"
            : `${rule!.multiplier.toFixed()} × price binds`,
    },
    ...UNSOURCED.map((name) => ({ id: name, name, from: UNKNOWN, to: UNKNOWN, note: UNKNOWN })),
    {
      id: "tier",
      name: "tier eligibility",
      from: meQuery.data?.tier ?? UNKNOWN,
      to: meQuery.data ? "unchanged" : UNKNOWN,
      note: "volume-based",
    },
  ];

  const save = useMutation({
    mutationFn: () => {
      // Only the changed keys travel: `undefined` means "leave it alone" and
      // is not the same request as `null`.
      const body: { priceAmount?: string; pricingMode?: PricingMode } = {};
      if (priceChanged && parsedPrice.amount) body.priceAmount = parsedPrice.amount;
      if (modeChanged) body.pricingMode = mode;
      return updateToolBinding(bindingId, body);
    },
    onSuccess: () => {
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["provider"] });
      toast.success("Applied at the next window boundary");
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Could not save the price");
    },
  });

  function cancel() {
    if (!binding) return;
    setPriceInput(majorInputFromMoney(binding.price));
    setMode(binding.pricingMode);
    setDirty(false);
  }

  const boundary = nextWindowBoundary(windowsQuery.data?.items);

  if (bindingQuery.isError) {
    const error = bindingQuery.error;
    return (
      <Note tone="warning" icon={<TriangleAlert className="h-full w-full" />}>
        {error instanceof ApiError ? error.message : "This binding could not be loaded."}
      </Note>
    );
  }

  return (
    <>
      {/*
        the binding editor design promised this block matches what an `x402 binding plan`
        CLI prints. That CLI does not exist — there is no x402 CLI at all — so
        the sentence sent a provider looking for a second surface. The block
        itself is real; only the claim about its twin was not. The replacement
        says the thing a provider on this screen actually needs to know.
      */}
      <PageHeader
        title={`Pricing and tier · ${bindingId}`}
        sub="a price change raises the binding's revision, so publishing it needs a fresh mapping-tester run"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<X />}
              onClick={cancel}
              disabled={!binding || !hasChanges || save.isPending}
            >
              Cancel
            </Button>
            <Button
              icon={<Check />}
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!binding || !hasChanges || Boolean(priceError)}
            >
              Apply at next window
            </Button>
          </>
        }
      />

      <BindingNav bindingId={bindingId} />

      {save.isError ? (
        <p role="alert" className="text-body-13 text-danger-500">
          {save.error instanceof ApiError ? save.error.message : "Could not save the price."}
        </p>
      ) : null}

      <div className="flex w-full flex-col items-start gap-4 desktop:flex-row">
        <Panel className="flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Price and tier</PanelTitle>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 p-5">
            <Field
              id="price-per-call"
              label="Price per call"
              inputMode="decimal"
              value={priceInput}
              onChange={(event) => {
                setPriceInput(event.target.value);
                setDirty(true);
              }}
              suffix="USD"
              error={priceError ?? undefined}
              /*
                The design's hint reads "was $0.0020". There is no price-history
                endpoint, so "was" can only ever mean the currently-saved price,
                and it is shown only while the box disagrees with it.
              */
              hint={priceChanged && binding ? `was ${formatMoney(binding.price, { decimals: 4 })}` : undefined}
              disabled={!binding}
            />

            {/*
              Tier is drawn as a control and is not one: `ProviderTier` is
              NEW | ESTABLISHED | TRUSTED, it is earned rather than chosen, and
              no write path exists on any provider route. It renders the real
              tier, disabled. The design's value "verified · 10% take" names a
              tier that is not in the enum and a take rate that is on no
              response.
            */}
            <Select
              label="Tier"
              value={meQuery.data?.tier ?? ""}
              disabled
              hint="Earned, never chosen — no endpoint writes it."
              onChange={() => undefined}
            >
              <option value="">{UNKNOWN}</option>
              {(["NEW", "ESTABLISHED", "TRUSTED"] as const).map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </Select>

            <Select
              label="Pricing mode"
              value={mode}
              disabled={!binding}
              onChange={(event) => {
                setMode(event.target.value as PricingMode);
                setDirty(true);
              }}
            >
              {(["FREE", "FREEMIUM", "PAID"] as const).map((value) => (
                <option key={value} value={value}>
                  {MODE_LABEL[value]}
                </option>
              ))}
            </Select>

            <Note tone="warning" icon={<TriangleAlert className="h-full w-full" />}>
              guaranteed is not offered. It is dominated on margin and on routing score, so this
              configurator does not offer it.
            </Note>
          </PanelBody>
        </Panel>

        <Panel className="desktop:w-[620px] desktop:flex-none">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Derived consequences</PanelTitle>
              <PanelDescription>every number carries its derivation</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="px-2.5 pb-2.5 pt-1.5">
            <Table
              caption="Derived consequences"
              columns={COLUMNS}
              rows={rows}
              className="overflow-x-auto"
            />
          </PanelBody>
        </Panel>
      </div>

      <Note tone="primary" icon={<ClockFading className="h-full w-full" />}>
        {boundary
          ? `Effective at the next window boundary · ${boundary}. `
          : "Effective at the next window boundary. "}
        The window now in flight is judged against your current price and SLA — a price change never re-scores a
        window that is already running.
      </Note>
    </>
  );
}
