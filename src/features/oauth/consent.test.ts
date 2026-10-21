import { describe, expect, it } from "vitest";

import { AUTHORIZE_ERROR_COPY, AUTHORIZE_ERROR_FALLBACK, authorizeErrorText } from "./authorize-error";

import {
  CONSENT_STRINGS,
  consentFailure,
  consentView,
  defaultAgentId,
  displayClientName,
  foldForMatch,
  initialName,
  isContinueUrl,
  lockedAgentName,
  limitsLine,
  mixesScripts,
  nameIsFlagged,
  nameProblem,
  startedAgo,
  type ConsentRequest,
} from "./consent";
import VECTORS from "./client-name-fold.vectors.json";

/** A shown name folded as for matching, to check no "verified" is left in any spelling. */
const foldedText = (shown: string) => [...shown.normalize("NFKC")].map(foldForMatch).join("");

const usd = (amount: string) => ({ amount, asset: "eip155:46630/erc20:0x0", decimals: 6 });
const NOW = new Date("2026-10-19T10:00:12.000Z");

function agent(overrides: Partial<ConsentRequest["agents"][number]> = {}): ConsentRequest["agents"][number] {
  return {
    id: "agt-1",
    label: "research-bot",
    active: true,
    limits: { perCall: usd("500000"), perDay: usd("5000000"), freeCallsPerDay: 100 },
    access: { mode: "ALL", summary: "All tools" },
    liveOAuthCredentials: 3,
    ...overrides,
  };
}

function request(overrides: Partial<ConsentRequest> = {}): ConsentRequest {
  return {
    requestId: "r",
    createdAt: "2026-10-19T10:00:00.000Z",
    expiresAt: "2026-10-19T10:10:00.000Z",
    client: {
      name: "Claude Code",
      kind: "CIMD",
      registrableDomain: "claude.ai",
      host: "claude.ai",
      verified: true,
      builtin: false,
      paymentClient: false,
    },
    returnTo: { kind: "WEB", display: "claude.ai" },
    scope: ["assay:agent", "offline_access"],
    agents: [agent()],
    suggestedName: "Claude Code · 2026-10-19",
    ...overrides,
  };
}

/** Fetched the moment it was created; NOW is 12 s later. */
const FETCHED_AT = Date.parse("2026-10-19T10:00:00.000Z");
const view = (req: ConsentRequest, agentId: string | null = defaultAgentId(req)) =>
  consentView(req, { agentId, now: NOW, fetchedAt: FETCHED_AT });

