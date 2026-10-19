"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { hasTightenDelay, revokeDelayNote } from "@/features/delegation/unsettled";

/**
 * Revoke one credential from Agents & keys (spec F3):
 *
 *   1. "Revoke {name}? The app stops working at once and must sign in again."
 *   2. When the row's payment key is active on chain (read from the chain, not
 *      the credential), a checkbox, on by default: "Also stop its payment key
 *      on chain (one signature)".
 *   3. `DELETE /agents/:agentId/credentials/:id` first: the credential and its
 *      tokens end whatever happens next.
 *   4. If ticked: `revoke-intent` → wallet (Privy's confirmation shown) →
 *      `revoke`. A declined or failed signature leaves the credential revoked
 *      and says plainly that the key is still active on chain; its row keeps
 *      "Stop it" (F3 step 5).
 *
 * The dialog signs in place only when the chain shows the key active AND the
 * escrow keeps signed payments collectable for a known delay (D-21): then a
 * revoke strands nothing. Otherwise (no delay, delay unknown, or the chain
 * could not be read) the credential is revoked and the "Stop it paying" sheet
 * takes over, with its own fresh read and its wait for payments still being
 * settled (BUG-D1-07). While the chain is unread, the key may still be active:
 * the checkbox is offered, on, with a note, and nothing reads as stopped.
 */

export const ALSO_STOP_LABEL = "Also stop its payment key on chain (one signature)";
export const STILL_ACTIVE_TEXT = "Payment key still active on chain";
export const MAY_BE_ACTIVE_TEXT = "Payment key: may still be active on chain (couldn't check)";
export const MAY_BE_ACTIVE_NOTE =
  "We couldn't check the chain just now, so its payment key may still be active. Leave this ticked to check and stop it after the revoke.";

/** The row's payment key: none bound (or proven not to pay), active on chain, or not known (chain unread). */
export type RevokeKeyState = "none" | "active" | "unknown";

/** How the on-chain stop runs: not at all, signed in this dialog, or handed to the "Stop it paying" sheet. */
export type StopMode = "none" | "inline" | "sheet";

export function stopMode(input: {
  keyState: RevokeKeyState;
  alsoStop: boolean;
  tightenDelaySeconds: number | null | undefined;
}): StopMode {
  if (input.keyState === "none" || !input.alsoStop) return "none";
  return input.keyState === "active" && hasTightenDelay(input.tightenDelaySeconds) ? "inline" : "sheet";
}

export interface RevokeDialogCopy {
  title: string;
  description: string;
  /** The checkbox, only when the key is active on chain; on by default. */
  alsoStop: { label: string; defaultChecked: true } | null;
}

export function revokeDialogCopy(input: {
  name: string;
  issuedVia: "API_KEY" | "OAUTH";
  keyState: RevokeKeyState;
}): RevokeDialogCopy & { note: string | null } {
  return {
    title: `Revoke ${input.name}?`,
    description:
      input.issuedVia === "OAUTH"
        ? "The app stops working at once and must sign in again."
        : "Anything using this key stops working at once. You can create a new key.",
    alsoStop: input.keyState === "none" ? null : { label: ALSO_STOP_LABEL, defaultChecked: true },
    note: input.keyState === "unknown" ? MAY_BE_ACTIVE_NOTE : null,
  };
}

/** The toast after a revoke: never "stopped" alone while the key is, or may be, active on chain. */
export function revokedToast(keyState: RevokeKeyState, chain: "untouched" | "stopped" | "handoff"): string {
  if (chain === "stopped") return "Revoked, and its payment key was stopped on chain.";
  if (chain === "handoff") return "Revoked. Now sign to stop its payment key on chain.";
  if (keyState === "active") return "Revoked. Its payment key is still active on chain; its row keeps Stop it.";
  if (keyState === "unknown") return "Revoked. Its payment key may still be active on chain (couldn't check); its row shows it.";
  return "Revoked. It stopped working at once.";
}

export type RevokeOutcome =
  | { revoked: false; error: unknown }
  | { revoked: true; chain: "untouched" | "stopped" | "handoff" }
  | { revoked: true; chain: "failed"; error: unknown };

/**
 * The credential first, then (when asked) the key on chain: signed here
 * ("inline") or handed to the "Stop it paying" sheet ("sheet"). The chain step
 * never runs when the revoke failed, and its failure never undoes the revoke.
 */
