import { parseMcpUrl } from "@/features/connect/mcp-url";
import type { ServerInUse } from "@/services/toolsets.service";

/**
 * A server row named by what it serves, not by the short name a client
 * gave it: "Everything", the tool set's name, or "2 chosen tools". The name
 * the app knows it by is said separately ("In your app: weather").
 */
export function serverLabel(server: Pick<ServerInUse, "canonicalUrl" | "name" | "toolsetId">): { title: string; detail: string | null } {
  const origin = server.canonicalUrl.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]+).*$/i, "$1");
  const parsed = parseMcpUrl(server.canonicalUrl, origin);
  const free = parsed?.options.free ? " · free tools only" : "";
  if (!parsed) return { title: server.name, detail: null };
  switch (parsed.choice.kind) {
    case "everything":
      return { title: `Everything${free}`, detail: "Every tool on Assay" };
    case "toolset":
      return { title: `${server.name}${free}`, detail: "Tool set" };
    case "tools": {
      const n = parsed.choice.tools.length;
      return { title: `${n} chosen tool${n === 1 ? "" : "s"}${free}`, detail: parsed.choice.tools.join(", ") };
    }
    default:
      return { title: `${server.name}${free}`, detail: null };
  }
}

/** The server that shows the most tools: the one to narrow first when over budget. */
export function biggestServer(servers: readonly ServerInUse[]): ServerInUse | null {
  return [...servers].filter((s) => s.available).sort((a, b) => (b.toolCount ?? 0) - (a.toolCount ?? 0))[0] ?? null;
}

/** The tools shown in full across the servers — the over-budget count, from the same rows the table shows. */
export function toolsShown(servers: readonly ServerInUse[]): number {
  return servers.filter((s) => s.available).reduce((sum, s) => sum + (s.toolCount ?? 0), 0);
}