describe("consent view: the client", () => {
  it('verified client → "Claude Code ✓ Verified"', () => {
    const v = view(request());
    expect(v.client.title).toBe("Claude Code ✓ Verified");
    expect(v.client.verified).toBe(true);
    expect(v.notVerified).toBeNull();
    expect(v.client.domain).toBe("claude.ai");
  });

  it('builtin → "Assay app (says it is) · an app on this computer" and the will-not line', () => {
    const v = view(
      request({
        client: {
          name: "Assay app (assay-mcp)",
          kind: "BUILTIN",
          registrableDomain: null,
          host: null,
          verified: false,
          builtin: true,
          paymentClient: true,
        },
        returnTo: { kind: "LOCAL_APP", display: "an app on this computer" },
      }),
    );
    expect(v.client.title).toBe("Assay app (says it is) · an app on this computer");
    expect(v.cannotDo).toContain("make paid calls until you turn them on, on a separate page, with your wallet");
    expect(v.cannotDo.join(" ")).not.toContain("Only the Assay app on your computer can");
    // Any local process can claim to be the Assay app: no "Verified", and the amber line.
    expect(v.client.verified).toBe(false);
    expect(v.notVerified).toBe("Not verified by Assay. Only approve if you just started this from an app you trust.");
  });

  it("not verified → amber copy exactly §6.5, domain bold and the full host under it", () => {
    const v = view(
      request({
        client: {
          name: "Some Tool",
          kind: "CIMD",
          registrableDomain: "example.com",
          host: "app.tools.example.com",
          verified: false,
          builtin: false,
          paymentClient: false,
        },
        returnTo: { kind: "WEB", display: "app.tools.example.com" },
      }),
    );
    expect(v.notVerified).toBe("Not verified by Assay. Only approve if you just started this from an app you trust.");
    expect(v.client.title).toBe("Some Tool");
    expect(v.client.domain).toBe("example.com");
    expect(v.client.host).toBe("app.tools.example.com");
  });

  it("not verified, returning to a local app → says it is, and Assay can't confirm which app", () => {
    const v = view(
      request({
        client: {
          name: "Cursor",
          kind: "CIMD",
          registrableDomain: "cursor.com",
          host: "cursor.com",
          verified: false,
          builtin: false,
          paymentClient: false,
        },
        returnTo: { kind: "LOCAL_APP", display: "an app on this computer" },
      }),
    );
    expect(v.client.title).toBe("Cursor (says it is) · an app on this computer · Assay can't confirm which app");
    expect(v.notVerified).not.toBeNull();
  });

  it('DCR → "Self-registered app"', () => {
    const v = view(
      request({
        client: {
          name: "Visual Studio Code",
          kind: "DCR",
          registrableDomain: null,
          host: null,
          verified: false,
          builtin: false,
          paymentClient: false,
        },
        returnTo: { kind: "LOCAL_APP", display: "an app on this computer" },
      }),
    );
    expect(v.client.kindLabel).toBe("Self-registered app");
    expect(v.notVerified).not.toBeNull();
  });

  describe("DCR domain line, from the HTTPS return host (§6.5)", () => {
    const dcr = (returnTo: ConsentRequest["returnTo"]) =>
      view(
        request({
          client: {
            name: "E2E Web App",
            kind: "DCR",
            registrableDomain: null,
            host: null,
            verified: false,
            builtin: false,
            paymentClient: false,
          },
          returnTo,
        }),
      );

    it("a subdomain: registrable domain bold, the full host under it, still Self-registered", () => {
      const v = dcr({ kind: "WEB", display: "app.tools.example.co.uk" });
      expect(v.client.domain).toBe("example.co.uk");
      expect(v.client.host).toBe("app.tools.example.co.uk");
      expect(v.client.kindLabel).toBe("Self-registered app");
    });

    it("the registrable domain itself: no second line", () => {
      const v = dcr({ kind: "WEB", display: "chatgpt.com" });
      expect(v.client.domain).toBe("chatgpt.com");
      expect(v.client.host).toBeNull();
    });

    it("a private suffix stays its own site (foo.github.io, not github.io)", () => {
      expect(dcr({ kind: "WEB", display: "foo.github.io" }).client.domain).toBe("foo.github.io");
    });

    it("loopback / private scheme: nothing extra", () => {
      const v = dcr({ kind: "LOCAL_APP", display: "an app on this computer" });
      expect(v.client.domain).toBeNull();
      expect(v.client.host).toBeNull();
    });

    it("an IP or a host with no public suffix: nothing extra", () => {
      expect(dcr({ kind: "WEB", display: "203.0.113.7" }).client.domain).toBeNull();
      expect(dcr({ kind: "WEB", display: "intranet" }).client.domain).toBeNull();
    });
  });

  it("third-party will-not line names the Assay app as the only payer", () => {
    expect(view(request()).cannotDo).toEqual([
      "change limits, move funds or add people",
      "make paid calls. Only the Assay app on your computer can, after you approve a payment key in your wallet.",
    ]);
  });

  it("return and recency lines", () => {
    const v = view(request());
    expect(v.returnLine).toBe("After you approve, you go back to: claude.ai");
    expect(v.recencyLine).toBe("Only approve if you clicked Connect in Claude Code in the last few minutes.");
    expect(v.startedAgo).toBe("started 12 seconds ago");
  });
});

