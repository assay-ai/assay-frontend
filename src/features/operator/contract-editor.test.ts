import { describe, expect, it } from "vitest";

import type { OperatorApproval } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { demoOperatorTool, GEOCODE_TOOL_ID, TIDES_TOOL_ID, WEATHER_TOOL_ID } from "@/libs/demo/fixtures-contracts";

import { approvalOutcome, approvalTitle, approverRolesFor, EMPTY_APPROVAL_CONTEXT } from "./approvals";
import {
  contractErrorMessage,
  formFor,
  isDirty,
  livePreview,
  majorRows,
  mayEditContracts,
  parseForm,
  pendingFor,
  suggestion,
  toolNameFrom,
  toolNameProblem,
} from "./contract-editor";
import { activeOperatorNav, operatorNavFor, operatorTitleFor } from "./nav";
import { approverPhrase } from "./two-person";

const weather = demoOperatorTool(WEATHER_TOOL_ID)!;
const geocode = demoOperatorTool(GEOCODE_TOOL_ID)!;
const tides = demoOperatorTool(TIDES_TOOL_ID)!;

describe("the draft form", () => {
  it("opens on the saved draft, and the live diff matches the server's (a new optional output: minor)", () => {
    const form = formFor(weather);
    expect(form.optionalOutputFields).toEqual(["uv_index", "humidity"]);
    const preview = livePreview(form, weather.versions);
    expect(preview).toMatchObject({ baseSemver: "2.0.0", bump: "MINOR", nextSemver: "2.1.0", problems: [] });
    expect(preview.bump).toBe(weather.draft!.bump);
    expect(preview.nextSemver).toBe(weather.draft!.nextSemver);
    expect(isDirty(form, weather)).toBe(false);
  });

  it("shows a breaking change the moment an output is renamed", () => {
    const form = formFor(weather);
    const output = JSON.parse(form.outputSchema);
    output.properties.temp = output.properties.temperature_c;
    delete output.properties.temperature_c;
    output.required = ["temp", "observed_at"];
    const preview = livePreview({ ...form, outputSchema: JSON.stringify(output) }, weather.versions);
    expect(preview.bump).toBe("MAJOR");
    expect(preview.nextSemver).toBe("3.0.0");
  });

  it("starts a draft from the newest version when there is none, and is clean until edited", () => {
    const form = formFor(geocode);
    expect(form.baseVersion).toBe(2);
    expect(isDirty(form, geocode)).toBe(false);
    expect(livePreview(form, geocode.versions).problems).toEqual(["Nothing changed from v2.0.0 yet. Edit something before publishing."]);
    expect(isDirty({ ...form, summary: "Coordinates for any place name." }, geocode)).toBe(true);
  });

  it("treats a tool with no version as a first version", () => {
    const preview = livePreview(formFor(tides), tides.versions);
    expect(preview).toMatchObject({ firstVersion: true, nextSemver: "1.0.0", problems: [] });
  });

  it("says which JSON does not parse, and sends nothing", () => {
    const parsed = parseForm({ ...formFor(weather), inputSchema: "{ nope", examples: "{}" });
    expect(parsed.body).toBeNull();
    expect(parsed.jsonErrors.inputSchema).toMatch(/^The input schema is not valid JSON/);
    expect(parsed.jsonErrors.examples).toBe("The examples must be a JSON list: [ … ].");
  });

  it("drops optional fields that are no longer in the schema", () => {
    const form = { ...formFor(weather), optionalOutputFields: ["uv_index", "gone"] };
    expect(parseForm(form).body?.optionalOutputFields).toEqual(["uv_index"]);
  });
});

describe("versions agents can use", () => {
  it("lists majors newest first; the default can't be deprecated, the old one can", () => {
    const [v2, v1] = majorRows(weather);
    expect(v2).toMatchObject({ label: "v2", isCurrent: true, makeCurrentVersion: null, deprecateVersion: null, readyText: "2 providers can serve it now" });
    expect(v2!.deprecateBlocked).toMatch(/Make another version the default first/);
    expect(v1).toMatchObject({ label: "v1", status: "DEPRECATED", statusText: "Deprecated", deprecateVersion: null });
    expect(v1!.sunsetText).toMatch(/^Stops on .* \(UTC\)$/);
  });

  it("offers to make a ready newer major the default", () => {
    const [v2] = majorRows(geocode);
    expect(v2!.makeCurrentVersion?.semver).toBe("2.0.0");
    expect(suggestion(geocode)?.text).toBe("v2.0.0 is ready: 2 providers can serve it. Make it the version agents get by default?");
    expect(suggestion(weather)).toBeNull();
  });
});

