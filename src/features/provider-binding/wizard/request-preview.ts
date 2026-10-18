import type { ToolMapping } from "@/interfaces";

/**
 * "The request for this test input", updated as the provider types: the
 * method and URL a test would send, built from the address, the request
 * mapping and the test input the way the backend joins them (address without
 * its trailing "/", then the path when there is one, then the query).
 *
 * A preview only. The raw exchange of a real test shows what was sent. A
 * value the mapping transforms is shown as "…"; a required value the input
 * lacks as "(missing)"; an optional one the input lacks is left out, as the
 * mapping leaves it out.
 */

type Value = { text: string } | { missing: true } | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `$.vsCurrency` → `vsCurrency`; null for a deeper or wildcard selector. */
function topField(selector: string): string | null {
  const match = selector.match(/^\$\.([A-Za-z0-9_-]+)$/);
  return match?.[1] ?? null;
}

function valueOf(node: unknown, args: Readonly<Record<string, string>>): Value {
  if (typeof node === "string") return valueOf({ $path: node }, args);
  if (!isRecord(node)) return { text: "…" };
  if ("$const" in node) return { text: typeof node.$const === "string" ? node.$const : JSON.stringify(node.$const) };
  if (typeof node.$path !== "string") return { text: "…" };
  const field = topField(node.$path);
  const transformed = Array.isArray(node.$transform) ? node.$transform.length > 0 : node.$transform !== undefined;
  if (!field) return { text: "…" };
  const typed = (args[field] ?? "").trim();
  if (typed !== "") return transformed ? { text: "…" } : { text: typed };
  if (node.$default !== undefined) return { text: typeof node.$default === "string" ? node.$default : JSON.stringify(node.$default) };
  return node.$optional === true ? null : { missing: true };
}

function render(value: Exclude<Value, null>): string {
  return "missing" in value ? "(missing)" : encodeURIComponent(value.text);
}

export function previewRequest(
  endpoint: string,
  mapping: ToolMapping,
  args: Readonly<Record<string, string>>,
): string | null {
  let base: URL;
  try {
    base = new URL(endpoint.trim());
  } catch {
    return null;
  }
  if (base.protocol !== "http:" && base.protocol !== "https:") return null;

  const method = typeof mapping.method === "string" ? mapping.method.toUpperCase() : "GET";
  const template = typeof mapping.path === "string" ? mapping.path : "";
  const path = template
    ? `/${template.replace(/^\/+/, "")}`.replace(/\{(\$[^}]*)\}/g, (_, selector: string) => {
        const value = valueOf({ $path: selector }, args);
        return value === null ? "(missing)" : render(value);
      })
    : "";

  const query = base.search.replace(/^\?/, "").split("&").filter(Boolean);
  if (isRecord(mapping.query)) {
    for (const [name, node] of Object.entries(mapping.query)) {
      const value = valueOf(node, args);
      if (value !== null) query.push(`${encodeURIComponent(name)}=${render(value)}`);
    }
  }

  const address = `${base.origin}${base.pathname}`.replace(/\/+$/, "");
  return `${method} ${address}${path}${query.length > 0 ? `?${query.join("&")}` : ""}`;
}
