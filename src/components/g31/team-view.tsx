"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import { ApiError } from "@/libs/ApiClient";
import { getSpendPolicyTyped } from "@/services/limits.service";

import { MicroLabel, PageHeader } from "./chrome";
import { formatLimit } from "./format";

/**
 * Team and members.
 *
 * The design labels this Phase 2 in its own subtitle, and the API agrees:
 * there is no members, roles or invitations resource at all. The Members table
 * is therefore empty rather than populated with four invented colleagues and
 * their email addresses — on a screen whose subject is who can raise a limit
 * and who can sign, a fictional Admin is a fictional authority.
 *
 * The Organization limits panel is real but partial. `GET /spend-policy`
 * returns **one** policy — the session's agent policy, falling back to the
 * organization default — so the design's three-column comparison
 * (organization / sum of agents / which one binds) cannot be assembled from a
 * single call. What is shown is the policy that came back, labelled with the
 * scope it actually has.
 */

export function TeamView() {
  const policy = useQuery({
    queryKey: ["spend-policy"],
    retry: false,
    queryFn: async () => {
      try {
        return await getSpendPolicyTyped();
      } catch (error) {
        if (error instanceof ApiError && error.code === "SPEND_POLICY_NOT_FOUND") return null;
        throw error;
      }
    },
  });

  const scope = policy.data?.scope === "ORGANIZATION" ? "organization" : "agent";

  const rows = policy.data
    ? [
        { label: "Per call", value: formatLimit(policy.data.perCallMax) },
        { label: "Per day", value: formatLimit(policy.data.dailyCap) },
        { label: "Per month", value: formatLimit(policy.data.monthlyCap) },
      ]
    : [];

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Team"
        subtitle="Phase 2 · roles, invitations and ownership transfer"
        actions={
          <Button icon={<UserPlus />} type="button" disabled>
            Invite
          </Button>
        }
      />

      <div className="flex w-full items-start gap-2.5 rounded-lg border border-primary-20 bg-primary-10 p-3.5 tablet:p-[15px]">
        <ShieldCheck aria-hidden="true" className="mt-0.5 size-[15px] shrink-0 text-primary-600" />
        <p className="text-body-13 text-primary-700">
          An agent&apos;s limits may be lower than the organization&apos;s but never higher, and the
          organization limit always binds even if the agents&apos; limits sum to more. Billing and
          Viewer see every receipt and every statement, and can raise no limit and sign nothing.
        </p>
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Members</PanelTitle>
            <PanelDescription>roles and invitations are not available yet</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-5">
          <EmptyState
            icon={null}
            title="Nobody else has been invited"
            description="Roles, invitations and ownership transfer are Phase 2. No members endpoint exists yet, so this list cannot fill — and an invented colleague on a screen about who can raise a limit would be an invented authority."
          />
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Organization limits</PanelTitle>
            <PanelDescription>the ceiling every agent sits under</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {policy.isPending ? (
            <p className="p-3 font-mono text-mono-13 text-03">Loading…</p>
          ) : policy.isError ? (
            <p className="p-3 text-body-13 text-danger-600">
              The organization ceiling could not be read, so nothing here states what binds.
            </p>
          ) : !policy.data ? (
            <p className="p-3 text-body-13 text-02">
              No policy has been written for this organization, so there is no ceiling to show.
            </p>
          ) : (
            <div className="w-full overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="flex items-center gap-3 border-b border-02 px-3 pb-2.5">
                  <div className="min-w-0 flex-1">
                    <MicroLabel>Limit</MicroLabel>
                  </div>
                  <div className="w-[180px] text-right">
                    <MicroLabel>Value</MicroLabel>
                  </div>
                  <div className="w-[150px] text-right">
                    <MicroLabel>Binding</MicroLabel>
                  </div>
                </div>
                {rows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center gap-3 border-b border-01 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1 font-mono text-mono-12 font-semibold text-01">
                      {row.label}
                    </div>
                    <div className="w-[180px] text-right font-mono text-mono-12 text-02">
                      {row.value}
                    </div>
                    <div className="w-[150px] text-right font-mono text-mono-12 text-02">
                      {scope}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="px-3 pt-3 text-body-xs text-03">
            The API returns one policy per session — the agent&apos;s, falling back to the
            organization default — so the design&apos;s organization-versus-sum-of-agents comparison
            cannot be assembled yet.
          </p>
        </PanelBody>
      </Panel>
    </div>
  );
}
