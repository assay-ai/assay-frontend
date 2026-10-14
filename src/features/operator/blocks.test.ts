import { describe, expect, it } from "vitest";

import { ApiError } from "@/libs/ApiClient";

import {
  blockErrorMessage,
  mayBlock,
  normaliseSubject,
  validateBlockForm,
  validateUnblockForm,
} from "./blocks";

const ADDRESS = "0xA271A3407D3302f4b4Fbe469b9188487cedd7d45";
const NOTE = "Key reported leaked by the customer on INC-123.";

describe("mayBlock", () => {
  it("is ADJL or SRE only", () => {
    expect(mayBlock(["ADJL"])).toBe(true);
    expect(mayBlock(["SRE", "SUP"])).toBe(true);
    expect(mayBlock(["ADJ", "TRE", "SUP"])).toBe(false);
    expect(mayBlock([])).toBe(false);
  });
});

describe("normaliseSubject", () => {
  it("lower-cases an organization uuid and refuses anything else", () => {
    expect(normaliseSubject("ORGANIZATION", " 3F2C1B7E-0A4D-4E5F-9A8B-1C2D3E4F5A6B ")).toEqual({
      ok: true,
      subject: "3f2c1b7e-0a4d-4e5f-9a8b-1c2d3e4f5a6b",
    });
    expect(normaliseSubject("ORGANIZATION", "acme").ok).toBe(false);
    expect(normaliseSubject("ORGANIZATION", `eip155:1:${ADDRESS}`).ok).toBe(false);
    expect(normaliseSubject("ORGANIZATION", "  ").ok).toBe(false);
  });

  it("accepts and lower-cases an eip155 CAIP-10 account", () => {
    expect(normaliseSubject("WALLET", `eip155:84532:${ADDRESS}`)).toEqual({
      ok: true,
      subject: `eip155:84532:${ADDRESS.toLowerCase()}`,
    });
  });

  it("turns a bare 0x address into a CAIP-10 account and says so", () => {
    const result = normaliseSubject("WALLET", ADDRESS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toBe(`eip155:1:${ADDRESS.toLowerCase()}`);
    expect(result.note).toMatch(/every EVM chain/);
  });

  it("keeps a Solana account as written (base58 is case-sensitive)", () => {
    const solana = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:7S3P4HxJpyyigGzodYwHtCxZyUQe9JiBMHyRWXArAaKv";
    expect(normaliseSubject("WALLET", solana)).toEqual({ ok: true, subject: solana });
  });

  it("refuses what is not a wallet", () => {
    expect(normaliseSubject("WALLET", "0x1234").ok).toBe(false);
    expect(normaliseSubject("WALLET", "eip155:base:" + ADDRESS).ok).toBe(false);
    expect(normaliseSubject("WALLET", "eip155:1:0x1234").ok).toBe(false);
    expect(normaliseSubject("WALLET", "3f2c1b7e-0a4d-4e5f-9a8b-1c2d3e4f5a6b").ok).toBe(false);
    expect(normaliseSubject("WALLET", "x".repeat(257)).ok).toBe(false);
  });
});

describe("validateBlockForm", () => {
  const valid = {
    subjectKind: "WALLET" as const,
    subject: ADDRESS,
    reasonCode: " LEAKED_KEY ",
    note: `  ${NOTE}  `,
    ticketRef: "",
  };

  it("builds the trimmed body and omits an empty ticket", () => {
    expect(validateBlockForm(valid)).toEqual({
      ok: true,
      body: {
        subjectKind: "WALLET",
        subject: `eip155:1:${ADDRESS.toLowerCase()}`,
        reasonCode: "LEAKED_KEY",
        note: NOTE,
      },
    });
    const withTicket = validateBlockForm({ ...valid, ticketRef: " INC-1 " });
    expect(withTicket.ok && withTicket.body.ticketRef).toBe("INC-1");
  });

  it("holds the note to 20–4096 characters after trimming", () => {
    const short = validateBlockForm({ ...valid, note: "  too short      " });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors.note).toMatch(/At least 20/);

    expect(validateBlockForm({ ...valid, note: "x".repeat(20) }).ok).toBe(true);
    expect(validateBlockForm({ ...valid, note: "x".repeat(4096) }).ok).toBe(true);
    expect(validateBlockForm({ ...valid, note: "x".repeat(4097) }).ok).toBe(false);
  });

  it("reports every wrong field at once", () => {
    const result = validateBlockForm({
      subjectKind: "ORGANIZATION",
      subject: "acme",
      reasonCode: "",
      note: "",
      ticketRef: "t".repeat(129),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["note", "reasonCode", "subject", "ticketRef"]);
  });

  it("refuses a reason code over 64 characters", () => {
    expect(validateBlockForm({ ...valid, reasonCode: "R".repeat(65) }).ok).toBe(false);
  });
});

describe("validateUnblockForm", () => {
  it("asks for no second operator's credential: the second person approves in the inbox", () => {
    const result = validateUnblockForm({ reasonCode: "KEY_ROTATED", note: NOTE, ticketRef: "" });
    expect(result).toEqual({ ok: true, body: { reasonCode: "KEY_ROTATED", note: NOTE } });
  });

  it("builds a trimmed body", () => {
    expect(
      validateUnblockForm({ reasonCode: " KEY_ROTATED ", note: NOTE, ticketRef: " INC-9 " }),
    ).toEqual({
      ok: true,
      body: { reasonCode: "KEY_ROTATED", note: NOTE, ticketRef: "INC-9" },
    });
  });

  it("refuses a missing reason code and a short note", () => {
    const result = validateUnblockForm({ reasonCode: "", note: "short", ticketRef: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["note", "reasonCode"]);
  });
});

describe("blockErrorMessage", () => {
  const err = (code: string, message = "backend says", status = 400) => new ApiError(code, message, status);

  it.each([
    ["OPERATOR_BLOCK_SUBJECT_INVALID", "block", /subject is not valid/],
    ["OPERATOR_BLOCK_SUBJECT_INVALID", "list", /subject filter/],
    ["OPERATOR_BLOCK_NOT_FOUND", "unblock", /no longer exists/],
    ["OPERATOR_BLOCK_ALREADY_LIFTED", "unblock", /already been lifted/],
    ["OPERATOR_SECOND_APPROVER_REQUIRED", "unblock", /approvals inbox/],
    ["OPERATOR_ROLE_REQUIRED", "block", /Blocking needs the ADJL or SRE/],
    ["OPERATOR_ROLE_REQUIRED", "unblock", /Lifting a block needs the ADJL or SRE/],
    ["OPERATOR_CREDENTIAL_INVALID", "block", /session has ended/],
    ["OPERATOR_NOT_AUTHORIZED", "block", /no longer an active operator/],
    ["OPERATOR_SUSPENDED", "unblock", /suspended/],
    ["OPERATOR_AUTH_RATE_LIMITED", "block", /Too many sign-in attempts/],
    ["OPERATOR_OVERRIDE_NOT_IMPLEMENTED", "block", /not have this action/],
    ["VALIDATION_FAILED", "block", /not accepted: backend says/],
    ["NETWORK_ERROR", "list", /could not be reached/],
  ] as const)("maps %s (%s) to a clear message and keeps the code", (code, action, pattern) => {
    const message = blockErrorMessage(err(code), action);
    expect(message).toMatch(pattern);
    expect(message.endsWith(`(${code})`)).toBe(true);
  });

  it("keeps the backend's sentence for an already-active block, which names the block", () => {
    const message = blockErrorMessage(
      err("OPERATOR_BLOCK_ALREADY_ACTIVE", "This subject is already blocked (block 1234)", 409),
      "block",
    );
    expect(message).toMatch(/one standing block per subject/);
    expect(message).toMatch(/block 1234/);
  });

  it("falls back to the backend's message for an unknown code", () => {
    expect(blockErrorMessage(err("SOMETHING_NEW", "Something new"), "block")).toBe(
      "Something new (SOMETHING_NEW)",
    );
  });

  it("has words for a non-API failure", () => {
    expect(blockErrorMessage(new Error("boom"), "list")).toBe("The blocks could not be loaded.");
    expect(blockErrorMessage("boom", "block")).toMatch(/could not be completed/);
  });
});
