"use client";

import { useQuery } from "@tanstack/react-query";
import Decimal from "decimal.js";
import { Info, PenLine } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Meter } from "@/components/ui/meter";
import { Switch } from "@/components/ui/switch";
import { chainBalances, soleChainBalance, type FullBalance } from "@/features/g30/balance";
import { NoteBox } from "@/features/g30/ui";
import { ApiError } from "@/libs/ApiClient";
import { getBalances } from "@/services";
import { toDecimal, formatDecimal } from "@/utils/money";

/**
 * Auto top-up.
 *
 * The whole point of this screen is the CEILING. Without auto top-up, the
 * maximum a person can be charged is their balance; turning it on removes that
 * bound, so the design makes the monthly cap a required field with no
 * "unlimited" option, and states the resulting maximum in one sentence before
 * anything is saved.
 *
 * This build enforces that in three places at once, because one of them is a
 * styling detail and two are not:
 *   1. Save is `disabled` while the switch is on and the cap is missing or 0.
 *   2. The submit handler returns early on the same condition, so a keyboard
 *      Enter or a devtools-enabled button still cannot save.
 *   3. The cap field shows its own error and the exposure sentence refuses to
 *      state a maximum it cannot compute.
 *
 * There is NO auto top-up endpoint on this API — not to read, not to write. The
 * switch therefore starts OFF (which is what the funding overview screen
 * reports) and the form holds its own state.
 */

/**
 * Delegating, like the one on the deposit screen. It was the second of three
 * hand-copied bodies of the same rounding convention; `utils/money.ts` states
 * it once now and `money.test.ts` pins it, so a screen cannot drift half a
 * cent away from the screen it shares a figure with.
 */
function money(value: Decimal, decimals = 2): string {
  return formatDecimal(value, { decimals });
}

function parse(value: string): Decimal | null {
  const trimmed = value.trim();
  if (trimmed === "" || !/^\d*\.?\d*$/.test(trimmed)) return null;
  try {
    return new Decimal(trimmed);
  } catch {
    return null;
  }
}

const MONTH = new Date().toLocaleString("en-US", { month: "long", timeZone: "UTC" });

