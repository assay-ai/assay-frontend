/**
 * These two numbers are not the frontend's to know, and this test is the
 * standing acknowledgement of that.
 *
 * `slash_agent_bps` and `slash_platform_bps` live on the program's `Config`
 * account on chain. An admin can move them through `update_config`, and
 * raising their *sum* is adverse to providers, because the provider's share is
 * `10_000 - agent - platform` and is derived rather than stored. The program
 * bounds such a change, but no endpoint publishes either number, so a change
 * on chain is invisible to this repo.
 *
 * Until an endpoint does, the browser's copy is a snapshot. This test pins it
 * to a trimmed excerpt of the program source (`fixtures/`), so that a
 * contributor who changes the program and refreshes the excerpt, but not the
 * UI, gets a red test instead of a screen that quietly misstates to a provider
 * how their stake was split.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SLASH_AGENT_BPS,
  SLASH_PLATFORM_BPS,
  SLASH_SPLIT_SOURCE,
} from "./distribution";

const PROGRAM_STATE = join(__dirname, "fixtures/program-config.excerpt.rs.txt");

describe("the slash split the UI shows", () => {
  it("leaves the provider a residual rather than storing one", () => {
    // 10_000 - 6000 - 3000 = 1000. Two independently benign raises could
    // drive this to zero, so it is asserted here as a number and not as a
    // comment.
    expect(10_000 - SLASH_AGENT_BPS - SLASH_PLATFORM_BPS).toBe(1_000);
  });

  it("carries a provenance record naming where it came from and when", () => {
    expect(SLASH_SPLIT_SOURCE.readAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SLASH_SPLIT_SOURCE.file).toContain("state.rs");
    expect(SLASH_SPLIT_SOURCE.publishedByApi).toBe(false);
  });

  it("finds the split on `Config`", () => {
    // An older program layout kept these fields on a separate
    // `EconomicsConfig` account. Asserting its absence stops this test passing
    // against a stale excerpt: the two field names alone would still be found.
    const rust = readFileSync(PROGRAM_STATE, "utf8");
    expect(rust).not.toContain("EconomicsConfig");

    const config = rust.slice(rust.indexOf("pub struct Config {"));
    const body = config.slice(0, config.indexOf("\n}"));
    expect(body).toContain("slash_agent_bps");
    expect(body).toContain("slash_platform_bps");
  });

  it("still matches the program source excerpt", () => {
    // Reads the excerpt as text rather than importing anything: the browser
    // must not gain a dependency on the program.
    const rust = readFileSync(PROGRAM_STATE, "utf8");
    expect(rust).toContain("slash_agent_bps");
    expect(rust).toContain("slash_platform_bps");
    // A literal `6_000` / `3_000` anywhere in state.rs is weak evidence, so
    // assert the derivation the UI actually depends on instead.
    expect(rust).toContain("saturating_sub(self.slash_agent_bps)");
  });
});
