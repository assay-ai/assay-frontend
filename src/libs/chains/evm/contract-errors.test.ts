import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";

import { contractErrorNameOf, contractErrorNameOfData } from "./contract-error-selectors";
import { KNOWN_CONTRACT_ERRORS, contractErrorNameInText, contractErrorText } from "./contract-errors";

const NEW_ERRORS = [
  "DisputeTimedOut",
  "SlashAlreadyDisputed",
  "InvalidArbiter",
  "InvalidAdmin",
  "SlashWindowNotDrained",
  "ArbiterCannotUnblock",
];

/** Removed from `Errors.sol` in assay-evm 9f036a3. */
const REMOVED_ERRORS = ["ArbiterIsVerifier", "VerifierIsAdminOrArbiter", "RedeemerIsArbiter", "VerifierDailyCapExceeded"];

describe("contractErrorText", () => {
  it("has a distinct sentence for every error it names, as of assay-evm 9f036a3", () => {
    expect([...KNOWN_CONTRACT_ERRORS].sort()).toEqual([...NEW_ERRORS].sort());
    const sentences = NEW_ERRORS.map((name) => contractErrorText(name));
    expect(sentences.every((s) => typeof s === "string" && s.length > 20)).toBe(true);
    expect(new Set(sentences).size).toBe(NEW_ERRORS.length);
  });

  it("says a full window is a wait, and that the penalty is then paid in full", () => {
    expect(contractErrorText("SlashWindowNotDrained")).toMatch(
      /^Waiting until today's penalty limit has room; it will be paid in full\./,
    );
  });

  it("names none of the errors the contract removed", () => {
    for (const name of REMOVED_ERRORS) {
      expect(contractErrorText(name)).toBeNull();
      expect(contractErrorNameInText(`reverted ${name}`)).toBeNull();
      expect(contractErrorNameOfData(toFunctionSelector(`${name}()`))).toBeNull();
    }
  });

  it("has no sentence for an unknown name, or an inherited property", () => {
    expect(contractErrorText("NotAdmin")).toBeNull();
    expect(contractErrorText("toString")).toBeNull();
    expect(contractErrorText(undefined)).toBeNull();
  });
});

describe("naming a revert", () => {
  it("matches the selectors `cast sig` gives for assay-evm 9f036a3's Errors.sol", () => {
    const pinned: [string, string][] = [
      ["0xe048dc84", "DisputeTimedOut"],
      ["0x6eccea65", "SlashAlreadyDisputed"],
      ["0x6a3f467f", "SlashWindowNotDrained"],
      ["0x64ce2c77", "ArbiterCannotUnblock"],
      ["0xf0318500", "InvalidArbiter"],
      ["0xb5eba9f0", "InvalidAdmin"],
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
    expect(contractErrorNameOf("InvalidArbiter")).toBeNull();
  });
});
