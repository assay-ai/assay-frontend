import { diffContracts, contractProblems, type ContractShape } from "@/features/contracts/diff";
import { bumpSemver, compareSemverText } from "@/features/contracts/semver";
import type {
  CatalogueToolVersionFields,
  ContractDraft,
  ContractMajor,
  ContractSchema,
  OperatorTool,
  OperatorToolSummary,
  ToolContractVersion,
  ToolVersionBrief,
  ToolVersionList,
} from "@/interfaces/contracts";

import { DEMO_NOW_MS } from "./demo-clock";
import { demoRetiredMajor } from "./demo-switches";

/**
 * Standard tool contracts — DEMO ONLY (design spec §7.5, T3).
 *
 * One story, told the same way on every screen:
 *
 *  - **get_weather** has three published versions. 1.0.0 and 1.1.0 (which
 *    added the optional output `uv_index` and the optional input `units`)
 *    are major 1; 2.0.0 renamed `temperature` to `temperature_c`, so it is a
 *    new major. 2.0.0 is current, and major 1 is deprecated with a sunset 120
 *    days out. A draft 2.1.0 adds the optional output `humidity`.
 *    `?contracts=retired` retires major 1 instead (its sunset passed).
 *  - **geocode_place** published 2.0.0 but still serves 1.0.0 to unpinned
 *    URLs: the editor suggests making 2.0.0 current (two eligible bindings).
 *  - **get_tide_times** is a DRAFT tool an accepted tool request created:
 *    no published version yet, a first draft waiting.
 *  - every other tool has one version, 1.0.0, current.
 *
 * Stateless like every fixture: a save answers with the diff of what was
 * sent, a publish or "Make current" answers 202 (a second operator must
 * approve), and nothing is remembered.
 */

export const WEATHER_TOOL_ID = "06399979-f8b8-4c9e-a9b1-bd2a5924d442";
export const GEOCODE_TOOL_ID = "ad39dccc-aff2-54c1-b383-62e0ff392570";
export const TIDES_TOOL_ID = "7c1e2f90-5b3a-4d18-9e6c-2a40b8d1f357";
/** The accepted tool request that created get_tide_times. */
export const TIDES_REQUEST_ID = "e2b7c4d1-0f3a-4a6e-8b95-71c2d0a9f4e3";

const DAY_MS = 86_400_000;

function daysAgo(days: number): string {
  return new Date(DEMO_NOW_MS - days * DAY_MS).toISOString();
}

/** Midnight UTC, `days` after the demo's today. */
function midnightIn(days: number): string {
  const now = new Date(DEMO_NOW_MS);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY_MS).toISOString();
}

/** When major 1 of get_weather stops (or stopped, with `?contracts=retired`). */
export function weatherSunsetAt(): string {
  return demoRetiredMajor() ? midnightIn(-2) : midnightIn(120);
}

/* ------------------------------------------------------------- get_weather */

const LAT_LON = {
  latitude: { type: "number", minimum: -90, maximum: 90, description: "Latitude in degrees" },
  longitude: { type: "number", minimum: -180, maximum: 180, description: "Longitude in degrees" },
};

const UNITS = { type: "string", enum: ["metric", "imperial"], description: "Units of the answer" };

function weatherInput(withUnits: boolean): ContractSchema {
  return {
    type: "object",
    properties: { ...LAT_LON, ...(withUnits ? { units: UNITS } : {}) },
    required: ["latitude", "longitude"],
  };
}

function weatherOutput(major: 1 | 2, extras: readonly ("uv_index" | "humidity")[]): ContractSchema {
  const temperature = major === 1 ? { temperature: { type: "number", description: "Air temperature" } } : { temperature_c: { type: "number", description: "Air temperature in °C" } };
  return {
    type: "object",
    properties: {
      ...temperature,
      observed_at: { type: "string", format: "date-time", description: "When it was measured (UTC)" },
      ...(extras.includes("uv_index") ? { uv_index: { type: "number", minimum: 0, description: "UV index" } } : {}),
      ...(extras.includes("humidity") ? { humidity: { type: "number", minimum: 0, maximum: 100, description: "Relative humidity, %" } } : {}),
    },
    required: [major === 1 ? "temperature" : "temperature_c", "observed_at"],
  };
}