describe("consent view: the agent", () => {
  it('limits line "$0.50 a call · $5 a day · 100 free calls a day · All tools"', () => {
    expect(limitsLine(agent())).toBe("$0.50 a call · $5 a day · 100 free calls a day · All tools");
    expect(view(request()).limitsLine).toBe("$0.50 a call · $5 a day · 100 free calls a day · All tools");
  });

  it("limits line follows the chosen agent, from that agent's own limits in the request (BUG-BUY-CONNECT-05)", () => {
    const req = request({
      agents: [agent(), agent({ id: "agt-2", label: "ops", limits: { perCall: usd("10000"), perDay: null, freeCallsPerDay: 100 } })],
    });
    expect(view(req, "agt-1").limitsLine).toBe("$0.50 a call · $5 a day · 100 free calls a day · All tools");
    expect(view(req, "agt-2").limitsLine).toBe("$0.01 a call · No daily limit · 100 free calls a day · All tools");
  });

  it("limits line with no ceilings says so", () => {
    expect(limitsLine(agent({ limits: { perCall: null, perDay: null, freeCallsPerDay: 100 } }))).toBe(
      "No limit a call · No daily limit · 100 free calls a day · All tools",
    );
  });

  it("the picker is hidden with one agent and shown with two", () => {
    expect(view(request()).showAgentPicker).toBe(false);
    expect(view(request({ agents: [agent(), agent({ id: "agt-2", label: "ops" })] })).showAgentPicker).toBe(true);
  });

  it("45 live → the warning text", () => {
    const v = view(request({ agents: [agent({ liveOAuthCredentials: 45 })] }));
    expect(v.agentNotes).toContain(
      "This agent has 45 connected apps. Revoke ones you no longer use in Agents & keys.",
    );
    expect(v.approveDisabled).toBe(false);
    expect(view(request({ agents: [agent({ liveOAuthCredentials: 44 })] })).agentNotes).toEqual([]);
  });

  it("inactive agent → Approve disabled + text", () => {
    const v = view(request({ agents: [agent({ active: false })] }));
    expect(v.approveDisabled).toBe(true);
    expect(v.agentNotes).toContain("This agent is paused. Turn it back on in Agents & keys first.");
  });

  it("no agent chosen → Approve disabled", () => {
    expect(view(request({ agents: [] }), null).approveDisabled).toBe(true);
  });

  it("defaults to the first active agent", () => {
    const req = request({ agents: [agent({ id: "a", active: false }), agent({ id: "b" })] });
    expect(defaultAgentId(req)).toBe("b");
  });
});

describe("consent view: replaces", () => {
  const replacing = (narrowed: boolean) =>
    request({
      agents: [agent({ id: "a" }), agent({ id: "b", label: "ops" })],
      replaces: { id: "c-old", name: "Assay app on this Mac", agentId: "b", narrowed, live: true },
    });

  it("pre-selects the replaced grant's agent", () => {
    expect(defaultAgentId(replacing(true))).toBe("b");
  });

  it('replaces narrowed → "Replaces {old}. Its tool limits are kept."', () => {
    expect(view(replacing(true)).replaces).toEqual({
      tone: "info",
      text: "Replaces Assay app on this Mac. Its tool limits are kept.",
    });
  });

  it("replaces, not narrowed → no tool-limits sentence", () => {
    expect(view(replacing(false)).replaces).toEqual({ tone: "info", text: "Replaces Assay app on this Mac." });
  });

  it("picking another agent keeps the old one connected", () => {
    expect(view(replacing(true), "a").replaces).toEqual({
      tone: "warning",
      text: "This keeps Assay app on this Mac connected. It will not be replaced.",
    });
  });

  it("no replaces → nothing", () => {
    expect(view(request()).replaces).toBeNull();
  });

  it("a replaced agent that is not in the list is not pre-selected", () => {
    const req = request({ replaces: { id: "c", name: "Old", agentId: "gone", narrowed: false, live: true } });
    expect(defaultAgentId(req)).toBe("agt-1");
  });
});

describe("consent view: signing in again (replacesAgent)", () => {
  const two = [agent({ id: "a", label: "research-bot" }), agent({ id: "b", label: "ops" })];

  it("pre-selects that agent, hides the picker and says so", () => {
    const req = request({ agents: two, replacesAgent: { id: "b", name: "ops" } });
    expect(defaultAgentId(req)).toBe("b");
    const v = view(req);
    expect(v.showAgentPicker).toBe(false);
    expect(v.relogin).toBe("Signing in again for ops.");
    expect(v.agent?.id).toBe("b");
  });

  it("wins over a replaced grant's agent", () => {
    const req = request({
      agents: two,
      replaces: { id: "c", name: "Assay app on this Mac", agentId: "a", narrowed: false, live: true },
      replacesAgent: { id: "b", name: "ops" },
    });
    expect(defaultAgentId(req)).toBe("b");
  });

  it("absent (older API) or null → the picker as before", () => {
    for (const req of [request({ agents: two }), request({ agents: two, replacesAgent: null })]) {
      expect(defaultAgentId(req)).toBe("a");
      expect(view(req).showAgentPicker).toBe(true);
      expect(view(req).relogin).toBeNull();
    }
  });

  it("an agent not in the list locks nothing", () => {
    const req = request({ agents: two, replacesAgent: { id: "gone", name: "old" } });
    expect(defaultAgentId(req)).toBe("a");
    expect(view(req).showAgentPicker).toBe(true);
    expect(view(req).relogin).toBeNull();
  });
});

