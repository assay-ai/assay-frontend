"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Flag, Minus, Plus, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Skeleton } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { MAKE_MY_OWN_HINT, MAKE_MY_OWN_LABEL } from "@/features/toolsets/labels";
import { type StatRow } from "@/features/toolsets/public";
import { diffLines } from "@/features/toolsets/sharing";
import type { PublicToolsetEntry } from "@/services/public-toolsets.service";
import { copyToolset, createReport, type CopyResult, type ToolsetDiff } from "@/services/toolsets.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

import { errorText, toolsetKeys } from "./use-toolsets";

/** A small rounded status chip; tones match the rest of the tool-set screens. */
export function Chip({ tone = "neutral", children, className }: { tone?: "neutral" | "warning" | "danger" | "primary" | "success"; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-label-xs",
        tone === "warning" && "bg-warning-10 text-warning-700",
        tone === "danger" && "bg-danger-10 text-danger-700",
        tone === "primary" && "bg-primary-10 text-primary-700",
        tone === "success" && "bg-success-10 text-success-700",
        tone === "neutral" && "bg-03 text-02",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A share status's tone as a chip tone. */
export function statusChipTone(tone: "neutral" | "shared" | "warning" | "danger"): "neutral" | "primary" | "warning" | "danger" {
  return tone === "shared" ? "primary" : tone;
}

/** A URL in monospace that wraps, with one Copy button (40px on a phone). */
export function CopyLine({ value, label = "Copy", onCopied, testId }: { value: string; label?: string; onCopied?: () => void; testId?: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-01 bg-02 p-2.5 tablet:flex-row tablet:items-center" data-testid={testId}>
      <span className="min-w-0 flex-1 break-all font-mono text-mono-12 text-01">{value}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="min-h-10 shrink-0 tablet:min-h-0"
        icon={copied ? <Check /> : <Copy />}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            onCopied?.();
          } catch {
            toast.error("Copy did not work here: select the text and copy it.");
          }
        }}
      >
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}

