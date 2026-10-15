"use client";

import { Check, Link2, Users } from "lucide-react";
import * as React from "react";

import { formatRemaining } from "@/hooks/useCountdown";
import { cn } from "@/utils";

import { LocalTime } from "./local-time";

/**
 * The end of every two-person form and request: who has to approve it, a link
 * to send them, and how long it stays open.
 *
 *   // On a form, before it is sent:
 *   <ApprovalFooter needs="a second Lead adjudicator" approvers={["Alice", "Bob"]} />
 *
 *   // On a sent request:
 *   <ApprovalFooter
 *     needs="a second Lead adjudicator"
 *     approvers={["Alice", "Bob"]}
 *     link={approvalHref(id)}
 *     createdAt={approval.createdAt}
 *     expiresAt={approval.expiresAt}
 *   />
 *
 * `approvers` is the list of names who can approve; `[]` says nobody can
 * (which the reader must know before sending), `undefined` leaves the names
 * out (still loading, or not knowable).
 */
export interface ApprovalFooterProps {
  /** Who, in words: "a second Lead adjudicator", "another admin". */
  needs: React.ReactNode;
  approvers?: readonly string[];
  /** Path or URL an approver opens. Made absolute before it is copied. */
  link?: string;
  createdAt?: string | null;
  expiresAt?: string | null;
  /** Shown when there is no `expiresAt` yet (a form). Default: requests expire after 24 h. */
  expiryNote?: React.ReactNode;
  className?: string;
}

const MAX_NAMES = 4;

/** "Alice, Bob and 3 others" — the approver names as one phrase, or null when none are known. */
export function approverNames(names: readonly string[] | undefined): string | null {
  if (!names || names.length === 0) return null;
  if (names.length <= MAX_NAMES) {
    return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
  }
  return `${names.slice(0, MAX_NAMES - 1).join(", ")} or ${names.length - (MAX_NAMES - 1)} others`;
}

export interface ExpiryReading {
  /** 0..1, the share of the window still left. */
  left: number;
  /** "Expires in 6h 10m" / "Expired". */
  label: string;
  /** Under a quarter of the window left, or expired. */
  urgent: boolean;
  expired: boolean;
}

/** How much of a request's window is left. Pure. `null` when the dates cannot be read. */
export function expiryReading(
  createdAt: string | null | undefined,
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): ExpiryReading | null {
  if (!expiresAt) return null;
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return null;
  const start = createdAt ? Date.parse(createdAt) : Number.NaN;
  const total = Number.isNaN(start) ? 24 * 3_600_000 : Math.max(1, end - start);
  const msLeft = end - now;
  if (msLeft <= 0) return { left: 0, label: "Expired", urgent: true, expired: true };
  const left = Math.min(1, msLeft / total);
  return { left, label: `Expires in ${formatRemaining(msLeft)}`, urgent: left < 0.25, expired: false };
}

function absolute(link: string): string {
  if (/^https?:\/\//.test(link) || typeof window === "undefined") return link;
  return `${window.location.origin}${link.startsWith("/") ? "" : "/"}${link}`;
}

export function ApprovalFooter({
  needs,
  approvers,
  link,
  createdAt,
  expiresAt,
  expiryNote = "If nobody approves it within 24 h, it expires and nothing runs.",
  className,
}: ApprovalFooterProps) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(absolute(link));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused: the link is still in the title for a manual copy.
    }
  };

  const names = approverNames(approvers);
  const nobody = approvers !== undefined && approvers.length === 0;
  const expiry = expiryReading(createdAt, expiresAt, now);

  return (
    <div className={cn("flex w-full flex-col gap-2.5 rounded-lg border border-01 bg-02 px-3.5 py-3", className)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2">
        <Users aria-hidden="true" className="size-4 shrink-0 text-03" />
        <p className={cn("min-w-0 flex-1 text-body-13", nobody ? "text-danger-600" : "text-01")}>
          Needs {needs}
          {names ? <span className="text-02">: {names}</span> : null}
          {nobody ? <span>: nobody else holds that role, so it cannot be approved yet.</span> : null}
        </p>
        {link ? (
          <button
            type="button"
            onClick={() => void copy()}
            title={absolute(link)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-02 bg-01 px-2.5 py-1 text-label-xs text-02 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            {copied ? <Check aria-hidden="true" className="size-3.5 text-success-500" /> : <Link2 aria-hidden="true" className="size-3.5" />}
            {copied ? "Link copied" : "Copy link for an approver"}
          </button>
        ) : null}
      </div>
      {expiry ? (
        <div className="flex w-full items-center gap-3">
          <div
            role="meter"
            aria-label="Time left to approve"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(expiry.left * 100)}
            aria-valuetext={expiry.label}
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-03"
          >
            <span
              className={cn("block h-full rounded-full", expiry.urgent ? "bg-danger-500" : "bg-primary-500")}
              style={{ width: `${Math.max(expiry.expired ? 0 : 3, expiry.left * 100)}%` }}
            />
          </div>
          <span className={cn("shrink-0 font-mono text-mono-12", expiry.urgent ? "text-danger-600" : "text-03")}>
            {expiry.label}
            {expiresAt && !expiry.expired ? (
              <>
                {" · "}
                <LocalTime value={expiresAt} />
              </>
            ) : null}
          </span>
        </div>
      ) : (
        <p className="text-body-xs text-03">{expiryNote}</p>
      )}
    </div>
  );
}