describe("two-person requests on a tool", () => {
  const approval = (action: string, payload: Record<string, unknown>): OperatorApproval => ({
    id: "apr-1",
    action,
    code: action === "tool_version.publish" ? "P-10" : "P-11",
    target: `tool:${WEATHER_TOOL_ID}`,
    payload,
    status: "PENDING",
    requestedBy: "jordan@",
    requestedById: "op-jordan",
    approvedBy: null,
    rejectedBy: null,
    createdAt: "2026-10-17T10:00:00Z",
    decidedAt: null,
    expiresAt: "2026-10-18T10:00:00Z",
  });

  it("finds what is already waiting, so a second identical request is not sent", () => {
    const publish = approval("tool_version.publish", { toolId: WEATHER_TOOL_ID, version: 4 });
    expect(pendingFor(WEATHER_TOOL_ID, [publish])).toEqual({ publish, current: null });
    expect(pendingFor(GEOCODE_TOOL_ID, [publish])).toEqual({ publish: null, current: null });
  });

  it("names the tool and the version in the approvals inbox", () => {
    const tools = new Map([
      [WEATHER_TOOL_ID, { name: "get_weather", semvers: new Map([[4, "2.1.0"], [3, "2.0.0"]]), draft: { version: 4, bump: "MINOR" as const } }],
    ]);
    const context = { ...EMPTY_APPROVAL_CONTEXT, tools };
    expect(approvalTitle(approval("tool_version.publish", { toolId: WEATHER_TOOL_ID, version: 4 }), context)).toBe("Publish get_weather v2.1.0");
    expect(approvalTitle(approval("tool.current_version", { toolId: WEATHER_TOOL_ID, body: { version: 3 } }), context)).toBe(
      "Make get_weather v2.0.0 the default for agents",
    );
    expect(approvalOutcome(approval("tool_version.publish", { toolId: WEATHER_TOOL_ID, version: 4 }), context)[0]!.text).toMatch(/at once/);
  });

  it("needs a Policy approver, who is not the requester", () => {
    expect(approverRolesFor("P-10")).toEqual(["POLA"]);
    expect(approverPhrase("P-10", ["POL"])).toBe("a Policy approver");
    expect(approverPhrase("P-11", ["POLA"])).toBe("a second Policy approver");
  });
});

describe("who sees the editor", () => {
  it("shows Tools only to the Policy roles", () => {
    expect(mayEditContracts(["POL"])).toBe(true);
    expect(mayEditContracts(["ADJL"])).toBe(false);
    expect(operatorNavFor(["ADJL", "POL"]).map((i) => i.id)).toContain("tools");
    expect(operatorNavFor(["SUP"]).map((i) => i.id)).not.toContain("tools");
    expect(activeOperatorNav("/operator/tools/view")).toBe("tools");
    expect(operatorTitleFor("/operator/tools/view")).toBe("Tool");
  });
});

describe("names and errors", () => {
  it("suggests a tool name from a request title", () => {
    expect(toolNameFrom("Air quality index for a city")).toBe("air_quality_index_for_a_city");
    expect(toolNameFrom("3D models!")).toBe("tool_3d_models");
    expect(toolNameProblem("Get-Weather")).toMatch(/lower-case/);
    expect(toolNameProblem("get_weather")).toBeNull();
  });

  it("explains refusals in plain words, with the server's problems", () => {
    const invalid = new ApiError("TOOL_CONTRACT_INVALID", "x", 400, undefined, { problems: ["summary is empty"] });
    expect(contractErrorMessage(invalid)).toEqual({ text: "The server didn't accept the draft. Fix these first:", problems: ["Write a one-line summary."] });
    const taken = new ApiError("TOOL_CONTRACT_NAME_TAKEN", "x", 409, undefined, { suggestion: "get_weather_2" });
    expect(contractErrorMessage(taken).text).toBe('That name is taken. "get_weather_2" is free.');
  });
});
