"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, CircleCheck, Rocket, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import type {
  Money,
  ProviderStake,
  PublishRequirement,
  PublishRequirementResult,
  ToolBindingDetail,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { applyPublished, isAlreadyLive, isPublishedState } from "@/features/provider-binding/after-publish";
import { requirementChain, unreadableChains } from "@/features/provider-stake/chain-stake";
import { getProviderStake } from "@/services/provider-stake.service";
import {
  getPublishCheck,
  getToolBinding,
  publishToolBinding,
} from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";
import { toast } from "@/utils/toast";
import { labelForEndpoint } from "@/utils/provider-label";

/**
 * Publish checklist.
 *
 * ## The gate is the backend's, and this file renders it
 *
 * `GET /providers/me/tool-bindings/{id}/publish-check` returns
 * `{ publishable, mappingVersion, requirements[] }`, and `POST .../publish`
 * raises `PROVIDER_PUBLISH_CHECKS_FAILED` carrying the *same* list. Nothing
 * here re-derives either half: the button's `disabled` is `!check.publishable`
 * and each row's tick is `requirement.met`. A console that decided for itself
 * when publishing was allowed would eventually disagree with the server, and
 * assay-backend `src/modules/provider/domain/publish-gate.ts` says why that
 * disagreement is always in the permissive direction — the re-derivation is a
 * second opinion that can contradict the gate that actually refused.
 *
 * ## Why three rows and not the design's seven
 *
 * The design draws seven checklist items. The gate implements **three**:
 * `TESTER_RUN`, `TESTER_PASSED`, `STAKE_AT_MINIMUM`. The other five —
 * "Backtest run on a corpus of ≥500", "Coverage reviewed", "SLA declared",
 * "Price and tier set", "Constraints declared" — have no requirement, no code
 * and no `met` flag anywhere in the API; there is not even a backtest resource
 * for the second one (see the corpus backtest screen). Drawing them with a green tick would invent
 * four conditions the platform does not enforce and put the count in the
 * subtitle ("6 of 7") permanently out of step with the gate. They are dropped.
 *
 * Conversely `TESTER_PASSED` has no row in the design at all, and it is the
 * one the gate refuses on most often.
 *
 * ## Where the stake numbers come from
 *
 * Every figure is the API's. `GET /providers/me/stake` computes `staked`,
 * `requirementTotal`, `headroom`, `shortfall` and `recommendedBuffer` server
 * side, and itemises the requirement per binding with its own `derivation`
 * string — `max(floor 50.000000, 1000 × 0.250000) = 250.000000`. The design's
 * flat `$50.00` is only the *floor*; it is the right number solely for a
 * provider pricing under $0.05, and this org's requirement is $250. Nothing
 * below multiplies, compares or rounds a stake figure — `shortfall` is read,
 * not computed, which is also why an RPC outage renders as "—" rather than a
 * confident zero.
 */

// ── Copy ───────────────────────────────────────────────────────────────────

/**
 * Row titles.
 *
 * Only `STAKE_AT_MINIMUM` has design copy ("Stake funded to the minimum")
 * and it is used verbatim. The two tester rows are ours: the
 * design's nearest string is "Mapping tested against at least 3 cases", and
 * the gate requires **one** run at the current revision, not three cases —
 * printing the design's sentence would misstate the condition the button is
 * actually locked on. Both need a designer's words.
 */
const TITLES: Record<PublishRequirement, string> = {
  TESTER_RUN: "Mapping tested at the revision that would go live",
  TESTER_PASSED: "That tester run passed every layer",
  PAYOUT_ACCOUNT: "A proved payout address on every settlement chain",
  STAKE_AT_MINIMUM_ON_EVERY_CHAIN: "Stake funded to the minimum",
};

/** The one glyph for "we do not know", as opposed to a measured zero. */
const UNKNOWN = "—";

// ── Rows ───────────────────────────────────────────────────────────────────