export default function AutoTopUpPage() {
  const [enabled, setEnabled] = React.useState(false);
  const [threshold, setThreshold] = React.useState("5.00");
  const [reload, setReload] = React.useState("25.00");
  const [cap, setCap] = React.useState("");
  const [saved, setSaved] = React.useState<string | null>(null);

  const balancesQuery = useQuery<{ balances: FullBalance[] }, ApiError>({
    queryKey: ["balances"],
    queryFn: () => getBalances() as Promise<{ balances: FullBalance[] }>,
    // No retries, and `networkMode: "always"`.
    //
    // Measured, not assumed: with the defaults this query sat at
    // `status: "pending", fetchStatus: "paused", failureCount: 1` forever
    // while the request had already rejected with ERR_NETWORK — React Query
    // PAUSES a pending retry rather than failing it, so /funding showed
    // "Loading balance…" indefinitely with the API down. A money screen that
    // cannot read its figures has to say so, immediately and in words.
    retry: 0,
    networkMode: "always" as const,
  });
  const balances = chainBalances(balancesQuery.data?.balances);
  /*
    Auto top-up has no route yet (`funding.service.ts` says so: auto top-up has no
    endpoint at all) and no chain selector. Rather than pick a chain silently,
    it shows the figure only when the buyer has exactly one, and otherwise
    shows the absent state. This screen writes nothing, so the cost of being
    conservative here is a dash.

    Was `primaryBalance(...)`, i.e. `balances[0]`. The `length === 1` test now
    lives in `soleChainBalance` rather than inline here, because this page
    cannot be rendered by a test and the inline version once survived a
    degenerate-mutation sweep as `balances ? balances[0] : null` with every test green.
  */
  const balance = soleChainBalance(balances);
  // `null`, never zero. The exposure sentence is the whole point of this
  // screen; stating a maximum built on a balance we could not read would be
  // worse than not stating one.
  const available = balance ? toDecimal(balance.available) : null;

  const capValue = parse(cap);
  const thresholdValue = parse(threshold);
  const reloadValue = parse(reload);

  /** The one condition that decides whether this screen may save at all. */
  const capMissing = enabled && (capValue === null || capValue.lte(0));

  const capError = capMissing
    ? "Required. There is no “unlimited” option."
    : undefined;

  const blocked =
    capMissing ||
    (enabled && (thresholdValue === null || reloadValue === null || reloadValue.lte(0)));

  const maximum = available && capValue ? available.plus(capValue) : null;

  function save(event: React.FormEvent) {
    event.preventDefault();
    // Guard 2 of 3. A disabled button is a hint; this is the rule.
    if (blocked) {
      setSaved(null);
      return;
    }
    setSaved(
      enabled
        ? `Auto top-up is not available yet, so this setting (on, capped at ${money(capValue!)} per calendar month) was not saved.`
        : "Auto top-up is not available yet, so there is nothing to switch off. Your balance is a hard ceiling.",
    );
  }

  return (
    <div className="flex w-full justify-center bg-02 px-4 py-6 tablet:py-[34px]">
      <form
        onSubmit={save}
        className="flex w-full max-w-[680px] flex-col gap-5 rounded-xl border border-01 bg-01 p-6 shadow-soft tablet:p-[30px]"
      >
        <div className="flex w-full items-center gap-3.5">
          <h1 className="min-w-0 flex-1 text-heading-sm text-01">Auto top-up</h1>
          <Switch
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setSaved(null);
            }}
            label={enabled ? "On" : "Off"}
            aria-label="Auto top-up"
          />
        </div>

        <div className="flex w-full flex-col gap-3.5">
          <Field
            id="atu-threshold"
            label="When balance falls below"
            inputMode="decimal"
            suffix="USD"
            disabled={!enabled}
            value={threshold}
            onChange={(e) => {
              setThreshold(e.target.value);
              setSaved(null);
            }}
          />
          <Field
            id="atu-reload"
            label="Add"
            inputMode="decimal"
            suffix="USD"
            disabled={!enabled}
            value={reload}
            onChange={(e) => {
              setReload(e.target.value);
              setSaved(null);
            }}
            hint="from your connected wallet 7xKX…9pQr"
          />
          <Field
            id="atu-cap"
            label="Never add more than   ← required"
            inputMode="decimal"
            suffix="per calendar month"
            disabled={!enabled}
            value={cap}
            placeholder="0.00"
            onChange={(e) => {
              setCap(e.target.value);
              setSaved(null);
            }}
            error={capError}
            hint="Required. There is no “unlimited” option."
          />

          <NoteBox icon={<PenLine className="h-full w-full" />}>
            Auto top-up pulls your chain&apos;s settlement token from your connected wallet, so it
            needs a standing allowance you
            sign once. The monthly cap above is the maximum that allowance can ever move.
          </NoteBox>
        </div>

        {/* The maximum, stated plainly, before anything is saved. */}
        <div className="flex w-full flex-col gap-1.5 rounded-lg border border-teal-20 bg-teal-10 p-[18px]">
          {enabled && maximum ? (
            <>
              <p className="text-label-md text-teal-600">
                Your maximum possible spend in {MONTH} is {money(maximum)}.
              </p>
              <p className="text-body-sm text-02">
                Current balance {money(available!)} + up to {money(capValue!)} of reloads. We
                cannot charge you more.
              </p>
            </>
          ) : enabled ? (
            <>
              <p className="text-label-md text-teal-600">
                We cannot tell you your maximum possible spend in {MONTH} yet.
              </p>
              <p className="text-body-sm text-02">
                Set the monthly cap above and this becomes a number. Auto top-up cannot be saved
                until it is.
              </p>
            </>
          ) : (
            <>
              <p className="text-label-md text-teal-600">
                {available
                  ? `Your maximum possible spend in ${MONTH} is ${money(available)}.`
                  : `We could not read your balance, so we cannot tell you your maximum possible spend in ${MONTH}.`}
              </p>
              <p className="text-body-sm text-02">
                Your maximum possible spend is your current balance. We cannot charge you more than
                you have deposited.
              </p>
            </>
          )}
        </div>

        {enabled && capValue && capValue.gt(0) ? (
          <Meter
            tone="primary"
            label="Used this month"
            amount={`${money(new Decimal(0))} of ${money(capValue)}`}
            percent={0}
            note="When the cap is reached, reloads stop and we tell you. Calls are then refused for insufficient funds rather than spending more of your money."
          />
        ) : null}

        <NoteBox icon={<Info className="h-full w-full" />}>
          Turning this off makes your balance a hard ceiling again.
        </NoteBox>

        {saved ? (
          <p role="status" className="text-body-13 text-warning-600">
            {saved}
          </p>
        ) : null}

        <div className="flex w-full justify-end gap-2.5">
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              setEnabled(false);
              setSaved(null);
            }}
            asChild={false}
          >
            Turn off
          </Button>
          <Button type="submit" disabled={blocked} data-testid="auto-top-up-save">
            Save
          </Button>
        </div>

        <p className="text-body-xs text-03">
          <Link href="/funding" className="text-primary-500 hover:underline">
            Back to Funding
          </Link>
        </p>
      </form>
    </div>
  );
}
