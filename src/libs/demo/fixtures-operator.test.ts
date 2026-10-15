import { afterEach, describe, expect, it, vi } from "vitest";

import type { OperatorApproval, OperatorCaseBrief, OperatorCaseListRow } from "@/interfaces/operator";
import { caseFacts, caseTimelineSteps } from "@/features/operator/case-flow";
import { isLiveApproval } from "@/features/operator/inbox";

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

function call(fixtures: Fixtures, method: string, path: string, query: Record<string, unknown> = {}): unknown {
  const found = fixtures.OPERATOR_FIXTURES.find(
    (f) => f.method === method && (f.match instanceof RegExp ? f.match.test(path) : f.match === path),
  );
  if (!found) throw new Error(`no fixture for ${method} ${path}`);
  return found.body(path, query, {});
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
