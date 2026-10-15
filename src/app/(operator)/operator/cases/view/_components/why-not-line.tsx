"use client";

import { Lock } from "lucide-react";
import * as React from "react";

import { shortWhyNot } from "@/features/operator/case-flow";
import { checkAction, rolesPhrase, whoCan, type ConsoleAction } from "@/features/operator/roles";
import { useOperatorDirectory } from "@/features/operator/use-operator-lookups";
import { AskButton, askLabel } from "@/features/operator/why-not";
import type { Money } from "@/interfaces/api";
import type { OperatorIdentity } from "@/interfaces/operator";


/**
 * "Ruling needs Lead adjudicator or Treasury · [Ask Jordan]" in one line,
 * inside the next-step card for a role that may only watch. The Ask button
 * copies the request with a link to this page. Nothing when allowed.
 */
export function WhyNotLine({
  action,
  me,
  amount = null,
  ask,
}: {
  action: ConsoleAction;
  me: Pick<OperatorIdentity, "id" | "roles" | "authorityLimit">;
  amount?: Money | null;
  ask: string;
}) {
  const directory = useOperatorDirectory();
  const check = checkAction(me, action, amount);
  if (check.allowed) return null;
  const names = directory.isPending ? null : whoCan(action, directory.operators, { amount, exceptId: me.id });
  const why = shortWhyNot(me, action, amount, null) ?? "";
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-body-xs text-03">
      <Lock aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{action === "rule" ? why.replace(/^Needs/, "Ruling needs") : why}</span>
      {names ? <AskButton label={askLabel(names, rolesPhrase(check.roles))} message={ask} /> : null}
    </p>
  );
}
