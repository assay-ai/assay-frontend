"use client";

import { AgentHealthList } from "@/components/buyer-money/agent-health";
import { GetStarted } from "@/components/buyer-money/get-started";

/**
 * Get started. The same checklist Overview shows to a new account, always
 * shown here (also once everything is done) so the account menu's "Get
 * started" link never lands on an empty page. Two columns from desktop
 * width — the checklist, and the agents' status beside it — centred, so a
 * wide screen has no empty right half.
 */
export default function OnboardingPage() {
  return (
    <div className="flex w-full flex-col gap-4 bg-02 px-4 py-5 tablet:px-7 tablet:py-[22px]">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4">
        <header className="flex flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Get started</h1>
          <p className="text-body-13 text-02">
            Connect your agent, try a free call, then let it pay for calls within spending limits you set.
          </p>
        </header>
        <div className="grid w-full grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <GetStarted placement="page" />
          </div>
          <AgentHealthList className="min-w-0" />
        </div>
      </div>
    </div>
  );
}
