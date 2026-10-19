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
  /** `live`: not revoked or expired. A dead one is still replaced (its limits are kept) but frees no place under the cap. */
  replaces?: { id: string; name: string; agentId: string; narrowed: boolean; live: boolean };
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
  tapAgain: "Tap again to confirm.",
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
 * Characters never shown in a name an app supplied. Removed outright:
 * format characters (zero-width, bidi overrides), controls and variation
 * selectors, so a word they split joins up again and is matched whole.
 */
const INVISIBLE = /[\p{Cf}\p{Cc}\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu;
/**
 * Replaced by a space: private-use, line separators, every "other" and
 * "modifier" symbol (every check mark, tick and emoji, not a list of them)
 * and the square-root tick.
 */
const SYMBOLS = /[\p{Co}\p{Zl}\p{Zp}\p{So}\p{Sk}\u221A]/gu;

/**
 * Letters of other scripts, and Latin variants, that look like plain Latin
 * ones, folded for matching only (never in what is shown). Keys are lower
 * case, as `foldForMatch` looks them up after lower casing. The backend's
 * table (`client-name.ts`) is the same, entry for entry; both repos test
 * against the same `client-name-fold.vectors.json`.
 */
// prettier-ignore
const LATIN_LOOKALIKES: Readonly<Record<string, string>> = {
  // Cyrillic
  "\u0430": "a", "\u0435": "e", "\u0451": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x",
  "\u0443": "y", "\u0456": "i", "\u0457": "i", "\u0458": "j", "\u0455": "s", "\u0501": "d", "\u0475": "v",
  "\u04cf": "i", "\u04bd": "e", "\u0433": "r", "\u0493": "f", "\u051b": "q", "\u051d": "w", "\u0261": "g",
  // Greek (ς: the lunate sigma ϲ decomposes to it)
  "\u03bf": "o", "\u03bd": "v", "\u03b9": "i", "\u03b5": "e", "\u03f5": "e", "\u03c1": "p", "\u03ba": "k",
  "\u03c5": "u", "\u03c4": "t", "\u03b1": "a", "\u03dd": "f", "\u03c2": "c", "\u03b3": "y", "\u03c7": "x",
  // Latin variants
  "\u0131": "i", "\u0269": "i", "\u0257": "d", "\u0192": "f", "\u0111": "d",
  // Latin small capitals
  "\u1d00": "a", "\u0299": "b", "\u1d04": "c", "\u1d05": "d", "\u1d07": "e", "\ua730": "f", "\u0262": "g",
  "\u029c": "h", "\u026a": "i", "\u1d0a": "j", "\u1d0b": "k", "\u029f": "l", "\u1d0d": "m", "\u0274": "n",
  "\u1d0f": "o", "\u1d18": "p", "\ua7af": "q", "\u0280": "r", "\ua731": "s", "\u1d1b": "t", "\u1d1c": "u",
  "\u1d20": "v", "\u1d21": "w", "\u028f": "y", "\u1d22": "z",
  // Cherokee, by the lower case form of each capital (Ꭺ U+13AA → U+AB7A)
  "\uab7a": "a", "\u13fc": "b", "\uab9f": "b", "\uabaf": "c", "\uab70": "d", "\uab7c": "e", "\uab90": "g",
  "\uab8b": "h", "\uab92": "h", "\uab75": "i", "\uab7b": "j", "\uabb6": "k", "\uabae": "l", "\uab87": "m",
  "\uabb2": "p", "\uaba2": "r", "\uab71": "r", "\uabaa": "s", "\uab72": "t", "\uaba9": "v", "\uab83": "w",
  "\uaba4": "w", "\uab79": "y", "\uab93": "z",
  // Lisu
  "\ua4ee": "a", "\ua4d0": "b", "\ua4da": "c", "\ua4d3": "d", "\ua4f0": "e", "\ua4dd": "f", "\ua4d6": "g",
  "\ua4e7": "h", "\ua4f2": "i", "\ua4d9": "j", "\ua4d7": "k", "\ua4e1": "l", "\ua4df": "m", "\ua4e0": "n",
  "\ua4f3": "o", "\ua4d1": "p", "\ua4e3": "r", "\ua4e2": "s", "\ua4d4": "t", "\ua4f4": "u", "\ua4e6": "v",
  "\ua4ea": "w", "\ua4eb": "x", "\ua4ec": "y", "\ua4dc": "z",
  // Canadian syllabics
  "\u15c5": "a", "\u15f7": "b", "\u1455": "c", "\u15ea": "d", "\u15f4": "e", "\u15b4": "f", "\u157c": "h",
  "\u148d": "j", "\u14aa": "l", "\u15f0": "m", "\u144e": "n", "\u146d": "p", "\u146b": "q", "\u1587": "r",
  "\u1515": "s", "\u144c": "u", "\u142f": "v", "\u15ef": "w", "\u1614": "z",
};

/** Digits and signs that stand in for letters. */
const LETTER_STANDINS: Readonly<Record<string, string>> = { "1": "i", l: "i", "|": "i", "3": "e", "0": "o", "5": "s", "4": "a" };

/** Ignored between letters when matching: whitespace, `_`, `-` (any dash), `.`. Zero-width characters are already gone. */
const MATCH_SEPARATOR = /^[\s_.\p{Pd}]$/u;
/**
 * Separator letters: modifier letters (Lm, e.g. `ʼ`), the Arabic tatweel, and
 * enclosed, circled and parenthesised letters and digits. They fold to the
 * plain letter or digit they stand for, or to nothing, and split words for
 * the script check.
 */
const SEPARATOR_LETTER = /^[\p{Lm}\u0640\u2460-\u24FF\u2776-\u2793\u3200-\u32FF\u{1F100}-\u{1F1FF}]$/u;
/** What a separator letter keeps of its fold: plain letters and digits, never a modifier letter. */
const NOT_PLAIN_LETTER = /[^\p{Ll}\p{Lu}\p{Lt}\p{Lo}\p{N}]/gu;

/**
 * One character, folded for matching (the backend's `foldForMatch`):
 * separators to nothing; otherwise NFKD with combining marks dropped (so `é`,
 * `e` + U+0301 and `e` all read `e`), lower case, lookalike letters to Latin,
 * and digit stand-ins (`1 l |`→i, `3`→e, `0`→o, `5`→s, `4`→a) to letters. A
 * separator letter keeps only the plain letters and digits of that (`ⓡ`→r,
 * `⑴`→i, `ʼ` and the tatweel → nothing).
 */
export function foldForMatch(char: string): string {
  if (MATCH_SEPARATOR.test(char)) return "";
  const folded = [...char.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()]
    .map((c) => LATIN_LOOKALIKES[c] ?? LETTER_STANDINS[c] ?? c)
    .join("");
  return SEPARATOR_LETTER.test(char) ? folded.replace(NOT_PLAIN_LETTER, "") : folded;
}

/** Splits a name into words for the script check. */
const WORD_SPLIT = /[^\p{L}\p{M}\p{N}]|[\p{Lm}\u0640\u2460-\u24FF\u2776-\u2793\u3200-\u32FF\u{1F100}-\u{1F1FF}]/u;
const LATIN_LETTER = /^\p{sc=Latin}$/u;
/** Scripts a word may mix with Latin: none of theirs, plus the CJK set of UTS #39. */
const LATIN_COMPANION = /^[\p{sc=Common}\p{sc=Inherited}\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}\p{sc=Bopomofo}]$/u;

