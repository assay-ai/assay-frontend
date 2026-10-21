"use client";

import { useConnectWallet } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, CircleX, PartyPopper, TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { SignAction } from "@/components/patterns/sign-action";
import { Stepper, type StepperStep } from "@/components/patterns/stepper";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { stakeRuleOf } from "@/features/provider-binding/go-live";
import { combinedProgress } from "@/features/provider-binding/wizard/stages";
import { Outcome } from "@/features/m41/outcome";
import { plainTermsLine, termLabel, termValue } from "@/features/m41/terms";
import { addressFamily, useProviderSetup, type ProviderSetup } from "@/features/m41/use-setup";
import { WINDOW_WORDS } from "@/features/provider-sla/window";
import { waitingPeriodOf, waitingPeriodPhrase } from "@/features/provider-stake/withdraw-state";
import { useChainName } from "@/hooks/useChainName";
import { useConnectedAddresses } from "@/hooks/useSigner";
import { ApiError } from "@/libs/ApiClient";
import { GLOSSARY } from "@/libs/glossary";
import { knowsError, plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { listToolBindings } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";
import { addressOfAccount } from "@/utils/chain";

/**
 * Provider setup — `/provider/setup`. Three steps on one page:
 *
 *   1 You       business name, you, a second person for escalations, the terms
 *   2 Get paid  connect a wallet, sign a message (free); the chain follows the wallet
 *   3 Your API  the endpoint, checked as soon as you leave the field
 *
 * then one screen with one button: "Create your first tool listing" ("List
 * another tool" once there are listings), which carries the endpoint (and a
 * price from the public calculator, if one came in on `?price=`) into the
 * listing wizard.
 *
 * That last screen is also the console's business explainer ("How earning,
 * stake and penalties work", linked from the rail, Home and Account): price,
 * stake and penalty in three lines, with the glossary's worked penalty
 * example. Its numbers come from the shared constants, never typed here.
 *
 * The order is the backend's: registering creates the provider record and
 * needs the terms, and a payout proof and an endpoint are stored on that record.
 */

type Stage = "you" | "paid" | "api" | "done";

const STAGE_FROM_PARAM: Record<string, Stage> = { you: "you", account: "you", wallet: "paid", paid: "paid", api: "api", endpoint: "api" };

/** Terms that the platform does not enforce are not shown as terms (business #10: no per-window cap). */
const HIDDEN_TERMS = /penalty.?ceiling/i;

function stageDone(setup: ProviderSetup, stage: Exclude<Stage, "done">): boolean {
  const status = (key: string) => setup.steps.find((step) => step.key === key)?.status;
  // Terms read from the server count at once: `accepted` is only copied from them after the first render.
  const accepted = setup.accepted || Boolean(setup.state?.registration.acceptedTerms);
  if (stage === "you") return setup.registered && status("account") === "DONE" && accepted;
  if (stage === "paid") return status("payoutWallet") === "DONE";
  return status("endpoint") === "DONE";
}

export default function ProviderSetupPage() {
  const setup = useProviderSetup();
  const params = useSearchParams();
  const requested = STAGE_FROM_PARAM[params.get("step") ?? ""] ?? null;
  const [stage, setStage] = React.useState<Stage | null>(null);

  const done = {
    you: stageDone(setup, "you"),
    paid: stageDone(setup, "paid"),
    api: stageDone(setup, "api"),
  };
  const firstOpen: Stage = !done.you ? "you" : !done.paid ? "paid" : !done.api ? "api" : "done";

  // Land on the asked-for step when it can be done now, else on the first unfinished one.
  React.useEffect(() => {
    if (stage !== null || setup.loading) return;
    const order: Stage[] = ["you", "paid", "api", "done"];
    const allowed = requested && order.indexOf(requested) <= order.indexOf(firstOpen) ? requested : firstOpen;
    setStage(allowed);
  }, [stage, setup.loading, requested, firstOpen]);

  if (setup.loading || stage === null) {
    return (
      <SetupFrame>
        <PageState kind="loading" rows={4} label="Loading your setup" />
      </SetupFrame>
    );
  }
  if (setup.loadError) {
    return (
      <SetupFrame>
        <PageState
          kind="error"
          description="Your provider setup could not be loaded."
          code={setup.loadError.code}
          details={setup.loadError.message}
          onRetry={() => window.location.reload()}
        />
      </SetupFrame>
    );
  }

  const stepperSteps: StepperStep[] = (
    [
      { id: "you", label: "You" },
      { id: "paid", label: "Get paid" },
      { id: "api", label: "Your API" },
    ] as const
  ).map((step, index, all) => {
    // A step after the one on screen is never shown as done: the stepper says where you are, in order.
    const current = all.findIndex((entry) => entry.id === stage);
    const ahead = current !== -1 && index > current;
    return { ...step, state: stage === step.id ? "current" : done[step.id] && !ahead ? "done" : "upcoming" };
  });

  const price = params.get("price");
  const wizardHref = (() => {
    const base = routes.bindingWizard();
    const extra = new URLSearchParams();
    if (setup.savedEndpoint) extra.set("endpoint", setup.savedEndpoint);
    if (price && /^\d*\.?\d+$/.test(price)) extra.set("price", price);
    const query = extra.toString();
    return query ? `${base}?${query}` : base;
  })();

  return (
    <SetupFrame>
      {stage === "done" ? (
        <DoneScreen href={wizardHref} setup={setup} />
      ) : (
        <>
          <header className="flex flex-col gap-1">
            <h1 className="text-heading-sm text-01 tablet:text-heading-md">Set up your provider account</h1>
            <p className="text-body-13 text-02">
              Three short steps, about five minutes. Then you list your first tool and publish it yourself: there is no
              review queue.
            </p>
          </header>
          <p className="text-label-13 text-02">{combinedProgress([done.you, done.paid, done.api].filter(Boolean).length, null)}</p>
          <Stepper steps={stepperSteps} onSelect={(id) => setStage(id as Stage)} label="Setup progress" />
          {stage === "you" ? <YouStep setup={setup} onNext={() => setStage(done.paid ? (done.api ? "done" : "api") : "paid")} /> : null}
          {stage === "paid" ? <PaidStep setup={setup} onNext={() => setStage(done.api ? "done" : "api")} /> : null}
          {stage === "api" ? <ApiStep setup={setup} onNext={() => setStage("done")} /> : null}
        </>
      )}
    </SetupFrame>
  );
}

/** A plain sentence for an API error; the server's own message when the dictionary has none. */
function errorSentence(error: unknown): string {
  if (error instanceof ApiError) return knowsError(error.code) ? plainError(error.code) : error.message;
  return error instanceof Error && error.message ? error.message : "That did not go through. Try again.";
}

function SetupFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">{children}</div>;
}

