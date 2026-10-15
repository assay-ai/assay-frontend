"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Play } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { BindingTestReport, CatalogueTool, ToolBindingDetail, ToolMapping } from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { testToolBinding } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";

import { documentsEqual, MappingEditor, schemaFields } from "../mapping-editor";
import { requestMappingSummary, responseMappingSummary } from "../mapping-summary";
import { argumentsProblem } from "../tester-arguments";
import { testPipeline } from "../tester/pipeline";
import { TestPipelineView } from "../tester/pipeline-view";
import { isStaleRun } from "../tester/report-view";
import { createRunGuard } from "../tester/run-guard";

import { argumentsFromText, seedArguments, seedRequestMapping, seedResponseMapping } from "./seeds";

export interface ConnectDraft {
  endpoint: string;
  requestMapping: ToolMapping;
  responseMapping: ToolMapping;
}

export function parseEndpoint(text: string): { value: string | null; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === "") return { value: null, error: "Enter your API's address." };
  if (trimmed.length > 2048) return { value: null, error: "At most 2048 characters." };
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { value: null, error: "Start it with https://." };
  } catch {
    return { value: null, error: "A full address, like https://api.example.com/v1." };
  }
  return { value: trimmed, error: null };
}

/**
 * Stage 2: where your API lives, how a tool call becomes a request to it and
 * how its answer becomes the tool's result, then one button that saves the
 * draft and runs a real test call. The test result is a 4-step pipeline that
 * says whose fault a failure is.
 */
