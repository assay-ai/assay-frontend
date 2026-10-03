import * as React from "react";

import { Button } from "@/components/ui/button";
import type { RelayedEscrowIntent } from "@/interfaces";

import type { RelayedRefusal } from "./relayed-refusal";

/**
 * @fileoverview
 * The two blocks both escrow screens draw after a relayed submission — the one
 * that says it landed, and the one that says why it did not.
 *
 * ## Why these are components and not JSX inside each page
 *
 * Both `/funding/escrow` and `/funding/escrow/limits` submit through the same
 * two doors and can receive the same five refusals, so this is one thing shown
 * in two places rather than two things that look alike. Written inline it would
 * be two copies — and a page component is the one place in this app nothing can
 * render in a test, so the copies would diverge with no gate noticing. The
 * measured shape of that failure is on record twice in this codebase: a guard
 * changed in one of two sibling files deleted a row from a rendered page while
 * 213 tests, `tsc` and a full build stayed green.
 *
 * These render to static markup in a node test, which is how the *sentences* a
 * buyer actually reads are asserted rather than the props they were passed.
 */

/**
 * What the buyer is told when the platform submitted their signed request and
 * the chain accepted it.
 *
 * **Three facts, in this order, and none of them is optional.** It is done
 * (not pending — the response is about a mined transaction). The platform paid
 * for it (the buyer holds no ETH; that is the entire reason this door exists).
 * And nothing left the escrow (both relayed doors write a rule, never a
 * transfer) — a green block after a *withdrawal request* that did not say so
 * would read as money having moved.
 */
export function RelayedDoneNotice({
  relayed,
  title,
  effect,
  testId,
}: {
  readonly relayed: RelayedEscrowIntent;
  /** What was done, in the screen's own vocabulary. */
  readonly title: string;
  /** What it changed on chain — the screen knows this and this component does not. */
  readonly effect: string;
  readonly testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex w-full flex-col gap-2 rounded-lg border border-teal-20 bg-teal-10 px-4 py-4"
    >
      <p className="text-label-sm text-01">{title}</p>
      <p className="text-body-13 leading-[1.55] text-02">
        Submitted for you and already in block {relayed.blockNumber}. The platform paid{" "}
        {relayed.gasUsed} gas for this and you paid none. {effect} Your signature is what made it
        yours — we could send it or refuse to, and nothing else.
      </p>
      <p className="break-all font-mono text-mono-12 text-03">{relayed.transactionHash}</p>
    </div>
  );
}

/**
 * What the buyer is told when the platform would not relay what they signed.
 *
 * The sentence and the instruction both come from
 * {@link RelayedRefusal} — this component chooses neither. What it adds is the
 * affordance: a signature the chain has retired cannot be re-sent, and a button
 * offering to re-send it is worse than no button, so "build a fresh request"
 * appears for exactly the refusals where a fresh one is the thing that works.
 */
export function RelayedRefusalNotice({
  refusal,
  title,
  onRebuild,
  testId,
}: {
  readonly refusal: RelayedRefusal;
  readonly title: string;
  /**
   * Throws the dead signature away and asks for a new request. Optional: a
   * screen with nowhere to put a fresh intent passes nothing and the button is
   * absent, rather than present and inert.
   */
  readonly onRebuild?: () => void;
  readonly testId: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex w-full flex-col gap-1.5 rounded-lg border border-danger-20 bg-danger-10 px-4 py-3.5"
    >
      <p className="text-label-sm text-01">{title}</p>
      <p className="text-body-13 leading-[1.55] text-02">{refusal.text}</p>
      <p className="font-mono text-mono-12 text-03">
        {refusal.code}
        {refusal.reason ? ` · ${refusal.reason}` : ""}
      </p>
      {refusal.retry === "rebuild" && onRebuild ? (
        <div className="pt-1.5">
          <Button type="button" variant="secondary" onClick={onRebuild}>
            Build a fresh request
          </Button>
        </div>
      ) : null}
    </div>
  );
}
