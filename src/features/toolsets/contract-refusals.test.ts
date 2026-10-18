import { describe, expect, it } from "vitest";

import { attentionAction } from "@/features/buyer/attention-action";
import { isProviderEvent } from "@/features/provider-home/inbox";
import type { RefusedCall, RefusedProvider, ToolsetEntry } from "@/services/toolsets.service";

import { allowMajorOf, contractNoticeAction, contractNoticeText, contractNoticeTitle, notificationTitle, readContractNotice, replacementText } from "./contract-notices";
import { entryAfterFix, entryAlreadyFixed, mismatchOf, providerReason, refusedCallView, replacementOf, sourceText, type EntryFix } from "./refused";

function call(over: Partial<RefusedCall> = {}): RefusedCall {
  return {
    callId: "c1",
    agentId: "a1",
    toolId: "t-weather",
    toolName: "get_weather",
    refusalCode: "NO_PROVIDER_MATCHES_RULES",
    refusalLayer: "TOOLSET_RULES",
    charged: false,
    providers: [],
    endpointKind: "TOOLSET",
    toolsetId: "s-weather",
    toolsetVersion: null,
    viewFilter: null,
    createdAt: "2026-10-17T14:02:00.000Z",
    ...over,
  };
}

const prov = (over: Partial<RefusedProvider>): RefusedProvider => ({ providerId: "p1", providerName: "Helios", reason: "", source: "TOOLSET", detail: "", ...over });

function entry(over: Partial<ToolsetEntry> = {}): ToolsetEntry {
  return {
    position: 0,
    toolId: "t-weather",
    toolName: "get_weather",
    category: "weather",
    providerMode: "BEST",
    providerIds: [],
    minTier: null,
    maxPrice: null,
    minQuality: null,
    onEmpty: "FAIL",
    toolVersionRange: "^1",
    requireOutputFields: ["uv_index"],
    ...over,
  };
}

describe("T3 provider reasons, in words", () => {
  it("names the field or the version, and whose rule it was", () => {
    expect(providerReason(prov({ reason: "MISSING_OUTPUT_FIELD", fields: ["uv_index"] }))).toBe("Doesn't return uv_index, and the tool set requires it");
    expect(providerReason(prov({ reason: "UNSUPPORTED_INPUT_FIELD", source: "REQUEST", fields: ["units"] }))).toBe("Doesn't accept the input units this call sent");
    expect(providerReason(prov({ reason: "CONTRACT_VERSION_MISMATCH", source: "MIGRATION", servedMajors: [2], requestedMajor: 1, requestedRange: [1] }))).toBe(
      "Serves only v2; this call uses v1",
    );
    expect(providerReason(prov({ reason: "CONTRACT_VERSION_MISMATCH", source: "MIGRATION" }))).toBe(
      "Doesn't serve the version of the tool this call uses",
    );
    expect(sourceText("REQUEST")).toBe("The call's own inputs");
    expect(sourceText("MIGRATION")).toBe("Contract version");
    expect(mismatchOf({ servedMajors: [2, 1], requestedMajor: 3 })).toEqual({ serves: [1, 2], callMajor: 3 });
  });
});

