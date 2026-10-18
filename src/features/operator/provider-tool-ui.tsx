"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";

import { SectionTabs } from "@/components/layout/section-tabs";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { changeText } from "@/features/contracts/text";
import type { ContractChange } from "@/interfaces/contracts";
import { takedownProviderTool, type ModerationCutoff } from "@/services/operator-provider-tools.service";
import type { ProviderToolVersion } from "@/services/provider-tools.service";

import { MODERATION_NOTE_MIN, OPERATOR_CASES_TABS, operatorToolsTabs, TAKEDOWN_REASONS, toolReviewErrorText } from "./provider-tool-review";
import { useOperatorSession } from "./session-context";

/** Tools' tabs, the ones this operator can use. */
export function OperatorToolsTabs() {
  const me = useOperatorSession();
  const tabs = operatorToolsTabs(me.roles);
  if (tabs.length < 2) return null;
  return <SectionTabs tabs={tabs} label="Tools" />;
}

export function OperatorCasesTabs() {
  return <SectionTabs tabs={OPERATOR_CASES_TABS} label="Penalties and disputes" />;
}

function pretty(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

/** Every word a model reads in one version, as the reviewer must read it. */
export function ReviewedVersion({ version }: { version: ProviderToolVersion }) {
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-01 px-3.5 py-3" data-testid="reviewed-version">
      <header className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-mono-13 text-01">v{version.semver}</span>
        {version.isCurrent ? <Chip tone="primary">Agents get this one</Chip> : null}
        {version.approved ? <Chip tone="success">Approved before</Chip> : <Chip tone="warning">Not reviewed</Chip>}
      </header>
      <dl className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-0.5">
          <dt className="text-body-xs text-03">Summary (the only text in tools/list)</dt>
          <dd className="text-body-13 text-01 [overflow-wrap:anywhere]">{version.summary}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-body-xs text-03">Description</dt>
          <dd className="whitespace-pre-wrap text-body-13 text-01 [overflow-wrap:anywhere]">{version.description || "—"}</dd>
        </div>
      </dl>
      <div className="flex w-full flex-col gap-3 tablet:flex-row">
        {[
          ["INPUT SCHEMA", version.inputSchema],
          ["OUTPUT SCHEMA", version.outputSchema],
        ].map(([label, value]) => (
          <div key={label as string} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="font-mono text-mono-2xs tracking-[1.2px] text-03">{label as string}</span>
            <pre className="max-h-[360px] w-full overflow-auto rounded-lg border border-01 bg-02 p-3 font-mono text-mono-12 text-01">{pretty(value)}</pre>
          </div>
        ))}
      </div>
      {version.optionalInputFields.length + version.optionalOutputFields.length > 0 ? (
        <p className="text-body-xs text-03">
          Optional inputs: {version.optionalInputFields.join(", ") || "none"} · optional outputs: {version.optionalOutputFields.join(", ") || "none"}
        </p>
      ) : null}
      <details className="rounded-lg border border-01">
        <summary className="cursor-pointer px-3 py-2 text-label-13 text-02">
          Examples ({version.examples.length}) and checks ({version.rules.length})
        </summary>
        <pre className="mx-3 mb-3 max-h-[360px] overflow-auto rounded-lg bg-02 p-3 font-mono text-mono-12 text-01">{pretty({ examples: version.examples, checks: version.rules })}</pre>
      </details>
    </article>
  );
}

/** A CHANGE review: what moved against the approved version. */
export function ReviewChanges({ changes }: { changes: readonly unknown[] }) {
  const rows = changes.filter((c): c is ContractChange => typeof c === "object" && c !== null && "kind" in c);
  if (rows.length === 0) return <p className="text-body-13 text-03">No schema change: only text changed. Read the summary and description above.</p>;
  return (
    <ul className="flex flex-col gap-1.5" data-testid="review-diff">
      {rows.map((change, i) => (
        <li key={i} className="flex items-start gap-2 text-body-13 text-02">
          <Chip tone={change.bump === "MAJOR" ? "warning" : change.bump === "MINOR" ? "primary" : "neutral"}>{change.bump === "MAJOR" ? "Breaking" : change.bump === "MINOR" ? "Addition" : "Wording"}</Chip>
          <span className="min-w-0 [overflow-wrap:anywhere]">{changeText(change)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Take a provider tool down (A-25): at once — removed from every view,
 * calls get TOOL_REMOVED — and a second operator confirms within 72 hours or
 * it is reverted.
 */
export function TakedownSheet({ toolId, toolName, open, onOpenChange, onDone }: { toolId: string; toolName: string; open: boolean; onOpenChange: (open: boolean) => void; onDone?: (cutoff: ModerationCutoff) => void }) {
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});
  React.useEffect(() => {
    if (open) {
      setReason("");
      setNote("");
      setErrors({});
    }
  }, [open]);
  const run = useMutation({
    mutationFn: () => takedownProviderTool(toolId, { reasonCode: reason, note: note.trim() }),
    onSuccess: (cutoff) => {
      onDone?.(cutoff);
      onOpenChange(false);
    },
  });
  const submit = () => {
    const next: typeof errors = {};
    if (!reason) next.reason = "Pick why.";
    if (note.trim().length < MODERATION_NOTE_MIN) next.note = `Write at least ${MODERATION_NOTE_MIN} characters: a second operator reads it to confirm.`;
    setErrors(next);
    if (Object.keys(next).length === 0) run.mutate();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[520px]">
        <SheetHeader>
          <SheetTitle>Take {toolName} down?</SheetTitle>
          <SheetDescription>At once: it disappears from every view, including pinned tool set versions, and calls get an error. A second operator confirms it within 72 hours, or it comes back.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-[18px] pb-5 pt-3">
          <ReasonChips label="Why" options={TAKEDOWN_REASONS} value={reason} onChange={setReason} note={note} onNoteChange={setNote} noteLabel="What a second operator needs to know" noteMin={MODERATION_NOTE_MIN} noteMax={1000} errors={errors} />
          {run.isError ? (
            <p role="alert" className="text-body-13 text-danger-700">
              {toolReviewErrorText(run.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="danger" loading={run.isPending} onClick={submit}>
              Take it down now
            </Button>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