const WEATHER_SUMMARY = "Current temperature at a latitude and longitude.";
const WEATHER_DESCRIPTION =
  "Current temperature at a latitude/longitude, from a meteorological forecast model. Use for present conditions at a known point, not for forecasts and not for place names.";

function weatherExample(major: 1 | 2) {
  return [
    {
      title: "Weather in Lisbon",
      arguments: { latitude: 38.72, longitude: -9.14 },
      result: major === 1 ? { temperature: 19.4, observed_at: "2026-10-16T14:00:00Z" } : { temperature_c: 19.4, observed_at: "2026-10-16T14:00:00Z" },
    },
  ];
}

function weatherVersions(): ToolContractVersion[] {
  const retired = demoRetiredMajor();
  const oldStatus = retired ? "RETIRED" : "DEPRECATED";
  const sunsetAt = weatherSunsetAt();
  return [
    {
      version: 3,
      semver: "2.0.0",
      major: 2,
      status: "ACTIVE",
      summary: WEATHER_SUMMARY,
      description: WEATHER_DESCRIPTION,
      inputSchema: weatherInput(true),
      outputSchema: weatherOutput(2, ["uv_index"]),
      optionalInputFields: ["units"],
      optionalOutputFields: ["uv_index"],
      examples: weatherExample(2),
      tier: "VERIFIED",
      sunsetAt: null,
      changelog: "temperature is now temperature_c, always in °C. Breaking: providers re-map and re-test for v2.",
      publishedAt: daysAgo(21),
      isCurrent: true,
    },
    {
      version: 2,
      semver: "1.1.0",
      major: 1,
      status: oldStatus,
      summary: WEATHER_SUMMARY,
      description: WEATHER_DESCRIPTION,
      inputSchema: weatherInput(true),
      outputSchema: weatherOutput(1, ["uv_index"]),
      optionalInputFields: ["units"],
      optionalOutputFields: ["uv_index"],
      examples: weatherExample(1),
      tier: "VERIFIED",
      sunsetAt,
      changelog: "Added the optional output uv_index and the optional input units.",
      publishedAt: daysAgo(64),
      isCurrent: false,
    },
    {
      version: 1,
      semver: "1.0.0",
      major: 1,
      status: oldStatus,
      summary: WEATHER_SUMMARY,
      description: WEATHER_DESCRIPTION,
      inputSchema: weatherInput(false),
      outputSchema: weatherOutput(1, []),
      optionalInputFields: [],
      optionalOutputFields: [],
      examples: weatherExample(1),
      tier: "VERIFIED",
      sunsetAt,
      changelog: "First version.",
      publishedAt: daysAgo(180),
      isCurrent: false,
    },
  ];
}

/* ----------------------------------------------------------- geocode_place */

const GEOCODE_INPUT: ContractSchema = {
  type: "object",
  properties: { query: { type: "string", description: "A place name" }, limit: { type: "integer", minimum: 1, maximum: 10 } },
  required: ["query"],
};

function geocodeOutput(major: 1 | 2): ContractSchema {
  const item = {
    type: "object",
    properties: { name: { type: "string" }, latitude: { type: "number" }, longitude: { type: "number" }, country: { type: "string" } },
  };
  return major === 1
    ? { type: "object", properties: { matches: { type: "array", items: item } }, required: ["matches"] }
    : { type: "object", properties: { results: { type: "array", items: item } }, required: ["results"] };
}

const GEOCODE_DESCRIPTION =
  "Resolve a place name to coordinates. Returns the best matches, each with latitude, longitude and country. Not a reverse geocoder and not an address validator.";