describe("T3 refused calls and their one-click fixes", () => {
  it("Must return: one 'Remove' button for every provider that lacks the field", () => {
    const view = refusedCallView(
      call({
        providers: [
          prov({ providerId: "p1", reason: "MISSING_OUTPUT_FIELD", fields: ["uv_index"] }),
          prov({ providerId: "p2", reason: "MISSING_OUTPUT_FIELD", fields: ["uv_index"] }),
          prov({ providerId: "p3", reason: "EXCLUDED_BY_TOOLSET" }),
        ],
      }),
    );
    expect(view.reason).toBe("No provider fits the tool set's rules. Some don't return uv_index, which it requires.");
    expect(view.providers[0]!.fix).toEqual({ kind: "drop-required-field", toolsetId: "s-weather", toolId: "t-weather", fields: ["uv_index"], label: "Remove 'Must return: uv_index'" });
    expect(view.providers[0]!.fixCovers).toBe(2);
    expect(view.providers[1]!.fix).toBeNull();
    expect(view.providers[2]!.fix?.kind).toBe("edit-toolset");
  });

  it("a contract version no provider serves: 'Allow v2', and the layer is not the buyer's limits", () => {
    const view = refusedCallView(
      call({
        refusalLayer: "SERVER",
        providers: [prov({ reason: "CONTRACT_VERSION_MISMATCH", source: "MIGRATION", servedMajors: [2], requestedMajor: 1, requestedRange: [1] })],
      }),
    );
    expect(view.reason).toBe("No provider serves this version of the tool yet.");
    expect(view.layer).toBe("Refused because no provider serves the version of the tool this call uses");
    expect(view.providers[0]).toMatchObject({ source: "Contract version", fix: { kind: "allow-major", majors: [2], callMajor: 1, label: "Allow v2" } });
  });

  it("an input nobody accepts: says so, offers no setting for it, keeps the agent-limit fix", () => {
    const view = refusedCallView(
      call({
        refusalCode: "UNSUPPORTED_INPUT_FIELD",
        refusalLayer: "AGENT_LIMITS",
        endpointKind: "ROOT",
        toolsetId: null,
        providers: [
          prov({ providerId: "p1", reason: "UNSUPPORTED_INPUT_FIELD", source: "REQUEST", fields: ["units"] }),
          prov({ providerId: "p2", reason: "EXCLUDED_BY_AGENT", source: "AGENT" }),
        ],
      }),
    );
    expect(view.reason).toBe("No allowed provider supports units.");
    expect(view.layer).toMatch(/inputs the call sent/);
    expect(view.providers.map((p) => p.fix?.kind ?? null)).toEqual([null, "include-provider"]);
    expect(view.note).toMatch(/Call without units, or allow a provider that accepts it/);
    expect(view.fix).toEqual({ kind: "link", href: "/explore?tool=t-weather", label: "See the inputs it accepts" });
  });

  it("retired: names the replacement the call carries and moves the entry to it", () => {
    const replacement = { toolId: "t-weather", name: "get_weather", major: 2, semver: "2.0.0", label: "get_weather@2 (v2.0.0)" };
    const view = refusedCallView(call({ refusalCode: "CONTRACT_VERSION_RETIRED", refusalLayer: "SERVER", details: { replacement } }));
    expect(view.reason).toBe("This version of the tool was retired. Use v2.0.0.");
    expect(view.fix).toEqual({ kind: "move-major", toolsetId: "s-weather", toolId: "t-weather", from: [1], to: 2, label: "Use v2.0.0" });
    expect(replacementOf({ toolId: "t-weather", details: { replacement } })).toEqual({ label: "v2.0.0", major: 2, toolId: "t-weather", sameTool: true });
    // Another tool replaces it: open that tool.
    const other = refusedCallView(
      call({ refusalCode: "CONTRACT_VERSION_RETIRED", details: { replacement: { ...replacement, toolId: "t-pro", name: "get_weather_pro", semver: "1.0.0", major: 1 } } }),
    );
    expect(other.fix).toEqual({ kind: "link", href: "/explore?tool=t-pro", label: "Use get_weather_pro v1.0.0" });
    // A locked version or a pinned URL can't be edited here: a new URL.
    expect(refusedCallView(call({ refusalCode: "CONTRACT_VERSION_RETIRED", toolsetVersion: 3, details: { replacement } })).fix).toEqual({
      kind: "link",
      href: "/connect",
      label: "Get a URL for v2.0.0",
    });
    // Nothing replaces it: find another tool.
    const none = refusedCallView(call({ refusalCode: "CONTRACT_VERSION_RETIRED", details: { replacement: null } }));
    expect(none.fix).toMatchObject({ label: "Find a replacement tool" });
    expect(none.reason).toBe("This version of the tool was retired.");
  });

  it("each fix rewrites only its part of the entry", () => {
    const drop: EntryFix = { kind: "drop-required-field", toolsetId: "s", toolId: "t-weather", fields: ["uv_index"], label: "" };
    const allow: EntryFix = { kind: "allow-major", toolsetId: "s", toolId: "t-weather", majors: [2], callMajor: 1, label: "" };
    const move: EntryFix = { kind: "move-major", toolsetId: "s", toolId: "t-weather", from: [1], to: 2, label: "" };
    expect(entryAfterFix(entry({ requireOutputFields: ["uv_index", "humidity"] }), drop)).toMatchObject({ requireOutputFields: ["humidity"], toolVersionRange: "^1" });
    expect(entryAfterFix(entry(), allow).toolVersionRange).toBe("^1 || ^2");
    expect(entryAfterFix(entry({ toolVersionRange: null }), allow).toolVersionRange).toBe("^1 || ^2");
    expect(entryAfterFix(entry({ toolVersionRange: "^1 || ^2" }), move).toolVersionRange).toBe("^2");
    expect(entryAlreadyFixed(entry({ requireOutputFields: [] }), drop)).toBe(true);
    expect(entryAlreadyFixed(entry({ toolVersionRange: "^1 || ^2" }), allow)).toBe(true);
    expect(entryAlreadyFixed(entry(), move)).toBe(false);
  });
});

