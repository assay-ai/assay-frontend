"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleX, Play, RefreshCw, TriangleAlert } from "lucide-react";
import * as React from "react";

import { BindingNav } from "@/features/provider-binding/binding-nav";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  BindingTestLayer,
  BindingTestLayerResult,
  BindingTestLayerStatus,
  BindingTestReport,
  ToolBindingDetail,
  ToolCatalogue,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import {
  getToolBinding,
  listToolCatalogue,
  testToolBinding,
  validateToolMapping,
} from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";
import { presentVerdict } from "@/utils/verdict";
import { argumentsProblem } from "@/features/provider-binding/tester-arguments";

import {
  byteSize,
  clockOf,
  firstFailedStage,
  hostOf,
  isStaleRun,
  jsonTypeOf,
  mappedField,
  mappedFieldCount,
  mappingPairs,
  pathOf,
  pretty,
  queryOf,
  requestQueryPairs,
  rulesPointingAt,
  scoredStage,
  twoDecimals,
  verdictRows,
  type VerdictRow,
} from "./report-view";
import { createRunGuard } from "./run-guard";
import { useSearchParam } from "@/hooks/useSearchParam";

/**
 * Mapping tester.
 *
 * ## What this screen is for, and the one rule that follows from it
 *
 * A provider reads this to predict what production will do to their traffic.
 * Every number on it therefore comes back from `POST
 * /providers/me/tool-bindings/{id}/test`, which runs the five production
 * layers — `mapRequest`, the egress invoker, the response classifier,
 * `mapResponse`, and the verification engine on this tool's stored
 * policy — and reports what each concluded.
 *
 * **Nothing here re-implements, re-orders or approximates a stage.** The stage
 * list is `verification.stages` in the API's own array order, the rule rows are
 * `stages[].rules` in theirs, and a stage the API marked `NOT_REACHED` is drawn
 * as not reached rather than quietly skipped. If the screen and production ever
 * disagree about a verdict, every later slash reads as arbitrary — which is the
 * failure the backend's mapping-tester endpoint documents.
 *
 * The single derived figure is a rule's **Contribution** (its weight when it
 * passed, zero when it failed); the API returns a per-rule `weight` and a
 * per-stage `score` but no per-rule contribution. The TOTAL row's contribution
 * is the API's `score`, not a sum of the rows — so a disagreement between the
 * two is visible rather than hidden. See `report-view.ts`.
 *
 * ## Where this diverges from the design, and why
 *
 *  - The design's **case picker** has no data source: no endpoint
 *    exposes saved test cases, and `RunBindingTestBody` is `{ input }` alone.
 *    Its slot carries the editable arguments document instead.
 *  - **Re-map** re-runs the mapping over a cached upstream response.
 *    `POST …/test` always dials upstream; there is no re-map route. The button
 *    is drawn and disabled, and says why.
 *  - The design's **History** sparkline ("0.41 ─── 0.63 ─── 0.90")
 *    needs previous runs. Nothing reads `binding_test_runs` back.
 *  - The design paints a failed Result cell `$text-02`, like every other cell.
 *    A failed row here is `$danger-600`, matching `StageList`'s own failed
 *    colour. Deliberate.
 */

// ── The three panes ────────────────────────────────────────────────────────

/**
 * The word for one of the five production layers, in the pane that shows it.
 *
 * The design has **no region for `report.layers`** — its three panes are the
 * mapped request, the upstream response and the mapped output, which are
 * layers 1, 2 and 4, and its panel 5 is layer 5. Layer 3, the response
 * classification, is drawn nowhere at all. Leaving them out would mean a run
 * that stops at CLASSIFICATION renders three panes with no visible reason, so
 * each pane carries its own layer's status word here, and the classification
 * is appended to the upstream pane's meta. That is an addition to the design.
 */
const LAYER_WORD: Record<BindingTestLayerStatus, string> = {
  PASSED: "passed",
  FAILED: "failed",
  NOT_REACHED: "not reached",
  INCONCLUSIVE: "inconclusive",
};

const LAYER_TONE: Record<BindingTestLayerStatus, string> = {
  PASSED: "text-success-500",
  FAILED: "text-danger-500",
  NOT_REACHED: "text-03",
  INCONCLUSIVE: "text-warning-600",
};

