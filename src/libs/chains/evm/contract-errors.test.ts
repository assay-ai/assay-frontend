import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";

import { contractErrorNameOf, contractErrorNameOfData } from "./contract-error-selectors";
import { KNOWN_CONTRACT_ERRORS, contractErrorNameInText, contractErrorText } from "./contract-errors";

const NEW_ERRORS = [
  "DisputeTimedOut",
  "SlashAlreadyDisputed",
  "InvalidArbiter",
  "SlashWindowNotDrained",
  "ArbiterCannotUnblock",
  "VerifierIsAdminOrArbiter",
  "RedeemerIsArbiter",
];

describe("contractErrorText", () => {
  it("has a distinct sentence for every error of the contract fix round", () => {
    expect([...KNOWN_CONTRACT_ERRORS].sort()).toEqual([...NEW_ERRORS].sort());
    const sentences = NEW_ERRORS.map((name) => contractErrorText(name));
    expect(sentences.every((s) => typeof s === "string" && s.length > 20)).toBe(true);
    expect(new Set(sentences).size).toBe(NEW_ERRORS.length);
  });

  it("says a drained window is a wait for the daily cap", () => {
    expect(contractErrorText("SlashWindowNotDrained")).toMatch(/^Waiting for the daily cap to free up/);
  });

  it("has no sentence for an unknown name, or an inherited property", () => {
    expect(contractErrorText("NotAdmin")).toBeNull();
    expect(contractErrorText("toString")).toBeNull();
    expect(contractErrorText(undefined)).toBeNull();
  });
});

describe("naming a revert", () => {
  it("matches the selectors `cast sig` gives (pinned in assay-backend abi-selectors.spec.ts)", () => {
    const pinned: [string, string][] = [
      ["0xe048dc84", "DisputeTimedOut"],
      ["0x6eccea65", "SlashAlreadyDisputed"],
      ["0x6a3f467f", "SlashWindowNotDrained"],
      ["0x64ce2c77", "ArbiterCannotUnblock"],
      ["0x9df5d0bf", "VerifierIsAdminOrArbiter"],
      ["0x23b2521b", "RedeemerIsArbiter"],
      ["0xf0318500", "InvalidArbiter"],
    ];
    for (const [selector, name] of pinned) expect(contractErrorNameOfData(selector)).toBe(name);
  });

  it("decodes a selector, with or without trailing data", () => {
    const selector = toFunctionSelector("SlashAlreadyDisputed()");
    expect(contractErrorNameOfData(selector)).toBe("SlashAlreadyDisputed");
    expect(contractErrorNameOfData(`${selector.toUpperCase().replace("0X", "0x")}00`)).toBe("SlashAlreadyDisputed");
    expect(contractErrorNameOfData(toFunctionSelector("NotAdmin()"))).toBeNull();
    expect(contractErrorNameOfData("0x12")).toBeNull();
  });

  it("finds a name in a message, as a whole word", () => {
    expect(contractErrorNameInText("execution reverted: InvalidArbiter")).toBe("InvalidArbiter");
    expect(contractErrorNameInText("NotInvalidArbiterX")).toBeNull();
  });

  it("walks a viem-style cause chain for revert data or a decoded name", () => {
    const data = toFunctionSelector("ArbiterCannotUnblock()");
    const wrapped = Object.assign(new Error("Execution reverted for an unknown reason."), {
      cause: Object.assign(new Error("RPC error"), { cause: { message: "x", data } }),
    });
    expect(contractErrorNameOf(wrapped)).toBe("ArbiterCannotUnblock");
    expect(contractErrorNameOf({ message: "m", data: { errorName: "DisputeTimedOut" } })).toBe("DisputeTimedOut");
    expect(contractErrorNameOf(new Error("nonce too low"))).toBeNull();
    expect(contractErrorNameOf("RedeemerIsArbiter")).toBeNull();
  });
});
