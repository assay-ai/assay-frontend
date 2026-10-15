"use client";

import { Check, Minus, Play, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DEMO_STAGE_LABELS,
  DemoCompensation,
  DemoRunResult,
  DemoVerdict,
  DemoVerdictState,
  getDemoStatus,
  pollDemoVerdict,
  runDemo,
} from "@/services/demo.service";
import { formatMoney } from "@/utils/money";

/**
 * Live demo — desktop and mobile designs,
 * route `/demo`.
 *
 * Two REAL paid calls, side by side, from a browser with no account. The right
 * column is served by a deliberately broken binding whose every result carries
 * the same `pageId`, so it fails this platform's own duplicate check and is not
 * charged. Nothing here is staged: a mocked demo at this exact spot is the fastest way to destroy the trust the page exists to
 * build.
 *
 * ## Seven places the frames do not match what the system does
 *
 * 1. `search_web` is not a tool that exists — it is `search_wikipedia`, and the
 *    broken one is `search_wikipedia_demo_broken`.
 * 2. The frame's sample body is `search_web`'s shape; the real one carries
 *    `title`, `pageId`, `wordCount`, `snippet`.
 * 3. `seeded to return nothing` / `0 results, minimum is 1` cannot happen: an
 *    empty search is a *valid, chargeable* answer here. The rule that really
 *    fails is `ids_distinct` (`NO_DUPLICATES`).
 * 4. `{ "results": [] }` is replaced by five rows sharing one id — those
 *    duplicate ids ARE the evidence, so they are what the response block shows.
 * 5. `not sampled · 1 in 125` publishes a sampling rate that does not exist:
 *    this policy is seeded `semantic.enabled: false` and nothing implements
 *    `SEMANTIC_JUDGE`. Shipped as `not sampled`, with no rate.
 * 6. The strip's `$1.00 / $0.60 / $0.30` are illustrative. The split is right —
 *    60% agent, 30% platform, 10% retained by the provider — but the figures
 *    come from a real executed slash, so the heading and body are templates.
 * 7. Mobile drops the compensation strip and the ledger table. That is the
 *    design's call and it is built that way, but it means compensation flowing is
 *    NOT shown on a small screen.
 *
 * ## One thing the page has to say that the design never anticipated
 *
 * All visitors share one demo agent, and the platform refuses more than five
 * IDENTICAL calls a minute (`DUPLICATE_REQUEST`, a constant with no per-agent
 * override). So the sixth person to run the pre-filled query inside a minute is
 * turned away by a real protection working correctly. The page says so and
 * invites them to type their own question, rather than showing an error that
 * reads like the demo being broken.
 */

const DEFAULT_QUERY = "cargo ship";
const POLL_INTERVAL_MS = 2_000;
const POLL_CEILING = 45;

interface ColumnState {
  running: boolean;
  run: DemoRunResult | null;
  verdict: DemoVerdict | null;
  error: string | null;
}

const EMPTY: ColumnState = { running: false, run: null, verdict: null, error: null };