export async function runRevokeCredential(steps: {
  mode: StopMode;
  revoke: () => Promise<unknown>;
  stopOnChain: () => Promise<unknown>;
}): Promise<RevokeOutcome> {
  try {
    await steps.revoke();
  } catch (error) {
    return { revoked: false, error };
  }
  if (steps.mode === "none") return { revoked: true, chain: "untouched" };
  if (steps.mode === "sheet") return { revoked: true, chain: "handoff" };
  try {
    await steps.stopOnChain();
    return { revoked: true, chain: "stopped" };
  } catch (error) {
    return { revoked: true, chain: "failed", error };
  }
}

export function RevokeCredentialDialog({
  open,
  onOpenChange,
  name,
  issuedVia,
  keyState,
  tightenDelaySeconds,
  onRevoke,
  onStopOnChain,
  describeRevokeError,
  describeStopError,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  issuedVia: "API_KEY" | "OAUTH";
  /** From the current chain read: updates while the dialog is open. */
  keyState: RevokeKeyState;
  tightenDelaySeconds?: number | null;
  onRevoke: () => Promise<unknown>;
  onStopOnChain: () => Promise<unknown>;
  describeRevokeError: (error: unknown) => string;
  describeStopError: (error: unknown) => string;
  /**
   * After the credential was revoked (whatever the chain step did): refresh
   * the lists; on "handoff", open the "Stop it paying" sheet for the key.
   */
  onDone: (outcome: Extract<RevokeOutcome, { revoked: true }>, keyState: RevokeKeyState) => void;
}) {
  const copy = revokeDialogCopy({ name, issuedVia, keyState });
  const [alsoStop, setAlsoStop] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Revoked, but the key could not be stopped on chain: said plainly, then Close.
  const [stillActive, setStillActive] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setAlsoStop(true);
      setError(null);
      setStillActive(null);
    }
  }, [open]);

  const ticked = copy.alsoStop !== null && alsoStop;
  const mode = stopMode({ keyState, alsoStop: ticked, tightenDelaySeconds });
  const delayNote = mode === "inline" ? revokeDelayNote(tightenDelaySeconds) : null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const outcome = await runRevokeCredential({ mode, revoke: onRevoke, stopOnChain: onStopOnChain });
    setBusy(false);
    if (!outcome.revoked) {
      setError(describeRevokeError(outcome.error));
      return;
    }
    onDone(outcome, keyState);
    if (outcome.chain === "failed") {
      setStillActive(describeStopError(outcome.error));
      return;
    }
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <SheetContent showCloseButton={!busy} data-testid="revoke-credential-dialog">
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{stillActive ? `${name} is revoked` : copy.title}</SheetTitle>
          <SheetDescription>
            {stillActive ? "It stopped working at once and must sign in again to be used." : copy.description}
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-4">
          {stillActive ? (
            <div role="alert" className="flex flex-col gap-1 rounded-lg bg-02 px-3 py-2" data-testid="revoke-still-active">
              <p className="text-body-13 text-warning-700">
                {STILL_ACTIVE_TEXT}. {stillActive}
              </p>
              <p className="text-body-13 text-02">Use Stop it on its row to try the signature again.</p>
            </div>
          ) : copy.alsoStop ? (
            <>
              <Checkbox
                checked={alsoStop}
                disabled={busy}
                onChange={(event) => setAlsoStop(event.target.checked)}
                label={copy.alsoStop.label}
                data-testid="revoke-also-stop"
                className="items-start [&>span:first-of-type]:mt-px"
              />
              {copy.note ? (
                <p className="text-body-13 text-warning-700" data-testid="revoke-may-be-active">
                  {copy.note}
                </p>
              ) : null}
              {delayNote ? <p className="text-body-xs text-03">{delayNote}</p> : null}
              {mode === "sheet" ? (
                <p className="text-body-xs text-03" data-testid="revoke-then-sheet">
                  After the revoke, the next step checks for payments still being settled, then asks your wallet to sign.
                </p>
              ) : null}
              {!alsoStop ? (
                <p className="text-body-xs text-03">
                  {keyState === "unknown"
                    ? "Its payment key may stay active on chain. Its row shows it once the chain is read."
                    : "Its payment key stays active on chain until you stop it. Its row keeps a Stop it button."}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <SheetFooter className="sticky bottom-0 mt-4 border-t border-01 bg-01">
          <div role="alert" className={error ? "text-body-xs text-danger-600" : "sr-only"}>
            {error ?? ""}
          </div>
          <div className="flex w-full flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
            {stillActive ? (
              <Button type="button" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  loading={busy}
                  data-testid="confirm-revoke-credential"
                  onClick={() => void confirm()}
                >
                  {mode === "inline" ? "Revoke and sign" : mode === "sheet" ? "Revoke, then stop its key" : "Revoke"}
                </Button>
              </>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
