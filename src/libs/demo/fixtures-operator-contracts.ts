import type { ContractShape } from "@/features/contracts/diff";
import type { OperatorApproval } from "@/interfaces/operator";

import type { DemoFixture } from "./fixtures";
import {
  demoCatalogueRefs as demoCatalogueToolRefs,
  demoNextDraftVersion,
  demoOperatorTool,
  demoOperatorToolList,
  TIDES_REQUEST_ID,
  TIDES_TOOL_ID,
} from "./fixtures-contracts";

/**
 * The operator contract editor's endpoints — DEMO ONLY (T3). The data is
 * `fixtures-contracts.ts`; this file answers the routes and remembers, for the
 * tab, what the operator did: a saved or discarded draft, a deprecation, a
 * tool created (new, or from a tool request), and what an approval ran.
 * Publish and "Make current" are queued for a second operator through the
 * console's own approvals (`queue`), exactly as the API answers a 202.
 */

type Draft = ContractShape & { version: number; changelog: string | null; updatedAt: string };

interface ContractMemory {
  drafts: [string, Draft | null][];
  baseVersions: [string, number][];
  deprecated: [string, { version: number; sunsetAt: string; replacementToolId: string | null }][];
  published: string[];
  current: [string, number][];
  created: [string, { name: string; category: string }][];
  /** Tool requests answered here: id → status and the tool it created. */
  answered: [string, { status: string; toolId: string | null; note: string }][];
}

const KEY = "demo-operator-contracts";

function load(): ContractMemory {
  const empty: ContractMemory = { drafts: [], baseVersions: [], deprecated: [], published: [], current: [], created: [], answered: [] };
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? { ...empty, ...(JSON.parse(raw) as Partial<ContractMemory>) } : empty;
  } catch {
    return empty;
  }
}

const memory = load();

function save(): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* no storage: remembered for this load only */
  }
}

function set<V>(list: [string, V][], key: string, value: V): void {
  const at = list.findIndex(([k]) => k === key);
  if (at === -1) list.push([key, value]);
  else list[at] = [key, value];
}

function get<V>(list: [string, V][], key: string): V | undefined {
  return list.find(([k]) => k === key)?.[1];
}

/** The tool as this tab now sees it. */
function toolNow(toolId: string) {
  const draftEntry = memory.drafts.find(([k]) => k === toolId);
  return demoOperatorTool(toolId, {
    others: demoCatalogueToolRefs(),
    ...(draftEntry ? { draft: draftEntry[1] } : {}),
    ...(get(memory.baseVersions, toolId) !== undefined ? { baseVersion: get(memory.baseVersions, toolId) } : {}),
    ...(get(memory.deprecated, toolId) ? { deprecated: get(memory.deprecated, toolId) } : {}),
    published: memory.published.includes(toolId),
    ...(get(memory.current, toolId) !== undefined ? { current: get(memory.current, toolId) } : {}),
    ...(get(memory.created, toolId) ? { created: get(memory.created, toolId) } : {}),
  });
}

function toolIdOf(path: string): string {
  return decodeURIComponent(path.split("/")[3] ?? "");
}

