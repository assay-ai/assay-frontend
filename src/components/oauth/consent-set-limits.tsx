"use client";

import * as React from "react";

import { BudgetOnlySheet, useLimitsContext } from "@/components/buyer-money/agent-limits";
import { Button } from "@/components/ui/button";

import type { SetLimitsSlotProps } from "./consent-card";

/**
 * "Approve and set limits" (spec §6.5): opens the agent's spending-limits
 * sheet in place; "Save and approve" saves, then approves.
 *
 * Offered only where the web app can edit the chosen agent's Assay-checked
 * limits today (`useLimitsContext().editableFor`, the same rule as the
 * Spending limits page). Elsewhere there is nothing to open, so the button is
 * not shown and plain Approve stays.
 */
export function ConsentSetLimits({ agentId, agentName, disabled, approve }: SetLimitsSlotProps) {
  const ctx = useLimitsContext({ pollMs: false });
  const [open, setOpen] = React.useState(false);
  if (ctx.editableFor !== agentId || !ctx.bootstrap) return null;
  return (
    <>
      <Button type="button" variant="secondary" disabled={disabled} onClick={() => setOpen(true)}>
        Approve and set limits
      </Button>
      <BudgetOnlySheet
        open={open}
        onOpenChange={setOpen}
        agentName={agentName}
        policy={ctx.policy}
        bootstrap={ctx.bootstrap}
        saveLabel="Save and approve"
        onSaved={approve}
      />
    </>
  );
}