describe("signing in again: refusals that the picker cannot fix (review m3, m4)", () => {
  it("OAUTH_REPLACE_AGENT_MISMATCH is final, in the API's words or ours", () => {
    expect(consentFailure("OAUTH_REPLACE_AGENT_MISMATCH", { message: "Sign out in the app first." })).toEqual({
      kind: "final",
      text: "Sign out in the app first.",
    });
    expect(consentFailure("OAUTH_REPLACE_AGENT_MISMATCH", { message: "  " })).toEqual({
      kind: "final",
      text: "This sign-in replaces another agent's connection. Sign out in the app first, then connect again.",
    });
  });

  it("a paused locked agent: resume it or sign out in the app, never pick another", () => {
    const text = "ops is paused. Resume it in Agents & keys, or sign out in the app to connect another agent.";
    expect(consentFailure("OAUTH_AGENT_NOT_ACTIVE", { lockedAgent: "ops" })).toEqual({ kind: "agent", text });
    expect(consentFailure("OAUTH_AGENT_NOT_ACTIVE").text).toBe(CONSENT_STRINGS.paused);
    const req = request({
      agents: [agent({ id: "a" }), agent({ id: "b", label: "ops", active: false })],
      replacesAgent: { id: "b", name: "ops" },
    });
    expect(lockedAgentName(req)).toBe("ops");
    expect(view(req).agentNotes).toEqual([text]);
    expect(view(req).approveDisabled).toBe(true);
  });
});

describe("consent view: time", () => {
  it("startedAgo", () => {
    const at = (s: number) => new Date(Date.parse("2026-10-19T10:00:00.000Z") + s * 1000);
    expect(startedAgo("2026-10-19T10:00:00.000Z", at(0))).toBe("started just now");
    expect(startedAgo("2026-10-19T10:00:00.000Z", at(1))).toBe("started 1 second ago");
    expect(startedAgo("2026-10-19T10:00:00.000Z", at(65))).toBe("started 1 minute ago");
    expect(startedAgo("2026-10-19T10:00:00.000Z", at(300))).toBe("started 5 minutes ago");
    expect(startedAgo("2026-10-19T10:00:00.000Z", at(-30))).toBe("started just now");
  });

  it("past expiresAt → expired", () => {
    expect(view(request()).expired).toBe(false);
    const late = consentView(request(), {
      agentId: "agt-1",
      now: new Date("2026-10-19T10:10:00.000Z"),
      fetchedAt: FETCHED_AT,
    });
    expect(late.expired).toBe(true);
    expect(late.approveDisabled).toBe(true);
  });

  it("a device clock far ahead does not expire the request early", () => {
    // This clock reads an hour fast: it fetched "at 11:00" a request the server made at 10:00.
    const fetchedAt = Date.parse("2026-10-19T11:00:00.000Z");
    const soon = consentView(request(), { agentId: "agt-1", now: new Date(fetchedAt + 60_000), fetchedAt });
    expect(soon.expired).toBe(false);
    const later = consentView(request(), { agentId: "agt-1", now: new Date(fetchedAt + 600_000), fetchedAt });
    expect(later.expired).toBe(true);
  });
});

