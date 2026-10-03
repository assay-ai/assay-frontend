import { api } from "./api";

/**
 * The tool catalogue, as a buyer reads it.
 *
 * Every buyer screen that names a tool had only `payment_intents.tool_id` to
 * print, which is a uuid — `06399979-f8b8-4c9e-a9b1-bd2a5924d442` in the column
 * headed "Tool" — and `/tool-calls` joins nothing that would fix it. `GET
 * /tools` is that join, done once per session and cached, rather than
 * denormalised onto every call row.
 *
 * The catalogue is platform-authored and identical for every caller, so this is
 * cached hard (see `useToolNames`) and a failure is not fatal: a screen that
 * cannot reach it falls back to the uuid, which is what it printed before this
 * endpoint existed.
 *
 * Not to be confused with `GET /providers/me/tool-bindings/catalogue`, which
 * serves the same tools to the *seller* surface with their JSON Schema
 * contracts attached. A buyer needs the label, not the contract.
 */

export type ToolTier = "UNVERIFIED" | "VERIFIED" | "GUARANTEED";

export interface CatalogueTool {
  /** The id every call row carries. */
  id: string;
  /** The name to print instead of the id — e.g. `get_weather`. */
  name: string;
  description: string;
  tier: ToolTier;
}

export interface ToolListResponse {
  tools: CatalogueTool[];
}

/** GET /tools — every tool, unpaged. */
export function listTools(): Promise<ToolListResponse> {
  return api.get<ToolListResponse>("/tools");
}
