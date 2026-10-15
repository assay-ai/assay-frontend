"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/utils";

import { ChangeRows, type ConfirmChange } from "./change-rows";

export type { ConfirmChange } from "./change-rows";

/**
 * Confirm an important or destructive action. Names the object and the
 * effect; optionally shows what changes (before → after) and asks for an
 * explicit acknowledgement.
 *
 *   <ConfirmSheet
 *     open={open} onOpenChange={setOpen}
 *     tone="danger"
 *     title="Revoke the key “prod-runner”?"
 *     description="Agents using this key stop being able to call tools at once. This cannot be undone."
 *     changes={[{ label: "Status", before: "Live", after: "Revoked" }]}
 *     acknowledge="I understand the agent will stop working"
 *     confirmLabel="Revoke key"
 *     onConfirm={() => revoke.mutateAsync()}
 *   />
 *
 * `onConfirm` may return a promise: the button shows progress, the sheet
 * stays open on failure and shows the error, and closes on success.
 */
export interface ConfirmSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the object: "Pause all agents?", "Revoke the key “prod”?" */
  title: React.ReactNode;
  /** The effect, in one or two sentences. */
  description: React.ReactNode;
  changes?: ConfirmChange[];
  /** A required checkbox. Leave out for no acknowledgement. */
  acknowledge?: React.ReactNode;
  /** A verb: "Revoke key", never "OK" or "Confirm". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void | Promise<unknown>;
  /** One sentence for a failure (e.g. `plainError(e.code)`). The raw message goes under Details. */
  describeError?: (error: unknown) => string;
  children?: React.ReactNode;
}

export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  description,
  changes,
  acknowledge,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
  describeError,
  children,
}: ConfirmSheetProps) {
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<{ sentence: string; raw: string | null } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setAcknowledged(false);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (caught) {
      // A plain sentence; the raw message (often an API code) only under Details.
      setError({
        sentence: describeError?.(caught) ?? "That did not go through. Nothing changed; you can try again.",
        raw: caught instanceof Error && caught.message ? caught.message : null,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <SheetContent showCloseButton={!busy}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>

        {changes?.length || children || acknowledge ? (
          <div className="flex w-full flex-col gap-4 px-[18px] pt-4">
            {changes?.length ? <ChangeRows changes={changes} /> : null}
            {children}
            {acknowledge ? (
              <Checkbox
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                label={acknowledge}
                className="items-start [&>span:first-of-type]:mt-px"
              />
            ) : null}
          </div>
        ) : null}

        <SheetFooter className="sticky bottom-0 bg-01">
          <div role="alert" className={cn("text-body-xs text-danger-600", !error && "sr-only")}>
            {error?.sentence ?? ""}
            {error?.raw ? (
              <details className="mt-1 text-03">
                <summary className="cursor-pointer select-none text-label-xs">Details</summary>
                <span className="mt-1 block break-all font-mono text-mono-xs">{error.raw}</span>
              </details>
            ) : null}
          </div>
          <div className="flex w-full flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
            <SheetClose asChild>
              <Button variant="secondary" disabled={busy}>
                {cancelLabel}
              </Button>
            </SheetClose>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              loading={busy}
              disabled={Boolean(acknowledge) && !acknowledged}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          </div>
          {acknowledge && !acknowledged ? (
            <p className="text-right text-body-xs text-03">Tick the box above to continue.</p>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