describe("consent failures", () => {
  it("maps the API's codes to the §6.5 sentences", () => {
    expect(consentFailure("OAUTH_REQUEST_NOT_FOUND")).toEqual({ kind: "final", text: CONSENT_STRINGS.expired });
    expect(CONSENT_STRINGS.expired).toBe("This request expired. Go back to your app and try again.");
    expect(consentFailure("OAUTH_REQUEST_ALREADY_DECIDED")).toEqual({
      kind: "final",
      text: "You already answered this request.",
    });
    expect(consentFailure("OAUTH_AGENT_NOT_ACTIVE").text).toBe(
      "This agent is paused. Turn it back on in Agents & keys first.",
    );
    expect(consentFailure("OAUTH_GRANT_LIMIT_REACHED").kind).toBe("agent");
    expect(consentFailure("OAUTH_CREDENTIAL_NAME_INVALID")).toEqual({
      kind: "name",
      text: "Use a name with letters or numbers. Invisible and control characters are removed.",
    });
    expect(consentFailure("SOMETHING_ELSE").kind).toBe("retry");
  });

  it("an empty name is refused before the request", () => {
    expect(nameProblem("   ")).toBe("Give this connection a name.");
    expect(nameProblem("Claude Code · 2026-10-19")).toBeNull();
  });
});

describe("continue URL", () => {
  it("accepts only {MCP}/oauth/authorize/continue", () => {
    const mcp = "https://mcp.example.com";
    expect(isContinueUrl("https://mcp.example.com/oauth/authorize/continue?request=abc", mcp)).toBe(true);
    expect(isContinueUrl("https://evil.example/oauth/authorize/continue?request=abc", mcp)).toBe(false);
    expect(isContinueUrl("https://mcp.example.com/other", mcp)).toBe(false);
    expect(isContinueUrl("javascript:alert(1)", mcp)).toBe(false);
    expect(isContinueUrl("not a url", mcp)).toBe(false);
    // No MCP host configured: nothing is a continue URL (fail closed).
    expect(isContinueUrl("http://localhost:3002/oauth/authorize/continue?request=abc", undefined)).toBe(false);
    expect(isContinueUrl("https://mcp.example.com/oauth/authorize/continue?request=abc", undefined)).toBe(false);
    expect(isContinueUrl("http://mcp.example.com/oauth/authorize/continue?request=abc", undefined)).toBe(false);
    expect(isContinueUrl("ftp://x/oauth/authorize/continue", undefined)).toBe(false);
  });
});

describe("authorize-error copy", () => {
  it("one sentence per reason the MCP host sends, and a general one otherwise", () => {
    expect(authorizeErrorText("client_unknown")).toBe(AUTHORIZE_ERROR_COPY.client_unknown);
    expect(authorizeErrorText("client_metadata_invalid")).toBe(AUTHORIZE_ERROR_COPY.client_metadata_invalid);
    expect(authorizeErrorText("redirect_uri_mismatch")).toBe(AUTHORIZE_ERROR_COPY.redirect_uri_mismatch);
    expect(authorizeErrorText("toString")).toBe(AUTHORIZE_ERROR_FALLBACK);
    expect(authorizeErrorText(null)).toBe(AUTHORIZE_ERROR_FALLBACK);
  });
});

describe("I3: a client cannot name itself verified", () => {
  const unverified = (name: string, kind: "CIMD" | "DCR" = "CIMD") =>
    request({
      client: {
        name,
        kind,
        registrableDomain: "example.com",
        host: "example.com",
        verified: false,
        builtin: false,
        paymentClient: false,
      },
      suggestedName: `${name} · 2026-10-19`,
    });

  it("strips check marks and the word verified from an unverified client's name, and keeps the amber line", () => {
    for (const name of ["Claude Code ✓ Verified", "Claude Code ✔ verified", "✅ VERIFIED Claude Code", "Claude Code ☑", "Claude Code 🗸 Verified"]) {
      const v = view(unverified(name));
      expect(v.client.title).toBe("Claude Code");
      expect(v.client.verified).toBe(false);
      expect(v.notVerified).toBe("Not verified by Assay. Only approve if you just started this from an app you trust.");
      expect(v.recencyLine).toBe("Only approve if you clicked Connect in Claude Code in the last few minutes.");
    }
  });

  it("DCR too", () => {
    expect(view(unverified("Code ✓ Verified", "DCR")).client.title).toBe("Code");
  });

  it("the badge comes only from the verified field, once", () => {
    const v = view(request({ client: { ...request().client, name: "Claude Code ✓ Verified", verified: true } }));
    expect(v.client.title).toBe("Claude Code ✓ Verified");
    expect(v.client.title.match(/✓/g)).toHaveLength(1);
  });

  it("a name that is only marks becomes 'Unnamed app'", () => {
    expect(displayClientName("✓ ✔ Verified")).toBe("Unnamed app");
    // "verified" goes whatever it is attached to.
    expect(displayClientName("Verifiedness Tool")).toBe("ness Tool");
  });

  it("the suggested name and a replaced connection's name lose the marks too", () => {
    expect(initialName({ suggestedName: "Claude Code ✓ Verified · 2026-10-19" })).toBe("Claude Code · 2026-10-19");
    const v = view(request({ replaces: { id: "c", name: "Old ✓ Verified", agentId: "agt-1", narrowed: false, live: true } }));
    expect(v.replaces?.text).toBe("Replaces Old.");
  });
});

