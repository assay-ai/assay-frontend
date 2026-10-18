import type {
  BindingTestLayer,
  BindingTestLayerResult,
  BindingTestReport,
  VerificationRuleResult,
} from "@/interfaces";
import { plainRule } from "@/libs/plain-language";

/**
 * A tester report as the four steps a provider can reason about, each passed
 * or failed, and — when one fails — whose fix it is, in their words:
 *
 *   1 Request built      → "your test input" or the mapping
 *   2 Your API answered  → "your API"; "the address or path" for a 404;
 *                          "Authentication" for a 401/403 or missing key headers;
 *                          "your test input" for another 4xx; "Assay, not you"
 *                          only when Assay could not prepare the call
 *   3 Output mapped      → the mapping
 *   4 Checks             → "your API's data"
 *
 * In this wizard the mapping is the provider's own (they can change it under
 * Advanced mapping), so a `PLATFORM` fault at steps 1 and 3 — the backend's
 * "our mapping" — is theirs to fix, never "Assay, not you".
 *
 * The backend reports five layers (REQUEST_MAPPING, UPSTREAM, CLASSIFICATION,
 * RESPONSE_MAPPING, VERIFICATION); UPSTREAM and CLASSIFICATION are one step
 * to a provider ("did my API answer usefully"). A layer's `AGENT` fault wins
 * over the per-step default.
 *
 * Each step leads with a plain sentence; the backend's own text, when it
 * differs, is kept as `details` for a "Details" disclosure, with the listing
 * id taken out.
 */

export type PipelineStepId = "request" | "api" | "mapped" | "checks";
export type PipelineStatus = "pass" | "fail" | "warn" | "skipped";
export const MAPPING_FAULT = "the mapping (yours; Advanced mapping)";

export type PipelineFault =
  | "your test input"
  | "your API"
  | typeof MAPPING_FAULT
  | "your API's data"
  | "the address or path"
  | "Authentication"
  | "Assay, not you";

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  status: PipelineStatus;
  /** One sentence: what happened at this step. */
  sentence: string;
  /** Set on a failed step. */
  fault: PipelineFault | null;
  /** The backend's own text, for "Details", when it says more than the sentence. */
  details: string | null;
}

export interface TestPipeline {
  steps: PipelineStep[];
  passed: boolean;
  /** The mapped result held nothing, so every check was skipped: a pass that proves nothing. */
  emptyResult: boolean;
  /** The first failed step, for the headline. */
  failed: PipelineStep | null;
}

const LABELS: Record<PipelineStepId, string> = {
  request: "Request built",
  api: "Your API answered",
  mapped: "Output mapped",
  checks: "Checks",
};

function layer(report: BindingTestReport, which: BindingTestLayer): BindingTestLayerResult | undefined {
  return report.layers.find((entry) => entry.layer === which);
}

function statusOf(result: BindingTestLayerResult | undefined): PipelineStatus {
  if (!result) return "skipped";
  switch (result.status) {
    case "PASSED":
      return "pass";
    case "FAILED":
      return "fail";
    case "INCONCLUSIVE":
      return "warn";
    default:
      return "skipped";
  }
}

/** The layer's `AGENT` fault wins; anything else (PLATFORM included) is the step's own default. */
function faultOf(result: BindingTestLayerResult | undefined, fallback: PipelineFault): PipelineFault {
  if (result?.fault === "AGENT") return "your test input";
  return fallback;
}

/** The backend's detail without the listing id it appends ("… for binding: <uuid>"). */
function rawDetail(result: BindingTestLayerResult | undefined): string | null {
  const text = result?.detail?.replace(/\s*for binding:\s*\S+\s*$/i, "").trim();
  return text ? text : null;
}

/** `$.vsCurrency` → `vsCurrency`, `$.data.answer` → `data.answer`, from a mapping error's detail. */
function selectorField(detail: string | null): string | null {
  const match = detail?.match(/:\s*\$\.?([A-Za-z0-9_.[\]-]+)/);
  return match?.[1] ?? null;
}

