"use client";

import { AuthenticationPanel, runBlockedByCredentials, runCredentialsHint, useBindingCredentials } from "../authentication/authentication-panel";
import { QUERY_KEY_ERROR, credentialQueryKeys, moveQueryKeys } from "../authentication/rules";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import type { BindingAuthMode, BindingTestReport, CatalogueTool, ToolBindingDetail, ToolMapping } from "@/interfaces";
import type { CredentialHeaderInput } from "@/interfaces/provider-bindings";
import { ApiError } from "@/libs/ApiClient";
import { plainApiError, plainError } from "@/libs/plain-language";
import { testToolBinding } from "@/services/provider-tool-bindings.service";
import { cn } from "@/utils";

import {
  contractMismatchProblems,
  defaultTerms,
  majorChoices,
  runLabel,
  sameTerms,
  termsOf,
  termsProblem,
  testTargets,
  type ContractTerms,
} from "../contract-terms";
import { ContractTermsPanel } from "../contract-terms-panel";
import { documentsEqual, MappingEditor, schemaFields } from "../mapping-editor";
import { requestMappingSummary, responseMappingSummary } from "../mapping-summary";
import { argumentsProblem } from "../tester-arguments";
import { testGate, testPipeline } from "../tester/pipeline";
import { TestPipelineView } from "../tester/pipeline-view";
import { isStaleRun } from "../tester/report-view";
import { createRunGuard } from "../tester/run-guard";

import { cleanEndpoint, endpointPath } from "@/features/provider-tools/tried-endpoint";

import { previewRequest } from "./request-preview";
import { canPickInto, pickInto, sampleAnswer } from "./response-pick";
import { ResponsePicker } from "./response-picker";
import { readTestInput, writeTestInput } from "./test-input-store";
import { argumentsFromText, seedArguments, seedRequestMapping, seedResponseMapping } from "./seeds";

export interface ConnectDraft {
  endpoint: string;
  authMode: BindingAuthMode;
  requestMapping: ToolMapping;
  responseMapping: ToolMapping;
  /**
   * T3: the contract versions served and the optional fields. null when the
   * catalogue has no versions (a backend before T3): nothing is sent.
   */
  terms: ContractTerms | null;
}

/** One test run, for one contract major. */
interface MajorRun {
  major: number;
  semver: string | null;
  report: BindingTestReport;
}

/** Where "Save draft and exit" goes: the listings. */
const LISTINGS_PATH = "/provider/bindings";

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
/**
 * A warning when the address would not call what was tried: a path other than
 * the one the provider's curl used, or no path at all when nothing was tried
 * (the account's base address). We call exactly the address typed here.
 */
export function endpointPathWarning(endpoint: string, testedEndpoint: string | null): string | null {
  const typed = cleanEndpoint(endpoint);
  if (!typed) return null;
  const path = endpointPath(typed);
  if (testedEndpoint) {
    const tested = endpointPath(testedEndpoint);
    if (path === tested) return null;
    return `You tried this tool at ${testedEndpoint}, but this address calls ${typed} instead. We call exactly this address, with the tool's inputs added.`;
  }
  if (path !== "") return null;
  return "This address has no path. If your API answers this tool at a path, like https://api.example.com/latest, add it here: we call exactly this address, with the tool's inputs added.";
}