describe("will-not line follows paymentClient", () => {
  it("a payment client that is not the built-in one is not told it can never pay", () => {
    const v = view(request({ client: { ...request().client, paymentClient: true } }));
    expect(v.cannotDo[1]).toBe("make paid calls until you turn them on, on a separate page, with your wallet");
  });
});

describe("agent checks before approve", () => {
  it("no agent → a reason, and Approve off", () => {
    const v = view(request({ agents: [] }), null);
    expect(v.agentNotes).toEqual(["You have no agent yet. Create one in Agents & keys first."]);
    expect(v.approveDisabled).toBe(true);
  });

  it("50 live grants → Approve off, unless this approval replaces one of them", () => {
    const full = { ...request().agents[0]!, liveOAuthCredentials: 50 };
    const v = view(request({ agents: [full] }));
    expect(v.approveDisabled).toBe(true);
    expect(v.agentNotes[0]).toMatch(/^This agent already has 50 connected apps/);
    const replacing = view(
      request({ agents: [full], replaces: { id: "c", name: "Old", agentId: full.id, narrowed: false, live: true } }),
    );
    expect(replacing.approveDisabled).toBe(false);
    // A dead grant frees no place: the backend still refuses at 50 (final review I-1).
    const dead = view(
      request({ agents: [full], replaces: { id: "c", name: "Old", agentId: full.id, narrowed: true, live: false } }),
    );
    expect(dead.approveDisabled).toBe(true);
    expect(dead.replaces?.text).toBe("Replaces Old. Its tool limits are kept.");
  });

  it("a dead grant of another agent: no 'keeps it connected' warning", () => {
    const v = view(
      request({
        agents: [agent({ id: "a" })],
        replaces: { id: "c", name: "Old", agentId: "b", narrowed: true, live: false },
      }),
    );
    expect(v.replaces).toBeNull();
  });

  it("an invisible-only name is empty", () => {
    expect(nameProblem("\u200b\u200e \u2028")).toBe("Give this connection a name.");
  });
});

describe("fix round 2, R1: Unicode spoofs of a verified name", () => {
  // The reviewer's table, plus zero-width and bidi cases.
  const ROWS: [string, string][] = [
    // Follow-up F1: a word mixing Latin with Cyrillic or Greek is flagged; the domain, or "Unnamed app", shows.
    ["Claude Code Vеrified", "Unnamed app"], // Cyrillic е
    ["Claude Code Ｖｅｒｉｆｉｅｄ", "Claude Code"], // fullwidth
    ["Claude Code \u{1D415}\u{1D41E}\u{1D42B}\u{1D422}\u{1D41F}\u{1D422}\u{1D41E}\u{1D41D}", "Claude Code"], // mathematical bold
    ["Claude_Code_Verified", "Claude_Code"],
    ["Claude Code \u{10102} Verified", "Claude Code"], // Aegean check mark
    ["Claude Code \u{1FBB1}", "Claude Code"], // symbols for legacy computing check mark
    ["Claude Code ⍻", "Claude Code"], // not check mark
    ["Veri​fied Claude Code", "Claude Code"], // zero-width space inside the word
    ["Claude Code ‮Verified", "Claude Code"], // RTL override before the word
    ["Claude Code ‮deifirev", "Claude Code deifirev"], // the override is gone, so it reads as written
    ["ClaudeVerified", "Claude"],
    ["Claude Code V̲erified", "Claude Code"], // a combining mark inside the word
    ["Claude Code νεrιfiεd", "Unnamed app"], // Greek ν ε ι, flagged as above
    ["Claude Code VERIFIED2", "Claude Code 2"],
    ["Claude Code ✓️", "Claude Code"],
  ];

  it.each(ROWS)("%j shows as %j", (input, shown) => {
    const out = displayClientName(input);
    expect(out).toBe(shown);
    expect(out.normalize("NFKC").toLowerCase()).not.toContain("verified");
    expect(out).not.toMatch(/[\p{So}\p{Sk}\p{Cf}]/u);
  });

  it("keeps ordinary names as they are", () => {
    for (const name of ["Café Tool", "(beta) Tool", "C++ helper", "Claude Code · 2026-10-19", "Verifiable Tool", "日本語ツール"]) {
      expect(displayClientName(name)).toBe(name);
    }
  });

  it("the suggested name gets the same treatment", () => {
    expect(initialName({ suggestedName: "Claude Code Ｖｅｒｉｆｉｅｄ · 2026-10-19" })).toBe(
      "Claude Code · 2026-10-19",
    );
  });

  it("an unverified spoof never gets the badge, and the amber line shows", () => {
    for (const [input] of ROWS) {
      const v = view(
        request({
          client: { ...request().client, name: input, verified: false },
          returnTo: { kind: "WEB", display: "example.com" },
        }),
      );
      expect(v.client.title).not.toContain("✓");
      expect(v.notVerified).not.toBeNull();
    }
  });
});

