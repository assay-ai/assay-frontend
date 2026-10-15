"use client";

import { X } from "lucide-react";
import * as React from "react";

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { OperatorIdentity } from "@/interfaces/operator";
import { formatMoney } from "@/utils/money";

import { ACTION_WHAT, MONEY_ACTIONS, capabilitiesFor, checkAction, listPhrase, roleTitle, rolesPhrase, type ConsoleAction } from "./roles";

/**
 * Who the console thinks you are, and what that lets you do.
 *
 *  - `RoleIntro`: on a first visit to Home only, one dismissible line —
 *    "You're signed in as Lead adjudicator · $1,000 limit per action. What can I do?"
 *    Dismissed per operator, in this browser.
 *  - `RoleCapabilities`: the "What can I do?" popover — "You can" and "Needs
 *    someone else", from `checkAction` (the check every button reads), so it
 *    cannot promise what a screen then refuses. The shell's role pill opens it
 *    too, so it stays one click away after the strip is gone.
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
    /* storage refused: the strip just shows again next time */
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

/**
 * The "you can …" line, from the same check every button reads
 * (`capabilitiesFor` → `checkAction`, limit included): an action the role
 * names but the $0 limit rules out is not listed.
 */
export function roleCanSentence(identity: Pick<OperatorIdentity, "roles" | "authorityLimit">): string {
  const caps = capabilitiesFor(identity.roles, identity.authorityLimit);
  if (caps.can.length === 0) {
    return caps.approves.length > 0
      ? "Apart from approving, you can read every screen; starting an action needs another role."
      : "You can read every screen here; acting needs another role.";
  }
  return `${caps.approves.length > 0 ? "You can also" : "You can"} ${listPhrase(caps.can)}.`;
}

/** "$1,000 limit per action", "No limit", "$0 limit": the limit as the strip and the pill say it. */
export function limitPhrase(limit: OperatorIdentity["authorityLimit"]): string {
  if (limit === null) return "no limit";
  return `${formatMoney(limit).replace(/\.00$/, "")} limit`;
}

/**
 * The limit as the strip and the shell's pill show it, or null when the
 * roles cannot act on money at all (an Admin's "$0 limit" is noise).
 */
export function roleLimitText(identity: Pick<OperatorIdentity, "roles" | "authorityLimit">): string | null {
  const actsOnMoney = [...MONEY_ACTIONS].some((action) => checkAction({ roles: identity.roles }, action).allowed);
  return actsOnMoney ? limitPhrase(identity.authorityLimit) : null;
}

/** "Lead adjudicator · $1,000", "Admin": the shell's role pill. */
export function rolePillText(identity: Pick<OperatorIdentity, "roles" | "authorityLimit">): string {
  const limit = roleLimitText(identity);
  return limit ? `${roleTitle(identity.roles)} · ${limit.replace(/ limit$/, "")}` : roleTitle(identity.roles);
}

// "block" and "blockOnChain" are one line, written by `blockLine`.
const LIST_ACTIONS: readonly ConsoleAction[] = ["rule", "suspend", "compensate", "block", "manageTeam"];

/**
 * Blocking is one line, not two: a block stops an account in Assay; for a
 * wallet it can also go into the contracts ("on chain"), which may need
 * another role.
 *   both:      can "block an account (a wallet also on chain)"
 *   Assay only: can "block an account (on chain too needs Lead adjudicator)"
 *   neither:   others "block an account (Lead adjudicator or Support / on-call; on chain: Lead adjudicator)"
 */
function blockLine(identity: Pick<OperatorIdentity, "roles" | "authorityLimit">): { can: boolean; text: string } {
  const block = checkAction(identity, "block");
  const chain = checkAction(identity, "blockOnChain");
  if (block.allowed) {
    return { can: true, text: chain.allowed ? `${ACTION_WHAT.block} (a wallet also on chain)` : `${ACTION_WHAT.block} (on chain too needs ${rolesPhrase(chain.roles)})` };
  }
  if (chain.allowed) return { can: true, text: `${ACTION_WHAT.blockOnChain} (in Assay too needs ${rolesPhrase(block.roles)})` };
  const sameRoles = rolesPhrase(block.roles) === rolesPhrase(chain.roles);
  return { can: false, text: `${ACTION_WHAT.block} (${rolesPhrase(block.roles)}${sameRoles ? "" : `; on chain: ${rolesPhrase(chain.roles)}`})` };
}