export default function DemoPage() {
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [compensation, setCompensation] = React.useState<DemoCompensation | null>(null);
  const [queries, setQueries] = React.useState({ pass: DEFAULT_QUERY, fail: DEFAULT_QUERY });
  const [columns, setColumns] = React.useState<{ pass: ColumnState; fail: ColumnState }>({
    pass: EMPTY,
    fail: EMPTY,
  });

  React.useEffect(() => {
    let cancelled = false;
    getDemoStatus()
      .then((status) => {
        if (cancelled) return;
        setConfigured(status.configured);
        setCompensation(status.compensation);
      })
      .catch(() => {
        if (!cancelled) setConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const execute = React.useCallback(
    async (side: "pass" | "fail") => {
      setColumns((prev) => ({ ...prev, [side]: { ...EMPTY, running: true } }));

      try {
        const run = await runDemo(side, queries[side]);
        if (!run) {
          setConfigured(false);
          return;
        }

        setColumns((prev) => ({ ...prev, [side]: { ...EMPTY, running: true, run } }));

        if (!run.intentId) {
          setColumns((prev) => ({ ...prev, [side]: { ...prev[side], running: false } }));
          return;
        }

        // Poll until the worker judges, or until one of the two terminal states
        // says it never will. A ceiling as well, so a page left open does not
        // poll a dead endpoint forever.
        for (let attempt = 0; attempt < POLL_CEILING; attempt += 1) {
          const verdict = await pollDemoVerdict(run.intentId);
          if (verdict.state !== DemoVerdictState.PENDING) {
            setColumns((prev) => ({ ...prev, [side]: { ...prev[side], verdict, running: false } }));
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        }

        setColumns((prev) => ({
          ...prev,
          [side]: {
            ...prev[side],
            running: false,
            verdict: { state: DemoVerdictState.GAVE_UP, stages: null, money: null, reason: null },
          },
        }));
      } catch (error) {
        setColumns((prev) => ({
          ...prev,
          [side]: { ...EMPTY, error: messageFor(error) },
        }));
      }
    },
    [queries]
  );

  if (configured === false) {
    return (
      <Shell>
        <Banner
          tone="primary"
          title="The live demo is not available yet"
          description="There is nothing to run here yet. Nothing is broken."
        />
        <p className="text-body-13 text-02">
          You can still read{" "}
          <Link href="/how-it-works" className="text-primary-500 underline">
            how a call is checked before it is charged
          </Link>{" "}
          or browse{" "}
          <Link href="/catalogue" className="text-primary-500 underline">
            the tools and prices
          </Link>
          .
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="flex flex-col items-center gap-3 py-6 text-center">
        <h1 className="text-display-md text-01 sm:text-display-lg">Make it refuse to charge you.</h1>
        <p className="max-w-[720px] text-body-15 text-02">
          <span className="hidden sm:inline">
            Two real calls against real tools, from your browser, with no account. The one on the
            right is served by a deliberately broken binding — watch the charge not happen.
          </span>
          <span className="sm:hidden">
            Two real calls, from your phone, no account. The second one is served by a deliberately
            broken binding.
          </span>
        </p>
        <span className="rounded-full bg-teal-10 px-3 py-1 font-mono text-mono-2xs tracking-[1.1px] text-teal-600">
          ● NO SIGNUP · WE PAY FOR THESE CALLS
        </span>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CallCard
          title="A normal call"
          chip="CHARGED"
          tone="default"
          tool="search_wikipedia"
          query={queries.pass}
          onQuery={(value) => setQueries((prev) => ({ ...prev, pass: value }))}
          onRun={() => void execute("pass")}
          state={columns.pass}
          footer="Passed every check we run on this call. The hold was charged."
        />
        <CallCard
          title="A call that returns nothing usable"
          chip="NOT CHARGED"
          tone="teal"
          tool="search_wikipedia · every result carries the same id"
          query={queries.fail}
          onQuery={(value) => setQueries((prev) => ({ ...prev, fail: value }))}
          onRun={() => void execute("fail")}
          state={columns.fail}
          footer="Failed our checks — you were not charged. The hold was released in full and the money stayed where it was."
        />
      </div>

      {/* Mobile drops this strip, exactly as the design draws it — see divergence 7. */}
      {compensation && (
        <section className="hidden rounded-xl border border-teal-200 bg-teal-10 p-5 lg:block">
          <h2 className="text-heading-sm text-teal-600">
            {`And ${formatMoney(money(compensation.agentAmount, compensation), { decimals: 2 })} came back to the agent from the provider's stake.`}
          </h2>
          <p className="mt-2 max-w-[820px] text-body-13 text-02">
            This is a real slash that was already executed on chain — not the call you just ran. A
            penalty needs a violated service window, a signed attestation and a 72-hour timelock,
            so it cannot be about a call from a moment ago. The provider lost{" "}
            {formatMoney(money(compensation.appliedAmount, compensation), { decimals: 2 })} from the
            stake they put up; the agent who was served the bad result received the share below, and
            no plain x402 gateway can do this at all.
          </p>
          <dl className="mt-4 flex flex-wrap gap-6 font-mono text-mono-13">
            <Figure label="Provider stake" value={`−${formatMoney(money(compensation.appliedAmount, compensation), { decimals: 2 })}`} tone="danger" />
            <Figure label="Agent" value={`+${formatMoney(money(compensation.agentAmount, compensation), { decimals: 2 })}`} tone="teal" />
            <Figure label="Platform" value={`+${formatMoney(money(compensation.platformAmount, compensation), { decimals: 2 })}`} />
          </dl>
          <p className="mt-3 break-all font-mono text-mono-2xs text-03">
            signature {compensation.executionSignature}
          </p>
        </section>
      )}

      <Banner
        tone="primary"
        title="A refund here is a released hold, so a balance never moves."
        description="That is exactly why this page exists: the product's central claim is invisible by construction, and the only way to make it land is to run it in front of you."
      />

      {/*
        Fixed rather than sticky, and the Shell pads for it on small screens.
        As `sticky bottom-4` it sat ON TOP of the second column's Run button —
        the visitor could not press the very button the page is about.
      */}
      <a
        href="/login"
        className="fixed inset-x-4 bottom-4 z-10 block rounded-lg bg-primary-400 px-4 py-3 text-center text-label-sm text-on-primary shadow-lg lg:hidden"
      >
        Start free: many tools include free calls every day
      </a>
    </Shell>
  );
}

function CallCard(props: {
  title: string;
  chip: string;
  tone: "default" | "teal";
  tool: string;
  query: string;
  onQuery: (value: string) => void;
  onRun: () => void;
  state: ColumnState;
  footer: string;
}) {
  const { state } = props;
  const teal = props.tone === "teal";

  return (
    <section className="flex flex-col rounded-xl border border-02 bg-01">
      <div
        className={`flex items-center justify-between rounded-t-xl px-5 py-4 ${teal ? "bg-teal-10" : ""}`}
      >
        <h2 className="text-heading-sm text-01">{props.title}</h2>
        <span
          className={`rounded-full px-2 py-1 font-mono text-mono-2xs tracking-[1.1px] ${
            teal ? "bg-01 text-teal-600" : "bg-02 text-02"
          }`}
        >
          ● {props.chip}
        </span>
      </div>

      <div className="flex flex-col gap-3 px-5 pb-5">
        <p className="font-mono text-mono-13 text-01">{props.tool}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={props.query}
            onChange={(event) => props.onQuery(event.target.value)}
            maxLength={200}
            aria-label={`${props.title} query`}
          />
          <Button
            onClick={props.onRun}
            disabled={state.running}
            className={`shrink-0 ${teal ? "bg-teal-600 text-on-color hover:bg-teal-600/90 dark:text-on-primary" : ""}`}
          >
            <Play className="mr-2 h-4 w-4" />
            {state.running ? "Running…" : "Run"}
          </Button>
        </div>

        {state.error && <Banner tone="warning" title={state.error} />}

        {state.run && (
          <>
            <pre className="max-h-[220px] overflow-auto rounded-lg bg-02 p-3 font-mono text-mono-2xs text-02">
              <span className="text-03">
                RESPONSE · {state.run.status === "RESULT" ? 200 : 502} · {state.run.latencyMs}ms
              </span>
              {"\n"}
              {JSON.stringify(state.run.body, null, 1)}
            </pre>

            {state.run.inconclusive && <Banner tone="warning" title={state.run.inconclusive} />}

            <Checks state={state} />
            <Money state={state} />

            {state.verdict?.state === DemoVerdictState.READY && (
              <p className={`text-body-13 ${teal ? "text-teal-600" : "text-02"}`}>{props.footer}</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The design's three check lines.
 *
 * `Relevance judgement` reads `not sampled` with **no rate**: the seeded policy
 * has `semantic.enabled: false` and nothing implements `SEMANTIC_JUDGE`, so the
 * frame's "1 in 125" would publish a sampling rate that does not exist.
 */
function Checks({ state }: { state: ColumnState }) {
  const verdict = state.verdict;

  if (!verdict || verdict.state === DemoVerdictState.PENDING) {
    return (
      <ul className="flex flex-col gap-2">
        {["Response shape", "Result quality rules", "Relevance judgement"].map((label) => (
          <li key={label} className="flex items-center gap-2 text-body-13 text-03">
            <Minus className="h-4 w-4" />
            {label}
            <span className="ml-auto">checking…</span>
          </li>
        ))}
      </ul>
    );
  }

  if (verdict.state !== DemoVerdictState.READY) {
    return (
      <Banner
        tone="warning"
        title={
          verdict.state === DemoVerdictState.SETTLED_WITHOUT_JUDGEMENT
            ? "This call was settled without reaching our checks"
            : "No verdict arrived for this call"
        }
        description={
          verdict.reason ??
          "The checks did not run within the time we wait. Nothing is being hidden — there is simply no verdict to show."
        }
      />
    );
  }

  const stages = (verdict.stages ?? []).filter((stage) => DEMO_STAGE_LABELS[stage.stage]);

  return (
    <ul className="flex flex-col gap-2">
      {stages.map((stage) => {
        const passed = stage.status === "PASSED";
        const failed = stage.status === "FAILED" || stage.status === "MISAPPLIED";
        return (
          <li key={stage.stage} className="flex items-start gap-2 text-body-13">
            {passed ? (
              <Check className="mt-[2px] h-4 w-4 text-teal-600" />
            ) : failed ? (
              <X className="mt-[2px] h-4 w-4 text-danger-600" />
            ) : (
              <Minus className="mt-[2px] h-4 w-4 text-03" />
            )}
            <span className="text-01">{DEMO_STAGE_LABELS[stage.stage]}</span>
            <span
              className={`ml-auto text-right ${passed ? "text-teal-600" : failed ? "text-danger-600" : "text-03"}`}
            >
              {passed
                ? "passed"
                : failed
                  ? `failed · ${stage.detail ?? stage.code ?? "quality rule"}`
                  : "not sampled"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Money({ state }: { state: ColumnState }) {
  const money = state.verdict?.money;

  // Phase one knows the LISTED price and that a hold is open — nothing else.
  // Printing a charge here and correcting it seconds later is the one thing
  // this page cannot afford to do.
  if (!money) {
    return (
      <div className="rounded-lg bg-02 p-3 text-body-13 text-02">
        Listed{" "}
        <span className="font-mono text-mono-13 text-01">
          {state.run ? formatMoney(state.run.listedPrice, { decimals: 4 }) : "—"}
        </span>{" "}
        · the hold is open while our checks run.
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-3 gap-3 rounded-lg bg-02 p-3">
      <Figure label="Listed price" value={formatMoney(money.listed, { decimals: 4 })} />
      <Figure label="You paid" value={formatMoney(money.paid, { decimals: 4 })} />
      <Figure
        label="Not charged"
        value={formatMoney(money.notCharged, { decimals: 4 })}
        tone={money.notCharged.amount !== "0" ? "teal" : undefined}
      />
    </dl>
  );
}

function Figure(props: { label: string; value: string; tone?: "teal" | "danger" }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-label-13 text-02">{props.label}</dt>
      <dd
        className={`font-mono text-mono-13 ${
          props.tone === "teal"
            ? "text-teal-600"
            : props.tone === "danger"
              ? "text-danger-600"
              : "text-01"
        }`}
      >
        {props.value}
      </dd>
    </div>
  );
}

function money(amount: string, source: { asset: string; decimals: number }) {
  return { amount, asset: source.asset, decimals: source.decimals };
}

function messageFor(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  // The duplicate-request detector, which is a real protection doing its job.
  // Every visitor shares one demo agent, so the sixth identical query inside a
  // minute is refused — and an unexplained 429 reads as the demo being broken.
  if (/velocity|duplicate/i.test(message)) {
    return "Someone just ran this exact query. Change the question to your own and run it again — the platform refuses repeated identical calls, and that limit is shared across everyone on this page.";
  }
  if (/too many/i.test(message)) {
    return "That is enough demo calls from this address for the moment. Try again shortly.";
  }
  return message;
}

function Shell({ children }: { children: React.ReactNode }) {
  // `pb-24` on small screens leaves room for the fixed CTA above; without it
  // the CTA covers the last card's controls.
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-5 pb-24 pt-4 lg:pb-8">
      {children}
    </div>
  );
}
