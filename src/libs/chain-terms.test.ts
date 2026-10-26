import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TEST_CHAIN } from "@/test/chain-fixture";

import {
  chainTerms,
  compoundDurationText,
  durationText,
  fillTerms,
  percentText,
  termsChain,
  UNKNOWN,
  UNKNOWN_TERMS,
  usdText,
} from "./chain-terms";

describe("chain terms: every on-chain number comes from GET /chains", () => {
  it("words the chain's values", () => {
    expect(chainTerms(TEST_CHAIN)).toEqual({
      feePercent: "10%",
      minimumStake: "$50.00",
      dailyCapPercent: "10%",
      penaltyCeiling: "$1.00",
      agentShare: "60%",
      platformShare: "30%",
      providerShare: "10%",
      unbonding: "11 days",
      slashDelay: "72 hours",
      holdWindow: "1 hour",
      holdCompound: "1-hour",
      withdrawDelay: "3 hours",
      tightenDelay: "3 hours",
      redeemGrace: "2 hours",
      heldTimeout: "7 days",
    });
  });

  it("follows a changed chain value, in both directions", () => {
    const changed = chainTerms({
      ...TEST_CHAIN,
      params: { ...TEST_CHAIN.params!, minimumStake: "20000000", takeRateBps: 1250, collectHoldSeconds: 7200, slashCapBps: 500 },
    });
    expect(changed.minimumStake).toBe("$20.00");
    expect(changed.feePercent).toBe("12.5%");
    expect(changed.holdWindow).toBe("2 hours");
    expect(changed.holdCompound).toBe("2-hour");
    expect(changed.dailyCapPercent).toBe("5%");
  });

  it("reads — for every value before the chain answered, never a guess", () => {
    for (const value of Object.values(UNKNOWN_TERMS)) expect(value).toBe(UNKNOWN);
    expect(chainTerms({ ...TEST_CHAIN, params: { ...TEST_CHAIN.params!, minimumStake: null } }).minimumStake).toBe(UNKNOWN);
  });

  it("formats durations, percentages and dollars", () => {
    expect(durationText(600)).toBe("10 minutes");
    expect(durationText(259_200)).toBe("72 hours");
    expect(durationText(950_400)).toBe("11 days");
    expect(durationText(null)).toBe(UNKNOWN);
    expect(compoundDurationText(3600)).toBe("1-hour");
    expect(percentText(1000)).toBe("10%");
    expect(usdText("1234567890", 6)).toBe("$1,234.56");
  });

  it("fills placeholders in static copy", () => {
    expect(fillTerms("held for {{holdWindow}}, at most {{dailyCapPercent}}", chainTerms(TEST_CHAIN))).toBe("held for 1 hour, at most 10%");
    expect(fillTerms("{{unknownKey}}", chainTerms(TEST_CHAIN))).toBe("{{unknownKey}}");
  });

  it("picks the named chain, else the first chain with params", () => {
    const solana = { ...TEST_CHAIN, chainId: "solana:x", params: undefined };
    expect(termsChain([solana, TEST_CHAIN])?.chainId).toBe(TEST_CHAIN.chainId);
    expect(termsChain([solana, TEST_CHAIN], "solana:x")?.chainId).toBe("solana:x");
    expect(termsChain([])).toBeNull();
  });
});

/**
 * The hard-coded copies the on-chain consistency audit found (2026-10-25) are
 * gone: no module keeps its own fee, minimum stake, slash split or cap,
 * unbonding period, dispute hold, withdrawal delay or redeem grace.
 */
describe("no hard-coded chain constants", () => {
  const SRC = join(process.cwd(), "src");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  walk(SRC);
  const source = (relative: string) => readFileSync(join(SRC, relative), "utf8");

  it("defines none of the removed constants anywhere", () => {
    const removed = [
      "FEE_RATE",
      "STAKE_FLOOR",
      "DAILY_CAP_PERCENT",
      "SLASH_AGENT_BPS",
      "SLASH_PLATFORM_BPS",
      "SLASH_SPLIT_SOURCE",
      "REDEEM_GRACE_SECONDS",
      "MIN_UNBONDING_MS",
      "REPORT_WINDOW",
      "DISPUTE_HOLD_MINUTES",
      "HELD_TIMEOUT_DAYS",
      "MIN_VALID_UNTIL_LEAD_SECONDS",
      "DESIGN_TERMS",
    ];
    const offenders = files.flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return removed.filter((name) => new RegExp(`\\b${name}\\b`).test(text)).map((name) => `${path}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps no fallback numbers for the stake floor, the fee or the split", () => {
    const goLive = source("features/provider-binding/go-live.ts");
    expect(goLive).not.toMatch(/new Decimal\(50\)/);
    expect(goLive).not.toMatch(/new Decimal\("0\.1"\)/);
    expect(source("features/explorer/provider-economics.ts")).not.toMatch(/new Decimal\("0\.10"\)|new Decimal\("50"\)/);
    expect(source("features/m41/terms.ts")).not.toMatch(/"10%"|\$50\.00|60 \/ 30 \/ 10|1 hour/);
    expect(source("features/provider-slash-case/distribution.ts")).not.toMatch(/=\s*6000|=\s*3000/);
    expect(source("features/operator/penalty-money.tsx")).not.toMatch(/=\s*3000/);
  });

  it("states the withdrawal wait from the chain, never 'about 1 h'", () => {
    const sheets = source("components/buyer-money/withdraw-sheets.tsx");
    expect(sheets).not.toMatch(/about 1 h\b|about an hour|three hours|~3 hours|~1 hour/);
    expect(source("components/buyer-money/funding-view.tsx")).not.toMatch(/~1 hour/);
    expect(source("components/buyer-money/deposit-sheet.tsx")).not.toMatch(/three hours|about an hour/);
  });

  it("states the hold, the cap and the slash delay from the chain on the public pages", () => {
    const why = source("app/(public)/why-list-here/page.tsx");
    expect(why).not.toMatch(/72 hours|\$50 or|1 hour/);
    expect(source("libs/glossary.ts")).not.toMatch(/"1 hour"|The hour after/);
    expect(source("app/(public)/demo/page.tsx")).not.toMatch(/72-hour/);
  });
});
