import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/* Spec R-WEB-5: the Privy confirmation is never hidden (scripts/check-wallet-ui.js). */
const require = createRequire(import.meta.url);
const check = require("../../scripts/check-wallet-ui.js") as {
  checkSource: (file: string, text: string) => string[];
  checkRepo: (root: string) => string[];
  REQUIRED_FILES: string[];
};

describe("check-wallet-ui", () => {
  it("passes on this repository", () => {
    expect(check.checkRepo(resolve(__dirname, "../.."))).toEqual([]);
  });

  it("covers both signing sites", () => {
    expect(check.REQUIRED_FILES).toEqual([
      "src/features/delegation/relayed-delegation.ts",
      "src/features/escrow/relayed-submission.ts",
    ]);
  });

  it("fails on showWalletUIs: false anywhere", () => {
    const problems = check.checkSource("src/x.ts", "sign(data, { uiOptions: { showWalletUIs: false } });");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/src\/x\.ts:1: showWalletUIs must be the literal true/);
  });

  it("fails on a non-literal value or a shorthand", () => {
    expect(check.checkSource("a.ts", "const o = { showWalletUIs: show };")).toHaveLength(1);
    expect(check.checkSource("b.ts", "const o = { showWalletUIs };")).toHaveLength(1);
  });

  it("fails when an AuthorizeDelegate or SetLimits signTypedData( call lacks showWalletUIs: true", () => {
    const authorize = 'const kind = "AUTHORIZE_DELEGATE";\nawait signer.signTypedData(tx);\n';
    expect(check.checkSource("d.ts", authorize)).toEqual([
      "d.ts:2: signTypedData( for AuthorizeDelegate/SetLimits without { showWalletUIs: true }",
    ]);
    const limits = 'primaryType: "SetLimits";\nawait signer.signTypedData(tx, { address });\n';
    expect(check.checkSource("l.ts", limits)).toHaveLength(1);
  });

  it("accepts the explicit option, and ignores comments", () => {
    const ok = 'const kind = "SET_LIMITS";\nawait signer.signTypedData(tx, { showWalletUIs: true });\n// showWalletUIs: false\n';
    expect(check.checkSource("ok.ts", ok)).toEqual([]);
  });

  it("leaves other typed data alone (a proof challenge)", () => {
    expect(check.checkSource("p.ts", 'primaryType: "PayoutProof";\nawait signer.signTypedData(req);\n')).toEqual([]);
  });
});
