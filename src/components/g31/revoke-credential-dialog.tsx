"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { revokeDelayNote } from "@/features/delegation/unsettled";

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
 */

export const ALSO_STOP_LABEL = "Also stop its payment key on chain (one signature)";
export const STILL_ACTIVE_TEXT = "Payment key still active on chain";

export interface RevokeDialogCopy {
  title: string;
  description: string;
  /** The checkbox, only when the key is active on chain; on by default. */
  alsoStop: { label: string; defaultChecked: true } | null;
}

export function revokeDialogCopy(input: {
  name: string;
  issuedVia: "API_KEY" | "OAUTH";
  keyActiveOnChain: boolean;
}): RevokeDialogCopy {
  return {
    title: `Revoke ${input.name}?`,
    description:
      input.issuedVia === "OAUTH"
        ? "The app stops working at once and must sign in again."
        : "Anything using this key stops working at once. You can create a new key.",
    alsoStop: input.keyActiveOnChain ? { label: ALSO_STOP_LABEL, defaultChecked: true } : null,
  };
}

export type RevokeOutcome =
  | { revoked: false; error: unknown }
  | { revoked: true; chain: "untouched" | "stopped" }
  | { revoked: true; chain: "failed"; error: unknown };

/**
 * The credential first, then (when asked) the key on chain. The chain step
 * never runs when the revoke failed, and its failure never undoes the revoke.
 */
export async function runRevokeCredential(steps: {
  alsoStop: boolean;
  revoke: () => Promise<unknown>;
  stopOnChain: () => Promise<unknown>;
}): Promise<RevokeOutcome> {
  try {
    await steps.revoke();
  } catch (error) {
    return { revoked: false, error };
  }
  if (!steps.alsoStop) return { revoked: true, chain: "untouched" };
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
  keyActiveOnChain,
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
  keyActiveOnChain: boolean;
  tightenDelaySeconds?: number | null;
  onRevoke: () => Promise<unknown>;
  onStopOnChain: () => Promise<unknown>;
  describeRevokeError: (error: unknown) => string;
  describeStopError: (error: unknown) => string;
  /** After the credential was revoked (whatever the chain step did): refresh the lists. */
  onDone: (outcome: Extract<RevokeOutcome, { revoked: true }>) => void;
}) {
  const copy = revokeDialogCopy({ name, issuedVia, keyActiveOnChain });
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
  const delayNote = ticked ? revokeDelayNote(tightenDelaySeconds) : null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const outcome = await runRevokeCredential({ alsoStop: ticked, revoke: onRevoke, stopOnChain: onStopOnChain });
    setBusy(false);
    if (!outcome.revoked) {
      setError(describeRevokeError(outcome.error));
      return;
    }
    onDone(outcome);
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
              {delayNote ? <p className="text-body-xs text-03">{delayNote}</p> : null}
              {!alsoStop ? (
                <p className="text-body-xs text-03">
                  Its payment key stays active on chain until you stop it. Its row keeps a Stop it button.
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
                  {ticked ? "Revoke and sign" : "Revoke"}
                </Button>
              </>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