/**
 * Whether a word of the name mixes Latin letters with letters of another
 * script (UTS #39 "highly restrictive", per word), the shape of a lookalike
 * spelling: `Ꮩerified` (Cherokee), `ꓦerified` (Lisu), `Vеrified`
 * (Cyrillic). The backend's `mixesScripts`, which refuses such a name; here
 * the page shows the domain instead, with the "Not verified" pill. Each word
 * is compared after NFKC. Digits and marks belong to no script; Latin may
 * join Han, Hiragana, Katakana, Hangul and Bopomofo. A name wholly in one
 * script passes.
 */
export function mixesScripts(name: string): boolean {
  for (const part of name.replace(INVISIBLE, "").split(WORD_SPLIT)) {
    let latin = false;
    let other = false;
    for (const c of part.normalize("NFKC")) {
      if (!/^\p{L}$/u.test(c)) continue;
      if (LATIN_LETTER.test(c)) latin = true;
      else if (!LATIN_COMPANION.test(c)) other = true;
    }
    if (latin && other) return true;
  }
  return false;
}

/** Never shown in any app's name: a trust claim. */
const TRUST_PHRASES = ["verified"];
/**
 * Never shown in the name of an app other than the built-in one: the words
 * of the built-in app's own header ("Assay app (says it is) · an app on this
 * computer").
 */
