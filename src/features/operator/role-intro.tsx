"use client";

import { X } from "lucide-react";
import * as React from "react";

import type { OperatorIdentity } from "@/interfaces/operator";
import { formatMoney } from "@/utils/money";

import { capabilitiesFor, listPhrase, roleTitle } from "./roles";

/**
 * The first thing an operator sees on Home: who the console thinks they are
 * and what that lets them do — "You are Lead adjudicator: you can approve
 * lifting account blocks; 2 waiting." Dismissed per operator (in this
 * browser); "What can I do?" in the Home header opens it again.
 */
const KEY = "operator-intro-dismissed:";

function readDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(KEY + id) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(id: string, value: boolean): void {
  try {
    if (value) window.localStorage.setItem(KEY + id, "1");
    else window.localStorage.removeItem(KEY + id);
  } catch {
    /* storage refused: the card just shows again next time */
  }
}

export function useRoleIntro(id: string): { open: boolean; show: () => void; dismiss: () => void } {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(!readDismissed(id)), [id]);
  return {
    open,
    show: () => {
      writeDismissed(id, false);
      setOpen(true);
    },
    dismiss: () => {
      writeDismissed(id, true);
      setOpen(false);
    },
  };
}

/** The sentence, pure for tests: "You are Lead adjudicator: you can approve lifting account blocks; 2 waiting." */
export function roleIntroSentence(roles: OperatorIdentity["roles"], waiting: number): string {
  const caps = capabilitiesFor(roles);
  const title = roleTitle(roles);
  if (caps.approves.length === 0) return `You are ${title}. Nothing in the approvals inbox is yours to approve.`;
  return `You are ${title}: you can approve ${listPhrase(caps.approves)}; ${waiting === 0 ? "nothing" : waiting} waiting.`;
}

export function RoleIntro({ identity, waiting, onDismiss }: { identity: OperatorIdentity; waiting: number; onDismiss: () => void }) {
  const caps = capabilitiesFor(identity.roles);
  const limit =
    identity.authorityLimit === null
      ? "no limit on the amounts you act on"
      : identity.authorityLimit.amount === "0"
        ? "an authority limit of $0, so you cannot act on money"
        : `an authority limit of ${formatMoney(identity.authorityLimit)} per action`;
  return (
    <section aria-label="Your role" className="relative flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 p-4 pr-12 tablet:p-5 tablet:pr-14">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hide this"
        className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full text-03 hover:bg-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
      <p className="text-label-md text-01">{roleIntroSentence(identity.roles, waiting)}</p>
      <ul className="flex flex-col gap-1 text-body-13 text-02">
        {caps.can.length > 0 ? <li>You can also {listPhrase(caps.can)}.</li> : <li>You can read every screen here; acting needs another role.</li>}
        <li>You have {limit}.</li>
        <li>Anything that needs two people waits on Home for someone who holds the right role, for 24 hours.</li>
      </ul>
    </section>
  );
}