describe("fix round 3: accents, separators and digit stand-ins", () => {
  const ROWS: [string, string][] = [
    ["Claude Code Verífied", "Claude Code"], // í precomposed
    ["Claude Code Verífied", "Claude Code"], // i + combining acute
    ["Claude Code vérified", "Claude Code"], // é precomposed
    ["Claude Code vérified", "Claude Code"], // e + combining acute
    ["Claude Code verifíea", "Claude Code verifíea"], // not the word: kept
    ["Claude Code verifíed", "Claude Code"], // í in the second i
    ["Claude Code verifíed", "Claude Code"],
    ["Claude Code ver_ified", "Claude Code"],
    ["Claude Code ver-ified", "Claude Code"],
    ["Claude Code ver.ified", "Claude Code"],
    ["Claude Code ver ified", "Claude Code"],
    ["Claude Code Verif1ed", "Claude Code"],
    ["Claude Code V3rified", "Claude Code"],
    ["Claude Code VERlFlED", "Claude Code"],
    ["Claude Code V3r1f13d", "Claude Code"],
    ["Claude Code |s verified", "Claude Code |s"],
  ];

  it.each(ROWS)("%j shows as %j", (input, shown) => {
    expect(displayClientName(input)).toBe(shown);
  });
});

describe("fix round 3: no app but the built-in one wears its title", () => {
  const client = (name: string, registrableDomain: string | null = "example.com") =>
    request({
      client: { name, kind: "CIMD", registrableDomain, host: registrableDomain, verified: false, builtin: false, paymentClient: false },
      returnTo: { kind: "LOCAL_APP", display: "an app on this computer" },
    });

  it.each([
    ["Assay app", "example.com"],
    ["Assay app (says it is) · an app on this computer", "example.com"],
    ["ASSAY APP", "example.com"],
    ["Assay_App", "example.com"],
    ["Аssay аpp", "example.com"], // Cyrillic А, а
    ["4ssay app helper", "helper"],
    ["Helper, says it is", "Helper"],
    ["Helper — an app on this computer", "Helper"],
  ])("%j shows as %j", (name, shown) => {
    const v = view(client(name));
    expect(v.client.title.startsWith(`${shown} (says it is)`)).toBe(true);
    expect(v.client.title).not.toMatch(/^Assay app/i);
    expect(v.notVerified).not.toBeNull();
  });

  it("an empty name with no domain falls back to 'Unnamed app'", () => {
    expect(displayClientName("Assay app", { registrableDomain: null })).toBe("Unnamed app");
  });

  it("the built-in client keeps its own title, and its suggested name", () => {
    const builtin = request({
      client: { name: "Assay app (assay-mcp)", kind: "BUILTIN", registrableDomain: null, host: null, verified: false, builtin: true, paymentClient: true },
      suggestedName: "Assay app on this Mac",
    });
    expect(view(builtin).client.title).toBe("Assay app (says it is) · an app on this computer");
    expect(initialName(builtin)).toBe("Assay app on this Mac");
  });

  it("another app's suggested name loses the phrases too", () => {
    expect(initialName({ suggestedName: "Assay app · 2026-10-19", client: { builtin: false } })).toBe("2026-10-19");
  });
});

