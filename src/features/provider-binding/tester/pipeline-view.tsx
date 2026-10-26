"use client";

import { Check, CircleAlert, Minus, TriangleAlert, X } from "lucide-react";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import type { BindingTestReport } from "@/interfaces";
import { cn } from "@/utils";

import { testPipeline, type PipelineStatus } from "./pipeline";
import { pretty } from "./report-view";

const ICON: Record<PipelineStatus, React.ReactNode> = {
  pass: <Check aria-hidden="true" strokeWidth={3} className="size-3.5" />,
  fail: <X aria-hidden="true" strokeWidth={3} className="size-3.5" />,
  warn: <TriangleAlert aria-hidden="true" className="size-3.5" />,
  skipped: <Minus aria-hidden="true" className="size-3.5" />,
};

const MARK: Record<PipelineStatus, string> = {
  pass: "bg-success-500 text-on-color",
  fail: "bg-danger-500 text-on-color",
  warn: "bg-warning-10 text-warning-600",
  skipped: "border border-02 bg-02 text-03",
};

const WARNING_TITLE: Record<BindingTestReport["warnings"][number]["code"], string> = {
  ACCEPTS_UNSIGNED: "Signature not enforced",
  ACCEPTS_FOREIGN_PROVIDER: "Provider id not checked",
  ACCEPTS_WITHOUT_CREDENTIALS: "API key not enforced",
  NO_AUTHENTICATION: "No authentication",
};

/** Warnings never change the outcome (the backend says so); the label says it too. */
const WARNING_NOTE = "Warning (does not block Go live)";

/**
 * Warnings that are fine in the common case, said as information with why
 * (onboarding wave item 3): a public API answers anyone, so an unchecked
 * signature only matters when what it returns is private or costs you.
 */
const FINE_FOR_PUBLIC: Partial<Record<BindingTestReport["warnings"][number]["code"], string>> = {
  ACCEPTS_UNSIGNED:
    "Fine for public data: your API answers calls without our signature, which is normal for an open API. Check the signature only if what it returns is private or each call costs you, so that only Assay can call it.",
};

const WORD: Record<PipelineStatus, string> = {
  pass: "passed",
  fail: "failed",
  warn: "needs a look",
  skipped: "not reached",
};

/**
 * A test run as four steps with pass / fail, and for a failure, whose fix
 * it is — "your test input", "your API", "the address or path",
 * "Authentication" or their mapping — so the provider knows what to change.
 * The backend's own wording sits behind "Details" on the failed step. Raw request, response and mapped output stay one
 * click away under "Show the raw exchange".
 */
export function TestPipelineView({
  report,
  stale,
  paid,
}: {
  report: BindingTestReport;
  stale?: boolean;
  /** The listing charges per call. A free or not-yet-priced draft must not read "would be paid". */
  paid?: boolean;
}) {
  const pipeline = testPipeline(report);

  return (
    <div className="flex w-full flex-col gap-3" aria-live="polite">
      {pipeline.passed && !pipeline.emptyResult ? (
        <div role="status" className="flex items-start gap-2.5 rounded-lg bg-success-10 px-3.5 py-3 text-success-700">
          <Check aria-hidden="true" strokeWidth={3} className="mt-0.5 size-4 shrink-0" />
          <p className="text-label-13">
            {paid
              ? "Test passed. A real call like this one would pass our check and be paid."
              : "Test passed. A real call like this one would pass our check."}
          </p>
        </div>
      ) : pipeline.emptyResult ? (
        <div role="status" className="flex items-start gap-2.5 rounded-lg bg-warning-10 px-3.5 py-3 text-warning-700">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="text-body-13">
            <span className="text-label-13">Empty result: all checks skipped.</span> Your API answered, but the result
            held no data, so this run proves nothing. Try test input that returns real data.
          </p>
        </div>
      ) : (
        <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-danger-10 px-3.5 py-3 text-danger-700">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p className="text-body-13">
            <span className="text-label-13">
              {pipeline.failed ? `Test failed at “${pipeline.failed.label}”.` : "Test failed."}
            </span>{" "}
            {pipeline.failed?.fault ? `What to fix: ${pipeline.failed.fault}.` : null}
          </p>
        </div>
      )}

      {stale ? (
        <p className="text-body-xs text-warning-700">
          You changed the connection after this run. Run the test again before you go live.
        </p>
      ) : null}

      <ol className="flex w-full flex-col rounded-lg border border-01 bg-01">
        {pipeline.steps.map((step, index) => (
          <li key={step.id} className="flex items-start gap-3 border-t border-01 px-3.5 py-3 first:border-t-0">
            <span className={cn("mt-px flex size-5 shrink-0 items-center justify-center rounded-full", MARK[step.status])}>
              {ICON[step.status]}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-label-13 text-01">
                {index + 1}. {step.label}
                <span className="sr-only">, {WORD[step.status]}</span>
              </span>
              <span className={cn("break-words text-body-xs", step.status === "fail" ? "text-danger-700" : "text-02")}>
                {step.sentence}
              </span>
              {step.details ? (
                <details className="text-body-xs text-03">
                  <summary className="cursor-pointer select-none">Details</summary>
                  <code className="mt-1 block break-all font-mono text-mono-xs">{step.details}</code>
                </details>
              ) : null}
            </div>
            {step.fault ? (
              <span className="shrink-0 rounded-full bg-danger-10 px-2 py-0.5 text-label-xs text-danger-700">
                Fix: {step.fault}
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {report.warnings.map((warning) => {
        const fine = FINE_FOR_PUBLIC[warning.code];
        return (
          <Alert
            key={warning.code}
            variant={fine ? "info" : "warning"}
            title={fine ? `${WARNING_TITLE[warning.code]} · does not block Go live` : `${WARNING_TITLE[warning.code]} · ${WARNING_NOTE}`}
            description={fine ? `${fine} ${warning.message}` : warning.message}
            showClose={false}
          />
        );
      })}

      <details className="rounded-lg border border-01 bg-02 px-3.5 py-2.5">
        <summary className="cursor-pointer select-none text-label-13 text-02">Show the raw exchange</summary>
        <div className="mt-3 flex flex-col gap-3">
          {report.request ? (
            <RawBlock title="We sent" body={sentText(report.request)} />
          ) : null}
          {report.upstream ? (
            <RawBlock
              title={`Your API answered${report.upstream.status ? ` (HTTP ${report.upstream.status})` : ""}`}
              body={
                report.upstream.transportError
                  ? (report.upstream.transportError.detail ?? report.upstream.transportError.kind)
                  : (report.upstream.rawBody ?? "(no body)") + (report.upstream.rawBodyTruncated ? "\n… (cut short)" : "")
              }
            />
          ) : null}
          <RawBlock title="Mapped result" body={pretty(report.mapped)} />
        </div>
      </details>
    </div>
  );
}

/**
 * The request line, then the header names (the signature ones included, so a
 * provider sees what to verify), then the body. Header values are never in the
 * report, so none can show here.
 */
export function sentText(request: NonNullable<BindingTestReport["request"]>): string {
  const lines = [`${request.method} ${request.url}`];
  if (request.headerNames.length > 0) lines.push(`Headers (values not shown): ${request.headerNames.join(", ")}`);
  if (request.body) lines.push("", pretty(request.body));
  return lines.join("\n");
}

function RawBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-label-xs text-03">{title}</span>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-01 p-2.5 font-mono text-mono-xs text-01">
        {body}
      </pre>
    </div>
  );
}
