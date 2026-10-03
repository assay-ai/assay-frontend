"use client";

import { ArrowRight, CircleCheck, CircleX, Globe, Network, Shield, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import {
  AccountFields,
  EndpointFields,
  Outcome,
  PayoutWalletFields,
  Refusal,
  StepCard,
  TermsBody,
} from "@/features/m41/steps";
import { useProviderSetup } from "@/features/m41/use-setup";

/**
 * Provider setup — route `/provider/setup`.
 *
 * The four steps — account, payout wallet, endpoint with a connectivity
 * check, terms — all live here, because the frame draws all four here. Its
 * companion registration screen (`/provider/register`) draws only the
 * first two, inside the console shell, and renders them from the same module
 * so the two routes cannot drift into two implementations.
 *
 * ## The terms are printed, not linked
 *
 * Step 4 is the full commercial table — take rate, payouts, reserve, clawback,
 * stake, what is slashable, where a penalty goes — followed by the acceptance
 * line. There is no link, no modal and no "see terms" affordance anywhere on
 * this screen, and there must not be one: the checkbox confirms text the
 * reader has in front of them, which is the only thing that makes an
 * acceptance mean anything.
 *
 * ## What the API forces about the ORDER
 *
 * The frame shows four cards side by side, not four pages, and that is right —
 * but they are not four independent writes:
 *
 *   - `POST /providers` takes the account AND the accepted terms in one body,
 *     so the header button writes steps 1 and 4 together. There is no route
 *     that does either alone.
 *   - Step 2's challenge and step 3's save both need that row to exist and
 *     say so until it does.
 *
 * ## The Bar
 *
 * "step 2 of 4" in the 56px bar is a static string in `(minimal)/layout.tsx`'s
 * pathname map, not this screen's live `currentStep`. The layout's own comment
 * names that map as the seam for live data; it is a shared file, so the
 * mismatch is left visible rather than patched from here.
 */
export default function ProviderSetupPage() {
  const setup = useProviderSetup();
  const router = useRouter();
  const {
    loading,
    loadError,
    registered,
    steps,
    allDone,
    save,
    saveBlockedBy,
    attempted,
    saving,
    saveError,
    saved,
    egressIps,
  } = setup;

  const statusOf = (key: string) => steps.find((s) => s.key === key)?.status ?? "NOT_STARTED";

  return (
    <>
      {/* Header */}
      <div className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <h1 className="text-heading-md text-01">Set up your provider account</h1>
          <p className="text-body-sm text-02">
            Four steps, then you write your binding and publish it yourself. You do not build
            anything against our API — you need an endpoint and a wallet.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Button
            icon={<ArrowRight />}
            loading={saving}
            onClick={allDone ? () => router.push("/provider") : save}
          >
            Save and continue
          </Button>
        </div>
      </div>

      {loadError ? (
        <Outcome tone="danger" icon={<CircleX />}>
          {loadError.message}
        </Outcome>
      ) : null}

      {/* Row */}
      <div className="flex w-full flex-1 flex-col gap-4 tablet:flex-row">
        {/* Left */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <StepCard
            title="1 · Account"
            caption="who we contact, and in which timezone"
            status={statusOf("account")}
          >
            <AccountFields
              setup={setup}
              copy={{
                technicalHint: "webhooks, incidents, binding changes",
                ownerHint: "escalation — never the same inbox as technical",
                timezoneHint: "any deadline we ever give you is counted in business days here",
              }}
            />
            {saveError ? (
              <Outcome tone="danger" icon={<CircleX />}>
                {saveError.message}
              </Outcome>
            ) : null}
            {saved && !saveError ? (
              <Outcome tone="teal" icon={<CircleCheck />}>
                Saved.
              </Outcome>
            ) : null}
            {attempted && saveBlockedBy && !loading ? <Refusal>{saveBlockedBy}</Refusal> : null}
          </StepCard>

          <StepCard
            title="2 · Payout wallet"
            caption="where your earnings land"
            status={statusOf("payoutWallet")}
          >
            <PayoutWalletFields
              setup={setup}
              addressPlaceholder="7xKX9mQ2vLpR4nT8jW1aZ6cE3bY5dF0gH2kM4pN7sV9u"
              addressHint="Payouts are on-chain and final. We cannot reverse a payment sent to the wrong address."
              buttonLabel="Sign a nonce to prove you control this wallet"
            />
            {/* Note */}
            <Outcome tone="primary" icon={<Shield />}>
              Console only. We will never ask you to submit a payout address over the CLI, by email
              or in a support ticket — a path like that is a phishing surface and we do not want one
              to exist.
            </Outcome>
          </StepCard>

          <StepCard
            title="3 · Endpoint"
            caption="what we will call, and whether we can reach it"
            status={statusOf("endpoint")}
          >
            <EndpointFields setup={setup} />
            {/* Note — the addresses come off the wire, not the frame. */}
            <Outcome tone="primary" icon={<Network />}>
              {egressIps.length > 0 ? (
                <>
                  We call your endpoint from these fixed egress IPs —{" "}
                  <span className="font-mono text-mono-13">{egressIps.join(", ")}</span>. Add them
                  to your allowlist, then run the check here rather than finding out after you go
                  live.
                </>
              ) : (
                <>
                  This deployment does not call from a fixed set of egress IPs, so there is nothing
                  to allowlist. Run the check here rather than finding out after you go live.
                </>
              )}
            </Outcome>
          </StepCard>

          <StepCard
            title="4 · Terms"
            caption="two documents, no second page of conditions"
            status={statusOf("terms")}
          >
            <TermsBody setup={setup} />
          </StepCard>
        </div>

        {/* Rail */}
        <div className="flex w-full flex-col gap-4 tablet:w-[420px] tablet:shrink-0">
          <Panel className="shadow-none">
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>What happens next</PanelTitle>
                <PanelDescription className="whitespace-normal">
                  after you finish these three steps
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              <NextStep
                ordinal="1"
                title="You register and stake"
                body="Open registration. $100 minimum stake before paid traffic; the free path needs none."
              />
              <NextStep
                ordinal="2"
                title="You write and test the binding"
                body="The binding editor writes it; the mapping tester runs it against your real endpoint and shows you what each verification stage thinks of the response."
              />
              <NextStep
                ordinal="3"
                title="We publish it when your tester is green"
                body="Publish is gated on a passing tester and stake at or above the minimum — not on a human reading your application."
              />
              <NextStep
                ordinal="4"
                title="You get paid, and you can be slashed"
                body="Paid on-chain to your own token account when the buyer's voucher is redeemed. A rejected response costs stake once slashing is live — the verdicts and flags screen shows you the amount during shadow mode first."
              />
            </PanelBody>
          </Panel>

          <Panel className="shadow-none">
            <PanelHeader className="bg-02">
              <PanelTitles>
                <PanelTitle>What we need from you</PanelTitle>
                <PanelDescription className="whitespace-normal">
                  the whole integration
                </PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="gap-3.5 p-5">
              <NeedRow
                icon={<Globe />}
                title="An HTTP endpoint"
                body="Any shape. JSON in, JSON out."
              />
              <NeedRow icon={<Wallet />} title="A wallet" body="Proved once, by signature." />
              <NeedRow
                icon={<Shield />}
                title="An allowlist entry for our egress IPs"
                body="Shown in step 3, with a one-click check that we can reach you."
              />
            </PanelBody>
          </Panel>
        </div>
      </div>

      {registered && allDone ? (
        <Outcome tone="teal" icon={<CircleCheck />}>
          All four steps are done. You are registered as a provider.
        </Outcome>
      ) : null}
    </>
  );
}

/** One numbered row of "What happens next". */
function NextStep({ ordinal, title, body }: { ordinal: string; title: string; body: string }) {
  return (
    <div className="flex w-full gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-03 font-mono text-mono-xs font-semibold text-02">
        {ordinal}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-label-13 text-01">{title}</span>
        <span className="text-body-xs text-02">{body}</span>
      </div>
    </div>
  );
}

/** One row of "What we need from you" — 15px `$success-500` icon. */
function NeedRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex w-full gap-2.5">
      <span
        aria-hidden="true"
        className="mt-0.5 flex size-[15px] shrink-0 items-center justify-center text-success-500 [&_svg]:size-[15px]"
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-label-13 text-01">{title}</span>
        <span className="text-body-xs text-03">{body}</span>
      </div>
    </div>
  );
}
