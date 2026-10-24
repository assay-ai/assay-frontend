import { ApiError } from "@/libs/ApiClient";
import { plainApiError, plainError } from "@/libs/plain-language";
import type { ProviderToolTryResult, TryProviderToolBody } from "@/services/provider-tools.service";

/**
 * "Paste a curl or OpenAPI and try it", the rules the panel shows. Pure.
 * A try is a test run: nothing is saved, so its refusals never say "saved".
 */

/** A try run's warnings, in words; an unknown code falls back to the server's own detail. */
export const WARNING_TEXT: Readonly<Record<string, string>> = {
  CREDENTIAL_DETECTED: "A key or token was in what you pasted. It was used for this one test only, never stored, and not put in the schemas: add it to the listing's Authentication later.",
  OPTION_IGNORED: "Some curl options were ignored; only the method, the URL, headers and a JSON body are used.",
  MISSING_TEST_VALUES: "Some inputs had no example or default, so the test filled them with placeholders. Check the answer makes sense.",
  AUTH_REQUIRED: "Your endpoint asked for authentication. Paste the curl with its header, or, for an OpenAPI document, add the header below and try again.",
  NOT_SUPPORTED: "Part of the document can't be used yet (only GET or POST with a JSON body).",
  NO_JSON_RESPONSE: "The answer was not JSON, so what it returns could not be worked out. Describe the outputs below.",
  EXAMPLE_TOO_LARGE: "The answer was too large to keep as an example; the schema was still worked out from it.",
  UNSIGNED_FOREIGN_ORIGIN: "This address is not one of your listings' endpoints, so the test went without Assay's request signature. An endpoint that checks the signature refuses it; save a listing with this endpoint to test it signed.",
};

export function warningText(warning: { code: string; detail: string }): string {
  return WARNING_TEXT[warning.code] ?? warning.detail;
}

export interface TryErrorView {
  text: string;
  /** What was wrong, one sentence each. */
  problems: string[];
  /** An OpenAPI document with several operations: the ids to pick from. */
  operations: string[];
}

function sentence(problem: string): string {
  const text = problem.trim();
  if (!text) return text;
  const first = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}

/** The ids after "there are:" in the server's "name the operation to try" problem; only real operationIds can be resent. */
export function operationsIn(problems: readonly string[]): string[] {
  for (const problem of problems) {
    const listed = /there are: (.+)$/.exec(problem)?.[1];
    if (listed) return listed.split(", ").map((id) => id.trim()).filter((id) => /^[A-Za-z0-9_.-]+$/.test(id));
  }
  return [];
}

export function tryErrorView(error: unknown): TryErrorView {
  if (!(error instanceof ApiError)) return { text: error instanceof Error ? error.message : "The test could not run. Try again.", problems: [], operations: [] };
  const raw = Array.isArray(error.context?.problems) ? (error.context.problems as unknown[]).filter((p): p is string => typeof p === "string") : [];
  switch (error.code) {
    case "TOOL_PROVIDER_TOOL_INVALID": {
      const operations = operationsIn(raw);
      return {
        text: operations.length > 0 ? "The document has more than one operation. Pick the one to try:" : "The test could not run:",
        problems: operations.length > 0 ? [] : raw.map(sentence),
        operations,
      };
    }
    case "TOOL_PROVIDER_TOOL_NOT_ALLOWED":
      return { text: "Register as a provider before trying an endpoint.", problems: [], operations: [] };
    case "PAYLOAD_TOO_LARGE":
      // BUG-PRV-SETUP-01: the API answers an oversized paste 413 now, not 500.
      return { text: "This is too large to try. Paste a shorter command or document, or only the operation you want to list.", problems: [], operations: [] };
    case "PROVIDER_EGRESS_RATE_LIMITED":
      return { text: "Too many test runs in a short time. Wait a minute and try again.", problems: [], operations: [] };
    default:
      return { text: plainApiError(error), problems: raw.map(sentence), operations: [] };
  }
}

/** Whether pasted text looks like it carries a credential (an Authorization or API key header, a bearer token). */
export function looksLikeCredential(text: string): boolean {
  return /authorization\s*:|x-api-key|api[-_]?key\s*[:=]|bearer\s+[A-Za-z0-9._~+/-]{8,}/i.test(text);
}

/** "Name: value" lines as headers; lines that are not a header are skipped. */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (/^[A-Za-z0-9-]+$/.test(name) && value) headers[name] = value;
  }
  return headers;
}

/** The request body: a curl command, or an OpenAPI document with the operation picked and test-only headers. */
export function tryBody(text: string, options: { operationId?: string | null; headers?: string } = {}): TryProviderToolBody {
  const value = text.trim();
  if (/^curl\s/i.test(value)) return { curl: value };
  const headers = options.headers ? parseHeaderLines(options.headers) : {};
  return {
    openapi: value,
    ...(options.operationId ? { operationId: options.operationId } : {}),
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
  };
}

export function isCurl(text: string): boolean {
  return /^curl\s/i.test(text.trim());
}

/** The result's first line, in words. */
export function resultLine(result: ProviderToolTryResult): string {
  const upstream = result.upstream;
  if (!result.ran) return "It could not be called.";
  if (upstream?.transportError) return `No answer: ${upstream.transportError.kind.toLowerCase().replace(/_/g, " ")}.`;
  return `${result.request.method} ${result.request.url} answered ${upstream?.status ?? "?"} in ${upstream?.latencyMs ?? "?"} ms.`;
}

/** The headers named in a result: the names only (values are never echoed back). */
export function headerNamesLine(result: ProviderToolTryResult): string | null {
  return result.request.headerNames.length > 0 ? `Sent with the headers ${result.request.headerNames.join(", ")} (values not shown).` : null;
}