function geocodeVersions(): ToolContractVersion[] {
  return [
    {
      version: 2,
      semver: "2.0.0",
      major: 2,
      status: "ACTIVE",
      summary: "Coordinates for a place name.",
      description: GEOCODE_DESCRIPTION,
      inputSchema: GEOCODE_INPUT,
      outputSchema: geocodeOutput(2),
      optionalInputFields: [],
      optionalOutputFields: [],
      examples: [{ title: "Lisbon", arguments: { query: "Lisbon" } }],
      tier: "VERIFIED",
      sunsetAt: null,
      changelog: "matches is now results, the name every other tool uses.",
      publishedAt: daysAgo(6),
      isCurrent: false,
    },
    {
      version: 1,
      semver: "1.0.0",
      major: 1,
      status: "ACTIVE",
      summary: "Coordinates for a place name.",
      description: GEOCODE_DESCRIPTION,
      inputSchema: GEOCODE_INPUT,
      outputSchema: geocodeOutput(1),
      optionalInputFields: [],
      optionalOutputFields: [],
      examples: [{ title: "Lisbon", arguments: { query: "Lisbon" } }],
      tier: "VERIFIED",
      sunsetAt: null,
      changelog: "First version.",
      publishedAt: daysAgo(180),
      isCurrent: true,
    },
  ];
}

/* --------------------------------------------------------- everything else */

/** A one-version contract for a catalogue tool with no story of its own. */
function plainVersions(name: string, description: string): ToolContractVersion[] {
  return [
    {
      version: 1,
      semver: "1.0.0",
      major: 1,
      status: "ACTIVE",
      summary: (description.split(". ")[0] ?? name).slice(0, 199).replace(/\.?$/, "."),
      description,
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      outputSchema: { type: "object", properties: { result: { type: "object" } }, required: ["result"] },
      optionalInputFields: [],
      optionalOutputFields: [],
      examples: [],
      tier: "VERIFIED",
      sunsetAt: null,
      changelog: "First version.",
      publishedAt: daysAgo(180),
      isCurrent: true,
    },
  ];
}

/** Every published version of a demo tool, newest first. */
export function demoContractVersions(toolId: string, name = "", description = ""): ToolContractVersion[] {
  if (toolId === WEATHER_TOOL_ID) return weatherVersions();
  if (toolId === GEOCODE_TOOL_ID) return geocodeVersions();
  if (toolId === TIDES_TOOL_ID) return [];
  return plainVersions(name || "tool", description || name || "A tool.");
}

export function briefOf(version: ToolContractVersion): ToolVersionBrief {
  return {
    version: version.version,
    semver: version.semver,
    major: version.major,
    status: version.status,
    sunsetAt: version.sunsetAt,
    changelog: version.changelog,
    publishedAt: version.publishedAt,
    isCurrent: version.isCurrent,
  };
}

/** The T3 half of a catalogue card, signed-in or public. */
export function demoVersionFields(toolId: string, name: string, description: string): Required<CatalogueToolVersionFields> {
  const versions = demoContractVersions(toolId, name, description);
  const current = versions.find((v) => v.isCurrent) ?? null;
  return {
    summary: current?.summary ?? description,
    version: current?.semver ?? null,
    versions: versions.map(briefOf),
    deprecatedMajors: [...new Set(versions.filter((v) => v.status === "DEPRECATED").map((v) => v.major))].sort((a, b) => a - b),
  };
}

export function demoVersionList(toolId: string, name: string, description = ""): ToolVersionList {
  const versions = demoContractVersions(toolId, name, description);
  return { toolId, name, currentVersion: versions.find((v) => v.isCurrent)?.semver ?? null, versions };
}

/* ------------------------------------------------------- operator editor */

interface DemoOperatorTool {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly tags: readonly string[];
  readonly status: OperatorToolSummary["status"];
  readonly replacementToolId: string | null;
  readonly majors: readonly Pick<ContractMajor, "major" | "eligibleBindings" | "activeBindings">[];
  readonly suggested: number | null;
}

const OPERATOR_TOOLS: readonly DemoOperatorTool[] = [
  {
    id: WEATHER_TOOL_ID,
    name: "get_weather",
    category: "weather",
    tags: ["temperature", "uv"],
    status: "ACTIVE",
    replacementToolId: null,
    majors: [
      { major: 2, eligibleBindings: 2, activeBindings: 2 },
      { major: 1, eligibleBindings: 3, activeBindings: 3 },
    ],
    suggested: null,
  },
  {
    id: GEOCODE_TOOL_ID,
    name: "geocode_place",
    category: "geo",
    tags: ["places"],
    status: "ACTIVE",
    replacementToolId: null,
    majors: [
      { major: 2, eligibleBindings: 2, activeBindings: 2 },
      { major: 1, eligibleBindings: 2, activeBindings: 2 },
    ],
    suggested: 2,
  },
  {
    id: TIDES_TOOL_ID,
    name: "get_tide_times",
    category: "weather",
    tags: ["tides"],
    status: "DRAFT",
    replacementToolId: null,
    majors: [],
    suggested: null,
  },
];

