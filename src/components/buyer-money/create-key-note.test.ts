import { describe, expect, it } from "vitest";

import { newKeyPaysNote, payingKeyName } from "./create-key";

const key = { id: "k1", name: "Key 1", revokedAt: null, lastUsedAt: null, delegateAccount: "eip155:1:0xd1" };
const grant = (status: "ACTIVE" | "REVOKED") => ({ status }) as never;

describe("the new key's free-calls note (V1-6)", () => {
  it("names the key the agent already pays through, and never says to run a step again", () => {
    const name = payingKeyName({ boundCredential: key, grant: grant("ACTIVE") });
    expect(name).toBe("Key 1");
    const note = newKeyPaysNote(name);
    expect(note).toContain("Your agent pays through its key “Key 1”");
    expect(note).not.toMatch(/again/);
    expect(note).toContain("If you switch the agent to this key, it can make paid calls only once a payment key is bound to this key as well.");
  });

  it("says only that the key makes free calls when no key of the agent pays", () => {
    expect(payingKeyName({ boundCredential: key, grant: grant("REVOKED") })).toBeNull();
    expect(payingKeyName({ boundCredential: null, grant: null })).toBeNull();
    expect(payingKeyName(undefined)).toBeNull();
    expect(newKeyPaysNote(null)).toBe("This key makes free calls only: no payment key is bound to it.");
  });
});