/**
 * three equal panes, 300 tall, each a `$bg-01` card with a
 * `$bg-02` head carrying a numbered mono caption and a one-line meta.
 */
function Pane({
  caption,
  meta,
  layer,
  children,
}: {
  caption: string;
  meta: string;
  layer?: BindingTestLayerResult;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-[300px] min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-01 bg-01">
      <header className="flex w-full flex-col gap-[3px] border-b border-01 bg-02 px-3.5 py-[11px]">
        <div className="flex w-full items-center justify-between gap-3">
          <h2 className="font-mono text-mono-2xs tracking-[1.1px] text-03">{caption}</h2>
          {layer ? (
            <span
              className={cn(
                "shrink-0 font-mono text-mono-2xs tracking-[1.1px]",
                LAYER_TONE[layer.status]
              )}
            >
              {LAYER_WORD[layer.status].toUpperCase()}
            </span>
          ) : null}
        </div>
        <p className="w-full truncate font-mono text-mono-xs text-02" title={meta}>
          {meta}
        </p>
      </header>
      <div className="w-full flex-1 overflow-auto p-3.5">{children}</div>
    </section>
  );
}

/** Mono body text at the design's 11.5/1.75. `pre` so JSON keeps its shape. */
function PaneCode({ children, wrap }: { children: React.ReactNode; wrap?: boolean }) {
  return (
    <pre
      className={cn(
        "w-full font-mono text-mono-xs leading-[1.75] text-01",
        wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"
      )}
    >
      {children}
    </pre>
  );
}

function PaneEmpty({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-mono-xs leading-[1.75] text-03">{children}</p>;
}

// ── Notes ──────────────────────────────────────────────────────────────────

/** The warning note under the coverage table. */
function WarningNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full gap-2.5 rounded-xl border border-warning-20 bg-warning-10 p-[15px]">
      <TriangleAlert
        aria-hidden="true"
        width={15}
        height={15}
        className="mt-0.5 shrink-0 text-warning-600"
      />
      <p className="w-full text-body-13 leading-[1.6] text-warning-700">{children}</p>
    </div>
  );
}

/**
 * The consequence bar under the verdict table.
 *
 * The design draws only the credited case, and its sentence is used verbatim
 * there. The other two wordings are OURS: `presentVerdict()` supplies the
 * verdict sentence, and whether the call would count as a strike is read off
 * the VERIFICATION layer's `fault`, which the API sets to `PROVIDER` exactly
 * when it would. Both are provisional copy.
 */
