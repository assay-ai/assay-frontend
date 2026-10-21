import { BadgeCheck, TriangleAlert } from "lucide-react";
import * as React from "react";

import { Term } from "@/components/patterns/term";
import { cn } from "@/utils";

/**
 * Small pieces the public Explorer and the signed-in Explore share, so a tool
 * row reads the same signed in or out.
 */

/**
 * One price line, free first: "Free for 100 calls/day per agent, then $0.002/call". The
 * free part is in the free-tier colour, the price in mono; `size="lg"` sets the
 * price large for a tool page. Built by `offerLine`.
 */
export function OfferPrice({
  offer,
  size = "sm",
  className,
}: {
  offer: { lead: string | null; price: string; unit: string; cap?: string };
  size?: "sm" | "lg";
  className?: string;
}) {
  // Nothing to price (no provider serves it): the row's "Nobody serves it yet" says so.
  if (offer.price === "—") return null;
  // A free tier with no paid route: the lead is the whole line, in plain text rather than as a price.
  if (!offer.price) {
    return (
      <p className={cn(size === "lg" ? "text-body-13" : "text-body-xs", "text-teal-600", className)} data-testid="offer-line">
        {offer.lead}
      </p>
    );
  }
  const free = offer.price === "Free";
  const from = offer.price.startsWith("from ");
  const amount = from ? offer.price.slice("from ".length) : offer.price;
  return (
    <p className={cn(size === "lg" ? "text-body-13" : "text-body-xs", "text-01", className)} data-testid="offer-line">
      {offer.lead ? <span className="text-teal-600">{offer.lead} </span> : null}
      {from ? <span className="text-02">from </span> : null}
      <span
        className={cn(
          "whitespace-nowrap font-mono font-semibold",
          size === "lg" ? "text-mono-xl" : "text-mono-13",
          free ? "text-teal-600" : null,
        )}
      >
        {amount}
        {offer.unit ? (
          <span className={cn("whitespace-pre font-sans font-normal text-03", size === "lg" ? "text-body-13" : "text-body-xs")}>
            {offer.unit}
          </span>
        ) : null}
      </span>
      {offer.cap ? <span className="text-02">{offer.cap}</span> : null}
    </p>
  );
}

/** Identity checked by the platform — not a quality claim. */
/**
 * "Identity verified", with its glossary definition. Inside a link (a list
 * row) the definition is the hover title (`interactive` off: a button inside a
 * link is invalid HTML); on a page of its own it opens on hover, focus or tap.
 */
export function VerifiedMark({
  verified,
  interactive = false,
  className,
}: {
  verified: boolean;
  interactive?: boolean;
  className?: string;
}) {
  if (!verified) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap text-label-xs text-primary-600", className)}>
      <BadgeCheck aria-hidden="true" className="size-3.5" />
      <Term k="identity-verified" inline={!interactive}>
        Identity verified
      </Term>
    </span>
  );
}

/** The "Observed failures" label, with its glossary definition (see `VerifiedMark` for `interactive`). */
export function ObservedFailuresLabel({ interactive = false }: { interactive?: boolean }) {
  return (
    <Term k="observed-failures" inline={!interactive}>
      Failure rate
    </Term>
  );
}

/** A muted label + value pair, for a row's facts. */
export function Fact({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <span className="text-body-xs text-03">{label}</span>
      <span className="text-body-13 text-01">{children}</span>
    </div>
  );
}

/** A grey "not available right now" tag for a tool nobody is serving. */
export function UnavailableTag() {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-full bg-03 px-2 py-0.5 text-label-xs text-02">
      No provider yet
    </span>
  );
}

/**
 * A provider whose observed failure rate is high (see `failsOften`). A warning,
 * not a filter: the provider stays listed and the buyer decides.
 */
export function FailsOftenChip({ className }: { className?: string }) {
  return (
    <span
      title="At least 1 in 5 of this provider's checked calls failed in the last 30 days, over at least 20 calls. Failed calls are not charged, but they cost your agent time."
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-warning-10 px-2 py-0.5 text-label-xs text-warning-700",
        className,
      )}
    >
      <TriangleAlert aria-hidden="true" className="size-3" />
      Fails often
    </span>
  );
}
