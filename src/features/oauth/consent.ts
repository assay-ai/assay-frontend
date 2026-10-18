import type { Money } from "@/interfaces";
import { formatMoney } from "@/utils/money";

/**
 * The consent page's view model (spec §6.5): the §6.3.5 JSON in, the page's
 * sentences out. Pure, so every line of copy is tested here and the card only
 * lays it out.
 *
 * The request id is never part of the view: the page holds it only to call
 * the API with it.
 */

/** `GET {API}/oauth/requests/{rid}` (spec §6.3.5, backend `OAuthConsentRequestDto`). */
export interface ConsentRequest {
  requestId: string;
  createdAt: string;
  expiresAt: string;
  client: {
    name: string;
    kind: "CIMD" | "DCR" | "BUILTIN";
    /** eTLD+1 of the client metadata host, punycode; `null` when none is proven. */
    registrableDomain: string | null;
    host: string | null;
    verified: boolean;
    builtin: boolean;
    paymentClient: boolean;
  };
  returnTo: { kind: "WEB" | "LOCAL_APP"; display: string };
  scope: string[];
  agents: ConsentAgent[];
  /** Only for a sign-in of the Assay app replacing its own earlier one. */
  replaces?: { id: string; name: string; agentId: string; narrowed: boolean };
  suggestedName: string;
}

export interface ConsentAgent {
  id: string;
  label: string | null;
  /** Agent and organization active, wallet linked. */
  active: boolean;
  /** `null` = no ceiling. */
  limits: { perCall: Money | null; perDay: Money | null; freeCallsPerDay: number };
  access: { mode: "ALL" | "RESTRICTED"; summary: string };
  liveOAuthCredentials: number;
}

/** From this many live connections the page warns; the backend refuses the 51st. */
export const GRANT_WARN_AT = 45;
export const GRANT_LIMIT = 50;

export const CONSENT_STRINGS = {
  heading: "Connect an app to Assay",
  wants: "wants to use Assay as your agent.",
  canDoTitle: "This app will be able to",
  canDo: "see and call tools, within this agent's limits:",
  cannotDoTitle: "It will not be able to",
  notVerified: "Not verified by Assay. Only approve if you just started this from an app you trust.",
  selfRegistered: "Self-registered app",
  paused: "This agent is paused. Turn it back on in Agents & keys first.",
  expired: "This request expired. Go back to your app and try again.",
  decided: "You already answered this request.",
  missing: "There is no sign-in request on this page. Go back to your app and try again.",
  grantLimit: `This agent already has ${GRANT_LIMIT} connected apps, the most it can have. Revoke ones you no longer use in Agents & keys.`,
  agentGone: "This agent is no longer in your account. Pick another one.",
  nameInvalid: "Use a name with letters or numbers. Invisible and control characters are removed.",
  nameEmpty: "Give this connection a name.",
  noAgents: "You have no agent yet. Create one in Agents & keys first.",
  limitsSavedNotApproved: "Your limits were saved, but the app was not approved:",
  returnToApp: "Return to the app",
  retry: "That did not go through. Try again.",
  badRedirect: "Assay could not send you back to the app. Go back to your app and try again.",
} as const;

export interface ConsentView {
  client: {
    /** The header line, e.g. "Claude Code ✓ Verified". */
    title: string;
    verified: boolean;
    /** "Self-registered app" for a DCR client. */
    kindLabel: string | null;
    /** Shown in bold. */
    domain: string | null;
    /** The full host, shown under the domain when the client is not verified and it differs. */
    host: string | null;
  };
  /** Amber, for a client that is neither verified nor the built-in one. */
  notVerified: string | null;
  startedAgo: string;
  showAgentPicker: boolean;
  agent: ConsentAgent | null;
  limitsLine: string | null;
  cannotDo: string[];
  replaces: { tone: "info" | "warning"; text: string } | null;
  /** Warnings about the chosen agent (paused, many connections). */
  agentNotes: string[];
  expired: boolean;
  approveDisabled: boolean;
  returnLine: string;
  recencyLine: string;
}

/** "$0.50", "$5": whole dollars drop their cents, as the spec's limits line reads. */
function shortMoney(money: Money): string {
  return formatMoney(money).replace(/\.00$/, "");
}

/** "$0.50 a call · $5 a day · 100 free calls a day · All tools". */
export function limitsLine(agent: ConsentAgent): string {
  const { perCall, perDay, freeCallsPerDay } = agent.limits;
  return [
    perCall ? `${shortMoney(perCall)} a call` : "No limit a call",
    perDay ? `${shortMoney(perDay)} a day` : "No daily limit",
    `${freeCallsPerDay} free calls a day`,
    agent.access.summary,
  ].join(" · ");
}