function Card({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 p-4 tablet:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-label-md text-01">{title}</h2>
        {description ? <p className="text-body-13 text-02">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ 1 · You */

function YouStep({ setup, onNext }: { setup: ProviderSetup; onNext: () => void }) {
  const { account, setAccountField, accountErrors, touch, terms, accepted, setAccepted, registered } = setup;
  const [editZone, setEditZone] = React.useState(false);
  const sans = "font-sans text-body-sm";
  const shownTerms = terms.commercialTerms.filter((term) => !HIDDEN_TERMS.test(`${term.key} ${term.label}`));
  const clean = registered && !setup.accountDirty;

  return (
    <Card title="About you" description="Who buyers' payments go to, and who we contact if something breaks.">
      <Field
        label="Business or trading name"
        className={sans}
        placeholder="Acme Data Ltd"
        value={account.legalName}
        error={accountErrors.legalName}
        autoComplete="organization"
        onChange={(e) => setAccountField("legalName", e.target.value)}
        onBlur={() => touch("legalName")}
      />
      <div className="grid w-full gap-4 tablet:grid-cols-2">
        <Field
          label="Your name"
          className={sans}
          placeholder="Alex Example"
          value={account.technicalName}
          error={accountErrors.technicalName}
          autoComplete="name"
          onChange={(e) => setAccountField("technicalName", e.target.value)}
          onBlur={() => touch("technicalName")}
        />
        <Field
          label="Your email"
          type="email"
          className={sans}
          placeholder="alex@acme.example"
          hint="Incidents and changes to your tools."
          value={account.technicalEmail}
          error={accountErrors.technicalEmail}
          autoComplete="email"
          onChange={(e) => setAccountField("technicalEmail", e.target.value)}
          onBlur={() => touch("technicalEmail")}
        />
      </div>

      <fieldset className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-02 p-3.5">
        <legend className="px-1 text-label-13 text-01">A second person</legend>
        <p className="text-body-xs text-02">
          Someone we can reach when you are away, with a different inbox. We only use it for escalations.
        </p>
        <div className="grid w-full gap-4 tablet:grid-cols-2">
          <Field
            label="Their name"
            className={sans}
            placeholder="Sam Example"
            value={account.ownerName}
            error={accountErrors.ownerName}
            onChange={(e) => setAccountField("ownerName", e.target.value)}
            onBlur={() => touch("ownerName")}
          />
          <Field
            label="Their email"
            type="email"
            className={sans}
            placeholder="sam@acme.example"
            value={account.ownerEmail}
            error={accountErrors.ownerEmail}
            onChange={(e) => setAccountField("ownerEmail", e.target.value)}
            onBlur={() => touch("ownerEmail")}
          />
        </div>
      </fieldset>

      {editZone || accountErrors.timezone || !account.timezone ? (
        <Field
          label="Time zone"
          className={sans}
          placeholder="Europe/London"
          hint="Emails about deadlines use this zone. The console shows every time in UTC, labelled."
          value={account.timezone}
          error={accountErrors.timezone}
          onChange={(e) => setAccountField("timezone", e.target.value)}
          onBlur={() => touch("timezone")}
        />
      ) : (
        <p className="text-body-13 text-02">
          Emails about deadlines use <span className="font-semibold text-01">{account.timezone}</span>; the console
          shows every time in UTC, labelled.{" "}
          <button type="button" className="text-primary-600 underline-offset-2 hover:underline" onClick={() => setEditZone(true)}>
            Change
          </button>
        </p>
      )}

      <div className="flex w-full flex-col gap-2 rounded-lg border border-primary-20 bg-primary-10 p-3.5 text-body-13 text-primary-700">
        <p>
          <span className="font-semibold">Free tools need no stake.</span> To charge per call you add stake: it backs the
          failure rate you promise, and you get it back when you stop. You choose later, per tool.
        </p>
      </div>

      <details className="group w-full text-body-13">
        <summary className="cursor-pointer select-none text-label-13 text-primary-600">Key terms</summary>
        <dl className="mt-2 flex w-full flex-col">
          {shownTerms.map((term) => (
            <div key={term.key} className="flex w-full flex-col gap-0.5 border-t border-01 py-2 tablet:flex-row tablet:gap-3">
              <dt className="text-02 tablet:w-44 tablet:shrink-0">{termLabel(term)}</dt>
              <dd className="flex flex-col gap-0.5">
                <span className="font-semibold text-01">{termValue(term)}</span>
                <span className="text-body-xs text-03">{term.caption}</span>
              </dd>
            </div>
          ))}
        </dl>
      </details>

      <Checkbox
        checked={accepted}
        disabled={registered}
        onChange={(e) => setAccepted(e.target.checked)}
        label={plainTermsLine(terms.acceptanceLine)}
        className="items-start [&>span:first-of-type]:mt-px"
      />

      {setup.saveError ? (
        <Outcome tone="danger" icon={<CircleX />}>
          {errorSentence(setup.saveError)}
        </Outcome>
      ) : null}
      {setup.attempted && setup.saveBlockedBy ? (
        <p role="status" className="text-body-xs text-danger-600">
          {setup.saveBlockedBy.replace("Step 1 is not finished — every account field is required.", "Fill in every field above.").replace(
            "Step 4 is not finished — the terms above have to be accepted.",
            "Tick the box to accept the terms.",
          )}
        </p>
      ) : null}

      <Button
        className="self-stretch tablet:self-end"
        icon={<ArrowRight />}
        loading={setup.saving}
        onClick={() => (clean ? onNext() : setup.save(onNext))}
      >
        {registered ? (clean ? "Continue" : "Save and continue") : "Create account"}
      </Button>
    </Card>
  );
}

/* ------------------------------------------------------------- 2 · Get paid */

function PaidStep({ setup, onNext }: { setup: ProviderSetup; onNext: () => void }) {
  const connected = useConnectedAddresses();
  const { connectWallet } = useConnectWallet();
  const chainName = useChainName();
  const usable = connected.filter((address) => addressFamily(address) !== null);
  const { address, setAddress } = setup;

  // Follow the connected wallet: preselect it, and keep the choice valid when wallets change.
  React.useEffect(() => {
    if (usable.length > 0 && !usable.includes(address)) setAddress(usable[0]!);
  }, [usable, address, setAddress]);

  const active = setup.payoutAccounts.filter((account) => account.status === "ACTIVE");
  const paidDone = stageDone(setup, "paid");

  return (
    <Card
      title="Where you get paid"
      description="Buyers' payments for your tool land in this wallet, on chain, as each call settles. Prove it is yours by signing a message: it is free and moves no money."
    >
      {active.map((account) => (
        <Outcome key={account.chainId} tone="teal" icon={<CircleCheck />}>
          Paid to <span className="font-mono text-mono-13 [overflow-wrap:anywhere]">{addressOfAccount(account.accountId)}</span> on{" "}
          {chainName(account.chainId)}.
        </Outcome>
      ))}
      {setup.payoutAccounts
        .filter((account) => account.status !== "ACTIVE")
        .map((account) => (
          <Outcome key={account.chainId} tone="warning" icon={<TriangleAlert />}>
            Payouts on {chainName(account.chainId)} are stopped ({account.status === "UNBONDING" ? "you are leaving that network" : "suspended by Assay"}).
            Contact support to restart them.
          </Outcome>
        ))}

      {usable.length === 0 ? (
        <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 p-3.5">
          <p className="text-body-13 text-02">No wallet is connected in this browser yet.</p>
          <Button
            variant="secondary"
            icon={<Wallet />}
            className="self-start"
            onClick={() => connectWallet({ walletChainType: "ethereum-and-solana" })}
          >
            Connect wallet
          </Button>
        </div>
      ) : (
        <div className="flex w-full flex-col gap-2">
          <span className="text-label-13 text-01">{paidDone ? "Pay me in a different wallet" : "Wallet to be paid in"}</span>
          <div role="radiogroup" aria-label="Wallet to be paid in" className="flex w-full flex-col gap-1.5">
            {usable.map((option) => (
              <label
                key={option}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5",
                  option === address ? "border-primary-500 bg-primary-10" : "border-01 bg-01 hover:bg-02",
                )}
              >
                <input
                  type="radio"
                  name="payout-wallet"
                  className="accent-primary-500"
                  checked={option === address}
                  onChange={() => setAddress(option)}
                />
                <span className="min-w-0 flex-1 font-mono text-mono-12 text-01 [overflow-wrap:anywhere]">{option}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-body-xs text-03">
              {setup.chainId ? `Network: ${chainName(setup.chainId)}` : "Assay does not pay out on this wallet's network."}
            </span>
            <button
              type="button"
              className="text-label-xs text-primary-600 underline-offset-2 hover:underline"
              onClick={() => connectWallet({ walletChainType: "ethereum-and-solana" })}
            >
              Use another wallet
            </button>
          </div>
          <SignAction
            label={paidDone ? "Sign a message to switch (free)" : "Sign a message (free)"}
            resetKey={address}
            disabled={Boolean(setup.walletBlockedBy)}
            disabledReason={setup.walletBlockedBy}
            steps={[
              {
                id: "prove",
                label: "Sign a message (free)",
                cost: "free",
                run: () => setup.prove(),
              },
            ]}
            successTitle="Wallet confirmed"
            successDescription="Payments for your tools will land here."
            describeError={errorSentence}
          />
        </div>
      )}

      <p className="text-body-xs text-03">
        We will never ask for a payout address by email, chat or support ticket. Only change it here.
      </p>

      <Button className="self-stretch tablet:self-end" icon={<ArrowRight />} disabled={!paidDone} onClick={onNext}>
        Continue
      </Button>
      {!paidDone ? <p className="-mt-2 text-right text-body-xs text-03">Sign the message above to continue.</p> : null}
    </Card>
  );
}

/* ------------------------------------------------------------- 3 · Your API */

function ApiStep({ setup, onNext }: { setup: ProviderSetup; onNext: () => void }) {
  const { endpoint, setEndpoint, probe, checking } = setup;
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const trimmed = endpoint.trim();
  const checkedThis = probe && probe.endpoint === trimmed ? probe : null;
  const savedThis = Boolean(trimmed) && setup.savedEndpoint === trimmed && checkedThis?.outcome === "REACHABLE";

  const finish = async () => {
    setError(null);
    if (!trimmed) {
      setError("Enter the address of your API.");
      return;
    }
    if (savedThis) {
      onNext();
      return;
    }
    setSaving(true);
    try {
      const result = await setup.declareAsync(trimmed);
      if (result.outcome === "REACHABLE") onNext();
      else setError(null);
    } catch (caught) {
      setError(errorSentence(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title="Your API"
      description="The HTTPS address Assay calls for your tools. Any JSON API works: you map it onto the tool when you list it, and change nothing on your side. Each tool you list can use a different address; this one is filled in for you."
    >
      <Field
        label="API address"
        className="font-sans text-body-sm"
        placeholder="https://api.acme.example/v1"
        inputMode="url"
        autoComplete="url"
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
        onBlur={() => {
          if (trimmed && (!probe || probe.endpoint !== trimmed)) setup.check();
        }}
      />
      <div aria-live="polite" className="min-h-5">
        {checking ? (
          <p className="text-body-xs text-03">Checking we can reach it…</p>
        ) : checkedThis?.outcome === "REACHABLE" ? (
          <Outcome tone="teal" icon={<CircleCheck />}>
            Reachable{checkedThis.latencyMs !== null ? ` in ${checkedThis.latencyMs} ms` : ""}. Any answer counts, even
            &quot;not authorised&quot;: we only check that something is listening.
          </Outcome>
        ) : checkedThis?.outcome === "BLOCKED" ? (
          <Outcome tone="danger" icon={<CircleX />}>
            This address cannot be used: it must be a public <code>https://</code> address (not a private or local one).
          </Outcome>
        ) : checkedThis ? (
          <Outcome tone="warning" icon={<TriangleAlert />}>
            We could not reach it.
          </Outcome>
        ) : null}
        {setup.checkError ? (
          <Outcome tone="danger" icon={<CircleX />}>
            {errorSentence(setup.checkError)}
          </Outcome>
        ) : null}
        {error ? <p className="text-body-xs text-danger-600">{error}</p> : null}
      </div>
      {/* Not while a re-check runs: saving re-runs the check server-side, and one provider gets one connectivity check at a time. */}
      <Button
        className="self-stretch tablet:self-end"
        icon={<ArrowRight />}
        loading={saving}
        disabled={checking}
        onClick={() => void finish()}
      >
        Finish setup
      </Button>
    </Card>
  );
}

/* ------------------------------------------------------------------ The end */

function DoneScreen({ href, setup }: { href: string; setup: ProviderSetup }) {
  const term = (pattern: RegExp) => setup.terms.commercialTerms.find((t) => pattern.test(`${t.key} ${t.label}`))?.value ?? null;
  const takeRate = term(/take.?rate/i);
  // The same stake rule the wizard uses: `max(floor, multiplier × price)`, its published defaults until a stake is read.
  const rule = stakeRuleOf(null);
  // With listings already, this screen is the explainer, and its button lists another tool.
  const listings = useQuery({
    queryKey: ["provider", "tool-bindings", "setup-done"],
    queryFn: () => listToolBindings({ limit: 1 }),
    retry: 0,
  });
  const hasListings = (listings.data?.items.length ?? 0) > 0;
  const basics: [string, string][] = [
    [
      "Price",
      `You set a price per call${takeRate ? ` and keep the rest after Assay's ${takeRate} fee` : ""}. Buyers pay only for calls that pass our checks.`,
    ],
    [
      "Stake",
      `Free tools need none. To charge, your stake must cover $${rule.floor.toFixed(0)} or ${rule.multiplier.toNumber().toLocaleString("en-US")} calls at your price, whichever is more. You get it back when you stop, after ${waitingPeriodPhrase(waitingPeriodOf(null, setup.terms))}.`,
    ],
    [
      "Promise",
      `You promise a failure rate. Calls are measured in windows (${WINDOW_WORDS}), and you can dispute a penalty before its deadline.`,
    ],
    // The glossary's own words (third person), as their own rows: the same text as /why-list-here.
    ["Penalty", GLOSSARY["stake-rule"].definition],
    ["Example", GLOSSARY["penalty-example"].definition],
  ];
  return (
    <section className="flex w-full flex-col gap-5 rounded-xl border border-success-20 bg-01 p-5 tablet:p-8">
      <div className="flex items-start gap-3">
        <PartyPopper aria-hidden="true" className="mt-1 size-6 shrink-0 text-success-600" />
        <div className="flex flex-col gap-1">
          <h1 className="text-heading-sm text-01">{hasListings ? "How earning, stake and penalties work" : "You are set up"}</h1>
          <p className="text-body-13 text-02">
            {hasListings
              ? "Your account, payout wallet and API are set up. Here is how you earn and what you risk."
              : "Your account, payout wallet and API are ready. Next, list your first tool."}
          </p>
          <p className="text-label-13 text-02">{combinedProgress(3, null)}</p>
        </div>
      </div>
      <dl className="flex w-full flex-col rounded-lg border border-01 bg-02 px-3.5 py-1">
        {basics.map(([label, body]) => (
          <div key={label} className="flex flex-col gap-0.5 border-t border-01 py-2.5 first:border-t-0 tablet:flex-row tablet:gap-3">
            <dt className="text-label-13 text-01 tablet:w-20 tablet:shrink-0">{label}</dt>
            <dd className="text-body-13 text-02">{body}</dd>
          </div>
        ))}
      </dl>
      <ol className="flex flex-col gap-3">
        {[
          ["Pick the tool your API answers", "and point it at your API. We fill in what we can."],
          ["Run one test call", "We call your API and check the answer, so buyers never get a broken tool."],
          ["Go live", "Free tools publish straight away. To charge per call, add stake first; you get it back when you stop."],
        ].map(([title, body], index) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-03 font-mono text-mono-xs font-semibold text-02">
              {index + 1}
            </span>
            <span className="text-body-13 text-02">
              <span className="text-label-13 text-01">{title}</span> {body}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 tablet:flex-row tablet:items-center">
        <Button asChild className="self-stretch tablet:self-start">
          <Link href={href}>
            {hasListings ? "List another tool" : "Create your first tool listing"}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
        {hasListings ? (
          <Button asChild variant="secondary" className="self-stretch tablet:self-start">
            <Link href="/provider">Back to Home</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
