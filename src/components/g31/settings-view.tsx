"use client";

import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";

import { mobileMoreItems } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { Switch } from "@/components/ui/switch";
import { listAgents } from "@/services/account.service";

import { KeyValueRow, PageHeader } from "./chrome";

/**
 * Settings.
 *
 * The design's subtitle is the promise this screen has to keep: "thin at MVP —
 * everything here is also a documented endpoint". Right now almost nothing
 * here is, so almost nothing here is writable.
 *
 * Identity has no endpoint: no user, session or organization resource exists
 * on this API. Email, login method, organization and time zone are named and
 * left unanswered rather than filled with a plausible person. The one row
 * that can be answered is the wallet, which is the agent's `agentAccount`
 * (CAIP-10) from `GET /agents` — the ledger account it spends from.
 *
 * Preferences likewise have no endpoint, so the three switches are read-only.
 * A switch that flips and forgets is worse than a switch that says it cannot
 * save: the second is a missing feature, the first is a lie about quiet hours
 * on a product that pages people about money.
 */

interface Agent {
  agentId: string;
  label?: string;
  agentAccount?: string;
  chainId?: string;
}

export function SettingsView() {
  const agents = useQuery({
    queryKey: ["agents"],
    retry: false,
    queryFn: () => listAgents({ limit: 50 }) as unknown as Promise<{ items: Agent[] }>,
  });

  const first = agents.data?.items[0];

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Settings"
        subtitle="your account, wallet and preferences"
        actions={
          <Button icon={<Check />} type="button" disabled>
            Save
          </Button>
        }
      />

      {/*
        Below 768 the bottom tab bar has no room for every section, and this is
        its "More" tab: the sections without a tab of their own are listed here.
        The account menu (Add funds, Log out) is the avatar in the top bar.
      */}
      <nav aria-label="More sections" className="flex flex-col gap-1 md:hidden">
        {mobileMoreItems().map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="flex items-center justify-between rounded-md border border-01 bg-01 px-4 py-3 text-body-13 text-01 hover:bg-02"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex w-full flex-col gap-4 tablet:flex-row tablet:items-start">
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Identity</PanelTitle>
              <PanelDescription className="whitespace-normal">
                your sign-in and wallet are provided by Privy
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="px-5 pb-[18px] pt-2">
            <KeyValueRow label="Email" value="not shown here yet" valueClassName="text-03" />
            <KeyValueRow label="Login method" value="not shown here yet" valueClassName="text-03" />
            <KeyValueRow label="Organization" value="not shown here yet" valueClassName="text-03" />
            <KeyValueRow
              label="Wallet"
              value={
                first?.agentAccount ? (
                  <span className="break-all">{first.agentAccount}</span>
                ) : (
                  "not shown here yet"
                )
              }
              valueClassName={first?.agentAccount ? undefined : "text-03"}
            />
            <KeyValueRow label="Time zone" value="UTC" />
            <KeyValueRow
              label="Currency display"
              sub="amounts are shown in US dollars"
              value="USD"
              divider={false}
            />
            <p className="pt-2 text-body-xs text-03">
              Editing these details is not available yet.
            </p>
          </PanelBody>
        </Panel>

        <Panel className="tablet:w-[520px] tablet:shrink-0">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Preferences</PanelTitle>
              <PanelDescription>not available yet</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-4 p-5">
            {[
              {
                title: "Daily digest email",
                sub: "spend, calls, amount not charged, notable events",
                on: true,
              },
              {
                title: "Quiet hours 22:00–07:00",
                sub: "never applies to the Critical class",
                on: true,
              },
              {
                title: "Show atomic units and CAIP-19 assets",
                sub: "in the raw-JSON view only",
                on: false,
              },
            ].map((pref) => (
              <div key={pref.title} className="flex w-full items-center gap-3.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-body-13 text-01">{pref.title}</span>
                  <span className="text-body-xs text-03">{pref.sub}</span>
                </div>
                <Switch checked={pref.on} readOnly label={pref.on ? "On" : "Off"} />
              </div>
            ))}
            <p className="text-body-xs text-03">
              Read-only for now: preferences cannot be changed yet.
            </p>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Close account</PanelTitle>
            <PanelDescription className="whitespace-normal">
              you export your records first; credentials are revoked last
            </PanelDescription>
          </PanelTitles>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/settings/close">Open</Link>
          </Button>
        </PanelHeader>
      </Panel>
    </div>
  );
}