/** The draft each demo tool holds (sequence number, shape). */
function demoDraftShape(toolId: string): (ContractShape & { version: number; changelog: string | null; updatedAt: string }) | null {
  if (toolId === WEATHER_TOOL_ID) {
    const base = weatherVersions()[0]!;
    return {
      version: 4,
      summary: base.summary,
      description: base.description,
      inputSchema: base.inputSchema,
      outputSchema: weatherOutput(2, ["uv_index", "humidity"]),
      optionalInputFields: ["units"],
      optionalOutputFields: ["uv_index", "humidity"],
      examples: base.examples,
      verificationPolicyId: null,
      tier: "VERIFIED",
      changelog: "Added the optional output humidity.",
      updatedAt: daysAgo(0.1),
    };
  }
  if (toolId === TIDES_TOOL_ID) {
    return {
      version: 1,
      summary: "High and low tide times for a coastal point.",
      description: "High and low tide times for the next 48 hours at a latitude/longitude on a coast, with the height of each tide in metres.",
      inputSchema: { type: "object", properties: { ...LAT_LON }, required: ["latitude", "longitude"] },
      outputSchema: {
        type: "object",
        properties: { tides: { type: "array", items: { type: "object", properties: { at: { type: "string" }, kind: { type: "string" }, height_m: { type: "number" } } } } },
        required: ["tides"],
      },
      optionalInputFields: [],
      optionalOutputFields: [],
      examples: [{ title: "Tides at Cascais", arguments: { latitude: 38.69, longitude: -9.42 } }],
      verificationPolicyId: null,
      tier: "VERIFIED",
      changelog: null,
      updatedAt: daysAgo(1),
    };
  }
  return null;
}

/** The published version a draft is diffed against: the newest one. */
function baseOf(versions: readonly ToolContractVersion[], baseVersion?: number): ToolContractVersion | null {
  if (baseVersion !== undefined) return versions.find((v) => v.version === baseVersion) ?? null;
  return [...versions].sort((a, b) => compareSemverText(b.semver, a.semver))[0] ?? null;
}

function shapeOf(version: ToolContractVersion): ContractShape {
  return {
    summary: version.summary,
    description: version.description,
    inputSchema: version.inputSchema,
    outputSchema: version.outputSchema,
    optionalInputFields: version.optionalInputFields,
    optionalOutputFields: version.optionalOutputFields,
    examples: version.examples,
    verificationPolicyId: null,
    tier: version.tier,
  };
}

/** A draft with its diff, as `ContractDraftDto` carries it. */
export function demoDraftOf(
  shape: ContractShape & { version: number; changelog: string | null; updatedAt: string },
  versions: readonly ToolContractVersion[],
  baseVersion?: number,
): ContractDraft {
  const base = baseOf(versions, baseVersion);
  const diff = diffContracts(base ? shapeOf(base) : null, shape);
  const problems = [...contractProblems(shape), ...(base && !diff.bump ? [`identical to v${base.semver}`] : [])];
  return {
    version: shape.version,
    baseSemver: base?.semver ?? null,
    baseVersion: base?.version ?? null,
    nextSemver: base ? bumpSemver(base.semver, diff.bump) : "1.0.0",
    bump: base ? diff.bump : "MAJOR",
    changes: [...diff.changes],
    problems,
    summary: shape.summary,
    description: shape.description,
    inputSchema: shape.inputSchema,
    outputSchema: shape.outputSchema,
    optionalInputFields: [...shape.optionalInputFields],
    optionalOutputFields: [...shape.optionalOutputFields],
    examples: shape.examples as ContractDraft["examples"],
    verificationPolicyId: shape.verificationPolicyId ?? null,
    tier: (shape.tier as ContractDraft["tier"]) ?? null,
    changelog: shape.changelog,
    updatedAt: shape.updatedAt,
  };
}