export function ConnectStage({
  tool,
  binding,
  initialEndpoint,
  initialEndpointSource = "setup",
  testedEndpoint = null,
  readOnly,
  testPassedBefore,
  onSave,
  onContinue,
}: {
  tool: CatalogueTool;
  binding: ToolBindingDetail | null;
  initialEndpoint: string;
  /** Where `initialEndpoint` came from: the account setup's base address, or the call tried for this tool. */
  initialEndpointSource?: "setup" | "try";
  /** Where this tool was tried (origin and path), if it was: a different path here is warned about. */
  testedEndpoint?: string | null;
  readOnly: boolean;
  /** The stored listing already has a passing test at its current version. */
  testPassedBefore: boolean;
  /** Creates the draft, or saves what changed. Resolves with the stored listing. */
  onSave: (draft: ConnectDraft) => Promise<ToolBindingDetail>;
  onContinue: () => void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [endpoint, setEndpoint] = React.useState(binding?.endpoint ?? initialEndpoint);
  // No default (D10): a new listing starts with no choice, and nothing is saved until one is made.
  const [authMode, setAuthMode] = React.useState<BindingAuthMode | null>(binding?.authMode ?? null);
  // Moved out of the address by "Move it to an API key header"; only ever handed to the write-only form.
  const [pendingHeaders, setPendingHeaders] = React.useState<CredentialHeaderInput[] | null>(null);
  const credentialSets = useBindingCredentials(binding?.id ?? null, authMode);
  // Before the first save there is nowhere to store a key, so Run (which saves) stays open.
  const credentialGate = {
    hasBinding: binding !== null,
    mode: authMode,
    loading: credentialSets.isLoading,
    isError: credentialSets.isError,
    sets: credentialSets.data,
    endpoint,
    savedEndpoint: binding?.endpoint ?? null,
  };
  const credentialsMissing = runBlockedByCredentials(credentialGate);
  const credentialsHint = runCredentialsHint(credentialGate);
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

  const choices = React.useMemo(() => majorChoices(tool), [tool]);
  const versioned = choices.length > 0;
  const storedTerms = React.useMemo(() => (binding ? termsOf(binding) : null), [binding]);
  const [terms, setTerms] = React.useState<ContractTerms>(() => storedTerms ?? defaultTerms(tool));
  const termsDirty = versioned && (storedTerms ? !sameTerms(storedTerms, terms) : false);
  const termsBlocked = versioned ? termsProblem(terms, choices) : null;

  const fields = React.useMemo(() => schemaFields(tool.inputSchema), [tool.inputSchema]);
  const outputFields = React.useMemo(() => schemaFields(tool.outputSchema), [tool.outputSchema]);
  // Bumped by a click in the answer, so the Advanced editor re-opens on the picked mapping.
  const [picks, setPicks] = React.useState(0);
  // Prefilled from the contract's own example (the current version's), so the first test can run at once.
  // The last test input kept with this draft wins; otherwise the contract's example.
  const [args, setArgs] = React.useState<Record<string, string>>(() => {
    const seeded = seedArguments(tool.inputSchema, (tool.versions?.find((v) => v.isCurrent) ?? tool.versions?.[0])?.examples ?? []);
    const kept = readTestInput(binding?.id);
    return kept ? { ...seeded, ...Object.fromEntries(Object.entries(kept).filter(([name]) => name in seeded)) } : seeded;
  });

  // Run stays off until the page has hydrated, so the first click is never lost.
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);

  const [phase, setPhase] = React.useState<"idle" | "saving" | "testing" | "saving-only" | "exiting">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const [problems, setProblems] = React.useState<string[] | null>(null);
  const [runs, setRuns] = React.useState<MajorRun[] | null>(null);
  const [testingMajor, setTestingMajor] = React.useState<number | null>(null);
  const report = runs?.[runs.length - 1]?.report ?? null;
  // An empty result proves nothing: Continue needs the provider to say they know. Asked again per run.
  const [emptyAck, setEmptyAck] = React.useState(false);
  const [ackFor, setAckFor] = React.useState<BindingTestReport | null>(null);
  if (ackFor !== report) {
    setAckFor(report);
    setEmptyAck(false);
  }
  const [runGuard] = React.useState(createRunGuard);
  // The mappings as typed when they were last saved. The server stores them in its canonical form
  // (`$from` + `$item`), which differs from the shorthand typed in the JSON editor, so a saved
  // shorthand must not read as "changed since the test".
  const [sent, setSent] = React.useState<{ version: number; request: ToolMapping; response: ToolMapping } | null>(null);

  const parsedEndpoint = parseEndpoint(endpoint);
  const urlKeys = credentialQueryKeys(endpoint);
  const endpointError = urlKeys.length > 0 ? QUERY_KEY_ERROR : parsedEndpoint.error;
  const mappingProblem = blocked.request ?? blocked.response;

  const mappingInvalid = () => {
    setAdvanced(true);
    setError(`Fix the mapping first: ${mappingProblem}`);
  };

  /** Everything a save needs, or null with the reason shown. */
  const prepare = (): ConnectDraft | null => {
    setError(null);
    setProblems(null);
    if (termsBlocked) {
      setError(termsBlocked);
      return null;
    }
    if (endpointError) {
      setEndpointTouched(true);
      return null;
    }
    if (authMode === null) {
      setError("Choose how your API knows a call is from Assay, under Authentication.");
      return null;
    }
    if (mappingProblem) {
      mappingInvalid();
      return null;
    }
    return {
      endpoint: parsedEndpoint.value!,
      authMode,
      requestMapping: mappings.request,
      responseMapping: mappings.response,
      terms: versioned ? terms : null,
    };
  };

  const failed = (caught: unknown) => {
    const mismatch = contractMismatchProblems(caught);
    if (mismatch) {
      setProblems(mismatch);
      return;
    }
    setError(
      caught instanceof ApiError
        ? plainApiError(caught)
        : caught instanceof Error && caught.message
          ? caught.message
          : "That did not work. Check your connection and try again.",
    );
  };

  /** Saves the draft without a test call: "Save connection" and "Save draft and exit". */
  const saveOnly = async (then?: () => void) => {
    const draft = prepare();
    if (!draft) return;
    if (!runGuard.enter()) return;
    try {
      setPhase(then ? "exiting" : "saving-only");
      const saved = await onSave(draft);
      setSent({ version: saved.version, request: draft.requestMapping, response: draft.responseMapping });
      writeTestInput(saved.id, args);
      then?.();
    } catch (caught) {
      failed(caught);
    } finally {
      setPhase("idle");
      runGuard.leave();
    }
  };

  const run = async () => {
    const draft = prepare();
    if (!draft) return;
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
      const saved = await onSave(draft);
      setSent({ version: saved.version, request: draft.requestMapping, response: draft.responseMapping });
      writeTestInput(saved.id, args);
      setPhase("testing");
      // One run per contract version served: each must pass before publishing.
      const done: MajorRun[] = [];
      for (const target of testTargets(terms, choices)) {
        setTestingMajor(versioned ? target.major : null);
        const result = await testToolBinding(saved.id, {
          input: built.input,
          ...(versioned && target.version !== undefined ? { toolVersion: target.version } : {}),
        });
        done.push({ major: target.major, semver: target.semver, report: result });
        setRuns([...done]);
      }
      void queryClient.invalidateQueries({ queryKey: ["provider", "tool-binding", saved.id, "publish-check"] });
    } catch (caught) {
      failed(caught);
    } finally {
      setPhase("idle");
      setTestingMajor(null);
      runGuard.leave();
    }
  };

  const mappingSaved = (field: "request" | "response") =>
    !binding ||
    documentsEqual(field === "request" ? binding.requestMapping : binding.responseMapping, mappings[field]) ||
    (sent !== null && sent.version === binding.version && documentsEqual(sent[field], mappings[field]));
  const dirty =
    !binding ||
    binding.endpoint !== endpoint.trim() ||
    binding.authMode !== authMode ||
    !mappingSaved("request") ||
    !mappingSaved("response") ||
    termsDirty;
  const stale = runs && binding ? runs.some((r) => isStaleRun(r.report, binding.version)) || dirty : false;
  const gates = runs?.map((r) => testGate(testPipeline(r.report), { stale: Boolean(stale), emptyAcknowledged: emptyAck })) ?? null;
  // Every version served needs its own passing run.
  const complete = runs ? runs.length === testTargets(terms, choices).length : false;
  const gate = gates
    ? { passed: complete && gates.every((g) => g.passed), needsEmptyAck: gates.some((g) => g.needsEmptyAck) }
    : null;
  const passed = gate ? gate.passed : testPassedBefore && !dirty;
  const multi = versioned && (runs?.length ?? terms.majors.length) > 1;
  const preview = previewRequest(endpoint, mappings.request, args);
  const pathWarning = endpointPathWarning(endpoint, testedEndpoint);
  // The real answer of the latest test call, for clicking values into output fields.
  const answer = sampleAnswer(report);
  const pickResponse = (field: string, path: string) => {
    setMappings((current) => ({ ...current, response: pickInto(current.response, field, path) }));
    setBlocked((current) => ({ ...current, response: null }));
    setPicks((n) => n + 1);
  };

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

      <div className="flex flex-col gap-2">
        <Field
          label="Your API's address"
          placeholder="https://api.example.com/v1"
          type="url"
          inputMode="url"
          value={endpoint}
          disabled={readOnly}
          // A monospace font can draw "//" as a ligature that reads "/ /".
          className="[font-variant-ligatures:none]"
          onChange={(event) => setEndpoint(event.target.value)}
          onBlur={() => setEndpointTouched(true)}
          error={urlKeys.length > 0 || endpointTouched ? (endpointError ?? undefined) : undefined}
          // A public API that needs a fixed query (?current=...) has no other place for it (onboarding wave item 4).
          hint={[
            initialEndpoint && !binding && endpoint === initialEndpoint
              ? initialEndpointSource === "try"
                ? "Filled in from the call you tried for this tool, path included."
                : "Filled in from your account setup. Change it if this tool is served elsewhere."
              : null,
            "Put fixed query parameters in the address, like ?units=metric; the tool's inputs are added to them.",
          ]
            .filter(Boolean)
            .join(" ")}
        />
        {pathWarning ? (
          <p className="text-body-xs text-warning-700" data-testid="endpoint-path-warning">
            {pathWarning}
          </p>
        ) : null}
        {urlKeys.length > 0 && !readOnly ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="self-start"
            onClick={() => {
              const moved = moveQueryKeys(endpoint);
              if (!moved) return;
              setEndpoint(moved.endpoint);
              setAuthMode((current) => (current === "SIGNATURE" || current === "BOTH" ? "BOTH" : "API_KEY"));
              setPendingHeaders(moved.headers);
            }}
          >
            Move it to an API key header
          </Button>
        ) : null}
      </div>

      <div className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-01 p-4">
        <h3 className="text-label-sm text-01">Authentication</h3>
        <AuthenticationPanel
          bindingId={binding?.id ?? null}
          endpoint={endpoint}
          savedEndpoint={binding?.endpoint ?? null}
          publishedEndpoint={binding?.publishedEndpoint ?? null}
          mode={authMode}
          onModeChange={setAuthMode}
          readOnly={readOnly}
          onSaveConnection={() => void saveOnly()}
          savingConnection={phase === "saving-only"}
          pendingHeaders={pendingHeaders}
          onPendingDone={() => setPendingHeaders(null)}
        />
      </div>

      <div className="flex w-full flex-col gap-3 rounded-lg border border-01 bg-01 p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-label-sm text-01">How we call your API</h3>
          <p className="text-body-13 text-02">{requestMappingSummary(mappings.request)}</p>
          <p className="text-body-13 text-02">{responseMappingSummary(mappings.response)}</p>
          {preview ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body-xs text-03">The request for your test input below:</span>
              <code className="break-all font-mono text-mono-xs text-01 [font-variant-ligatures:none]">{preview}</code>
            </div>
          ) : null}
          <p className="text-body-xs text-03">
            We filled this in from the tool&apos;s fields. If your API answers with other names, run the test below and click the
            values in its answer. Advanced mapping is there for anything else.
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
              key={`response:${tool.id}:${picks}`}
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

      {versioned ? (
        <ContractTermsPanel
          choices={choices}
          terms={terms}
          changed={termsDirty}
          disabled={readOnly}
          onChange={(next) => {
            setTerms(next);
            setProblems(null);
          }}
        />
      ) : null}

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
            disabled={!hydrated || readOnly || phase !== "idle" || urlKeys.length > 0 || credentialsMissing}
            loading={phase === "saving" || phase === "testing"}
          >
            {phase === "saving"
              ? binding
                ? "Saving your changes…"
                : "Saving your draft…"
              : phase === "testing"
                ? testingMajor !== null && multi
                  ? `Testing v${testingMajor}…`
                  : "Calling your API…"
                : report
                  ? "Run the test again"
                  : "Save and run test"}
          </Button>
          <span aria-live="polite" className="text-body-xs text-03">
            {phase === "saving" && !binding ? "Creating your draft listing takes a few seconds." : null}
            {readOnly ? "Your account is blocked, so changes are paused." : null}
            {!readOnly ? (authMode === null ? "Choose an option under Authentication first." : credentialsHint) : null}
          </span>
        </div>
        {error ? (
          <p role="alert" className="text-body-13 text-danger-600">
            {error}
          </p>
        ) : null}
        {problems ? (
          <div role="alert" className="flex flex-col gap-1 rounded-md border border-danger-20 bg-danger-10 px-3 py-2">
            <p className="text-label-13 text-danger-600">This doesn&apos;t fit the tool&apos;s contract yet:</p>
            <ul className="flex list-disc flex-col gap-0.5 pl-5 text-body-13 text-danger-600">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {runs && runs.length > 0 ? (
          <div className="flex flex-col gap-4">
            {runs.map((r) => (
              <div key={r.major} className="flex flex-col gap-2">
                {versioned ? (
                  <h4 className="flex flex-wrap items-baseline gap-x-2 text-label-13 text-01">
                    {runLabel(r.major, r.report, r.semver)}
                    {stale ? (
                      <span className="text-body-xs text-warning-700">Out of date: run the test again</span>
                    ) : (
                      <span className={r.report.outcome === "PASSED" ? "text-body-xs text-success-700" : "text-body-xs text-danger-600"}>
                        {r.report.outcome === "PASSED" ? "Passed" : "Failed"}
                      </span>
                    )}
                  </h4>
                ) : null}
                <TestPipelineView report={r.report} stale={Boolean(stale)} paid={binding ? binding.pricingMode !== "FREE" : false} />
              </div>
            ))}
          </div>
        ) : testPassedBefore && !dirty ? (
          <p className="text-body-13 text-success-700">Your last test passed. Run it again any time.</p>
        ) : null}

        {answer !== null && canPickInto(mappings.response) ? (
          <ResponsePicker
            answer={answer}
            fields={outputFields}
            mapping={mappings.response}
            disabled={readOnly || phase !== "idle"}
            onPick={pickResponse}
          />
        ) : null}
      </div>

      {gate?.needsEmptyAck ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-3">
          <p className="text-body-13 text-warning-700">
            Your API answered, but the result was empty, so none of our checks ran. This test does not show that real
            calls will pass. Try an input that returns data, or continue knowing that.
          </p>
          <Checkbox
            checked={emptyAck}
            onChange={(event) => setEmptyAck(event.target.checked)}
            label="I understand this test proved nothing about whether real calls pass our checks."
            className="items-start [&>span:first-of-type]:mt-px"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onContinue} disabled={!passed}>
          Continue to Go live
          <ArrowRight aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!hydrated || readOnly || phase !== "idle"}
          loading={phase === "exiting"}
          onClick={() => (binding && !dirty ? router.push(LISTINGS_PATH) : void saveOnly(() => router.push(LISTINGS_PATH)))}
        >
          Save draft and exit
        </Button>
        {!passed ? (
          <span className="text-body-xs text-03">
            {gate?.needsEmptyAck
              ? "Tick the box above, or run a test that returns data."
              : report && !stale
              ? multi
                ? "Every version you serve needs a passing test to continue."
                : "Get a passing test to continue."
              : "Run a test to continue. Your draft is saved when you do."}
          </span>
        ) : null}
      </div>
    </section>
  );
}
