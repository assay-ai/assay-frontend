/**
 * DEMO ONLY: which picture the tool-set, Connect and refused-call fixtures
 * paint (`fixtures-toolsets.ts`), so every state of the Connect sheet,
 * Servers in use, "What this agent can use" and the refused-call view can be
 * looked at without a backend. Open any page with `?connect=<variant>`; the
 * choice is kept for the browser tab (sessionStorage) like `?debt=`, and
 * `?connect=default` goes back.
 *
 *   default     — "prod" can use only its tool set and three tools, with
 *                 provider limits (one provider excluded, max $0.005 a call);
 *                 two servers in use; four refused calls. "staging" can use
 *                 everything and has one URL waiting for its first call.
 *   all         — "prod" can use everything, with no provider limits: the
 *                 Connect sheet shows no blocked tools.
 *   nothing     — "prod" is restricted to nothing: every preview says so and
 *                 Copy is off until "Allow them".
 *   waiting     — "prod" was handed a URL that has had no call yet, so its
 *                 Servers in use shows "Waiting for the first call".
 *   over-budget — "prod"'s servers show 29 tools between them (over 25).
 *   single      — refused calls on a one-provider tool only ("This tool has
 *                 one provider, so nothing else can run it.").
 *   preview-error — every Connect preview fails: "Couldn't load the tool list".
 *   empty       — no tool sets, no servers in use, no refused calls.
 *
 * Sharing (T2). In `default` the account has no public name yet, so the
 * Share dialog asks for one inline; "Weather and places" has a v1 saved for
 * the team.
 *
 *   shared          — public name @brightpath; "Research kit" is listed in
 *                     the catalogue at v3 (the Draft has one change since),
 *                     with weekly figures above 5 teams; "Weather and places"
 *                     is shared by link.
 *   unlisted        — "Research kit" is shared by link at v2, figures below 5.
 *   update-available — "prod" uses @marketkit/crypto-research locked to v2
 *                     while v3 is out: the chip in Servers in use and in What
 *                     this agent can use, and the alert.
 *   delisted        — Assay took "Research kit" out of the catalogue.
 *   stopped         — the owner stopped sharing "Research kit"; old links
 *                     work for 90 more days.
 *   removed         — "Research kit" was taken down.
 *   handle-taken    — claiming any public name answers "taken", with free
 *                     suggestions (picking one works).
 *   claim-refused   — claiming a public name is refused until funds are added.
 */
export type DemoConnectVariant =
  | "default"
  | "all"
  | "nothing"
  | "waiting"
  | "over-budget"
  | "single"
  | "preview-error"
  | "empty"
  | "shared"
  | "unlisted"
  | "update-available"
  | "delisted"
  | "stopped"
  | "removed"
  | "handle-taken"
  | "claim-refused";

export const DEMO_CONNECT_VARIANTS: readonly DemoConnectVariant[] = [
  "default",
  "all",
  "nothing",
  "waiting",
  "over-budget",
  "single",
  "preview-error",
  "empty",
  "shared",
  "unlisted",
  "update-available",
  "delisted",
  "stopped",
  "removed",
  "handle-taken",
  "claim-refused",
];

const KEY = "assay.demo.connect";

export function parseConnectVariant(value: string | null | undefined): DemoConnectVariant | null {
  return value && (DEMO_CONNECT_VARIANTS as readonly string[]).includes(value) ? (value as DemoConnectVariant) : null;
}

export function demoConnectVariant(): DemoConnectVariant {
  if (typeof window === "undefined") return "default";
  try {
    const asked = parseConnectVariant(new URLSearchParams(window.location.search).get("connect"));
    if (asked) {
      if (asked === "default") window.sessionStorage.removeItem(KEY);
      else window.sessionStorage.setItem(KEY, asked);
      return asked;
    }
    return parseConnectVariant(window.sessionStorage.getItem(KEY)) ?? "default";
  } catch {
    return "default";
  }
}
