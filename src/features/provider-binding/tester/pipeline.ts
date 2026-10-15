import type {
  BindingTestLayer,
  BindingTestLayerResult,
  BindingTestReport,
  VerificationRuleResult,
} from "@/interfaces";
import { plainError, plainRule } from "@/libs/plain-language";

/**
 * A tester report as the four steps a provider can reason about, each passed
 * or failed, and — when one fails — whose fault it is in their words:
 *
 *   1 Request built      → "your test input" or "the mapping"
 *   2 Your API answered  → "your API" (or "your test input" when the API said the input was bad)
 *   3 Output mapped      → "the mapping"
 *   4 Checks             → "your API's data"
 *
 * The backend reports five layers (REQUEST_MAPPING, UPSTREAM, CLASSIFICATION,
 * RESPONSE_MAPPING, VERIFICATION); UPSTREAM and CLASSIFICATION are one step
 * to a provider ("did my API answer usefully"). The layer's own `fault`
 * (AGENT | PROVIDER | PLATFORM) wins over the per-step default when present.
 */

export type PipelineStepId = "request" | "api" | "mapped" | "checks";
export type PipelineStatus = "pass" | "fail" | "warn" | "skipped";
export type PipelineFault = "your test input" | "your API" | "the mapping" | "your API's data" | "Assay, not you";

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  status: PipelineStatus;
  /** One sentence: what happened at this step. */
  sentence: string;
  /** Set on a failed step. */
  fault: PipelineFault | null;
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

function faultOf(result: BindingTestLayerResult | undefined, fallback: PipelineFault): PipelineFault {
  if (result?.fault === "AGENT") return "your test input";
  if (result?.fault === "PLATFORM") return "Assay, not you";
  return fallback;
}

function detailSentence(result: BindingTestLayerResult | undefined): string | null {
  if (!result) return null;
  if (result.detail && result.detail.trim()) return result.detail.trim();
  if (result.code) return plainError(result.code);
  return null;
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
  const request: PipelineStep = {
    id: "request",
    label: LABELS.request,
    status: requestStatus,
    sentence:
      requestStatus === "fail"
        ? (detailSentence(requestLayer) ??
          (inputProblem
            ? "Your test input is missing a value the request needs."
            : "The request mapping could not build a call from your test input."))
        : report.request
          ? `${report.request.method} ${hostAndPath(report.request.url)}`
          : "Not run.",
    fault: requestStatus === "fail" ? faultOf(requestLayer, inputProblem ? "your test input" : "the mapping") : null,
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
  let apiSentence: string;
  if (apiStatus === "skipped") apiSentence = "Not reached.";
  else if (upstream?.transportError) {
    apiSentence = `Could not reach your API${upstream.transportError.detail ? `: ${upstream.transportError.detail}` : "."}`;
  } else if (apiStatus === "fail" && requestError) {
    apiSentence = `Your API said the request was invalid (HTTP ${upstream?.status ?? "error"}). Check the test input.`;
  } else if (apiStatus === "fail") {
    apiSentence =
      detailSentence(upstreamStatus === "fail" ? upstreamLayer : classLayer) ??
      `Your API answered HTTP ${upstream?.status ?? "error"} with no usable result.`;
  } else {
    apiSentence = upstream ? `HTTP ${upstream.status} in ${upstream.latencyMs} ms.` : "Answered.";
  }
  const api: PipelineStep = {
    id: "api",
    label: LABELS.api,
    status: apiStatus,
    sentence: apiSentence,
    fault:
      apiStatus === "fail"
        ? faultOf(upstreamStatus === "fail" ? upstreamLayer : classLayer, requestError ? "your test input" : "your API")
        : null,
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
        ? (detailSentence(responseLayer) ?? "The response mapping could not read your API's answer.")
        : mappedStatus === "skipped"
          ? "Not reached."
          : emptyResult
            ? "The result is empty, so there was nothing to check."
            : fieldCount !== null
              ? `${fieldCount} field${fieldCount === 1 ? "" : "s"} filled.`
              : "Result read.",
    fault: mappedStatus === "fail" ? faultOf(responseLayer, "the mapping") : null,
  };

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
          : (detailSentence(verifyLayer) ?? "The result did not pass the checks.")
        : verifyStatus === "skipped"
          ? "Not reached."
          : emptyResult
            ? "Empty result: all checks skipped."
            : verifyStatus === "warn"
              ? "The checks reached no decision."
              : "All checks passed.",
    fault: verifyStatus === "fail" ? faultOf(verifyLayer, "your API's data") : null,
  };

  const steps = [request, api, mapped, checks];
  return {
    steps,
    passed: report.outcome === "PASSED",
    emptyResult,
    failed: steps.find((step) => step.status === "fail") ?? null,
  };
}
