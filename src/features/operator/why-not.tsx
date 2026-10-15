"use client";

import { Check, Link2, Lock } from "lucide-react";
import * as React from "react";

import type { Money } from "@/interfaces/api";
import type { OperatorIdentity } from "@/interfaces/operator";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

import { ACTION_DOING, checkAction, MONEY_ACTIONS, rolesPhrase, whoCan, type ConsoleAction } from "./roles";
import { useOperatorDirectory } from "./use-operator-lookups";

/**
 * "Why you can't, and who can" — drawn wherever an action exists but this
 * operator may not take it, instead of hiding the button and leaving them to
 * guess. Why, the names who can (or the role when nobody holds it), and an
 * "Ask …" link that copies a message with a link to this page, ready to paste
 * into chat.
 *
 *   <WhyNot action="suspend" me={identity} amount={penalty}
 *           ask="Can you suspend Northwind Geo's $28.47 penalty?" />
 *     → [lock] Suspending a penalty needs Adjudicator, Lead adjudicator or Support / on-call · Ask Riley or Iris
 *
 * One line by default (two at most on a phone); the full "who can" sentence is
 * its tooltip. `variant="box"` is the older panel with a title and both
 * sentences, kept for a page that is read-only for you as a whole.
 */

/** "Ask Riley Brooks", "Ask Riley or Iris", "Ask a Lead adjudicator". Pure. */
export function askLabel(names: readonly string[], rolePhrase: string): string {
  if (names.length === 1) return `Ask ${names[0]}`;
  if (names.length === 2) return `Ask ${firstName(names[0]!)} or ${firstName(names[1]!)}`;
  if (names.length > 2) return `Ask ${firstName(names[0]!)} or someone else`;
  const article = /^[AEIOU]/.test(rolePhrase) ? "an" : "a";
  return `Ask ${article} ${rolePhrase.split(" or ")[0]}`;
}

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

/**
 * The answer to "Who can:", without a second "can": "Riley Brooks or Iris
 * Park (Lead adjudicator or Adjudicator)." With `amountText` for an action on
 * money, the names are already filtered by authority limit (`whoCan`), and
 * the answer says so. Pure.
 */
export function whoCanSentence(names: readonly string[], rolePhrase: string, amountText?: string | null): string {
  const needs = amountText ? `${rolePhrase}, with an authority limit of at least ${amountText}` : rolePhrase;
  if (names.length === 0) return `Nobody on the team right now: it needs ${needs}. An admin adds or changes someone on Team.`;
  const list = names.length <= 3 ? `${names.slice(0, -1).join(", ")}${names.length > 1 ? " or " : ""}${names[names.length - 1]}` : `${names.slice(0, 3).join(", ")} or ${names.length - 3} others`;
  return `${list} (${needs}).`;
}

function absolute(link: string): string {
  if (/^https?:\/\//.test(link) || typeof window === "undefined") return link;
  return `${window.location.origin}${link.startsWith("/") ? "" : "/"}${link}`;
}

/** The "Ask …" button: copies `message` and a link to `link` (default: this page). `link` style: a text link, for the one-line why-not. */
export function AskButton({ label, message, link, look = "button" }: { label: string; message: string; link?: string; look?: "button" | "link" }) {
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    const href = link ? absolute(link) : typeof window === "undefined" ? "" : window.location.href;
    try {
      await navigator.clipboard.writeText(`${message} ${href}`.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard refused: the page link is still in the address bar */
    }
  };
  if (look === "link") {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        className="hit-area inline-flex items-center gap-1 rounded-sm text-label-13 text-primary-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      >
        {copied ? <Check aria-hidden="true" className="size-3.5 text-success-500" /> : <Link2 aria-hidden="true" className="size-3.5" />}
        {copied ? "Message and link copied" : label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="touch-target inline-flex shrink-0 items-center gap-1.5 self-start rounded-md border border-02 bg-01 px-2.5 py-1 text-label-xs text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      {copied ? <Check aria-hidden="true" className="size-3.5 text-success-500" /> : <Link2 aria-hidden="true" className="size-3.5" />}
      {copied ? "Message and link copied" : label}
    </button>
  );
}

export interface WhyNotProps {
  action: ConsoleAction;
  me: Pick<OperatorIdentity, "id" | "roles" | "authorityLimit">;
  /** The amount the action is on, for the limit check. */
  amount?: Money | null;
  /** What to ask for, as a sentence: "Can you suspend Northwind Geo's $28.47 penalty?" */
  ask: string;
  /** Where the asked person should go. Default: this page. */
  link?: string;
  /** Overrides the "why" sentence. */
  why?: string;
  /** Lead-in, e.g. "Suspend this penalty" (the box only). */
  title?: string;
  /** "inline" (default): one line. "box": a panel, for a page that is read-only for you. */
  variant?: "inline" | "box";
  className?: string;
}

/** "Blocking an account needs Lead adjudicator or Support / on-call" — the why, without its full stop. Pure. */
export function whyLine(why: string): string {
  return why.trim().replace(/\.$/, "");
}

/** Nothing when the action is allowed. */
export function WhyNot({ action, me, amount, ask, link, why, title, variant = "inline", className }: WhyNotProps) {
  const directory = useOperatorDirectory();
  const check = checkAction(me, action, amount);
  if (check.allowed) return null;
  const names = directory.isPending ? [] : whoCan(action, directory.operators, { amount, exceptId: me.id });
  const phrase = rolesPhrase(check.roles);
  const who = whoCanSentence(names, phrase, amount && MONEY_ACTIONS.has(action) ? formatMoney(amount) : null);
  if (variant === "inline") {
    return (
      <p className={cn("flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 text-body-13 text-02", className)} title={directory.isPending ? undefined : `Who can: ${who}`}>
        <Lock aria-hidden="true" className="size-3.5 shrink-0 text-03" />
        <span className="min-w-0">{whyLine(why ?? (check.limitOnly ? (check.why ?? "") : `${ACTION_DOING[action]} needs ${phrase}`))}</span>
        {directory.isPending ? null : (
          <>
            <span aria-hidden="true" className="text-03">
              ·
            </span>
            <span className="sr-only">Who can: {who}</span>
            <AskButton look="link" label={askLabel(names, phrase)} message={ask} link={link} />
          </>
        )}
      </p>
    );
  }
  return (
    <div className={cn("flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 px-3.5 py-3 tablet:flex-row tablet:items-center tablet:gap-4", className)}>
      <Lock aria-hidden="true" className="hidden size-4 shrink-0 text-03 tablet:block" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-body-13">
        {title ? <p className="text-label-13 text-01">{title}</p> : null}
        <p className="text-02">
          <span className="text-03">Why you can&rsquo;t: </span>
          {why ?? check.why}
        </p>
        {directory.isPending ? null : (
          <p className="text-02">
            <span className="text-03">Who can: </span>
            {who}
          </p>
        )}
      </div>
      {directory.isPending ? null : <AskButton label={askLabel(names, phrase)} message={ask} link={link} />}
    </div>
  );
}
