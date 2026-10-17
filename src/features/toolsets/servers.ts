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
      return { title: `${server.name}${free}`, detail: parsed.choice.version ? `Your tool set · locked to v${parsed.choice.version}` : "Your tool set · live Draft" };
    case "tools": {
      const n = parsed.choice.tools.length;
      return { title: `${n} chosen tool${n === 1 ? "" : "s"}${free}`, detail: parsed.choice.tools.join(", ") };
    }
    case "topic":
      return { title: `Topic: ${parsed.choice.category}${free}`, detail: "Every tool in one topic" };
    case "maker":
      return { title: `@${parsed.choice.handle}${free}`, detail: "One maker's tools" };
    case "shared":
      return {
        title: `${server.name}${free}`,
        detail: `@${parsed.choice.handle}/${parsed.choice.slug} · ${parsed.choice.version ? `locked to v${parsed.choice.version}` : "always latest"}`,
      };
    case "link":
      return { title: `${server.name}${free}`, detail: `Shared by link · ${parsed.choice.version ? `locked to v${parsed.choice.version}` : "always latest"}` };
    default:
      return { title: `${server.name}${free}`, detail: null };
  }
}

/** Shows every tool (not search): only these count toward the 25-tool budget. */
export function showsEveryTool(server: Pick<ServerInUse, "available" | "discovery">): boolean {
  return server.available && server.discovery !== "SEARCH";
}

/**
 * The server to switch to search first when over budget: the biggest one that
 * shows every tool, preferring one the server offered a search URL for.
 */
export function biggestServer(servers: readonly ServerInUse[]): ServerInUse | null {
  const full = servers.filter(showsEveryTool).sort((a, b) => (b.toolCount ?? 0) - (a.toolCount ?? 0));
  return full.find((s) => s.searchUrl) ?? full[0] ?? null;
}

/** The tools shown in full across the servers that show every tool — the over-budget count. */
export function toolsShown(servers: readonly ServerInUse[]): number {
  return servers.filter(showsEveryTool).reduce((sum, s) => sum + (s.toolCount ?? 0), 0);
}

/** The version a server's URL is locked to, and the tool set it serves, for "Update available". */
export function lockedVersionOf(server: Pick<ServerInUse, "canonicalUrl">): number | null {
  const origin = server.canonicalUrl.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#]+).*$/i, "$1");
  const parsed = parseMcpUrl(server.canonicalUrl, origin);
  const choice = parsed?.choice;
  return choice && (choice.kind === "shared" || choice.kind === "link" || choice.kind === "toolset") ? (choice.version ?? null) : null;
}
