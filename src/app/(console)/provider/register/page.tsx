"use client";

import { ArrowRight, CircleCheck, CircleX, Info, Shield } from "lucide-react";
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
import { PageHeader } from "@/features/g30/ui";
import {
  AccountFields,
  Outcome,
  PayoutWalletFields,
  Refusal,
} from "@/features/m41/steps";
import { useProviderSetup } from "@/features/m41/use-setup";

/**
 * Registration and wallet proof — route
 * `/provider/register`, console shell.
 *
 * The provider setup screen's companion. `provider-registration.controller.ts`
 * names both, and the split is the design's own: the setup design draws all
 * four steps on the sidebar-less setup shell, this design draws **two** —
 * Account and Payout address — inside the console. Both render from
 * `@/features/m41`, so there is one implementation and one piece of state.
 *
 * Where the two frames word the same field differently they are NOT
 * reconciled: this design's contact hints talk about the dispute clock, the
 * setup design's about deadlines and inboxes, and each screen says what its own frame says.
 *
 * ## Why "Continue" cannot register from here
 *
 * `POST /providers` requires the accepted terms in the same body as the
 * account. This frame has no terms block — the setup screen is where they are printed —
 * so an organisation with no provider row is sent there to read them rather
 * than being registered against text it was never shown. Once the row exists,
 * Continue saves the account and moves on.
 */
export default function ProviderRegisterPage() {
  const setup = useProviderSetup();
  const router = useRouter();
  const { registered, loadError, accountComplete, attempted, save, saving, saveError, saved } =
    setup;

  const blocked = !registered
    ? "You have not registered yet, and registering means accepting the provider terms — they are printed in full on the setup screen, so Continue takes you there rather than accepting them for you."
    : attempted && !accountComplete
      ? "Every account field is required."
      : null;

  function onContinue() {
    if (!registered) {
      router.push("/provider/setup");
      return;
    }
    save();
  }

  return (
    <>
      {/* Page Header */}
      <PageHeader
        title="Register as a provider"
        sub="step 2 of 3 · the payout address is proved by signature, never typed twice"
        actions={
          <Button
            icon={<ArrowRight />}
            loading={saving}
            onClick={onContinue}
          >
            Continue
          </Button>
        }
      />

      {loadError ? (
        <Outcome tone="danger" icon={<CircleX />}>
          {loadError.message}
        </Outcome>
      ) : null}

      {/* Row */}
      <div className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-start">
        {/* Account */}
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Account</PanelTitle>
              <PanelDescription className="whitespace-normal">
                contacts are separate on purpose — an enforcement notice must not go to a shared
                inbox nobody reads
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 p-5">
            <AccountFields
              setup={setup}
              copy={{
                technicalHint: "receives webhooks, incidents, policy notices",
                ownerHint: "escalation target at 60% of any dispute clock",
                timezoneHint: "the dispute clock floor is three business days in this zone",
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
            {blocked ? <Refusal>{blocked}</Refusal> : null}
          </PanelBody>
        </Panel>

        {/* Payout address — 520px in the frame. */}
        <Panel className="w-full tablet:w-[520px] tablet:shrink-0">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Payout address</PanelTitle>
              <PanelDescription className="whitespace-normal">
                console only — a CLI path here is a phishing surface
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3.5 p-5">
            <PayoutWalletFields
              setup={setup}
              addressPlaceholder="7xKX…vault"
              addressHint="Payouts are on-chain and final. We cannot reverse a payment to the wrong address."
              buttonLabel="Sign to prove ownership"
              buttonClassName="py-[11px]"
            />
            {/* Note */}
            <Outcome tone="primary" icon={<Shield />}>
              You will sign a nonce with this wallet. We never accept a payout address that has not
              been proved by signature.
            </Outcome>
            {/* Note — drawn on this frame only, not on the setup screen. */}
            <Outcome tone="neutral" icon={<Info />}>
              Gas is not sponsored for provider actions: staking and unstaking are your
              transactions, and sponsoring them would make the stake meaningless as a cost.
            </Outcome>
          </PanelBody>
        </Panel>
      </div>
    </>
  );
}
