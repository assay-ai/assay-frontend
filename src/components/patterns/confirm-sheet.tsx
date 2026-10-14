"use client";

import { ArrowRight } from "lucide-react";
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
export interface ConfirmChange {
  label: React.ReactNode;
  before: React.ReactNode;
  after: React.ReactNode;
}

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
  /** One sentence for a failure. Default uses the error's message. */
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
  const [error, setError] = React.useState<string | null>(null);

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
      setError(
        describeError?.(caught) ??
          (caught instanceof Error && caught.message ? caught.message : "That did not go through. Try again."),
      );
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
            {changes?.length ? (
              <dl className="flex w-full flex-col overflow-hidden rounded-lg border border-01">
                {changes.map((change, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-01 px-3.5 py-2.5 last:border-b-0 tablet:grid-cols-[140px_minmax(0,1fr)]"
                  >
                    <dt className="text-body-13 text-03">{change.label}</dt>
                    <dd className="col-span-2 flex flex-wrap items-center gap-2 text-body-13 tablet:col-span-1">
                      <span className="text-02 line-through decoration-03">{change.before}</span>
                      <ArrowRight aria-label="becomes" className="size-3.5 shrink-0 text-03" />
                      <span className="font-semibold text-01">{change.after}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
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

        <SheetFooter>
          <p role="alert" className={cn("min-h-4 text-body-xs text-danger-600", !error && "sr-only")}>
            {error ?? ""}
          </p>
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