describe("tool_version notices", () => {
  const payload = { toolId: "t-weather", toolName: "get_weather", major: 1, sunsetAt: "2027-02-15T00:00:00.000Z", replacement: "get_weather@2 (v2.0.0)", role: "BUYER" };

  it("a buyer reads when it stops (UTC), what to use and what to move", () => {
    const notice = readContractNotice(payload)!;
    expect(replacementText(notice)).toEqual({ text: "get_weather v2.0.0", major: 2, sameTool: true });
    expect(contractNoticeTitle("tool_version.deprecated", notice)).toBe("get_weather v1 stops on Feb 15, 2027 (UTC)");
    expect(contractNoticeText("tool_version.deprecated", notice)).toBe(
      "Version 1 of get_weather stops working on Feb 15, 2027 (UTC). Use get_weather v2.0.0 instead. Tool sets and URLs locked to v1 need to move before then; everything else moves by itself.",
    );
    expect(contractNoticeText("tool_version.retired", notice)).not.toMatch(/CONTRACT_VERSION_RETIRED/);
    expect(attentionAction({ event: "tool_version.deprecated", payload })).toEqual({ label: "Check your tool sets", href: "/toolsets/mine" });
    // A notice that names the tool set opens it, and offers "Allow v2".
    const named = readContractNotice({ ...payload, toolsetId: "s-weather", toolsetName: "Weather and places" })!;
    expect(contractNoticeAction(named)).toEqual({ label: "Open Weather and places", href: "/toolsets/mine?id=s-weather" });
    expect(allowMajorOf(named)).toBe(2);
    // An old deprecation read after its day says it in the past, never "stops" on a day gone by.
    expect(contractNoticeTitle("tool_version.deprecated", notice, Date.parse("2027-06-01T00:00:00Z"))).toMatch(/stopped on/);
    expect(notificationTitle({ event: "tool_version.deprecated", title: "server title", payload })).toBe(contractNoticeTitle("tool_version.deprecated", notice));
  });

  it("a provider is told to serve v2, and only provider notices reach the Inbox", () => {
    const notice = readContractNotice({ ...payload, role: "PROVIDER" })!;
    expect(contractNoticeText("tool_version.deprecated", notice)).toMatch(/Add v2 to the versions you serve, test it and publish before then/);
    expect(contractNoticeAction(notice)).toEqual({ label: "Serve v2", href: "/provider/bindings" });
    expect(isProviderEvent("tool_version.retired", { role: "PROVIDER" })).toBe(true);
    expect(isProviderEvent("tool_version.retired", { role: "BUYER" })).toBe(false);
    expect(isProviderEvent("provider.slash_proposed")).toBe(true);
  });

  it("an unreadable payload falls back to the server's text", () => {
    expect(readContractNotice({ toolId: 1 })).toBeNull();
    expect(readContractNotice(null)).toBeNull();
  });
});