function text(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/* ------------------------------------------------------------ tool requests */

const DAY_MS = 86_400_000;

function requestRows(now: number) {
  return [
    {
      id: "4f2a9c61-8e3b-4d70-a5c2-9b1e6f0d3a84",
      organizationId: "org-harbor-analytics",
      title: "Air quality index for a city",
      description:
        "We need the current air quality index (AQI) and the main pollutant for a city or a latitude/longitude, for a travel agent that warns users before they go out.",
      upstreamUrl: "https://api.openaq.example/v3",
      expectedMonthlyCalls: 40_000,
      status: "OPEN",
      ownerOperatorId: null,
      firstResponseDueAt: new Date(now + 1 * DAY_MS).toISOString(),
      firstRespondedAt: null,
      resolutionNote: null,
      closedAt: null,
      toolId: null,
      createdAt: new Date(now - 1 * DAY_MS).toISOString(),
    },
    {
      id: "a7d3e0b5-2c19-4f86-b4a1-6e8c0d2f9b37",
      organizationId: "org-quill-research",
      title: "Patent search",
      description: "Search granted patents by keyword and return the title, number, assignee and filing date.",
      upstreamUrl: null,
      expectedMonthlyCalls: 5_000,
      status: "OPEN",
      ownerOperatorId: null,
      firstResponseDueAt: new Date(now - 2 * 3_600_000).toISOString(),
      firstRespondedAt: null,
      resolutionNote: null,
      closedAt: null,
      toolId: null,
      createdAt: new Date(now - 3 * DAY_MS).toISOString(),
    },
  ];
}

function requestNow(row: ReturnType<typeof requestRows>[number]) {
  const answered = get(memory.answered, row.id);
  return answered
    ? { ...row, status: answered.status, toolId: answered.toolId, resolutionNote: answered.note, firstRespondedAt: new Date().toISOString() }
    : row;
}

/** "Air quality index for a city" → "air_quality_index_for_a_city" (≤ 48). */
function snake(title: string): string {
  const name = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48).replace(/_+$/, "");
  return /^[a-z]/.test(name) ? name : `tool_${name}`;
}

/* ---------------------------------------------------------------- fixtures */

export interface OperatorDemoHelpers {
  queue: (action: string, code: string, target: string, payload: Record<string, unknown>) => unknown;
  log: (code: string, label: string, action: string, targetId: string, data: Record<string, unknown> | undefined) => void;
  nextId: (prefix: string) => string;
}