describe("follow-up F1 (R1-m1): fold vectors shared with the backend", () => {
  // The same file as assay-backend test/unit/oauth/client-name-fold.vectors.json.
  it.each(VECTORS.fold.map((v) => [v.group, v.input, v.folded]))("%s: %j folds to %j", (_group, input, folded) => {
    expect(foldForMatch(input)).toBe(folded);
  });

  it.each(VECTORS.mixesScripts.map((v) => [v.name, v.mixed] as const))("%j mixes Latin with another script: %s", (name, mixed) => {
    expect(mixesScripts(name)).toBe(mixed);
  });

  it.each(VECTORS.caught)("%j is never shown as it is", (name) => {
    const shown = displayClientName(name, { registrableDomain: "example.com" });
    expect(shown).not.toBe(name);
    expect(foldedText(shown)).not.toContain("verified");
  });

  it.each(VECTORS.legitimate)("%j is shown unchanged, not flagged", (name) => {
    expect(nameIsFlagged(name)).toBe(false);
    expect(displayClientName(name, { registrableDomain: "example.com" })).toBe(name);
  });
});

describe("follow-up F1 (R1-m1): separator letters and lookalikes outside the old table", () => {
  it.each([
    ["Claude Verifiedʼ", "Claude"],
    ["Claude ʼVerified", "Claude"],
    ["Claude Verifiedـ", "Claude"],
    ["Claude Veriـfied", "Claude"],
    ["Claude Veriʼfied", "Claude"],
    ["Claude Verifieds", "Claude s"],
    ["Claude Verified2026", "Claude 2026"],
    ["Claude ᴠᴇʀɪꜰɪᴇᴅ", "Claude"],
    ["Claude ꓦꓰꓣꓲꓝꓲꓰꓓ", "Claude"],
  ])("%j shows as %j", (input, shown) => {
    expect(displayClientName(input)).toBe(shown);
  });

  it("Verifone and Verifiable keep their names", () => {
    expect(displayClientName("Verifone")).toBe("Verifone");
    expect(displayClientName("Verifiable Tool")).toBe("Verifiable Tool");
  });
});

describe("follow-up F1 (R1-m1): a name mixing Latin with another script shows the domain and the pill", () => {
  const mixed = (name: string, verified = false, registrableDomain: string | null = "example.com") =>
    request({
      client: { name, kind: "CIMD", registrableDomain, host: registrableDomain, verified, builtin: false, paymentClient: false },
      returnTo: { kind: "WEB", display: "example.com" },
      suggestedName: `${name} · 2026-10-19`,
    });

  it.each(["Ꮩerified Tools", "ꓦerified", "ᐯerified", "Claude Cоde", "Νode helper"])("%j", (name) => {
    const v = view(mixed(name));
    expect(v.client.title).toBe("example.com");
    expect(v.client.verified).toBe(false);
    expect(v.notVerified).toBe(CONSENT_STRINGS.notVerified);
    expect(v.recencyLine).toBe("Only approve if you clicked Connect in example.com in the last few minutes.");
    expect(initialName(mixed(name))).toBe("example.com");
  });

  it("never wears the badge, even when the API says verified", () => {
    const v = view(mixed("Claude Cоde", true));
    expect(v.client.title).toBe("example.com");
    expect(v.client.title).not.toContain("✓");
    expect(v.client.verified).toBe(false);
    expect(v.notVerified).not.toBeNull();
  });

  it("with no domain it is 'Unnamed app', and the name field starts empty", () => {
    expect(view(mixed("Claude Cоde", false, null)).client.title).toBe("Unnamed app");
    expect(initialName(mixed("Claude Cоde", false, null))).toBe("");
  });

  it("a name wholly in one script, or Latin with Japanese, is shown as it is", () => {
    for (const name of ["Ассистент", "日本語ツール", "Gitクライアント", "Claude Ассистент"]) {
      expect(view(mixed(name)).client.title).toBe(name);
    }
  });

  it("the built-in app is never flagged", () => {
    expect(nameIsFlagged("Assay app on МакБук", { builtin: true })).toBe(false);
  });
});
