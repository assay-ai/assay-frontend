import { afterEach, describe, expect, it, vi } from "vitest";

import type { OperatorApproval, OperatorCaseBrief, OperatorCaseListRow } from "@/interfaces/operator";
import { caseFacts, caseTimelineSteps } from "@/features/operator/case-flow";
import { isLiveApproval } from "@/features/operator/inbox";
import { assertContractCall } from "@/libs/chains/evm/signing-guard";

type Fixtures = typeof import("./fixtures-operator");

/** A Storage stand-in: what a browser tab's sessionStorage / localStorage does, in memory. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

/** The fixtures as a fresh page load reads them. */
async function load(): Promise<Fixtures> {
  vi.resetModules();
  return import("./fixtures-operator");
}

function call(
  fixtures: Fixtures,
  method: string,
  path: string,
  query: Record<string, unknown> = {},
  data: Record<string, unknown> = {},
): unknown {
  const found = fixtures.OPERATOR_FIXTURES.find(
    (f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path),
  );
  if (!found) throw new Error(`no fixture for ${method} ${path}`);
  return found.body(path, query, data);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the demo clock: one session stays coherent", () => {
  it("ends every running deadline after the session, so nothing lapses during a review", async () => {
    const fixtures = await load();
    const base = fixtures.demoSessionBase();
    const safe = base + fixtures.SESSION_SAFE_MINUTES * 60_000;

    const approvals = (call(fixtures, "GET", "/operator/approvals") as { items: OperatorApproval[] }).items;
    const pending = approvals.filter((a) => a.status === "PENDING");
    expect(pending.length).toBeGreaterThan(0);
    for (const approval of pending) expect(Date.parse(approval.expiresAt), approval.id).toBeGreaterThanOrEqual(safe);

    const rows = (call(fixtures, "GET", "/operator/cases") as { items: OperatorCaseListRow[] }).items;
    for (const row of rows) {
      if (row.nextDeadline) expect(Date.parse(row.nextDeadline), row.providerName).toBeGreaterThanOrEqual(safe);
    }
  });

  it("never dates a done step or an event after the session base", async () => {
    const fixtures = await load();
    const base = fixtures.demoSessionBase();
    const rows = (call(fixtures, "GET", "/operator/cases") as { items: OperatorCaseListRow[] }).items;
    for (const row of rows) {
      const brief = call(fixtures, "GET", `/operator/cases/${row.proposalId}`) as OperatorCaseBrief;
      for (const event of brief.timeline) expect(Date.parse(event.occurredAt), event.summary).toBeLessThanOrEqual(base);
      const steps = caseTimelineSteps(brief, caseFacts(brief, base), { now: base, slashDelaySeconds: 259_200 });
      for (const step of steps.filter((s) => s.state === "done" && s.date)) {
        expect(Date.parse(step.date!), `${row.providerName}: ${String(step.label)}`).toBeLessThanOrEqual(base);
      }
    }
  });

  it("lists a deadline the page reads the same: one source for row and page", async () => {
    const fixtures = await load();
    const base = fixtures.demoSessionBase();
    const rows = (call(fixtures, "GET", "/operator/cases") as { items: OperatorCaseListRow[] }).items;
    const cobalt = rows.find((r) => r.status === "CANCEL_REQUESTED")!;
    const brief = call(fixtures, "GET", `/operator/cases/${cobalt.proposalId}`) as OperatorCaseBrief;
    expect(caseFacts(brief, base).cancel?.deadline).toBe(cobalt.nextDeadline);
  });

  it("shows a request as waiting on a penalty only if Approvals lists it", async () => {
    const fixtures = await load();
    const base = fixtures.demoSessionBase();
    const approvals = (call(fixtures, "GET", "/operator/approvals", { status: "PENDING" }) as { items: OperatorApproval[] }).items;
    const lattice = approvals.find((a) => a.action === "slash.suspend");
    expect(lattice && isLiveApproval(lattice, base + 6 * 3_600_000)).toBe(true);
  });

  it("answers a pending request past its deadline as expired, as the API does", async () => {
    const fixtures = await load();
    vi.useFakeTimers({ now: fixtures.demoSessionBase() + 30 * 3_600_000 });
    try {
      const approvals = (call(fixtures, "GET", "/operator/approvals") as { items: OperatorApproval[] }).items;
      expect(approvals.filter((a) => a.status === "PENDING")).toEqual([]);
      expect(approvals.find((a) => a.id === "apr-suspend-1")?.status).toBe("EXPIRED");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("demo actions survive a reload in the same tab", () => {
  it("keeps an approved pay-back: off the waiting list, and the penalty paid back", async () => {
    vi.stubGlobal("window", { sessionStorage: memoryStorage(), localStorage: memoryStorage() });
    const first = await load();
    const MERIDIAN_CASE = "0a6d3b9e-7c42-4e1f-8d05-9b3a6c1e4f78";
    const approve = first.OPERATOR_FIXTURES.find((f) => f.method === "POST" && f.match instanceof RegExp && f.match.test("/operator/approvals/x/approve"))!;
    approve.body("/operator/approvals/apr-comp-1/approve", {}, {});

    const reloaded = await load();
    expect(reloaded.demoSessionBase()).toBe(first.demoSessionBase());
    const pending = (call(reloaded, "GET", "/operator/approvals", { status: "PENDING" }) as { items: OperatorApproval[] }).items;
    expect(pending.some((a) => a.id === "apr-comp-1")).toBe(false);
    // History (no status filter, decided rows) lists it first: newest decision on top.
    const history = (call(reloaded, "GET", "/operator/approvals") as { items: OperatorApproval[] }).items.filter((a) => a.status !== "PENDING");
    expect(history[0]).toMatchObject({ id: "apr-comp-1", status: "APPROVED" });
    const row = (call(reloaded, "GET", "/operator/cases") as { items: OperatorCaseListRow[] }).items.find((r) => r.proposalId === MERIDIAN_CASE);
    expect(row?.status).toBe("COMPENSATED");
    const brief = call(reloaded, "GET", `/operator/cases/${MERIDIAN_CASE}`) as OperatorCaseBrief;
    expect(caseFacts(brief).stage).toBe("compensated");
    const log = (call(reloaded, "GET", "/operator/override-log", { targetId: MERIDIAN_CASE }) as { items: { action: string }[] }).items;
    expect(log[0]?.action).toBe("slash.compensated");
  });

  it("starts clean when the demo clock starts over", async () => {
    const session = memoryStorage();
    vi.stubGlobal("window", { sessionStorage: session, localStorage: memoryStorage() });
    const first = await load();
    const approve = first.OPERATOR_FIXTURES.find((f) => f.method === "POST" && f.match instanceof RegExp && f.match.test("/operator/approvals/x/approve"))!;
    approve.body("/operator/approvals/apr-change-1/approve", {}, {});
    expect(session.getItem("demo-operator-memory")).not.toBeNull();
    // Seven hours on, the session is past its six: a new base, so a fresh stage set.
    vi.useFakeTimers({ now: first.demoSessionBase() + 7 * 3_600_000 });
    try {
      const later = await load();
      expect(later.demoSessionBase()).not.toBe(first.demoSessionBase());
      const approvals = (call(later, "GET", "/operator/approvals") as { items: OperatorApproval[] }).items;
      expect(approvals.find((a) => a.id === "apr-change-1")?.status).toBe("PENDING");
    } finally {
      vi.useRealTimers();
    }
  });
});

/* Chrome review 2026-10-16b: the demo reached the real API (401, session over) and its calldata failed the guard. */
describe("the arbiter's calls in the demo pass the signing guard unchanged", () => {
  const CALL = { chainId: "", to: "", data: "", value: "" };
  type Call = typeof CALL;

  it("answers every arbiter read the Arbiter page makes", async () => {
    const fixtures = await load();
    const superseded = call(fixtures, "GET", "/operator/arbiter/superseded") as { items: { requestId: string; executableAt: string }[] };
    expect(superseded.items.length).toBeGreaterThan(0);
    expect(Date.parse(superseded.items[0]!.executableAt)).toBeGreaterThan(fixtures.demoSessionBase());
  });

  it("builds a ruling for exactly the selected records", async () => {
    const fixtures = await load();
    const ids = [`0x${"b2".repeat(32)}`, `0x${"c3".repeat(32)}`];
    const built = call(fixtures, "POST", "/operator/arbiter/ruling-intent", {}, { ruling: "UPHOLD", requestIds: ids }) as Call;
    expect(() => assertContractCall(built, { contract: "stake", functionName: "upholdSlashBatch", args: [ids] })).not.toThrow();
  });

  it("builds a superseded record's cancel for that one id", async () => {
    const fixtures = await load();
    const id = `0x${"e5".repeat(32)}`;
    const built = call(fixtures, "POST", "/operator/arbiter/superseded/cancel-intent", {}, { requestId: id }) as Call;
    expect(() => assertContractCall(built, { contract: "stake", functionName: "cancelSlashBatch", args: [[id]] })).not.toThrow();
  });

  it("queues an on-chain block for a second Lead, and the approved one's call is setBlocked(that wallet, true)", async () => {
    const fixtures = await load();
    const account = "0x1111111111111111111111111111111111111111";
    const queued = call(fixtures, "POST", "/operator/arbiter/block-intent", {}, { chainId: "eip155:46630", account }) as { approvalId: string; status: string };
    expect(queued.status).toBe("PENDING");

    const approved = (call(fixtures, "GET", "/operator/approvals", { status: "APPROVED", action: "arbiter.block" }) as { items: OperatorApproval[] }).items;
    expect(approved.length).toBeGreaterThan(0);
    const first = approved[0]!;
    const built = call(fixtures, "GET", `/operator/arbiter/blocks/${first.id}/call`) as Call;
    expect(() =>
      assertContractCall(built, { contract: "config", functionName: "setBlocked", args: [first.payload.account, true] }),
    ).not.toThrow();
  });
});

describe("B11 shapes: chainStanding, cancels to sign", () => {
  it("lists the CANCEL_REQUESTED rows Home's 'Cancels to sign' reads: one standing, one executed while it waited", async () => {
    const fixtures = await load();
    const rows = (call(fixtures, "GET", "/operator/cases", { status: "CANCEL_REQUESTED" }) as { items: OperatorCaseListRow[] }).items;
    const records = rows.map((row) => {
      expect(row).toMatchObject({ status: "CANCEL_REQUESTED", onChain: true });
      return (call(fixtures, "GET", `/operator/cases/${row.proposalId}`) as OperatorCaseBrief).chainRecord;
    });
    expect(records.sort()).toEqual(["EXECUTED", "STANDING"]);
  });

  it("C1: the executed-while-waiting case never reads as nothing taken", async () => {
    const fixtures = await load();
    const base = fixtures.demoSessionBase();
    const brief = call(fixtures, "GET", "/operator/cases/6a0f3b9e-7c21-4d58-9e04-b1c2d3e4f5a6") as OperatorCaseBrief;
    const facts = caseFacts(brief, base);
    expect(facts.executedWhileCancelWaited).toBe(true);
    expect(brief.chainStanding).toBe(false);
  });

  it("names every blocked organization, as the server does; a wallet has no name", async () => {
    const fixtures = await load();
    const rows = (call(fixtures, "GET", "/operator/blocks") as { items: import("@/interfaces/operator").AccountBlock[] }).items;
    for (const row of rows) {
      if (row.subjectKind === "ORGANIZATION") expect(row.subjectName).toBeTruthy();
      else expect(row.subjectName).toBeNull();
    }
  });

  it("says a closed record no longer stands", async () => {
    const fixtures = await load();
    const rows = (call(fixtures, "GET", "/operator/cases") as { items: OperatorCaseListRow[] }).items;
    const cancelled = rows.find((row) => row.status === "CANCELLED")!;
    const brief = call(fixtures, "GET", `/operator/cases/${cancelled.proposalId}`) as OperatorCaseBrief;
    expect(brief.chainStanding).toBe(false);
  });
});

describe("B18 shapes: manualActions", () => {
  it("offers only the record of the execution made while the cancel waited, and nothing on any other case", async () => {
    const fixtures = await load();
    const rows = (call(fixtures, "GET", "/operator/cases") as { items: OperatorCaseListRow[] }).items;
    for (const row of rows) {
      const brief = call(fixtures, "GET", `/operator/cases/${row.proposalId}`) as OperatorCaseBrief;
      const offered = Object.entries(brief.manualActions ?? {})
        .filter(([, option]) => option.allowed)
        .map(([name]) => name);
      expect(offered).toEqual(row.proposalId === "6a0f3b9e-7c21-4d58-9e04-b1c2d3e4f5a6" ? ["recordExecution"] : []);
    }
  });

  it("queues the record for a second operator, as the API does", async () => {
    const fixtures = await load();
    const answer = call(fixtures, "POST", "/operator/cases/6a0f3b9e-7c21-4d58-9e04-b1c2d3e4f5a6/record-execution", {}, {
      reasonCode: "EXECUTED_WHILE_CANCEL_WAITED",
      note: "Read the record on the explorer: executed.",
    }) as { approvalId: string; status: string; action: string };
    expect(answer).toMatchObject({ status: "PENDING", action: "slash.record_execution" });
  });
});
