"use client";

import * as React from "react";

import { BudgetOnlySheet, useLimitsContext } from "@/components/buyer-money/agent-limits";
import { Button } from "@/components/ui/button";

import type { SetLimitsSlotProps } from "./consent-card";

/** The limits sheet as this control uses it: `BudgetOnlySheet`'s props that matter here. */
export interface LimitsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  saveLabel: string;
  intro: React.ReactNode;
  /** Runs before the limits are saved; a returned reason stops the save. */
  beforeSave: () => Promise<string | null>;
  onSaved: () => void;
}

/**
 * "Approve and set limits" (spec §6.5): opens the agent's spending-limits
 * sheet in place; "Save and approve" saves, then approves.
 *
 * Nothing is saved for an approval that is bound to fail: what approve checks
 * (the name, the agent, the request still open, by a fresh read) is checked
 * before the sheet opens and again just before the save. If approve still
 * fails after the save, the card says the limits were saved and the app was
 * not approved.
 */
export function ConsentSetLimitsControl({
  slot,
  Sheet,
}: {
  slot: SetLimitsSlotProps;
  Sheet: React.ComponentType<LimitsSheetProps>;
}) {
  const [open, setOpen] = React.useState(false);
  const [checking, setChecking] = React.useState(false);
  const openSheet = async () => {
    if (!slot.canAct() || checking) return;
    setChecking(true);
    try {
      if ((await slot.precheck()) === null) setOpen(true);
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={slot.disabled}
        loading={checking}
        onClick={() => void openSheet()}
      >
        Approve and set limits
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        agentName={slot.agentName}
        saveLabel="Save and approve"
        intro={`These limits apply to everything ${slot.agentName} does, not only to this app.`}
        beforeSave={slot.precheck}
        onSaved={slot.approve}
      />
    </>
  );
}

/**
 * Offered only where the web app can edit the chosen agent's Assay-checked
 * limits today (`useLimitsContext().editableFor`, the same rule as the
 * Spending limits page). Elsewhere there is nothing to open, so the button is
 * not shown and plain Approve stays.
 */
export function ConsentSetLimits(slot: SetLimitsSlotProps) {
  const ctx = useLimitsContext({ pollMs: false });
  const policy = ctx.policy;
  const bootstrap = ctx.bootstrap;
  const Sheet = React.useMemo(
    () =>
      function LimitsSheet(props: LimitsSheetProps) {
        return <BudgetOnlySheet {...props} policy={policy} bootstrap={bootstrap} />;
      },
    [policy, bootstrap],
  );
  if (ctx.editableFor !== slot.agentId || !bootstrap) return null;
  return <ConsentSetLimitsControl slot={slot} Sheet={Sheet} />;
}
