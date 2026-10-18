import type { RefusedCall } from "@/services/toolsets.service";

import { demoMinutesAgo } from "./demo-clock";
import { demoRetiredMajor } from "./demo-switches";
import { WEATHER_TOOL_ID, weatherSunsetAt } from "./fixtures-contracts";

/**
 * T3 refused calls and contract notices — DEMO ONLY.
 *
 * The same story as `fixtures-contracts.ts`: get_weather 2.0.0 is current,
 * major 1 is deprecated (retired with `?contracts=retired`). The "Weather and
 * places" tool set (fixtures-toolsets `WEATHER_ID`) routes get_weather; the
 * prod agent excludes Helios. The router applies the contract before the
 * buyer's rules, so a provider is dropped by its first failing check:
 *
 *  - MISSING_OUTPUT_FIELD (TOOLSET): the entry requires uv_index; Helios and
 *    Northwind don't return it, Quanta does but the entry leaves it out.
 *  - CONTRACT_VERSION_MISMATCH (MIGRATION): the entry is on v1; every
 *    provider now serves only v2 → "Allow v2".
 *  - UNSUPPORTED_INPUT_FIELD (REQUEST): the agent sent `units`; Northwind
 *    and Quanta don't accept it, Helios does but the agent excludes it.
 *  - CONTRACT_VERSION_RETIRED: only with `?contracts=retired` → "Use v2.0.0".
 */

export interface ContractRefusalIds {
  readonly agentId: string;
  readonly toolsetId: string;
  readonly providers: { readonly helios: string; readonly northwind: string; readonly quanta: string };
  readonly name: (providerId: string) => string | null;
}

export function contractRefusedCalls(ids: ContractRefusalIds): RefusedCall[] {
  const { helios, northwind, quanta } = ids.providers;
  const p = (providerId: string) => ({ providerId, providerName: ids.name(providerId) });
  const base = {
    agentId: ids.agentId,
    toolId: WEATHER_TOOL_ID,
    toolName: "get_weather",
    charged: false as const,
    toolsetVersion: null,
    viewFilter: null,
  };
  const calls: RefusedCall[] = [
    {
      ...base,
      callId: "rc-5e1a77c3-weather-uv",
      refusalCode: "NO_PROVIDER_MATCHES_RULES",
      refusalLayer: "TOOLSET_RULES",
      providers: [
        { ...p(helios), reason: "MISSING_OUTPUT_FIELD", source: "TOOLSET", fields: ["uv_index"], detail: `binding b-helios-weather does not return uv_index` },
        { ...p(northwind), reason: "MISSING_OUTPUT_FIELD", source: "TOOLSET", fields: ["uv_index"], detail: `binding b-northwind-weather does not return uv_index` },
        { ...p(quanta), reason: "EXCLUDED_BY_TOOLSET", source: "TOOLSET", detail: "Excluded by the entry" },
      ],
      endpointKind: "TOOLSET",
      toolsetId: ids.toolsetId,
      createdAt: demoMinutesAgo(11),
    },
    {
      ...base,
      callId: "rc-8c2f04b9-weather-v1",
      refusalCode: "NO_PROVIDER_MATCHES_RULES",
      refusalLayer: "SERVER",
      providers: [helios, northwind, quanta].map((id) => ({
        ...p(id),
        reason: "CONTRACT_VERSION_MISMATCH",
        source: "MIGRATION",
        detail: `binding b-${id.slice(0, 8)} serves ^2, not contract v1.1.0`,
        servedMajors: [2],
        requestedMajor: 1,
        requestedRange: [1],
      })),
      endpointKind: "TOOLSET",
      toolsetId: ids.toolsetId,
      createdAt: demoMinutesAgo(26),
    },
    {
      ...base,
      callId: "rc-31d7a6e0-weather-units",
      refusalCode: "UNSUPPORTED_INPUT_FIELD",
      refusalLayer: "AGENT_LIMITS",
      providers: [
        { ...p(northwind), reason: "UNSUPPORTED_INPUT_FIELD", source: "REQUEST", fields: ["units"], detail: "binding b-northwind-weather does not support units" },
        { ...p(quanta), reason: "UNSUPPORTED_INPUT_FIELD", source: "REQUEST", fields: ["units"], detail: "binding b-quanta-weather does not support units" },
        { ...p(helios), reason: "EXCLUDED_BY_AGENT", source: "AGENT", detail: "Excluded by the agent's rules" },
      ],
      endpointKind: "ROOT",
      toolsetId: null,
      createdAt: demoMinutesAgo(41),
    },
  ];
  if (demoRetiredMajor()) {
    calls.unshift({
      ...base,
      callId: "rc-0b94e2d6-weather-retired",
      refusalCode: "CONTRACT_VERSION_RETIRED",
      refusalLayer: "SERVER",
      providers: [],
      details: { replacement: { toolId: base.toolId ?? WEATHER_TOOL_ID, name: "get_weather", major: 2, semver: "2.0.0", label: "get_weather@2 (v2.0.0)" } },
      endpointKind: "TOOLSET",
      toolsetId: ids.toolsetId,
      createdAt: demoMinutesAgo(4),
    });
  }
  return calls;
}

/** `tool_version.deprecated` / `.retired`, for the buyer's alerts or the provider's Inbox. */
export function contractNotices(role: "BUYER" | "PROVIDER", toolset?: { id: string; name: string }): unknown[] {
  // One date for every screen: the version's own sunset (fixtures-contracts).
  const sunsetAt = weatherSunsetAt();
  const day = sunsetAt.slice(0, 10);
  const retired = demoRetiredMajor();
  const payload = {
    toolId: WEATHER_TOOL_ID,
    toolName: "get_weather",
    major: 1,
    sunsetAt,
    replacement: "get_weather@2 (v2.0.0)",
    role,
    // The buyer's tool set that routes get_weather to v1, so the notice opens it and offers "Allow v2".
    ...(role === "BUYER" && toolset ? { toolsetId: toolset.id, toolsetName: toolset.name } : {}),
  };
  // A deprecation is told at least 90 days before its sunset; once retired, that notice is old and read.
  const deprecatedAt = retired ? new Date(Date.parse(sunsetAt) - 100 * 86_400_000).toISOString() : demoMinutesAgo(3 * 24 * 60);
  const tag = role === "BUYER" ? "b" : "p";
  const notices: unknown[] = [
    {
      id: `ntf_tv_dep_${tag}`,
      event: "tool_version.deprecated",
      severity: "WARNING",
      title: "get_weather v1 is deprecated",
      body: `Version 1 of get_weather stops serving on ${day} (UTC). Use get_weather@2 (v2.0.0). Calls pinned to it, and bindings that serve only it, need to move before then.`,
      subjectType: "tool",
      subjectId: WEATHER_TOOL_ID,
      payload,
      readAt: retired ? deprecatedAt : null,
      createdAt: deprecatedAt,
    },
  ];
  if (demoRetiredMajor()) {
    notices.unshift({
      id: `ntf_tv_ret_${tag}`,
      event: "tool_version.retired",
      severity: "WARNING",
      title: "get_weather v1 was retired",
      body: "Version 1 of get_weather no longer serves calls; calls that can only use it are refused with CONTRACT_VERSION_RETIRED.",
      subjectType: "tool",
      subjectId: WEATHER_TOOL_ID,
      payload,
      readAt: null,
      createdAt: demoMinutesAgo(2 * 24 * 60),
    });
  }
  return notices;
}