const BUILTIN_TITLE_PHRASES = ["assay app", "says it is", "an app on this computer"];

/** Separators trimmed from the ends after a removal: space, `_`, `-`, `.`, `·` and the like. */
const END_SEPARATORS = /^[\s\p{Pd}\p{Po}\p{Pe}_]+|[\s\p{Pd}\p{Po}\p{Ps}_]+$/gu;

/**
 * A name an app supplied, without anything that could read as a trust claim:
 * NFKC first (fullwidth and mathematical letters become plain ones), then
 * invisible characters and symbols removed, then each of `phrases` removed
 * wherever it is, matched on a folded copy (`foldForMatch`) so case, accents,
 * lookalike letters, digit stand-ins and separators between letters do not
 * hide it. Brackets left empty and separators left dangling are removed.
 */
function stripTrustText(raw: string, phrases: readonly string[] = TRUST_PHRASES): string {
  const normalised = raw.normalize("NFKC");
  const chars = [...normalised.replace(INVISIBLE, "").replace(SYMBOLS, " ")];
  let changed = chars.join("") !== normalised;
  const targets = phrases.map((phrase) => [...phrase].map(foldForMatch).join(""));
  for (;;) {
    const folded = chars.map(foldForMatch);
    const joined = folded.join("");
    let at = -1;
    let target = "";
    for (const candidate of targets) {
      const found = joined.indexOf(candidate);
      if (found >= 0 && (at < 0 || found < at)) {
        at = found;
        target = candidate;
      }
    }
    if (at < 0) break;
    // Map the match back to characters of the shown name.
    let offset = 0;
    let from = -1;
    let to = -1;
    for (let i = 0; i < folded.length; i += 1) {
      const next = offset + folded[i]!.length;
      if (from < 0 && next > at) from = i;
      if (next >= at + target.length) {
        to = i;
        break;
      }
      offset = next;
    }
    // Marks that followed the last letter go with it, and so do separator
    // letters that fold to nothing (`ʼ`, the tatweel) on either side.
    while (to + 1 < chars.length && folded[to + 1] === "" && /\p{M}/u.test(chars[to + 1]!)) to += 1;
    while (to + 1 < chars.length && folded[to + 1] === "" && SEPARATOR_LETTER.test(chars[to + 1]!)) to += 1;
    while (from > 0 && folded[from - 1] === "" && SEPARATOR_LETTER.test(chars[from - 1]!)) from -= 1;
    chars.splice(from, to - from + 1, " ");
    changed = true;
  }
  let spaced = chars.join("").replace(/\s+/g, " ").trim();
  if (!changed) return spaced;
  spaced = spaced.replace(/[(\[{]\s*[)\]}]/g, " ").replace(/\s+/g, " ").trim();
  spaced = spaced.replace(END_SEPARATORS, "").trim();
  return /[\p{L}\p{N}]/u.test(spaced) ? spaced : "";
}

/**
 * A name the client supplied, fit to show: no check mark or symbol of any
 * kind, and no "verified" in any spelling, so an app cannot name itself
 * "Claude Code ✓ Verified". Whether an app is verified comes only from the
 * API's `verified` field (§6.3.6), never from text. The backend refuses such
 * names too; this is the page's own defence.
 *
 * A name with a word that mixes Latin with another script
 * ({@link nameIsFlagged}) is not shown at all: the domain stands in for it,
 * and the page shows the "Not verified" pill.
 */
export function displayClientName(
  name: string,
  options: { builtin?: boolean; registrableDomain?: string | null } = {},
): string {
  const fallback = options.registrableDomain || "Unnamed app";
  if (nameIsFlagged(name, options)) return fallback;
  const phrases = options.builtin ? TRUST_PHRASES : [...TRUST_PHRASES, ...BUILTIN_TITLE_PHRASES];
  return stripTrustText(name, phrases) || fallback;
}

