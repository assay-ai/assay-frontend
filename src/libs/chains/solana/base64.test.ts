import { describe, expect, it } from "vitest";

import { base64ToBytes, toBase64 } from "@/libs/chains/solana/base64";

/*
  These four assertions are not new. Two moved here verbatim from
  `deposit-transaction.test.ts` and two from `run-stake-intent.test.ts` when the
  two halves of the codec were joined into one module — the round trip through
  every byte value is the whole reason `atob` was chosen over `TextEncoder`,
  and it was previously asserted on only one direction at a time.
*/

const TRANSACTION_BYTES = Uint8Array.from([0, 1, 2, 250, 255, 128, 64]);
const TRANSACTION_BASE64 = "AAEC+v+AQA==";

describe("toBase64", () => {
  it("encodes a byte array to base64", () => {
    expect(toBase64(Uint8Array.from([0, 1, 250, 255]))).toBe("AAH6/w==");
  });

  it("returns an empty string for an empty input", () => {
    expect(toBase64(new Uint8Array(0))).toBe("");
  });
});

describe("base64ToBytes", () => {
  it("decodes to the exact bytes, padding included", () => {
    expect(base64ToBytes(TRANSACTION_BASE64)).toEqual(TRANSACTION_BYTES);
    expect(base64ToBytes("")).toEqual(new Uint8Array(0));
    expect(base64ToBytes("AAH6/w==")).toEqual(Uint8Array.from([0, 1, 250, 255]));
  });

  it("round-trips a byte range no ASCII path would survive", () => {
    const all = Uint8Array.from(Array.from({ length: 256 }, (_, i) => i));
    let binary = "";
    for (const byte of all) binary += String.fromCharCode(byte);
    expect(base64ToBytes(btoa(binary))).toEqual(all);
    /* Both directions on the same bytes: the inverse property, asserted. */
    expect(toBase64(all)).toBe(btoa(binary));
  });
});
