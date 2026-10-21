import { sunsetDay } from "@/features/contracts/text";
import { routes } from "@/libs/routes";

/**
 * `tool_version.deprecated` and `tool_version.retired` (design spec §7.5,
 * T3) as a person reads them: what stops, when (UTC), what to use instead,
 * and the one next step — for a buyer (move tool sets and pinned URLs) or a
 * provider (serve the newer version). The backend's own title and body name
 * `CONTRACT_VERSION_RETIRED`; these sentences don't. Pure.
 */

export const CONTRACT_NOTICE_EVENTS = ["tool_version.deprecated", "tool_version.retired"] as const;
export type ContractNoticeEvent = (typeof CONTRACT_NOTICE_EVENTS)[number];

export interface ContractNotice {
  toolId: string;
  toolName: string;
  major: number;
  sunsetAt: string | null;
  /** The backend's spelling, e.g. "get_weather@2 (v2.0.0)", or a replacement tool's name. */
  replacement: string | null;
  role: "BUYER" | "PROVIDER";
  /** The tool set that routes the tool to this major, when the notice names one. */
  toolsetId?: string | null;
  toolsetName?: string | null;
  /** The agent that called it, when the notice names one. */
  agentId?: string | null;
}

export function isContractNoticeEvent(event: string | null | undefined): event is ContractNoticeEvent {
  return event === "tool_version.deprecated" || event === "tool_version.retired";
}

/** The payload, read defensively (it arrives from the notification feed). */
export function readContractNotice(payload: unknown): ContractNotice | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.toolId !== "string" || typeof p.toolName !== "string" || typeof p.major !== "number") return null;
  return {
    toolId: p.toolId,
    toolName: p.toolName,
    major: p.major,
    sunsetAt: typeof p.sunsetAt === "string" ? p.sunsetAt : null,
    replacement: typeof p.replacement === "string" && p.replacement.length > 0 ? p.replacement : null,
    role: p.role === "PROVIDER" ? "PROVIDER" : "BUYER",
    toolsetId: typeof p.toolsetId === "string" ? p.toolsetId : null,
    toolsetName: typeof p.toolsetName === "string" ? p.toolsetName : null,
    agentId: typeof p.agentId === "string" ? p.agentId : null,
  };
}

/** "get_weather@2 (v2.0.0)" → { text: "get_weather v2.0.0", major: 2, sameTool: true }. */
export function replacementText(notice: Pick<ContractNotice, "replacement" | "toolName">): { text: string; major: number | null; sameTool: boolean } | null {
  if (!notice.replacement) return null;
  const match = /^(.+)@(\d+) \(v([\d.]+)\)$/.exec(notice.replacement);
  if (match) return { text: `${match[1]} v${match[3]}`, major: Number(match[2]), sameTool: match[1] === notice.toolName };
  return { text: notice.replacement, major: null, sameTool: notice.replacement === notice.toolName };
}

/** The notice's title: "get_weather v1 stops on Feb 1, 2027" / "get_weather v1 no longer works". */
export function contractNoticeTitle(event: ContractNoticeEvent, notice: ContractNotice, now: number = Date.now()): string {
  const name = `${notice.toolName} v${notice.major}`;
  if (event === "tool_version.retired") return `${name} no longer works`;
  if (!notice.sunsetAt) return `${name} is going away`;
  // An old deprecation notice read after the day: say it in the past, never "stops" on a day gone by.
  const past = Date.parse(notice.sunsetAt) <= now;
  return `${name} ${past ? "stopped" : "stops"} on ${sunsetDay(notice.sunsetAt)} (UTC)`;
}

/**
 * The one title a notification shows, in the bell and on the alerts page
 * alike: a contract notice's plain title, else the server's.
 */
export function notificationTitle(item: { event: string; title: string; payload?: unknown }): string {
  if (!isContractNoticeEvent(item.event)) return item.title;
  const notice = readContractNotice(item.payload);
  return notice ? contractNoticeTitle(item.event, notice) : item.title;
}

/** The newer major a buyer can widen its tool set entry to ("Allow v2"), or null. */
export function allowMajorOf(notice: ContractNotice): number | null {
  if (notice.role !== "BUYER" || !notice.toolsetId) return null;
  const next = replacementText(notice);
  return next?.sameTool && next.major !== null && next.major !== notice.major ? next.major : null;
}

/** The body: what happens and what to do, for the reader's role. */
export function contractNoticeText(event: ContractNoticeEvent, notice: ContractNotice): string {
  const name = `Version ${notice.major} of ${notice.toolName}`;
  const next = replacementText(notice);
  const use = next ? ` Use ${next.text} instead.` : "";
  const when = notice.sunsetAt ? `${sunsetDay(notice.sunsetAt)} (UTC)` : "its end date";
  const target = next?.sameTool && next.major !== null ? `v${next.major}` : "the newer version";
  if (notice.role === "PROVIDER") {
    return event === "tool_version.retired"
      ? `${name} no longer serves calls. If your tool serves only v${notice.major}, it gets no calls: add ${target} to the versions you serve, test it and publish.`
      : `${name} stops serving on ${when}.${use} Add ${target} to the versions you serve, test it and publish before then, or your tool stops getting calls for it.`;
  }
  return event === "tool_version.retired"
    ? `${name} no longer serves calls, so calls that can only use it are refused (and not charged).${use} Move tool sets and URLs locked to v${notice.major}.`
    : `${name} stops working on ${when}.${use} Tool sets and URLs locked to v${notice.major} need to move before then; everything else moves by itself.`;
}

/** The one next step, as a link. */
export function contractNoticeAction(notice: ContractNotice): { label: string; href: string } {
  if (notice.role === "PROVIDER") {
    const next = replacementText(notice);
    return { label: next?.sameTool && next.major !== null ? `Serve v${next.major}` : "Open your tools", href: "/provider/bindings" };
  }
  if (notice.toolsetId) return { label: `Open ${notice.toolsetName ?? "the tool set"}`, href: `/toolsets/mine?id=${encodeURIComponent(notice.toolsetId)}` };
  if (notice.agentId) return { label: "Open the agent", href: `/agents?agent=${encodeURIComponent(notice.agentId)}#access` };
  return { label: "Check your tool sets", href: "/toolsets/mine" };
}