/** Whether an app's own name is replaced by its domain: a word of it mixes scripts. Never the built-in app's. */
export function nameIsFlagged(name: string, options: { builtin?: boolean } = {}): boolean {
  return !options.builtin && mixesScripts(name);
}

function clientTitle(request: ConsentRequest, name: string, verified: boolean): string {
  const { client, returnTo } = request;
  if (client.builtin) return "Assay app (says it is) · an app on this computer";
  // The badge, from the structured field only.
  if (verified) return `${name} ✓ Verified`;
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
  const name = displayClientName(client.name, { builtin: client.builtin, registrableDomain: client.registrableDomain });
  // A flagged name never wears the badge, whatever the API says.
  const verified = client.verified && !nameIsFlagged(client.name, { builtin: client.builtin });

  const agentNotes: string[] = [];
  if (request.agents.length === 0) agentNotes.push(CONSENT_STRINGS.noAgents);
  if (agent && !agent.active) agentNotes.push(CONSENT_STRINGS.paused);
  // The backend's cap leaves out a live grant this approval replaces (a dead one is not counted anyway).
  const atLimit =
    !!agent && agent.liveOAuthCredentials >= GRANT_LIMIT && !(replaces?.live && replaces.agentId === agent.id);
  if (atLimit) agentNotes.push(CONSENT_STRINGS.grantLimit);
  else if (agent && agent.liveOAuthCredentials >= GRANT_WARN_AT) {
    agentNotes.push(
      `This agent has ${agent.liveOAuthCredentials} connected apps. Revoke ones you no longer use in Agents & keys.`,
    );
  }

  let replacesLine: ConsentView["replaces"] = null;
  if (replaces && agent) {
    // `replaces` is only ever a grant of the built-in app, named "Assay app on {device}".
    const old = displayClientName(replaces.name, { builtin: true });
    replacesLine =
      agent.id === replaces.agentId
        ? {
            tone: "info",
            text: replaces.narrowed
              ? `Replaces ${old}. Its tool limits are kept.`
              : `Replaces ${old}.`,
          }
        : replaces.live
          ? { tone: "warning", text: `This keeps ${old} connected. It will not be replaced.` }
          : null;
  }

  const appName = client.builtin ? "the Assay app" : name;

  return {
    client: {
      title: clientTitle(request, name, verified),
      verified: verified && !client.builtin,
      kindLabel: client.kind === "DCR" ? CONSENT_STRINGS.selfRegistered : null,
      domain: client.registrableDomain,
      host: !verified && client.host && client.host !== client.registrableDomain ? client.host : null,
    },
    // Every client the API does not mark verified, the built-in one included:
    // any process on the computer can claim to be it.
    notVerified: verified ? null : CONSENT_STRINGS.notVerified,
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

/**
 * The name field's starting value: the API's suggestion, without trust marks.
 * For an app whose name is flagged, the suggestion (its name and a date) is
 * not used: the field starts at the app's domain, or empty.
 */
export function initialName(
  request: Pick<ConsentRequest, "suggestedName"> & {
    client?: Pick<ConsentRequest["client"], "builtin"> & Partial<Pick<ConsentRequest["client"], "name" | "registrableDomain">>;
  },
): string {
  // The built-in app's suggestion is "Assay app on {device}"; any other app's is its own name and a date.
  const builtin = request.client?.builtin ?? false;
  if (nameIsFlagged(request.client?.name ?? request.suggestedName, { builtin })) {
    return request.client?.registrableDomain ?? "";
  }
  return stripTrustText(request.suggestedName, builtin ? TRUST_PHRASES : [...TRUST_PHRASES, ...BUILTIN_TITLE_PHRASES]);
}

/** The API answered with a `redirectTo` that is not the `continue` step: the page does not go there. */
export class ContinueUrlRefused extends Error {
  constructor() {
    super(CONSENT_STRINGS.badRedirect);
    this.name = "ContinueUrlRefused";
  }
}

/**
 * Whether `redirectTo` is the MCP host's `continue` step, the only place the
 * page ever navigates to after a decision. The origin must be the configured
 * MCP host; without one (the build requires it) every URL is refused.
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
  if (!configured) return false;
  try {
    return url.origin === new URL(configured).origin;
  } catch {
    return false;
  }
}