/** One button that copies a value and says so; the value is in its title for selecting by hand. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      title={value}
      className={cn("min-h-10 tablet:min-h-9", className)}
      icon={copied ? <Check /> : <Copy />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          toast.error("Copy did not work here: select the text and copy it.");
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

/** What changed between two versions, one line per tool, in plain words; `priceOf` adds a new tool's price. */
export function DiffView({
  diff,
  empty = "Nothing changed in the tools or their rules.",
  priceOf,
}: {
  diff: ToolsetDiff;
  empty?: string;
  priceOf?: (toolName: string) => string | null;
}) {
  const rows: { key: string; kind: "added" | "removed" | "rules" | "settings"; name?: string; text: string }[] = [
    ...diff.added.map((name) => ({ key: `a-${name}`, kind: "added" as const, name, text: priceOf?.(name) ? `added · ${priceOf(name)}` : "added" })),
    ...diff.removed.map((name) => ({ key: `r-${name}`, kind: "removed" as const, name, text: "removed" })),
    ...diff.rulesChanged.map((name) => ({ key: `p-${name}`, kind: "rules" as const, name, text: "provider rules changed" })),
    ...diffLines({ added: [], removed: [], rulesChanged: [], settingsChanged: diff.settingsChanged }).map((l) => ({ key: "settings", kind: "settings" as const, text: l.text })),
  ];
  if (rows.length === 0) return <p className="text-body-13 text-02">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5" data-testid="diff-view">
      {rows.map((row) => (
        <li key={row.key} className="flex items-start gap-2 text-body-13 text-01">
          {row.kind === "added" ? (
            <Plus aria-label="Added" className="mt-0.5 size-3.5 shrink-0 text-success-600" />
          ) : row.kind === "removed" ? (
            <Minus aria-label="Removed" className="mt-0.5 size-3.5 shrink-0 text-danger-600" />
          ) : (
            <SlidersHorizontal aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-03" />
          )}
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {row.name ? (
              <>
                <span className="font-mono text-mono-12">{row.name}</span> <span className="text-02">{row.text}</span>
              </>
            ) : (
              row.text
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Weekly figures as a grid; withheld ones read as the server spelt them ("Fewer than 5"). */
export function FigureGrid({ rows, weekStart, loading }: { rows: StatRow[]; weekStart: string | null; loading?: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 tablet:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="text-body-13 text-02">No figures yet. They are published every Monday 00:00 UTC, once people use it.</p>;
  }
  const note = rows.find((r) => r.note)?.note;
  return (
    <div className="flex flex-col gap-2" data-testid="figure-grid">
      <dl className="grid grid-cols-2 gap-2 tablet:grid-cols-4">
        {rows.map((row) => (
          <div key={row.label} className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-02 px-3 py-2">
            <dt className="text-body-xs text-03">{row.label}</dt>
            <dd className="text-label-md tabular-nums text-01">{row.value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-body-xs text-03">
        {note ? `${note} ` : ""}
        {weekStart ? (
          <>
            Week of <UtcTime value={`${weekStart}T00:00:00.000Z`} dateOnly /> UTC; updated every Monday.
          </>
        ) : null}
      </p>
    </div>
  );
}


/**
 * "Make my own version": a copy of someone else's tool set that you can
 * change and that gets no updates. Tools the copy cannot hold (another
 * maker's link-only tools, removed tools) are listed with the reason.
 */
export function CopyToolsetSheet({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: { id: string | null; name: string; handle: string; slug: string; version: number; unlistedToken?: string | null; entries?: PublicToolsetEntry[] };
}) {
  const willLeave = expectedExclusions(source.entries ?? []);
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(source.name);
  const [result, setResult] = React.useState<CopyResult | null>(null);
  React.useEffect(() => {
    if (open) {
      setName(source.name);
      setResult(null);
    }
  }, [open, source.name]);
  const copy = useMutation({
    mutationFn: () =>
      copyToolset(source.id!, { version: source.version, ...(source.unlistedToken ? { unlistedToken: source.unlistedToken } : {}), ...(name.trim() ? { name: name.trim() } : {}) }),
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      if (next.excluded.length === 0) {
        toast.success(`${next.toolset.name} is yours now`, { description: "Change its rules; it gets no updates from the original." });
        router.push(`/toolsets/mine?id=${encodeURIComponent(next.toolset.id)}`);
        onOpenChange(false);
      } else {
        setResult(next);
      }
    },
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[520px]">
        <SheetHeader>
          <SheetTitle>{MAKE_MY_OWN_LABEL}</SheetTitle>
          <SheetDescription>{MAKE_MY_OWN_HINT}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-[18px] pb-4 pt-3" data-testid="copy-sheet">
          {result ? (
            <CopyExclusions result={result} source={source} />
          ) : (
            <>
              <p className="text-body-13 text-02">
                A copy of @{source.handle}/{source.slug} v{source.version} in your tool sets, for your team only. Change its tools and provider rules as you like;
                changes to the original never reach it.
              </p>
              {willLeave.length > 0 ? (
                <div className="flex flex-col gap-1.5 rounded-lg bg-warning-10 p-3" data-testid="copy-will-leave">
                  <span className="text-label-13 text-warning-700">
                    {willLeave.length === 1 ? "1 tool can't be copied:" : `${willLeave.length} tools can't be copied:`}
                  </span>
                  <ul className="flex flex-col gap-1">
                    {willLeave.map((e) => (
                      <li key={e.toolId} className="text-body-13 text-02">
                        <span className="font-mono text-mono-12 text-01">{e.toolName}</span> {exclusionReason(e)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Field id="copy-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} error={copy.isError ? errorText(copy.error) : undefined} />
              <div className="flex flex-wrap gap-2">
                <Button loading={copy.isPending} disabled={!source.id || !name.trim()} onClick={() => copy.mutate()}>
                  Make my own version
                </Button>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              </div>
              {!source.id ? <p className="text-body-xs text-03">Not available on this page yet.</p> : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The public name a provider tool belongs to: `cobalt__news_search` → "cobalt". */
export function makerOf(toolName: string): string | null {
  const i = toolName.indexOf("__");
  return i > 0 ? toolName.slice(0, i) : null;
}

/** Why a tool stays behind, naming its own maker (not the tool set's publisher). */
export function exclusionReason(e: { toolName: string; reason: string }): string {
  if (e.reason === "REMOVED") return "was removed by its maker";
  const maker = makerOf(e.toolName);
  return maker ? `is @${maker}'s link-only tool: it works only through @${maker}'s own link` : "is one maker's link-only tool: it works only through its maker's own link";
}

/**
 * The tools a copy will leave out, known before it is made: removed ones, and
 * provider tools that are not reviewed for the catalogue (link-only, reachable
 * only through their maker's own tool sets).
 */
export function expectedExclusions(entries: readonly PublicToolsetEntry[]): { toolId: string; toolName: string; reason: string }[] {
  return entries
    .filter((e) => e.removed || (e.notReviewed && makerOf(e.toolName)))
    .map((e) => ({ toolId: e.toolId, toolName: e.toolName, reason: e.removed ? "REMOVED" : "LINK_ONLY" }));
}

/** The copy was made, but some tools stayed behind: each with its reason and what to do. */
export function CopyExclusions({ result }: { result: CopyResult; source?: { handle: string } }) {
  const linkOnly = result.excluded.filter((e) => e.reason === "LINK_ONLY");
  const makers = [...new Set(linkOnly.map((e) => makerOf(e.toolName)).filter((m): m is string => Boolean(m)))];
  return (
    <div className="flex flex-col gap-3" data-testid="copy-excluded">
      <p className="text-body-13 text-01">
        {result.toolset.name} is yours now, with {result.toolset.toolCount} tool{result.toolset.toolCount === 1 ? "" : "s"}.{" "}
        {result.excluded.length === 1 ? "One tool was" : `${result.excluded.length} tools were`} left out:
      </p>
      <ul className="flex flex-col gap-1.5 rounded-lg bg-02 p-3">
        {result.excluded.map((e) => (
          <li key={e.toolId} className="flex flex-col text-body-13 tablet:flex-row tablet:gap-2">
            <span className="font-mono text-mono-12 text-01 [overflow-wrap:anywhere]">{e.toolName}</span>
            <span className="text-02">{exclusionReason(e)}</span>
          </li>
        ))}
      </ul>
      {linkOnly.length > 0 ? (
        <p className="text-body-13 text-02">
          {makers.length > 0
            ? `Keep ${makers.map((m) => `@${m}`).join(" and ")}'s link connected to use ${linkOnly.length === 1 ? "it" : "them"}.`
            : `Keep the original link connected to use ${linkOnly.length === 1 ? "it" : "them"}.`}
        </p>
      ) : null}
      <Button asChild className="self-start">
        <Link href={`/toolsets/mine?id=${encodeURIComponent(result.toolset.id)}`}>Open my version</Link>
      </Button>
    </div>
  );
}

const REPORT_REASONS = ["Pretends to be someone else", "Misleading name or description", "Harmful or abusive", "Spam"];

/** Report a tool set or a public name to Assay. One open report per item per team. */
export function ReportSheet({
  open,
  onOpenChange,
  target,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { toolsetId?: string; handle?: string; unlistedToken?: string };
  label: string;
}) {
  const [reason, setReason] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState("");
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setReason(null);
      setDetail("");
      setDone(false);
    }
  }, [open]);
  const text = [reason, detail.trim()].filter(Boolean).join(": ");
  const report = useMutation({
    mutationFn: () => createReport({ ...target, reason: text.slice(0, 500) }),
    onSuccess: () => setDone(true),
  });
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>Report {label}</SheetTitle>
          <SheetDescription>Assay reviews every report. The publisher is not told who reported it.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-[18px] pb-4 pt-3" data-testid="report-sheet">
          {done ? (
            <>
              <p className="text-body-13 text-01">Thanks. Assay will look at it and act if it breaks the rules.</p>
              <Button className="self-start" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </>
          ) : (
            <>
              <fieldset className="flex flex-col gap-1.5">
                <legend className="pb-1 text-label-13 text-01">What is wrong?</legend>
                {REPORT_REASONS.map((r) => (
                  <label key={r} className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-md border border-02 px-3 text-body-13 text-01 tablet:min-h-9">
                    <input type="radio" name="report-reason" className="accent-primary-500" checked={reason === r} onChange={() => setReason(r)} />
                    {r}
                  </label>
                ))}
              </fieldset>
              <label className="flex flex-col gap-1.5">
                <span className="text-label-13 text-01">Anything else (optional)</span>
                <Textarea value={detail} maxLength={400} onChange={(e) => setDetail(e.target.value)} placeholder="What should Assay look at?" />
              </label>
              {report.isError ? <p className="text-body-13 text-danger-700">{errorText(report.error)}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button icon={<Flag />} loading={report.isPending} disabled={text.length < 3} onClick={() => report.mutate()}>
                  Send report
                </Button>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