export function ConnectStage({
  tool,
  binding,
  initialEndpoint,
  readOnly,
  testPassedBefore,
  onSave,
  onContinue,
}: {
  tool: CatalogueTool;
  binding: ToolBindingDetail | null;
  initialEndpoint: string;
  readOnly: boolean;
  /** The stored listing already has a passing test at its current version. */
  testPassedBefore: boolean;
  /** Creates the draft, or saves what changed. Resolves with the stored listing. */
  onSave: (draft: ConnectDraft) => Promise<ToolBindingDetail>;
  onContinue: () => void;
}) {
  const queryClient = useQueryClient();
  const [endpoint, setEndpoint] = React.useState(binding?.endpoint ?? initialEndpoint);
  const [endpointTouched, setEndpointTouched] = React.useState(false);
  const [mappings, setMappings] = React.useState<{ request: ToolMapping; response: ToolMapping }>(() => ({
    request: binding?.requestMapping ?? seedRequestMapping(tool),
    response: binding?.responseMapping ?? seedResponseMapping(tool),
  }));
  const [blocked, setBlocked] = React.useState<{ request: string | null; response: string | null }>({ request: null, response: null });
  const [asJson, setAsJson] = React.useState(false);
  const [advanced, setAdvancedState] = React.useState(false);
  const [advancedSeen, setAdvancedSeen] = React.useState(false);
  const setAdvanced = (open: boolean) => {
    if (open) setAdvancedSeen(true);
    setAdvancedState(open);
  };

  const fields = React.useMemo(() => schemaFields(tool.inputSchema), [tool.inputSchema]);
  const [args, setArgs] = React.useState<Record<string, string>>(() => seedArguments(tool.inputSchema));

  // Run stays off until the page has hydrated, so the first click is never lost.
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);

  const [phase, setPhase] = React.useState<"idle" | "saving" | "testing">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<BindingTestReport | null>(null);
  const [runGuard] = React.useState(createRunGuard);

  const parsedEndpoint = parseEndpoint(endpoint);
  const mappingProblem = blocked.request ?? blocked.response;

  const run = async () => {
    setError(null);
    if (parsedEndpoint.error) {
      setEndpointTouched(true);
      return;
    }
    if (mappingProblem) {
      setAdvanced(true);
      setError(`Fix the mapping first: ${mappingProblem}`);
      return;
    }
    const built = argumentsFromText(fields, args);
    if (built.error) {
      setError(built.error);
      return;
    }
    const problem = argumentsProblem(built.input, tool.inputSchema);
    if (problem) {
      setError(problem);
      return;
    }
    if (!runGuard.enter()) return;
    try {
      setPhase("saving");
      const saved = await onSave({
        endpoint: parsedEndpoint.value!,
        requestMapping: mappings.request,
        responseMapping: mappings.response,
      });
      setPhase("testing");
      const result = await testToolBinding(saved.id, { input: built.input });
      setReport(result);
      void queryClient.invalidateQueries({ queryKey: ["provider", "tool-binding", saved.id, "publish-check"] });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? plainError(caught.code)
          : caught instanceof Error && caught.message
            ? caught.message
            : "That did not work. Check your connection and try again.",
      );
    } finally {
      setPhase("idle");
      runGuard.leave();
    }
  };

  const dirty =
    !binding ||
    binding.endpoint !== endpoint.trim() ||
    !documentsEqual(binding.requestMapping, mappings.request) ||
    !documentsEqual(binding.responseMapping, mappings.response);
  const stale = report && binding ? isStaleRun(report, binding.version) || dirty : false;
  const passed = report ? testPipeline(report).passed && !stale : testPassedBefore && !dirty;

  return (
    <section aria-labelledby="connect-stage-title" className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="connect-stage-title" className="text-label-md text-01">
          Connect {tool.name} to your API
        </h2>
        <p className="text-body-13 text-02">
          We call your API whenever an agent uses this tool. Check the address, then run a test.
        </p>
      </div>

      <Field
        label="Your API's address"
        placeholder="https://api.example.com/v1"
        type="url"
        inputMode="url"
        value={endpoint}
        disabled={readOnly}
        onChange={(event) => setEndpoint(event.target.value)}
        onBlur={() => setEndpointTouched(true)}
        error={endpointTouched ? (parsedEndpoint.error ?? undefined) : undefined}
        hint={initialEndpoint && !binding ? "Filled in from your account setup." : undefined}
      />

      <div className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-01 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-label-sm text-01">How we call your API</h3>
          <p className="text-body-13 text-02">{requestMappingSummary(mappings.request)}</p>
          <p className="text-body-13 text-02">{responseMappingSummary(mappings.response)}</p>
          <p className="text-body-xs text-03">
            We filled this in from the tool&apos;s fields. If your API uses other names or paths, change them under Advanced mapping. Most
            people do not need to.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={advanced}
          aria-controls="advanced-mapping"
          onClick={() => setAdvanced(!advanced)}
          className="flex items-center gap-1.5 self-start text-label-13 text-02 hover:text-01"
        >
          <ChevronDown aria-hidden="true" className={cn("size-4 transition-transform", advanced && "rotate-180")} />
          Advanced mapping
        </button>
        {/* Kept mounted once opened so a half-made edit survives closing it. */}
        {advancedSeen ? (
          <div id="advanced-mapping" hidden={!advanced} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h4 className="text-label-sm text-01">How a call reaches your API</h4>
                <p className="text-body-xs text-03">Each row says where a value comes from.</p>
              </div>
              <Switch checked={asJson} onChange={(event) => setAsJson(event.target.checked)} label="Edit as JSON" />
            </div>
            <MappingEditor
              key={`request:${tool.id}`}
              direction="REQUEST"
              toolId={tool.id}
              mapping={mappings.request}
              schema={tool.inputSchema}
              json={asJson}
              onChange={(next) => setMappings((current) => ({ ...current, request: next }))}
              onStatus={(status) => setBlocked((current) => ({ ...current, request: status.editing }))}
            />
            <h4 className="pt-2 text-label-sm text-01">How your answer becomes the result</h4>
            <MappingEditor
              key={`response:${tool.id}`}
              direction="RESPONSE"
              toolId={tool.id}
              mapping={mappings.response}
              schema={tool.outputSchema}
              json={asJson}
              onChange={(next) => setMappings((current) => ({ ...current, response: next }))}
              onStatus={(status) => setBlocked((current) => ({ ...current, response: status.editing }))}
            />
          </div>
        ) : null}
      </div>

      <div className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-01 p-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-label-sm text-01">Test it</h3>
          <p className="text-body-xs text-03">
            A real call to your API with this input. Nobody is charged and nothing counts against you.
          </p>
        </div>
        {fields.length > 0 ? (
          <div className="grid w-full grid-cols-1 gap-3 tablet:grid-cols-2">
            {fields.map((field) => (
              <Field
                key={field.name}
                label={`${field.name}${field.required ? "" : " (optional)"}`}
                value={args[field.name] ?? ""}
                onChange={(event) => setArgs((current) => ({ ...current, [field.name]: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void run();
                  }
                }}
                placeholder={field.type === "number" || field.type === "integer" ? "0" : ""}
              />
            ))}
          </div>
        ) : (
          <p className="text-body-13 text-02">This tool takes no input.</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            icon={<Play aria-hidden="true" />}
            onClick={() => void run()}
            disabled={!hydrated || readOnly || phase !== "idle"}
            loading={phase !== "idle"}
          >
            {phase === "saving"
              ? binding
                ? "Saving your changes…"
                : "Saving your draft…"
              : phase === "testing"
                ? "Calling your API…"
                : report
                  ? "Run the test again"
                  : "Save and run test"}
          </Button>
          <span aria-live="polite" className="text-body-xs text-03">
            {phase === "saving" && !binding ? "Creating your draft listing takes a few seconds." : null}
            {readOnly ? "Your account is blocked, so changes are paused." : null}
          </span>
        </div>
        {error ? (
          <p role="alert" className="text-body-13 text-danger-600">
            {error}
          </p>
        ) : null}

        {report ? (
          <TestPipelineView report={report} stale={Boolean(stale)} paid={binding ? binding.pricingMode !== "FREE" : false} />
        ) : testPassedBefore && !dirty ? (
          <p className="text-body-13 text-success-700">Your last test passed. Run it again any time.</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onContinue} disabled={!passed}>
          Continue to Go live
          <ArrowRight aria-hidden="true" />
        </Button>
        {!passed ? (
          <span className="text-body-xs text-03">
            {report && !stale
              ? "Get a passing test to continue."
              : "Run a test to continue. Your draft is saved when you do."}
          </span>
        ) : null}
      </div>
    </section>
  );
}