function ConsequenceBar({ report }: { report: BindingTestReport }) {
  const verdict = presentVerdict(report.verification?.verdict);
  const verificationLayer = report.layers.find((layer) => layer.layer === "VERIFICATION");
  const providerAtFault = report.layers.some((layer) => layer.fault === "PROVIDER");

  if (verdict.charged === true) {
    return (
      <div className="flex w-full items-center gap-4 rounded-xl border border-success-20 bg-success-10 p-[15px]">
        <CircleCheck aria-hidden="true" width={16} height={16} className="shrink-0 text-success-600" />
        <p className="w-full text-label-13 text-success-700">
          In production this call would be CREDITED. It would not count as a strike.
        </p>
      </div>
    );
  }

  if (verdict.charged === false) {
    return (
      <div className="flex w-full items-center gap-4 rounded-xl border border-danger-20 bg-danger-10 p-[15px]">
        <CircleX aria-hidden="true" width={16} height={16} className="shrink-0 text-danger-600" />
        <p className="w-full text-label-13 text-danger-700">
          In production this call would NOT be CREDITED.{" "}
          {providerAtFault
            ? "It would count as a strike."
            : "It would not count as a strike."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full items-center gap-4 rounded-xl border border-warning-20 bg-warning-10 p-[15px]">
      <TriangleAlert aria-hidden="true" width={16} height={16} className="shrink-0 text-warning-600" />
      <p className="w-full text-label-13 text-warning-700">
        {verdict.shownAs}
        {verificationLayer?.status === "INCONCLUSIVE"
          ? " This run reached no judgement, so it is not evidence either way."
          : ""}
      </p>
    </div>
  );
}

// ── Coverage table ─────────────────────────────────────────────────────────

interface CoverageRow {
  id: string;
  field: string;
  from: string;
  status: string;
  readBy: string;
  impact: string;
  failed: boolean;
}

const COVERAGE_COLUMNS: TableColumn<CoverageRow>[] = [
  { key: "field", header: "Field", cell: (row) => row.field, mono: true },
  { key: "from", header: "Mapped from", cell: (row) => row.from, width: 210, mono: true },
  { key: "status", header: "Status", cell: (row) => row.status, width: 150, mono: true },
  { key: "readBy", header: "Read by", cell: (row) => row.readBy, width: 320, mono: true },
  {
    key: "impact",
    header: "Impact",
    cell: (row) => (
      <span className={row.failed ? "text-danger-600" : undefined}>{row.impact}</span>
    ),
    width: 110,
    mono: true,
  },
];

function coverageRows(binding: ToolBindingDetail, report: BindingTestReport): CoverageRow[] {
  const stages = report.verification?.stages ?? [];

  return mappingPairs(binding.responseMapping).map((pair) => {
    const mapped = mappedField(report.mapped, pair.field);
    const rules = rulesPointingAt(stages, pair.field);
    const failedRules = rules.filter((rule) => rule.outcome === "FAILED");
    const lost = failedRules.reduce((sum, rule) => sum + rule.weight, 0);

    return {
      id: pair.field,
      field: pair.field,
      from:
        pair.selector ??
        (pair.literal === undefined ? pretty(pair.node) : `const ${pretty(pair.literal)}`),
      status: mapped.present ? `mapped · ${jsonTypeOf(mapped.value)}` : "absent",
      // A rule names the field it read only when it FAILED — `pointer` is null
      // on a pass. So this column is honestly blank for a passing rule rather
      // than guessed at from the rule's type. This is an API gap.
      readBy: rules.length === 0 ? "—" : rules.map((rule) => rule.type).join(" · "),
      impact: failedRules.length === 0 ? "—" : `−${twoDecimals(lost)}`,
      failed: failedRules.length > 0,
    };
  });
}

// ── Verdict table ──────────────────────────────────────────────────────────

const VERDICT_COLUMNS: TableColumn<VerdictRow>[] = [
  { key: "check", header: "Check", cell: (row) => row.check, mono: true },
  {
    key: "result",
    header: "Result",
    cell: (row) => (
      <span className={row.failed ? "text-danger-600" : undefined} title={row.result}>
        {row.result}
      </span>
    ),
    width: 320,
    mono: true,
  },
  {
    key: "weight",
    header: "Weight",
    cell: (row) => (row.weight === null ? "—" : twoDecimals(row.weight)),
    width: 110,
    mono: true,
  },
  {
    key: "contribution",
    header: "Contribution",
    cell: (row) => (row.contribution === null ? "—" : twoDecimals(row.contribution)),
    width: 130,
    mono: true,
  },
];

// ── The screen ─────────────────────────────────────────────────────────────

/** A skeleton for the arguments box, from the selectors the request mapping reads. */
function inputSkeleton(binding: ToolBindingDetail, selectors: string[] | undefined): string {
  const fromQuery = requestQueryPairs(binding.requestMapping)
    .map((pair) => pair.selector)
    .filter((selector): selector is string => selector !== null);

  const paths = (selectors && selectors.length > 0 ? selectors : fromQuery)
    .map((selector) => selector.replace(/^\$\./, ""))
    .filter((name) => name.length > 0 && !name.includes("*"));

  if (paths.length === 0) return "{}";

  const skeleton: Record<string, null> = {};
  for (const name of paths) skeleton[name.split(".")[0]] = null;
  // Compact: the arguments slot is a single-line field, matching the design.
  return JSON.stringify(skeleton);
}

function errorLine(error: unknown): string {
  if (error instanceof ApiError) return `${error.code} · ${error.message}`;
  return error instanceof Error ? error.message : "The run could not be started.";
}

/** One layer's result, by name. `undefined` before the first run. */
function layerOf(
  report: BindingTestReport | null,
  layer: BindingTestLayer
): BindingTestLayerResult | undefined {
  return report?.layers.find((entry) => entry.layer === layer);
}

export default function MappingTesterPage() {
  const bindingId = useSearchParam("binding");

  const bindingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId],
    queryFn: () => getToolBinding(bindingId),
    enabled: Boolean(bindingId),
  });
  const binding = bindingQuery.data;

  /*
    `validate-mapping` is the same normaliser the editor runs at Save, so its
    `selectors` array is exactly the field list the tester will read — which is
    what pane 1 shows and what seeds the arguments box. It writes nothing and
    answers 201.
  */
  const requestMappingQuery = useQuery({
    queryKey: ["provider", "tool-binding", bindingId, "validate", "REQUEST"],
    queryFn: () =>
      validateToolMapping({
        direction: "REQUEST",
        mapping: binding!.requestMapping,
        toolId: binding!.toolId,
      }),
    enabled: Boolean(binding),
    retry: 0,
  });

  const [args, setArgs] = React.useState<string | null>(null);
  const [argsError, setArgsError] = React.useState<string | null>(null);

  // Seeded once, from the mapping. Never overwritten while the provider types.
  React.useEffect(() => {
    if (binding && args === null) {
      setArgs(inputSkeleton(binding, requestMappingQuery.data?.selectors));
    }
  }, [binding, requestMappingQuery.data, args]);

  // The tool's input schema, to name the arguments a run would be refused for.
  // Same key and freshness as the other catalogue readers, so usually cached.
  const catalogueQuery = useQuery<ToolCatalogue, ApiError>({
    queryKey: ["provider", "tool-catalogue"],
    queryFn: listToolCatalogue,
    retry: 0,
    staleTime: 5 * 60 * 1000,
  });
  const inputSchema = catalogueQuery.data?.tools.find((tool) => tool.id === binding?.toolId)?.inputSchema;

  const queryClient = useQueryClient();
  // Enter and the Run button both go through `onRun`; see `createRunGuard`.
  const [runGuard] = React.useState(createRunGuard);
  const run = useMutation({
    mutationFn: (input: Record<string, unknown>) => testToolBinding(bindingId, { input }),
    // A run is what the publish gate's tester rows read: the checklist cached
    // from an earlier visit is out of date the moment one lands.
    onSettled: () => {
      runGuard.leave();
      return queryClient.invalidateQueries({
        queryKey: ["provider", "tool-binding", bindingId, "publish-check"],
      });
    },
  });
  const report = run.data ?? null;

  const onRun = React.useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(args ?? "{}");
    } catch {
      setArgsError("The arguments are not valid JSON.");
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setArgsError("The arguments must be a JSON object.");
      return;
    }
    // The seeded skeleton is all nulls: say which fields to fill rather than
    // spend a run on a TOOL_MAPPING_NULL_VALUE refusal.
    const problem = argumentsProblem(parsed as Record<string, unknown>, inputSchema);
    if (problem) {
      setArgsError(problem);
      return;
    }
    setArgsError(null);
    if (!runGuard.enter()) return;
    run.mutate(parsed as Record<string, unknown>);
  }, [args, run, runGuard, inputSchema]);

  if (bindingQuery.isPending) {
    return <p className="font-mono text-mono-13 text-03">Loading binding…</p>;
  }

  if (bindingQuery.isError || !binding) {
    return (
      <EmptyState
        icon={null}
        title="This binding could not be loaded"
        description={errorLine(bindingQuery.error)}
      />
    );
  }

  const stages = report?.verification?.stages ?? [];
  const rows = verdictRows(stages);
  const scored = scoredStage(stages);
  const failedStage = firstFailedStage(stages);
  const verdict = report ? presentVerdict(report.verification?.verdict) : null;
  const stale = report ? isStaleRun(report, binding.version) : false;

  const responseFields = mappingPairs(binding.responseMapping);
  const requestQuery = requestQueryPairs(binding.requestMapping);

  return (
    <TooltipProvider delayDuration={150}>
      {/* Page Header */}
      <header className="flex w-full flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="truncate text-heading-md text-01">
            Test · {binding.id.slice(0, 8)} · {hostOf(binding.endpoint)}
          </h1>
          <p className="w-full truncate font-mono text-mono-12 text-03">
            v{binding.version} · {binding.status.toLowerCase()}
            {report ? ` · ran ${clockOf(report.ranAt)}` : " · not run yet"}
            {stale ? ` · this run was against v${report?.mappingVersion}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              {/* Wrapped: a disabled button emits no pointer events of its own. */}
              <span tabIndex={0}>
                <Button variant="secondary" icon={<RefreshCw />} disabled>
                  Re-map
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-[280px] border border-01 shadow-soft">
              <span className="text-body-13 text-02">
                Every run calls your endpoint again, so a mapping change is tested by running
                it.
              </span>
            </TooltipContent>
          </Tooltip>

          <Button icon={<Play />} onClick={onRun} loading={run.isPending}>
            Run
          </Button>
        </div>
      </header>

      <BindingNav bindingId={bindingId} />

      {/* Case. The design's case picker has no data source; the slot
          carries the arguments document the run actually posts. */}
      <section className="flex w-full items-center gap-3 rounded-xl border border-01 bg-01 p-3.5">
        <label className="flex min-w-0 flex-1 items-center gap-3">
          <span className="shrink-0 font-mono text-mono-2xs tracking-[1.1px] text-03">
            ARGUMENTS
          </span>
          <input
            value={args ?? ""}
            onChange={(event) => setArgs(event.target.value)}
            onKeyDown={(event) => {
              // A held key repeats; one press is one run.
              if (event.key === "Enter" && !event.repeat) onRun();
            }}
            spellCheck={false}
            aria-label="Tool arguments, as JSON"
            className="min-w-0 flex-1 bg-transparent font-mono text-mono-12 text-01 outline-none placeholder:text-03"
            placeholder="{}"
          />
        </label>

        {/* The design — the design's badge, overridden to `$bg-03` / `$text-02`
            with no dot. `Badge`'s vocabulary is closed by design (rule 03), so
            the same tokens are written out rather than a label prop added. */}
        <span className="shrink-0 whitespace-nowrap rounded-full bg-03 px-[9px] py-1 font-mono text-mono-xs font-semibold text-02">
          {report?.verification
            ? report.verification.policySource === "STORED_POLICY"
              ? `POLICY ${report.verification.policyId ?? "—"} v${report.verification.policyVersion ?? "—"}`
              : "TOOL SCHEMA ONLY"
            : "POLICY NOT YET READ"}
        </span>
      </section>

      {argsError ? (
        <p className="font-mono text-mono-12 text-danger-600">{argsError}</p>
      ) : null}

      {run.isError ? (
        <div className="flex w-full gap-2.5 rounded-xl border border-danger-20 bg-danger-10 p-[15px]">
          <CircleX aria-hidden="true" width={15} height={15} className="mt-0.5 shrink-0 text-danger-600" />
          <p className="w-full font-mono text-mono-12 leading-[1.6] text-danger-700">
            {errorLine(run.error)}
          </p>
        </div>
      ) : null}

      {stale ? (
        <WarningNote>
          This run exercised revision v{report?.mappingVersion}; the binding is now at v
          {binding.version}. The publish gate keys on the revision, so it is not
          evidence for what is on screen. Run it again.
        </WarningNote>
      ) : null}

      {/* Panes */}
      <div className="flex w-full gap-3">
        <Pane
          caption="1 · MAPPED REQUEST"
          layer={layerOf(report, "REQUEST_MAPPING")}
          meta={
            report?.request
              ? `${report.request.method} ${pathOf(report.request.url)} · x-assay-call-id: ${report.callId}`
              : `${String(binding.requestMapping.method ?? "")} ${String(binding.requestMapping.path ?? "")}`.trim() ||
                "no request built yet"
          }
        >
          {report?.request ? (
            <PaneCode>
              {pretty(report.request.body ?? queryOf(report.request.url) ?? {})}
              {"\n\n"}
              {requestQuery
                .filter((pair) => pair.selector !== null)
                .map((pair) => `${pair.selector} → ${pair.field}`)
                .join("\n")}
              {report.request.headerNames.length > 0
                ? `\n\nheaders: ${report.request.headerNames.join(", ")}`
                : ""}
            </PaneCode>
          ) : (
            <PaneEmpty>Not run yet.</PaneEmpty>
          )}
        </Pane>

        <Pane
          caption="2 · UPSTREAM RESPONSE"
          layer={layerOf(report, "UPSTREAM")}
          meta={
            report?.upstream
              ? [
                  String(report.upstream.status),
                  `${report.upstream.latencyMs} ms`,
                  byteSize(report.upstream.rawBody) ?? "no body",
                  report.upstream.contentType,
                  report.upstream.rawBodyTruncated ? "truncated" : null,
                  // Layer 3. The design draws the classifier nowhere, and a
                  // provider whose 200 was classified SYSTEM_ERROR needs to
                  // read that here rather than infer it from an empty panel 5.
                  report.classification
                    ? `${report.classification.responseClass} · ${report.classification.reason}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : "not run yet"
          }
        >
          {report?.upstream ? (
            report.upstream.transportError ? (
              <PaneCode wrap>
                {`${report.upstream.transportError.kind}\n${report.upstream.transportError.detail ?? ""}`}
              </PaneCode>
            ) : (
              // The bytes exactly as the API returned them. Re-indenting would
              // make this panel an interpretation of the response rather than
              // the response — which is the one thing it must not be.
              <PaneCode wrap>{report.upstream.rawBody ?? "(no body)"}</PaneCode>
            )
          ) : (
            <PaneEmpty>Not run yet.</PaneEmpty>
          )}
        </Pane>

        <Pane
          caption="3 · MAPPED OUTPUT"
          layer={layerOf(report, "RESPONSE_MAPPING")}
          meta={
            report
              ? `vs outputSchema · ${mappedFieldCount(report.mapped)} of ${responseFields.length} fields mapped`
              : "not run yet"
          }
        >
          {report ? (
            report.mapped === null || report.mapped === undefined ? (
              <PaneEmpty>
                The mapping produced nothing — the run stopped at{" "}
                {report.failedLayer ?? "an earlier layer"}.
              </PaneEmpty>
            ) : (
              <PaneCode>{pretty(report.mapped)}</PaneCode>
            )
          ) : (
            <PaneEmpty>Not run yet.</PaneEmpty>
          )}
        </Pane>
      </div>

      {!report ? (
        <EmptyState
          icon={null}
          title="No run yet"
          description="Nothing on this screen is simulated. Run the tester and it shows the response your endpoint actually returned, what the mapping made of it, and what every check production runs concluded about it."
        />
      ) : null}

      {/* 4 · Coverage vs outputSchema */}
      {report ? (
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>4 · Coverage vs outputSchema</PanelTitle>
              <PanelDescription>
                which fields the mapping fills, which it drops, and which rules read the
                dropped ones
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3 px-2.5 pb-3.5 pt-1.5">
            <Table
              caption="Coverage vs outputSchema"
              columns={COVERAGE_COLUMNS}
              rows={coverageRows(binding, report)}
            />
            {failedStage?.detail ? <WarningNote>{failedStage.detail}</WarningNote> : null}
            {report.failedLayer === "RESPONSE_MAPPING" ? (
              <WarningNote>
                {report.layers.find((layer) => layer.layer === "RESPONSE_MAPPING")?.detail ??
                  "The response mapping did not complete."}
              </WarningNote>
            ) : null}
          </PanelBody>
        </Panel>
      ) : null}

      {/* 5 · Verdict */}
      {report ? (
        <Panel>
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>5 · Verdict</PanelTitle>
              <PanelDescription>
                {report.verification
                  ? report.verification.policySource === "STORED_POLICY"
                    ? `policy ${report.verification.policyId} v${report.verification.policyVersion} — one result per rule`
                    : "no stored policy — judged against this tool's outputSchema alone, which is stricter than production"
                  : "verification was not reached"}
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3 px-2.5 pb-3.5 pt-1.5">
            {rows.length > 0 ? (
              <Table
                caption="Verdict, per check"
                columns={VERDICT_COLUMNS}
                rows={rows}
                total={{
                  label: "TOTAL",
                  values: {
                    // Never the raw token — Foundations rule 03.
                    result: verdict?.shownAs,
                    weight: "—",
                    contribution:
                      scored?.score === null || scored?.score === undefined
                        ? "—"
                        : twoDecimals(scored.score),
                  },
                }}
              />
            ) : (
              <p className="px-3 py-2 font-mono text-mono-13 text-03">
                {report.failedLayer
                  ? [
                      `Verification was not reached — the run stopped at ${report.failedLayer}.`,
                      layerOf(report, report.failedLayer)?.code,
                      layerOf(report, report.failedLayer)?.detail,
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : "The engine reported no stages for this run."}
              </p>
            )}
            <ConsequenceBar report={report} />
          </PanelBody>
        </Panel>
      ) : null}
    </TooltipProvider>
  );
}
