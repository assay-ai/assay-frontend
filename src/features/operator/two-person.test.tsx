import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovalQueued } from "@/interfaces/operator";
import { saveOperatorSession } from "@/libs/operator-session";
import { operatorApi } from "@/services/operator-api";
import {
  addOperator,
  changeOperator,
  createArbiterBlockIntent,
  openFleetSweep,
  recordCompensation,
  removeOperator,
  suspendCase,
  unblockAccount,
} from "@/services/operator.service";

import { envelope, memoryStorage, scriptedAdapter } from "./operator-test-kit";
import { QueuedNotice } from "./queued-notice";
import { approvalHref, queuedMessage, toTwoPersonAnswer } from "./two-person";

const QUEUED: ApprovalQueued = {
  approvalId: "7d1c2b9e-1111-4222-8333-944455556666",
  status: "PENDING",
  action: "slash.sweep",
  expiresAt: "2026-10-16T10:00:00.000Z",
};

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: memoryStorage() });
  saveOperatorSession({ token: "op", expiresAt: "2999-01-01T00:00:00.000Z" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("toTwoPersonAnswer", () => {
  it("reads a 202 as queued, never as the action's result", () => {
    expect(toTwoPersonAnswer({ status: 202, data: QUEUED })).toEqual({ kind: "queued", approval: QUEUED });
  });

  it("reads a 200 as the result", () => {
    expect(toTwoPersonAnswer({ status: 200, data: { matchedCount: 3 } })).toEqual({
      kind: "done",
      result: { matchedCount: 3 },
    });
  });
});

describe("every two-person form's service call", () => {
  const body = { reasonCode: "R", note: "a note that is long enough" };
  const calls: [string, () => Promise<{ kind: string }>][] = [
    ["suspend", () => suspendCase("p1", body)],
    ["sweep", () => openFleetSweep("p1", { defectKey: "D", lookbackHours: 24, ...body })],
    ["compensated", () => recordCompensation("p1", { signature: "sig", ...body })],
    ["unblock", () => unblockAccount("b1", body)],
    [
      "add operator",
      () =>
        addOperator({
          walletAddress: "0x52908400098527886E0F7030069857D2E4169EE7",
          subject: "dan@",
          roles: ["ADJ"],
          ...body,
        }),
    ],
    ["raise roles", () => changeOperator("o1", { roles: ["ADJ", "ADJL"], ...body })],
    ["demote an OPS_ADMIN", () => changeOperator("o1", { roles: ["ADJ"], ...body })],
    ["remove an OPS_ADMIN", () => removeOperator("o1", body)],
    [
      "arbiter block",
      () =>
        createArbiterBlockIntent({
          chainId: "eip155:46630",
          account: "0x52908400098527886E0F7030069857D2E4169EE7",
          ...body,
        }),
    ],
  ];

  it.each(calls)("%s: a 202 comes back as queued with its approval id", async (_name, call) => {
    const server = scriptedAdapter(() => [202, envelope(QUEUED, 202)]);
    operatorApi.raw().defaults.adapter = server.adapter;
    await expect(call()).resolves.toEqual({ kind: "queued", approval: QUEUED });
    // No second operator's credential travels with the request any more.
    expect(JSON.stringify(server.calls)).not.toMatch(/X-Operator-Approver/i);
    expect(server.calls[0].authorization).toBe("Bearer op");
  });

  it.each(calls)("%s: a 200 comes back as done", async (_name, call) => {
    operatorApi.raw().defaults.adapter = scriptedAdapter(() => [200, envelope({ id: "x" })]).adapter;
    await expect(call()).resolves.toMatchObject({ kind: "done" });
  });
});

describe("what a 202 shows", () => {
  it("says it was sent for approval, with the id and a link to the inbox", () => {
    expect(queuedMessage(QUEUED)).toMatch(/^Sent for approval \(id 7d1c2b9e-1111-4222-8333-944455556666\)/);
    const html = renderToStaticMarkup(<QueuedNotice approval={QUEUED} />);
    expect(html).toContain("Sent for approval");
    expect(html).toContain(QUEUED.approvalId);
    expect(html).toContain(`href="${approvalHref(QUEUED.approvalId)}"`);
    expect(approvalHref(QUEUED.approvalId)).toBe(`/operator/approvals?id=${QUEUED.approvalId}`);
    expect(html).toContain("Nothing has happened yet");
  });
});
