import { createRequire } from "node:module";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/* Spec R-WEB-5: the Privy confirmation is never hidden (scripts/check-wallet-ui.js). */
const require = createRequire(import.meta.url);
const check = require("../../scripts/check-wallet-ui.js") as {
  checkSource: (file: string, text: string) => string[];
  checkSigningFile: (file: string, text: string) => string[];
  checkRepo: (root: string) => string[];
  REQUIRED_FILES: string[];
};

describe("check-wallet-ui", () => {
  it("passes on this repository", () => {
    expect(check.checkRepo(resolve(__dirname, "../.."))).toEqual([]);
  });

  it("covers every signature the enable-paid page can ask for", () => {
    expect(check.REQUIRED_FILES).toEqual([
      "src/features/delegation/relayed-delegation.ts",
      "src/features/escrow/relayed-submission.ts",
      "src/features/escrow/run-escrow-intent.ts",
      "src/features/funding/evm-deposit.ts",
      "src/features/buyer-money/deposit-flow.ts",
    ]);
  });

  it("fails on a quoted or computed key, and on uiOptions that is not a literal with showWalletUIs: true", () => {
    expect(check.checkSource("q.ts", 'const o = { "showWalletUIs": false };')).toHaveLength(1);
    expect(check.checkSource("c.ts", 'const o = { ["showWalletUIs"]: false };')).not.toHaveLength(0);
    expect(check.checkSource("u.ts", "sign(tx, { uiOptions: chosen });")).toHaveLength(1);
    expect(check.checkSource("s.ts", "sign(tx, { uiOptions: { ...chosen } });")).toHaveLength(1);
    expect(check.checkSource("ok.ts", "sign(tx, { uiOptions: { showWalletUIs: true } });")).toEqual([]);
    expect(check.checkSource("t.ts", "type T = { uiOptions?: { showWalletUIs: true } };")).toEqual([]);
  });

  it("in a page signing file: every signTypedData/signTransaction/signAndSend call needs the option", () => {
    expect(check.checkSigningFile("f.ts", "await signer.signAndSend(tx);")).toEqual([
      "f.ts:1: signAndSend( without { showWalletUIs: true }",
    ]);
    expect(check.checkSigningFile("f.ts", "await signer.signTransaction(tx);")).toHaveLength(1);
    expect(check.checkSigningFile("f.ts", "await signer.signTransaction(tx, { showWalletUIs: true });")).toEqual([]);
  });

  it("in a page signing file: an alias or a bracket call is refused", () => {
    expect(
      check.checkSigningFile("a.ts", "const f = signer.signTypedData;\nawait signer.signAndSend(tx, { showWalletUIs: true });"),
    ).toEqual(["a.ts:1: signTypedData referenced without a direct call"]);
    expect(
      check.checkSigningFile("b.ts", 'await signer["signAndSend"](tx);\nawait signer.signAndSend(tx, { showWalletUIs: true });'),
    ).toEqual(["b.ts:1: signAndSend referenced without a direct call"]);
  });

  it("fails on showWalletUIs: false anywhere", () => {
    const problems = check.checkSource("src/x.ts", "sign(data, { uiOptions: { showWalletUIs: false } });");
    expect(problems).toContain("src/x.ts:1: showWalletUIs must be the literal true, not false");
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