/** `/markets` → `markets`, `/data/0/price` → `data.0.price`. */
function pointerField(pointer: string | undefined): string | null {
  const field = pointer?.replace(/^\//, "").replace(/\//g, ".");
  return field ? field : null;
}

/** A plain sentence for a mapping failure at step 1 or 3, from its code and detail. */
function mappingSentence(step: "request" | "mapped", code: string | null, detail: string | null): string | null {
  switch (code) {
    case "TOOL_MAPPING_PATH_NOT_FOUND": {
      const field = selectorField(detail);
      if (!field) return null;
      return step === "request"
        ? `Your test input has no “${field}”, and the request needs it. Fill it in, or tick “may be missing” for it under Advanced mapping.`
        : `Your answer has no “${field}” field. Change your API, or map another field under Advanced mapping.`;
    }
    case "TOOL_MAPPING_TYPE_MISMATCH": {
      const match = detail?.match(/at (\S+?)(?::\s*expected ([^,]+))?(?:,\s*got (.+))?$/);
      const field = pointerField(match?.[1]);
      if (!field) return null;
      return match?.[2] && match[3]
        ? `“${field}” has the wrong type: the tool expects ${match[2]}, ${step === "request" ? "your test input" : "your answer"} gave ${match[3]}.`
        : `“${field}” has the wrong type for the tool.`;
    }
    case "TOOL_MAPPING_NULL_VALUE":
      return step === "request"
        ? "Your test input left a value empty that the request needs."
        : "A value the tool needs is empty (null) in your answer.";
    case "TOOL_MAPPING_REQUIRED_FIELD_MISSING":
      return step === "request"
        ? "Your test input is missing a value the request needs."
        : "The result is missing a field the tool requires.";
    case "TOOL_MAPPING_EMPTY_COLLECTION":
      return "A list in your answer is empty where the tool needs at least one item.";
    case "TOOL_MAPPING_TRANSFORM_FAILED":
      return "A conversion step in the mapping failed on this value.";
    case "body_not_json":
      return "Your API's answer was not JSON, so there is nothing to map.";
    default:
      return null;
  }
}

/** The details line: the backend's text, unless the sentence already is that text. */
function detailsBeside(sentence: string, detail: string | null): string | null {
  return detail && detail !== sentence ? detail : null;
}

function hostAndPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

/** True when the mapped output carries no data at all: null, {}, [] or only empty values. */
export function isEmptyResult(mapped: unknown): boolean {
  if (mapped === null || mapped === undefined) return true;
  if (typeof mapped === "string") return mapped.trim() === "";
  if (Array.isArray(mapped)) return mapped.length === 0;
  if (typeof mapped === "object") {
    const values = Object.values(mapped as Record<string, unknown>);
    return values.length === 0 || values.every((value) => isEmptyResult(value));
  }
  return false;
}

function failingRules(report: BindingTestReport): VerificationRuleResult[] {
  return (report.verification?.stages ?? []).flatMap((stage) => stage.rules ?? []).filter((rule) => rule.outcome === "FAILED");
}

function rulesAllSkipped(report: BindingTestReport): boolean {
  const rules = (report.verification?.stages ?? []).flatMap((stage) => stage.rules ?? []);
  return rules.length > 0 && rules.every((rule) => rule.outcome === "NOT_APPLICABLE" || rule.outcome === "EMPTY_COLLECTION");
}

export function testPipeline(report: BindingTestReport): TestPipeline {
  const requestLayer = layer(report, "REQUEST_MAPPING");
  const upstreamLayer = layer(report, "UPSTREAM");
  const classLayer = layer(report, "CLASSIFICATION");
  const responseLayer = layer(report, "RESPONSE_MAPPING");
  const verifyLayer = layer(report, "VERIFICATION");

  // 1. Request built
  const requestStatus = statusOf(requestLayer);
  const inputProblem = /NULL_VALUE|INPUT|ARGUMENT|MISSING/i.test(requestLayer?.code ?? "");
  const requestDetail = rawDetail(requestLayer);
  const requestSentence =
    requestStatus === "fail"
      ? (mappingSentence("request", requestLayer?.code ?? null, requestDetail) ??
        (inputProblem
          ? "Your test input is missing a value the request needs."
          : "The request mapping could not build a call from your test input."))
      : report.request
        ? `${report.request.method} ${hostAndPath(report.request.url)}`
        : "Not run.";
  const request: PipelineStep = {
    id: "request",
    label: LABELS.request,
    status: requestStatus,
    sentence: requestSentence,
    fault: requestStatus === "fail" ? faultOf(requestLayer, inputProblem ? "your test input" : MAPPING_FAULT) : null,
    details: requestStatus === "fail" ? detailsBeside(requestSentence, requestDetail) : null,
  };

  // 2. Your API answered (transport + classification)
  const upstreamStatus = statusOf(upstreamLayer);
  const classStatus = statusOf(classLayer);
  const apiStatus: PipelineStatus =
    upstreamStatus === "fail" || classStatus === "fail"
      ? "fail"
      : upstreamStatus === "skipped"
        ? "skipped"
        : upstreamStatus === "warn" || classStatus === "warn"
          ? "warn"
          : "pass";
  const upstream = report.upstream;
  const requestError = report.classification?.responseClass === "REQUEST_ERROR";
  const httpStatus = upstream?.status ?? 0;
  const apiLayer = upstreamStatus === "fail" ? upstreamLayer : classLayer;
  const apiDetail = rawDetail(apiLayer);
  let apiSentence: string;
  let apiFault: PipelineFault = "your API";
  if (apiStatus === "skipped") apiSentence = "Not reached.";
  else if (upstream?.transportError?.kind === "PLATFORM_UNAVAILABLE") {
    // The invoker refused to dial: Assay's side, or the key headers this mode needs.
    if (/credentials missing/i.test(upstream.transportError.detail ?? "")) {
      apiSentence = "Add your API key headers under Authentication first. Your API wasn't called.";
      apiFault = "Authentication";
    } else {
      apiSentence = "Assay could not prepare the call (key storage or signing). Your API wasn't called. Try again in a minute.";
      apiFault = "Assay, not you";
    }
  } else if (upstream?.transportError) {
    apiSentence = `Could not reach your API${upstream.transportError.detail ? `: ${upstream.transportError.detail}` : "."}`;
  } else if (apiStatus === "fail" && (httpStatus === 404 || httpStatus === 410)) {
    apiSentence = `Your API answered HTTP ${httpStatus}: nothing at this address. Check the address, and the path under Advanced mapping.`;
    apiFault = "the address or path";
  } else if (apiStatus === "fail" && (httpStatus === 401 || httpStatus === 403)) {
    apiSentence = `Your API refused the call (HTTP ${httpStatus}). Check the Authentication choice and your API key headers.`;
    apiFault = "Authentication";
  } else if (apiStatus === "fail" && requestError) {
    apiSentence = `Your API said the request was invalid (HTTP ${httpStatus || "error"}). Check the test input.`;
    apiFault = "your test input";
  } else if (apiStatus === "fail") {
    apiSentence = httpStatus
      ? `Your API answered HTTP ${httpStatus} with no usable result.`
      : (apiDetail ?? "Your API gave no usable result.");
  } else {
    apiSentence = upstream ? `HTTP ${upstream.status} in ${upstream.latencyMs} ms.` : "Answered.";
  }
  const api: PipelineStep = {
    id: "api",
    label: LABELS.api,
    status: apiStatus,
    sentence: apiSentence,
    fault: apiStatus === "fail" ? faultOf(apiLayer, apiFault) : null,
    details: apiStatus === "fail" ? detailsBeside(apiSentence, apiDetail) : null,
  };

  // 3. Output mapped
  const mappedStatus = statusOf(responseLayer);
  const emptyResult = mappedStatus === "pass" && (isEmptyResult(report.mapped) || rulesAllSkipped(report));
  const fieldCount =
    report.mapped && typeof report.mapped === "object" && !Array.isArray(report.mapped)
      ? Object.keys(report.mapped as Record<string, unknown>).length
      : null;
  const mapped: PipelineStep = {
    id: "mapped",
    label: LABELS.mapped,
    status: emptyResult ? "warn" : mappedStatus,
    sentence:
      mappedStatus === "fail"
        ? (mappingSentence("mapped", responseLayer?.code ?? null, rawDetail(responseLayer)) ??
          rawDetail(responseLayer) ??
          "The response mapping could not read your API's answer.")
        : mappedStatus === "skipped"
          ? "Not reached."
          : emptyResult
            ? "The result is empty, so there was nothing to check."
            : fieldCount !== null
              ? `${fieldCount} field${fieldCount === 1 ? "" : "s"} filled.`
              : "Result read.",
    fault: mappedStatus === "fail" ? faultOf(responseLayer, MAPPING_FAULT) : null,
    details: null,
  };
  if (mappedStatus === "fail") mapped.details = detailsBeside(mapped.sentence, rawDetail(responseLayer));

  // 4. Checks
  const verifyStatus = statusOf(verifyLayer);
  const failing = failingRules(report);
  const checks: PipelineStep = {
    id: "checks",
    label: LABELS.checks,
    status: emptyResult && verifyStatus === "pass" ? "warn" : verifyStatus,
    sentence:
      verifyStatus === "fail"
        ? failing.length > 0
          ? `Failed: ${failing.map((rule) => plainRule(rule.type)).join("; ")}.`
          : (rawDetail(verifyLayer) ?? "The result did not pass the checks.")
        : verifyStatus === "skipped"
          ? "Not reached."
          : emptyResult
            ? "Empty result: all checks skipped."
            : verifyStatus === "warn"
              ? "The checks reached no decision."
              : "All checks passed.",
    fault: verifyStatus === "fail" ? faultOf(verifyLayer, "your API's data") : null,
    details: null,
  };

  const steps = [request, api, mapped, checks];
  return {
    steps,
    passed: report.outcome === "PASSED",
    emptyResult,
    failed: steps.find((step) => step.status === "fail") ?? null,
  };
}

/**
 * Whether a run lets the provider continue to Go live. A run whose result was
 * empty "passes" on the wire (every check was skipped) but proves nothing, so
 * it counts only once the provider says, in so many words, that they know
 * (provider review 2026-10-16b). A stale run never counts.
 */
export function testGate(
  pipeline: Pick<TestPipeline, "passed" | "emptyResult">,
  options: { stale: boolean; emptyAcknowledged: boolean },
): { passed: boolean; needsEmptyAck: boolean } {
  const needsEmptyAck = pipeline.passed && pipeline.emptyResult && !options.stale;
  return {
    passed: pipeline.passed && !options.stale && (!pipeline.emptyResult || options.emptyAcknowledged),
    needsEmptyAck,
  };
}
