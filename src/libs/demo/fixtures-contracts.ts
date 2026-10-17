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
/** get_usd_eur_rate: 2.0.0 is the default and 1.0.0 still runs, so the editor offers "Deprecate v1". */
export const FX_TOOL_ID = "a4b9882a-9bc1-4d64-807a-27c0b93daf0a";
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

/* -------------------------------------------------------- get_usd_eur_rate */

const FX_DESCRIPTION =
  "The latest USD to EUR reference exchange rate published by the European Central Bank, with the date it was published for. Not a tradeable quote, and not intraday.";

function fxVersions(): ToolContractVersion[] {
  const input: ContractSchema = { type: "object", properties: {}, required: [] };
  const common = {
    summary: "The latest USD to EUR reference rate.",
    description: FX_DESCRIPTION,
    inputSchema: input,
    optionalInputFields: [],
    optionalOutputFields: [],
    examples: [{ title: "Today's rate", arguments: {} }],
    tier: "VERIFIED" as const,
    sunsetAt: null,
  };
  return [
    {
      ...common,
      version: 2,
      semver: "2.0.0",
      major: 2,
      status: "ACTIVE",
      outputSchema: { type: "object", properties: { rate: { type: "number" }, published_for: { type: "string", format: "date" } }, required: ["rate", "published_for"] },
      changelog: "date is now published_for, the day the rate is for.",
      publishedAt: daysAgo(40),
      isCurrent: true,
    },
    {
      ...common,
      version: 1,
      semver: "1.0.0",
      major: 1,
      status: "ACTIVE",
      outputSchema: { type: "object", properties: { rate: { type: "number" }, date: { type: "string" } }, required: ["rate", "date"] },
      changelog: "First version.",
      publishedAt: daysAgo(200),
      isCurrent: false,
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
  if (toolId === FX_TOOL_ID) return fxVersions();
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
    id: FX_TOOL_ID,
    name: "get_usd_eur_rate",
    category: "finance",
    tags: ["fx"],
    status: "ACTIVE",
    replacementToolId: null,
    majors: [
      { major: 2, eligibleBindings: 2, activeBindings: 2 },
      { major: 1, eligibleBindings: 1, activeBindings: 2 },
    ],
    suggested: null,
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

/*
  The catalogue's tools, registered by fixtures-explore when it loads, so the
  operator list shows every tool without this file (or the operator fixtures)
  importing the explore fixtures — which import the fixture table, which
  imports the operator fixtures: a cycle at module load.
*/
let catalogueRefs: readonly DemoCatalogueToolRef[] = [];

export function registerDemoCatalogueTools(refs: readonly DemoCatalogueToolRef[]): void {
  catalogueRefs = refs;
}

export function demoCatalogueRefs(): readonly DemoCatalogueToolRef[] {
  return catalogueRefs;
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
    /** An approved publish: the draft is now a published version. */
    published?: boolean;
    /** An approved "Make current": this version (sequence number) is current. */
    current?: number;
    /** A tool created in this demo session (not one of the stories). */
    created?: { name: string; category: string };
  } = {},
): OperatorTool | undefined {
  const ref = options.others?.find((o) => o.id === toolId);
  const tool =
    OPERATOR_TOOLS.find((t) => t.id === toolId) ??
    (ref ? plainOperatorTool(ref) : undefined) ??
    (options.created
      ? { id: toolId, name: options.created.name, category: options.created.category, tags: [], status: "DRAFT" as const, replacementToolId: null, majors: [], suggested: null }
      : undefined);
  if (!tool) return undefined;
  let versions = options.created ? [] : demoContractVersions(tool.id, tool.name, ref?.description);
  const storedDraft = options.draft === undefined ? demoDraftShape(tool.id) : options.draft;
  if (options.published && storedDraft) {
    const draft = demoDraftOf(storedDraft, versions, options.baseVersion);
    const major = Number(draft.nextSemver.split(".")[0]);
    const currentMajor = versions.find((v) => v.isCurrent)?.major ?? null;
    const becomesCurrent = currentMajor === null || currentMajor === major;
    versions = [
      {
        version: draft.version,
        semver: draft.nextSemver,
        major,
        status: "ACTIVE",
        summary: draft.summary,
        description: draft.description,
        inputSchema: draft.inputSchema,
        outputSchema: draft.outputSchema,
        optionalInputFields: draft.optionalInputFields,
        optionalOutputFields: draft.optionalOutputFields,
        examples: draft.examples,
        tier: draft.tier ?? "VERIFIED",
        sunsetAt: null,
        changelog: draft.changelog,
        publishedAt: new Date().toISOString(),
        isCurrent: becomesCurrent,
      },
      ...versions.map((v) => (becomesCurrent ? { ...v, isCurrent: false } : v)),
    ];
  }
  if (options.current !== undefined && versions.some((v) => v.version === options.current)) {
    versions = versions.map((v) => ({ ...v, isCurrent: v.version === options.current }));
  }
  let replacementToolId = tool.replacementToolId;
  if (options.deprecated) {
    const major = versions.find((v) => v.version === options.deprecated!.version)?.major;
    versions = versions.map((v) => (v.major === major && v.status === "ACTIVE" ? { ...v, status: "DEPRECATED", sunsetAt: options.deprecated!.sunsetAt } : v));
    replacementToolId = options.deprecated.replacementToolId ?? replacementToolId;
  }
  const draftShape = options.published ? null : storedDraft;
  const draft = draftShape ? demoDraftOf(draftShape, versions, options.baseVersion) : null;
  const published = versions.length > 0;
  return {
    ...summaryOf({ ...tool, status: tool.status === "DRAFT" && published ? "ACTIVE" : tool.status }, versions, draft !== null),
    replacementToolId,
    versions,
    draft,
    // A major published here (or a first version) has no bindings yet.
    majors: majorsOf(
      {
        ...tool,
        majors: [
          ...tool.majors,
          ...[...new Set(versions.map((v) => v.major))]
            .filter((major) => !tool.majors.some((m) => m.major === major))
            .map((major) => ({ major, eligibleBindings: 0, activeBindings: 0 })),
        ].sort((a, b) => b.major - a.major),
      },
      versions,
    ),
    suggestedCurrentVersion: options.current !== undefined && options.current === tool.suggested ? null : tool.suggested,
  };
}

/** The id of the next draft a save creates: one past every version the tool has. */
export function demoNextDraftVersion(toolId: string): number {
  const draft = demoDraftShape(toolId);
  if (draft) return draft.version;
  return demoContractVersions(toolId).reduce((max, v) => Math.max(max, v.version), 0) + 1;
}