/**
 * The two short lists of the popover. Pure.
 *   can:    ["rule on disputed penalties", "suspend a penalty up to $1,000", "approve block lifts and suspensions"]
 *   others: ["add and change operators (Admin)"]
 */
export function roleCapabilityLists(identity: Pick<OperatorIdentity, "roles" | "authorityLimit">): { can: string[]; others: string[] } {
  const caps = capabilitiesFor(identity.roles, identity.authorityLimit);
  const can: string[] = [];
  const others: string[] = [];
  for (const action of LIST_ACTIONS) {
    if (action === "block") {
      const line = blockLine(identity);
      (line.can ? can : others).push(line.text);
      continue;
    }
    const check = checkAction(identity, action);
    if (check.allowed) {
      const upTo = MONEY_ACTIONS.has(action) && identity.authorityLimit ? ` up to ${formatMoney(identity.authorityLimit).replace(/\.00$/, "")}` : "";
      can.push(`${ACTION_WHAT[action]}${upTo}`);
    } else if (check.limitOnly) {
      others.push(`${ACTION_WHAT[action]} (your limit is $0)`);
    } else {
      others.push(`${ACTION_WHAT[action]} (${rolesPhrase(check.roles)})`);
    }
  }
  if (caps.approves.length > 0) can.push(`approve ${listPhrase(caps.approves)}`);
  return { can, others };
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The popover body: two short columns and one footnote. */
export function RoleCapabilitiesPanel({ identity }: { identity: OperatorIdentity }) {
  const { can, others } = roleCapabilityLists(identity);
  return (
    <div className="flex w-full flex-col gap-3 p-3">
      <p className="text-label-13 text-01">
        {roleTitle(identity.roles)}
        {roleLimitText(identity) ? <span className="font-normal text-03"> · {roleLimitText(identity)} per action</span> : null}
      </p>
      <div className="grid w-full grid-cols-1 gap-3 min-[480px]:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-label-xs text-03">You can</p>
          {can.length > 0 ? (
            <ul className="flex flex-col gap-1 text-body-13 text-01">
              {can.map((item) => (
                <li key={item}>{capital(item)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-body-13 text-02">Read every screen</p>
          )}
        </div>
        {others.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-label-xs text-03">Needs someone else</p>
            <ul className="flex flex-col gap-1 text-body-13 text-02">
              {others.map((item) => (
                <li key={item}>{capital(item)}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="border-t border-01 pt-2 text-body-xs text-03">
        Anything that needs two people waits on Home for 24 hours for someone with the right role.
      </p>
    </div>
  );
}

/** A trigger (the strip's link, the shell's pill) that opens the panel. */
export function RoleCapabilities({ identity, children, align = "end" }: { identity: OperatorIdentity; children: React.ReactElement; align?: "start" | "end" }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-[min(480px,calc(100vw-32px))] border border-02 p-0 shadow-lg">
        <RoleCapabilitiesPanel identity={identity} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RoleIntro({ identity, onDismiss }: { identity: OperatorIdentity; onDismiss: () => void }) {
  const limit = roleLimitText(identity);
  // A sheet, as from the account menu: a small popover anchored mid-sentence was easy to miss or lose.
  const [open, setOpen] = React.useState(false);
  return (
    <section
      aria-label="Your role"
      className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-01 bg-01 py-1.5 pl-3.5 pr-1.5 text-body-13 text-02"
    >
      <p className="min-w-0 flex-1">
        You&apos;re signed in as <span className="text-label-13 text-01">{roleTitle(identity.roles)}</span>
        {limit ? ` · ${limit} per action` : ""}.{" "}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="hit-area text-label-13 text-primary-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          What can I do?
        </button>
      </p>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-describedby={undefined}>
          <SheetHeader className="tablet:pt-5">
            <SheetTitle>What can I do?</SheetTitle>
          </SheetHeader>
          <div className="px-1.5 pb-4">
            <RoleCapabilitiesPanel identity={identity} />
          </div>
        </SheetContent>
      </Sheet>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hide this"
        className="touch-target flex size-7 shrink-0 items-center justify-center rounded-full text-03 hover:bg-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </section>
  );
}