export function operatorContractFixtures(h: OperatorDemoHelpers): DemoFixture[] {
  return [
    {
      method: "GET",
      match: "/operator/tools",
      body: () => {
        const list = demoOperatorToolList(demoCatalogueToolRefs());
        const created = memory.created.map(([id]) => toolNow(id)).filter((t) => t !== undefined);
        const byId = new Map(list.tools.map((t) => [t.id, t]));
        for (const tool of created) {
          const { replacementToolId: _r, versions: _v, draft: _d, majors: _m, suggestedCurrentVersion: _s, ...summary } = tool;
          byId.set(tool.id, summary);
        }
        // Each listed tool as this tab left it (a draft saved or discarded, a publish approved).
        for (const id of byId.keys()) {
          const now = toolNow(id);
          if (now) byId.set(id, { ...byId.get(id)!, hasDraft: now.draft !== null, currentSemver: now.currentSemver, currentVersion: now.currentVersion, status: now.status });
        }
        return { tools: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name)) };
      },
    },
    {
      method: "POST",
      match: "/operator/tools",
      body: (_path, _query, data) => {
        const id = `tool-${h.nextId("new")}`;
        set(memory.created, id, { name: text(data, "name") || "new_tool", category: text(data, "category") || "uncategorised" });
        save();
        return toolNow(id);
      },
    },
    {
      method: "GET",
      match: /^\/operator\/tools\/[^/]+$/,
      body: (path) => toolNow(toolIdOf(path)),
    },
    {
      method: "POST",
      match: /^\/operator\/tools\/[^/]+\/versions$/,
      body: (path, _query, data) => {
        const toolId = toolIdOf(path);
        const draft: Draft = {
          version: demoNextDraftVersion(toolId),
          summary: text(data, "summary"),
          description: text(data, "description"),
          inputSchema: (data?.inputSchema ?? {}) as Draft["inputSchema"],
          outputSchema: (data?.outputSchema ?? {}) as Draft["outputSchema"],
          optionalInputFields: strings(data?.optionalInputFields),
          optionalOutputFields: strings(data?.optionalOutputFields),
          examples: Array.isArray(data?.examples) ? (data.examples as unknown[]) : [],
          verificationPolicyId: null,
          tier: "VERIFIED",
          changelog: text(data, "changelog") || null,
          updatedAt: new Date().toISOString(),
        };
        set(memory.drafts, toolId, draft);
        if (typeof data?.baseVersion === "number") set(memory.baseVersions, toolId, data.baseVersion);
        memory.published = memory.published.filter((id) => id !== toolId);
        save();
        return toolNow(toolId);
      },
    },
    {
      method: "DELETE",
      match: /^\/operator\/tools\/[^/]+\/versions\/draft$/,
      body: (path) => {
        const toolId = toolIdOf(path);
        set(memory.drafts, toolId, null);
        save();
        return toolNow(toolId);
      },
    },
    {
      method: "POST",
      match: /^\/operator\/tools\/[^/]+\/versions\/\d+\/publish$/,
      body: (path, _query, data) => {
        const toolId = toolIdOf(path);
        const version = Number(path.split("/")[5]);
        return h.queue("tool_version.publish", "P-10", `tool:${toolId}`, { toolId, version, body: { ...data } });
      },
    },
    {
      method: "POST",
      match: /^\/operator\/tools\/[^/]+\/current-version$/,
      body: (path, _query, data) => {
        const toolId = toolIdOf(path);
        return h.queue("tool.current_version", "P-11", `tool:${toolId}`, { toolId, body: { ...data } });
      },
    },
    {
      method: "POST",
      match: /^\/operator\/tools\/[^/]+\/versions\/\d+\/deprecate$/,
      body: (path, _query, data) => {
        const toolId = toolIdOf(path);
        const version = Number(path.split("/")[5]);
        set(memory.deprecated, toolId, { version, sunsetAt: text(data, "sunsetAt"), replacementToolId: text(data, "replacementToolId") || null });
        save();
        h.log("P-12", "Deprecate a contract major", "tool_version.deprecated", toolId, data);
        return toolNow(toolId);
      },
    },
    {
      method: "GET",
      match: "/operator/tool-requests",
      body: (_path, query) => {
        const wanted = typeof query.status === "string" && query.status ? query.status.split(",") : ["OPEN"];
        const rows = requestRows(Date.now())
          .map(requestNow)
          .filter((row) => wanted.includes(row.status))
          .map(({ description: _d, upstreamUrl: _u, firstRespondedAt: _f, resolutionNote: _n, closedAt: _c, toolId: _t, ...row }) => row);
        return { items: rows, pageInfo: { nextCursor: null, hasMore: false } };
      },
    },
    {
      method: "GET",
      match: /^\/operator\/tool-requests\/[^/]+$/,
      body: (path) => {
        const id = decodeURIComponent(path.split("/").pop() ?? "");
        if (id === TIDES_REQUEST_ID) {
          return { ...requestRows(Date.now())[0]!, id, title: "Tide times", status: "ACCEPTED", toolId: TIDES_TOOL_ID, resolutionNote: "Accepted: drafting get_tide_times." };
        }
        const row = requestRows(Date.now()).find((r) => r.id === id);
        return row ? requestNow(row) : undefined;
      },
    },
    {
      method: "PATCH",
      match: /^\/operator\/tool-requests\/[^/]+$/,
      body: (path, _query, data) => {
        const id = decodeURIComponent(path.split("/").pop() ?? "");
        const row = requestRows(Date.now()).find((r) => r.id === id) ?? requestRows(Date.now())[0]!;
        const status = text(data, "status") || "ACKNOWLEDGED";
        let toolId: string | null = null;
        if (status === "ACCEPTED") {
          toolId = `tool-${h.nextId("request")}`;
          set(memory.created, toolId, { name: text(data, "toolName") || snake(row.title), category: text(data, "toolCategory") || "uncategorised" });
        }
        set(memory.answered, id, { status, toolId, note: text(data, "resolutionNote") });
        save();
        return requestNow({ ...row, id });
      },
    },
  ];
}

/** What an approved contract request does in the demo. Returns the action's result, or undefined for other actions. */
export function contractApproved(approval: OperatorApproval): unknown {
  const toolId = String(approval.payload.toolId ?? approval.target.split(":")[1] ?? "");
  if (approval.action === "tool_version.publish") {
    if (!memory.published.includes(toolId)) memory.published.push(toolId);
    save();
    return toolNow(toolId) ?? {};
  }
  if (approval.action === "tool.current_version") {
    const body = (approval.payload.body ?? {}) as Record<string, unknown>;
    if (typeof body.version === "number") set(memory.current, toolId, body.version);
    save();
    return toolNow(toolId) ?? {};
  }
  return undefined;
}