/** "started 12 seconds ago". A creation time ahead of this clock reads "just now". */
export function startedAgo(createdAt: string, now: Date): string {
  const seconds = Math.floor((now.getTime() - Date.parse(createdAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 1) return "started just now";
  if (seconds < 60) return `started ${seconds} second${seconds === 1 ? "" : "s"} ago`;
  const minutes = Math.floor(seconds / 60);
  return `started ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
}

/**
 * The agent the picker starts on: the replaced connection's agent when it is
 * one of the list (approving as it replaces the old connection), else the
 * first active agent, else the first one.
 */
export function defaultAgentId(request: ConsentRequest): string | null {
  const { agents, replaces } = request;
  if (replaces && agents.some((a) => a.id === replaces.agentId)) return replaces.agentId;
  return (agents.find((a) => a.active) ?? agents[0])?.id ?? null;
}

/**
 * Check marks and their lookalikes, and the emoji variation selector that
 * can follow them: ✓ ✔ ☑ ✅ √ 🗸 🗹 🆗 ✓︎.
 */
const TRUST_MARKS = /[\u2713\u2714\u2611\u2705\u221A\u{1F5F8}\u{1F5F9}\u{1F197}\u2610\u2612\uFE0E\uFE0F]/gu;
/** The word "verified" in any case, as a whole word. */
const VERIFIED_WORD = /\bverified\b/giu;

/**
 * A name the client supplied, fit to show: without check marks or the word
 * "verified", so an app cannot name itself "Claude Code ✓ Verified". Whether
 * an app is verified comes only from the API's `verified` field (§6.3.6),
 * never from text. The backend should refuse such names too (carried to a
 * later backend task); this is the page's own defence.
 */
export function displayClientName(name: string): string {
  const cleaned = name
    .replace(TRUST_MARKS, " ")
    .replace(VERIFIED_WORD, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s·\-–—|:,.()[\]]+|[\s·\-–—|:,(\[]+$/gu, "")
    .trim();
  return cleaned || "Unnamed app";
}

function clientTitle(request: ConsentRequest, name: string): string {
  const { client, returnTo } = request;
  if (client.builtin) return "Assay app (says it is) · an app on this computer";
  // The badge, from the structured field only.
  if (client.verified) return `${name} ✓ Verified`;
  if (returnTo.kind === "LOCAL_APP") {
    return `${name} (says it is) · an app on this computer · Assay can't confirm which app`;
  }
  return name;
}

/**
 * When the request expires on this device's clock: the server's lifetime
 * (`expiresAt − createdAt`) counted from when this page fetched it. Never
 * earlier than the server's own expiry, whatever this clock says; a late
 * answer is caught by the API's 404.
 */
export function localDeadline(request: Pick<ConsentRequest, "createdAt" | "expiresAt">, fetchedAt: number): number {
  const lifetime = Date.parse(request.expiresAt) - Date.parse(request.createdAt);
  return fetchedAt + (Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 0);
}

export function consentView(
  request: ConsentRequest,
  options: { agentId: string | null; now: Date; fetchedAt: number },
): ConsentView {
  const { client, replaces } = request;
  const agent = request.agents.find((a) => a.id === options.agentId) ?? null;
  const expired = options.now.getTime() >= localDeadline(request, options.fetchedAt);
  const name = displayClientName(client.name);

  const agentNotes: string[] = [];
  if (request.agents.length === 0) agentNotes.push(CONSENT_STRINGS.noAgents);
  if (agent && !agent.active) agentNotes.push(CONSENT_STRINGS.paused);
  // The backend's cap leaves out a live grant this approval replaces.
  const atLimit =
    !!agent && agent.liveOAuthCredentials >= GRANT_LIMIT && !(replaces && replaces.agentId === agent.id);
  if (atLimit) agentNotes.push(CONSENT_STRINGS.grantLimit);
  else if (agent && agent.liveOAuthCredentials >= GRANT_WARN_AT) {
    agentNotes.push(
      `This agent has ${agent.liveOAuthCredentials} connected apps. Revoke ones you no longer use in Agents & keys.`,
    );
  }

  let replacesLine: ConsentView["replaces"] = null;
  if (replaces && agent) {
    const old = displayClientName(replaces.name);
    replacesLine =
      agent.id === replaces.agentId
        ? {
            tone: "info",
            text: replaces.narrowed
              ? `Replaces ${old}. Its tool limits are kept.`
              : `Replaces ${old}.`,
          }
        : { tone: "warning", text: `This keeps ${old} connected. It will not be replaced.` };
  }

  const appName = client.builtin ? "the Assay app" : name;

  return {
    client: {
      title: clientTitle(request, name),
      verified: client.verified && !client.builtin,
      kindLabel: client.kind === "DCR" ? CONSENT_STRINGS.selfRegistered : null,
      domain: client.registrableDomain,
      host: !client.verified && client.host && client.host !== client.registrableDomain ? client.host : null,
    },
    // Every client the API does not mark verified, the built-in one included:
    // any process on the computer can claim to be it.
    notVerified: client.verified ? null : CONSENT_STRINGS.notVerified,
    startedAgo: startedAgo(request.createdAt, options.now),
    showAgentPicker: request.agents.length > 1,
    agent,
    limitsLine: agent ? limitsLine(agent) : null,
    cannotDo: [
      "change limits, move funds or add people",
      // Keyed on what the API says the app may do: only a payment client can
      // ever be given a payment key (spec §6.3.13).
      client.paymentClient
        ? "make paid calls until you turn them on, on a separate page, with your wallet"
        : "make paid calls. Only the Assay app on your computer can, after you approve a payment key in your wallet.",
    ],
    replaces: replacesLine,
    agentNotes,
    expired,
    approveDisabled: !agent || !agent.active || expired || atLimit,
    returnLine: `After you approve, you go back to: ${request.returnTo.display}`,
    recencyLine: `Only approve if you clicked Connect in ${appName} in the last few minutes.`,
  };
}

/**
 * What an API refusal means on this page:
 * - `final`: the request is over (expired, unknown, already answered); nothing more to do here;
 * - `agent`: the chosen agent cannot take it; pick another;
 * - `name`: shown on the name field;
 * - `retry`: anything else.
 */
export function consentFailure(code: string | undefined): { kind: "final" | "agent" | "name" | "retry"; text: string } {
  switch (code) {
    case "OAUTH_REQUEST_NOT_FOUND":
      return { kind: "final", text: CONSENT_STRINGS.expired };
    case "OAUTH_REQUEST_ALREADY_DECIDED":
      return { kind: "final", text: CONSENT_STRINGS.decided };
    case "OAUTH_AGENT_NOT_ACTIVE":
      return { kind: "agent", text: CONSENT_STRINGS.paused };
    case "OAUTH_GRANT_LIMIT_REACHED":
      return { kind: "agent", text: CONSENT_STRINGS.grantLimit };
    case "ACCOUNT_AGENT_NOT_FOUND":
      return { kind: "agent", text: CONSENT_STRINGS.agentGone };
    case "OAUTH_CREDENTIAL_NAME_INVALID":
      return { kind: "name", text: CONSENT_STRINGS.nameInvalid };
    default:
      return { kind: "retry", text: CONSENT_STRINGS.retry };
  }
}

/** A name the page refuses before asking the API. */
export function nameProblem(name: string): string | null {
  return visibleName(name) ? null : CONSENT_STRINGS.nameEmpty;
}

/** The name without control, format (invisible, bidi) or separator characters at its ends, as the API keeps it. */
export function visibleName(name: string): string {
  return name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").trim();
}

/** The name field's starting value: the API's suggestion, without trust marks. */
export function initialName(request: Pick<ConsentRequest, "suggestedName">): string {
  return request.suggestedName.replace(TRUST_MARKS, "").replace(VERIFIED_WORD, "").replace(/\s+/g, " ").trim();
}

/** The API answered with a `redirectTo` that is not the `continue` step: the page does not go there. */
export class ContinueUrlRefused extends Error {
  constructor() {
    super(CONSENT_STRINGS.badRedirect);
    this.name = "ContinueUrlRefused";
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Whether `redirectTo` is the MCP host's `continue` step, the only place the
 * page ever navigates to after a decision. With the MCP host configured the
 * origin must be it; without, an `https` URL (or `http` on loopback, for a
 * local stack) with that path.
 */
export function isContinueUrl(raw: string, mcpUrl: string | undefined = process.env.NEXT_PUBLIC_MCP_URL): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.pathname !== "/oauth/authorize/continue" || url.username || url.password) return false;
  const configured = mcpUrl?.trim();
  if (configured) {
    try {
      return url.origin === new URL(configured).origin;
    } catch {
      return false;
    }
  }
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}