function ChecklistRow({
  met,
  title,
  detail,
  action,
}: {
  met: boolean;
  title: string;
  detail: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex w-full items-center gap-3 border-t border-01 py-[13px] first:border-t-0">
      {met ? (
        <CircleCheck
          width={17}
          height={17}
          aria-hidden="true"
          className="shrink-0 text-success-500"
        />
      ) : (
        <CircleAlert
          width={17}
          height={17}
          aria-hidden="true"
          className="shrink-0 text-warning-500"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-label-sm text-01">{title}</p>
        {detail ? (
          <p className="font-mono text-mono-xs leading-[1.5] text-03">{detail}</p>
        ) : null}
      </div>
      {action}
      <span className="sr-only">{met ? "met" : "not met"}</span>
    </div>
  );
}

// ── The stake row's sub-line ───────────────────────────────────────────────

function money(value: Money | null | undefined): string {
  return value ? formatMoney(value) : UNKNOWN;
}

/**
 * The design's sentence, with the shortfall substituted for the headroom when
 * there is one: *"$50.00 staked, $50.00 required — headroom $0.00, we
 * recommend 1.5×"*. The design only ever draws the
 * zero-headroom case, so "short $X" is ours — and it is the half that
 * matters, since a provider who is told "not enough" without a number cannot
 * act on it.
 *
 * ## The one case where the two endpoints disagree
 *
 * The publish gate evaluates `max(floor, 1000 × price)` for **this binding**
 * whatever its status, while `GET /providers/me/stake` itemises **ACTIVE
 * PAID/FREEMIUM bindings only** (`provider-stake.service.ts`, the
 * `status === ACTIVE` filter) and computes `requirementTotal`, `headroom` and
 * `shortfall` from that set alone. Publishing a DRAFT or PAUSED binding is
 * therefore the case where the gate can refuse while the stake document still
 * reports headroom.
 *
 * So the headroom clause is printed only when the gate agreed, and never as a
 * reassurance underneath a refusal. A screen that said "headroom $250.00"
 * directly below "staked 500.000000, minimum 1000.000000" would be asking the
 * provider to decide which of its own two lines to believe.
 */
function stakeSentence(
  stake: ProviderStake | undefined,
  binding: ToolBindingDetail | undefined,
  met: boolean
): { line: string; derivation: string | null; note: string | null } {
  if (!stake) return { line: "", derivation: null, note: null };

  const itemised = binding
    ? (stake.requirement ?? []).find((entry) => entry.bindingId === binding.id)
    : undefined;

  // Stake is one pot per provider, not per binding, so the sentence's pair is
  // the provider-level one — `staked` against `requirementTotal`, which is the
  // `max` over the itemised bindings and is what `headroom`/`shortfall` were
  // computed against. Where this binding's own floor came from is the
  // `derivation` line below, not a second figure mixed into the comparison.
  const required = stake.requirementTotal ?? itemised?.minimum ?? null;
  const short = stake.shortfall;
  const isShort = Boolean(short && short.amount !== "0");

  // Unknown figures are dropped from the sentence rather than printed as "—".
  // "$500.00 staked, — required — headroom —" is not a sentence, and a reader
  // cannot tell an unknown requirement from a zero one inside it.
  const gap = isShort
    ? `short ${money(short)}`
    : met && stake.headroom
      ? `headroom ${money(stake.headroom)}`
      : null;

  /*
    The stake is per chain now, and the requirement figures are not: they are
    denominated in the stake floor's single asset, so the only chain they may
    be compared against is that asset's own. `requirementChain` derives it and
    answers `null` rather than picking a row — a sentence comparing a floor
    against a chain it was never computed for reads as complete and is wrong.
    This line used to be `money(stake.staked)`, a top-level field the backend
    had already moved, and it printed the UNKNOWN dash at a provider with
    $500.00 bonded.
  */
  const chainStake = requirementChain(stake)?.staked ?? null;
  const clauses = chainStake ? [`${money(chainStake)} staked`] : [];
  if (required) clauses.push(`${money(required)} required`);

  return {
    line: clauses.join(", ") + (gap ? ` — ${gap}, we recommend 1.5×` : ""),
    derivation: itemised?.derivation ?? null,
    note: !itemised
      ? "this binding is not in the itemised requirement — it lists ACTIVE bindings only"
      : !met && !isShort
        ? "the itemised requirement covers ACTIVE bindings only, so no shortfall is reported against this one"
        : null,
  };
}

// ── Screen ─────────────────────────────────────────────────────────────────

/** The rail labels a binding by its endpoint host; the page header agrees. */

export function PublishChecklistView({ bindingId }: { bindingId: string }) {
  const queryClient = useQueryClient();

  const binding = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
  });

  const check = useQuery({
    queryKey: ["provider", "tool-binding", bindingId, "publish-check"],
    queryFn: () => getPublishCheck(bindingId),
  });

  const stake = useQuery({
    queryKey: ["provider", "stake"],
    queryFn: () => getProviderStake(),
  });

  const router = useRouter();
  const detailHref = `/provider/bindings/${bindingId}`;

  /*
    BUG-J-PROV-02: the old success path only invalidated keys, and every
    refetch was answered from the browser's HTTP cache with the pre-publish
    body — the screen stayed on an enabled Publish button over a binding that
    was already ACTIVE. `applyPublished` seeds what it can from the response
    and re-reads the stake past the cache; then the provider is taken to the
    binding, where the live state is the thing on screen.
  */
  const publish = useMutation({
    mutationFn: () => publishToolBinding(bindingId),
    onSuccess: async (published) => {
      await applyPublished(queryClient, published);
      toast(`Published revision ${published.publishedVersion ?? published.version}`);
      router.push(detailHref);
    },
    onError: (error) => {
      // A second press, or a check read before the first publish landed: the
      // revision is already live, which is the outcome the provider wanted.
      if (isAlreadyLive(error)) {
        toast((error as Error).message);
        void queryClient.invalidateQueries({ queryKey: ["provider", "tool-binding", bindingId] });
        router.push(detailHref);
        return;
      }
      // `PROVIDER_PUBLISH_CHECKS_FAILED` carries the same requirement list the
      // panel is already showing, so the recovery is to re-read the check
      // rather than to parse the error. Branch on `code`, never on the text.
      const code = error instanceof ApiError ? error.code : null;
      toast(
        code === "PROVIDER_PUBLISH_CHECKS_FAILED"
          ? "Not published — a condition is not met"
          : (error as Error).message
      );
      void check.refetch();
    },
  });

  const requirements: readonly PublishRequirementResult[] = check.data?.requirements ?? [];
  const metCount = requirements.filter((requirement) => requirement.met).length;
  const publishable = check.data?.publishable === true;
  /* Live already, or just published and on its way to the binding page: no second press. */
  const isLive = isPublishedState(binding.data) || publish.isSuccess;

  const title = binding.data ? `Publish ${labelForEndpoint(binding.data.endpoint)}` : "Publish";

  // Design sub, verbatim after the count: "6 of 7 complete · nothing publishes
  // until every blocking item is green". The count is the gate's.
  const tail = "nothing publishes until every blocking item is green";
  const subtitle = check.isLoading
    ? `checking · ${tail}`
    : check.data
      ? `${metCount} of ${check.data.requirements.length} complete · ${tail}`
      : tail;

  const stakeMet =
    requirements.find((requirement) => requirement.requirement === "STAKE_AT_MINIMUM_ON_EVERY_CHAIN")?.met ?? true;
  const stakeCopy = stakeSentence(stake.data, binding.data, stakeMet);

  return (
    <>
      {/* Page Header. */}
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* 23px/600/-0.5 in the design; `heading-md` (24px) is the nearest step. */}
          <h1 className="truncate text-heading-md text-01">{title}</h1>
          <p className="font-mono text-mono-12 text-03">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Button
            icon={<Rocket aria-hidden="true" />}
            disabled={!publishable || isLive || publish.isPending}
            loading={publish.isPending}
            onClick={() => publish.mutate()}
          >
            {isLive ? "Published" : "Publish"}
          </Button>
        </div>
      </div>

      {/* Checklist. */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Checklist</PanelTitle>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-5 pb-3.5 pt-1.5">
          {check.isLoading ? (
            <p className="py-[13px] font-mono text-mono-xs text-03">Reading the gate…</p>
          ) : check.error ? (
            <p className="py-[13px] font-mono text-mono-xs text-danger-600">
              {(check.error as Error).message}
            </p>
          ) : (
            requirements.map((requirement) => (
              <ChecklistRow
                key={requirement.requirement}
                met={requirement.met}
                title={TITLES[requirement.requirement] ?? requirement.requirement}
                detail={
                  requirement.requirement === "STAKE_AT_MINIMUM_ON_EVERY_CHAIN" ? (
                    <StakeDetail
                      requirement={requirement}
                      line={stakeCopy.line}
                      derivation={stakeCopy.derivation}
                      note={stakeCopy.note}
                      /*
                        Per chain. `stake.data.chainReadable` was a top-level
                        field that no longer exists — `undefined === false` is
                        `false`, so this note had silently stopped rendering at
                        the same moment `/provider/capital` started claiming
                        the opposite.
                      */
                      unreadable={unreadableChains(stake.data).length > 0}
                    />
                  ) : (
                    (requirement.detail ??
                      `revision ${check.data?.mappingVersion ?? UNKNOWN}`)
                  )
                }
                action={
                  requirement.requirement === "STAKE_AT_MINIMUM_ON_EVERY_CHAIN" && !requirement.met ? (
                    <Button
                      asChild
                      variant="secondary"
                      size="sm"
                      className="px-3 py-[7px] text-label-13"
                    >
                      <Link href="/provider/capital">Add stake</Link>
                    </Button>
                  ) : undefined
                }
              />
            ))
          )}
        </PanelBody>
      </Panel>

      {/* Note. Copy verbatim. */}
      <div
        role="note"
        className="flex w-full items-start gap-2.5 rounded-lg border border-primary-20 bg-primary-10 p-[15px]"
      >
        <ShieldCheck
          width={15}
          height={15}
          aria-hidden="true"
          className="mt-[3px] shrink-0 text-primary-600"
        />
        <p className="min-w-0 flex-1 text-body-13 leading-[1.6] text-primary-700">
          If you publish with a number you have not measured, we record your explicit
          acknowledgement and show it back in any later dispute about surprise. Nothing in an
          accusation should be something you could not have seen the day before.
        </p>
      </div>
    </>
  );
}

function StakeDetail({
  requirement,
  line,
  derivation,
  note,
  unreadable,
}: {
  requirement: PublishRequirementResult;
  line: string;
  derivation: string | null;
  note: string | null;
  unreadable: boolean;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      {/* The gate's own sentence, verbatim, when it refused. It names the
          reason the router will use too — `STAKE_BELOW_MINIMUM` and
          `STAKE_UNKNOWN` send a provider to two different places. */}
      {!requirement.met && requirement.detail ? <span>{requirement.detail}</span> : null}
      {line ? <span className={cn(!requirement.met && "text-warning-700")}>{line}</span> : null}
      {derivation ? <span>{derivation}</span> : null}
      {note ? <span>{note}</span> : null}
      {unreadable ? <span>stake not readable on chain right now</span> : null}
    </span>
  );
}