function majorsOf(tool: DemoOperatorTool, versions: readonly ToolContractVersion[]): ContractMajor[] {
  return tool.majors.map((m) => {
    const newest = versions.filter((v) => v.major === m.major).sort((a, b) => compareSemverText(b.semver, a.semver))[0];
    return {
      major: m.major,
      latestSemver: newest?.semver ?? `${m.major}.0.0`,
      status: newest?.status ?? "ACTIVE",
      sunsetAt: newest?.sunsetAt ?? null,
      eligibleBindings: newest?.status === "RETIRED" ? 0 : m.eligibleBindings,
      activeBindings: m.activeBindings,
    };
  });
}

function summaryOf(tool: DemoOperatorTool, versions: readonly ToolContractVersion[], hasDraft: boolean): OperatorToolSummary {
  const current = versions.find((v) => v.isCurrent) ?? null;
  return {
    id: tool.id,
    name: tool.name,
    kind: "STANDARD",
    category: tool.category,
    tags: [...tool.tags],
    status: tool.status,
    currentSemver: current?.semver ?? null,
    currentVersion: current?.version ?? null,
    hasDraft,
  };
}

/** Every demo catalogue tool the operator list shows besides the three with a story. */
export interface DemoCatalogueToolRef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

function plainOperatorTool(ref: DemoCatalogueToolRef): DemoOperatorTool {
  return {
    id: ref.id,
    name: ref.name,
    category: "general",
    tags: [],
    status: "ACTIVE",
    replacementToolId: null,
    majors: [{ major: 1, eligibleBindings: 2, activeBindings: 2 }],
    suggested: null,
  };
}

export function demoOperatorToolList(others: readonly DemoCatalogueToolRef[] = []): { tools: OperatorToolSummary[] } {
  const known = new Set(OPERATOR_TOOLS.map((t) => t.id));
  const all = [...OPERATOR_TOOLS, ...others.filter((t) => !known.has(t.id)).map(plainOperatorTool)];
  return {
    tools: all
      .map((tool) => {
        const ref = others.find((o) => o.id === tool.id);
        return summaryOf(tool, demoContractVersions(tool.id, tool.name, ref?.description), demoDraftShape(tool.id) !== null);
      })
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * `GET /operator/tools/:id`. `draft` overrides the stored draft (an echoed
 * save); `null` drops it (a discard); `deprecated` echoes a deprecation.
 */
export function demoOperatorTool(
  toolId: string,
  options: {
    others?: readonly DemoCatalogueToolRef[];
    draft?: (ContractShape & { version: number; changelog: string | null; updatedAt: string }) | null;
    baseVersion?: number;
    deprecated?: { version: number; sunsetAt: string; replacementToolId: string | null };
  } = {},
): OperatorTool | undefined {
  const ref = options.others?.find((o) => o.id === toolId);
  const tool = OPERATOR_TOOLS.find((t) => t.id === toolId) ?? (ref ? plainOperatorTool(ref) : undefined);
  if (!tool) return undefined;
  let versions = demoContractVersions(tool.id, tool.name, ref?.description);
  let replacementToolId = tool.replacementToolId;
  if (options.deprecated) {
    const major = versions.find((v) => v.version === options.deprecated!.version)?.major;
    versions = versions.map((v) => (v.major === major && v.status === "ACTIVE" ? { ...v, status: "DEPRECATED", sunsetAt: options.deprecated!.sunsetAt } : v));
    replacementToolId = options.deprecated.replacementToolId ?? replacementToolId;
  }
  const draftShape = options.draft === undefined ? demoDraftShape(tool.id) : options.draft;
  const draft = draftShape ? demoDraftOf(draftShape, versions, options.baseVersion) : null;
  return {
    ...summaryOf(tool, versions, draft !== null),
    replacementToolId,
    versions,
    draft,
    majors: majorsOf(tool, versions),
    suggestedCurrentVersion: tool.suggested,
  };
}

/** The id of the next draft a save creates: one past every version the tool has. */
export function demoNextDraftVersion(toolId: string): number {
  const draft = demoDraftShape(toolId);
  if (draft) return draft.version;
  return demoContractVersions(toolId).reduce((max, v) => Math.max(max, v.version), 0) + 1;
}
