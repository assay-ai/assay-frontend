import type { CursorPage } from "@/interfaces/api";
import type {
  AccountBlock,
  ArbiterDispute,
  OperatorApproval,
  OperatorCaseBrief,
  OperatorCaseListRow,
  OperatorCaseStatus,
  OperatorDirectoryEntry,
  OperatorIdentity,
  OverrideLogEntry,
  PlatformHealth,
} from "@/interfaces/operator";
import { readOperatorSession } from "@/libs/operator-session";

import type { DemoFixture } from "./fixtures";

/**
 * The operator console's stage set — DEMO ONLY (see `demo-api.ts`).
 *
 * With `NEXT_PUBLIC_DEMO_CHAINS=robinhood` the sign-in screen offers "Open the
 * demo console as …", which stores a session whose token names a role preset
 * (`demo-operator:lead`). `/operator/me` reads that token, so the same data
 * can be reviewed as a Lead adjudicator, as on-call support or as an admin —
 * which is the point of a role-aware console.
 *
 * Each preset has its own requests (Lead asked for a suspension, Support for a
 * lift, the admin for a new operator), so "your requests" differs by role.
 *
 * A write is remembered for the browser tab's demo session (`memory` below,
 * kept in sessionStorage next to the demo clock): a request sent for approval
 * shows up in the inbox, an approve takes it off the list, a suspension or a
 * pay-back changes the penalty and lands in Activity with the reason that was
 * picked. Without that the demo would contradict its own result cards, and a
 * reload would undo what the viewer just did. It lives exactly as long as the
 * demo clock: a new tab, or a session past six hours, starts the stage set
 * over. It is still not a mock backend: nothing is validated, and nothing
 * leaves the tab.
 *
 * Provider ids are the explorer fixtures' own, so `/catalogue/providers`
 * names them.
 */

export const DEMO_OPERATOR_TOKEN_PREFIX = "demo-operator:";
export type DemoOperatorPreset = "lead" | "support" | "admin";

/*
  The same chain and asset as `fixtures.ts` (DEMO_CHAIN_ID, DEMO_ASSET), written
  out: this file is imported BY fixtures.ts, and reading its constants while it
  is still initialising would be a temporal-dead-zone error at module load.
*/
const DEMO_CHAIN_ID = "eip155:46630";
const DEMO_ASSET = `${DEMO_CHAIN_ID}/erc20:0x915Ef7c9F9f80a69e3BE47A38EE0Bb47607103ec`;

const HOUR = 60;
const DAY = 24 * HOUR;

/*
  One "now" for the whole stage set, rounded to the minute and kept for the
  browser tab's session (sessionStorage): the same event then reads the same
  time on Home, Arbiter and the penalty page, and after a reload — not 03:39
  on one page and 03:43 on the next. A session older than six hours starts
  over, so the deadlines stay plausible.

  Every time below is relative to this one base, and every deadline still
  running (a request waiting for approval, a cancel waiting for its
  signature, a dispute window) ends at least SESSION_SAFE_MINUTES after it:
  countdowns tick with the real clock, but nothing lapses or expires while a
  session lasts. `operator-fixes.test.ts` holds the fixtures to that.
*/
const NOW_KEY = "demo-operator-now";
const NOW_MAX_AGE_MS = 6 * 3_600_000;
/** The earliest a running deadline may end, in minutes after the session base: the session's six hours plus slack. */
export const SESSION_SAFE_MINUTES = 7 * 60;
const NOW = demoNow(Date.now());

/** The session base, for tests that check the fixtures against it. */
export function demoSessionBase(): number {
  return NOW;
}

function demoNow(real: number): number {
  const rounded = Math.floor(real / 60_000) * 60_000;
  try {
    const stored = Number(window.sessionStorage.getItem(NOW_KEY));
    if (Number.isFinite(stored) && stored > 0 && real >= stored && real - stored < NOW_MAX_AGE_MS) return stored;
    window.sessionStorage.setItem(NOW_KEY, String(rounded));
  } catch {
    /* no window or no storage (build, tests, private mode): this load's own minute */
  }
  return rounded;
}

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}
function inMinutes(minutes: number): string {
  return new Date(NOW + minutes * 60_000).toISOString();
}
function nowIso(): string {
  return new Date().toISOString();
}
function usd(major: string) {
  const [whole, fraction = ""] = major.split(".");
  return { amount: String(BigInt(`${whole}${fraction.padEnd(6, "0").slice(0, 6)}`)), asset: DEMO_ASSET, decimals: 6 };
}
function page<T>(items: T[]): CursorPage<T> {
  return { items, pageInfo: { nextCursor: null, hasMore: false } };
}
function lastSegment(path: string, fromEnd = 0): string {
  const parts = path.split("/").filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1 - fromEnd] ?? "");
}

// ── Providers (ids shared with fixtures-explore) ────────────────────────────

const HELIOS = "9c1d4f60-3a77-4c18-9b02-6e5a1f2d8b41";
const MERIDIAN = "3f8a2b71-5c04-4d9e-8a16-7b2c9e0d4a53";
const NORTHWIND = "b7e04c25-9d13-4a6f-bc80-1e5f3a7d9c62";
const TIDEWATER = "5a2c9e18-7f46-4b03-9d51-8c6e2a4f7b09";
const COBALT = "e41b7d93-2a58-4f60-b7c9-3d80f5a1e6c4";
const QUANTA = "17d6c0a4-8b39-4e52-a1f7-59c2b8e3d07f";
const VERDANT = "c9f35a82-6014-4d7b-8e93-2a1c7f06b5d8";
const LATTICE = "48e1b60c-d573-4a92-bf08-6c3d95e12a7b";

const ARBITER = "0x5B38Da6a701c568545dCfcB03FcB875f56beddC4";
const STAKE_CONTRACT = "0x0aF4D08f97B4FA8Ba3E47Cb025aE8CaD509bc73c";

// ── The team ────────────────────────────────────────────────────────────────

const OPERATORS: OperatorDirectoryEntry[] = [
  {
    id: "op-jordan",
    subject: "jordan@",
    displayName: "Jordan Blake",
    walletAddress: "0x7a3f9c2b4e81ad5f0b9c6d2e8f1a4b7c3d5e9f20",
    roles: ["ADJL"],
    authorityLimit: usd("1000"),
    status: "ACTIVE",
    email: "jordan@assay.example",
    lastSeenAt: minutesAgo(3),
    createdAt: minutesAgo(90 * DAY),
  },
  {
    id: "op-riley",
    subject: "riley@",
    displayName: "Riley Brooks",
    walletAddress: "0x1c4e0b9a3f7d26e85b0c4a1f9e3d7b2a6c8e5f31",
    roles: ["ADJL", "TRE"],
    authorityLimit: usd("5000"),
    status: "ACTIVE",
    email: "riley@assay.example",
    lastSeenAt: minutesAgo(45),
    createdAt: minutesAgo(120 * DAY),
  },
  {
    id: "op-iris",
    subject: "iris@",
    displayName: "Iris Park",
    walletAddress: "0x9e2d5a7c1b3f48e60d9a2c5b7e1f3a4d6c8b0e12",
    roles: ["ADJ"],
    authorityLimit: usd("250"),
    status: "ACTIVE",
    email: "iris@assay.example",
    lastSeenAt: minutesAgo(2 * DAY),
    createdAt: minutesAgo(40 * DAY),
  },
  {
    id: "op-sam",
    subject: "sam@",
    displayName: "Sam Reyes",
    walletAddress: "0x3b8f1e6d2a9c47b05e1d8a3c6f2b9e4a7d0c5b63",
    roles: ["SRE", "SUP"],
    authorityLimit: usd("0"),
    status: "ACTIVE",
    email: "sam@assay.example",
    lastSeenAt: minutesAgo(20),
    createdAt: minutesAgo(60 * DAY),
  },
  {
    id: "op-dan",
    subject: "dan@",
    displayName: "Dan Ortiz",
    walletAddress: "0x6f0a3d9b2e5c18f47a0b3e6d9c2f5a8b1e4d7c90",
    roles: ["OPS_ADMIN"],
    authorityLimit: usd("0"),
    status: "ACTIVE",
    email: "dan@assay.example",
    lastSeenAt: minutesAgo(5 * HOUR),
    createdAt: minutesAgo(200 * DAY),
  },
  {
    id: "op-ava",
    subject: "ava@",
    displayName: "Ava Chen",
    walletAddress: "0x2e7b4c9a1d6f30e85c2a7b4d9e1f6a3c8b5d0e47",
    roles: ["OPS_ADMIN"],
    authorityLimit: usd("0"),
    status: "ACTIVE",
    email: "ava@assay.example",
    lastSeenAt: minutesAgo(2 * HOUR),
    createdAt: minutesAgo(150 * DAY),
  },
];

const ME_BY_PRESET: Record<DemoOperatorPreset, string> = { lead: "op-jordan", support: "op-sam", admin: "op-dan" };

function demoPreset(): DemoOperatorPreset {
  const token = readOperatorSession()?.token ?? "";
  const preset = token.startsWith(DEMO_OPERATOR_TOKEN_PREFIX) ? token.slice(DEMO_OPERATOR_TOKEN_PREFIX.length) : "lead";
  return preset === "support" || preset === "admin" ? preset : "lead";
}

function me(): OperatorIdentity {
  const row = OPERATORS.find((op) => op.id === ME_BY_PRESET[demoPreset()])!;
  const { email: _email, lastSeenAt: _seen, createdAt: _created, ...identity } = row;
  return identity;
}

// ── What this page load did (demo only; see the file comment) ───────────────

interface Suspension {
  reasonCode: string;
  note: string;
  by: string;
  at: string;
}

interface Lift {
  by: string;
  approvedBy: string;
  at: string;
  note: string;
}

const memory = {
  /** Approvals decided here, by id: the row as it now reads. */
  decided: new Map<string, OperatorApproval>(),
  /** Requests sent for approval here, newest first. */
  added: [] as OperatorApproval[],
  suspended: new Map<string, Suspension>(),
  /** Executed penalties paid back by an approved pay-back here: case id → who asked and when. */
  compensated: new Map<string, { by: string; at: string }>(),
  /** Blocks lifted by an approval here: block id → who and when. */
  lifted: new Map<string, Lift>(),
  /** Blocks created here, newest first. */
  blocks: [] as AccountBlock[],
  removed: new Set<string>(),
  log: [] as OverrideLogEntry[],
  seq: 0,
};

/*
  The memory, kept in sessionStorage under the session base it belongs to:
  a reload keeps what was done, and a new demo clock (a new tab, or a session
  past six hours) starts with a clean stage set, because the stored base no
  longer matches.
*/
const MEMORY_KEY = "demo-operator-memory";

interface StoredMemory {
  base: number;
  decided: [string, OperatorApproval][];
  added: OperatorApproval[];
  suspended: [string, Suspension][];
  compensated: [string, { by: string; at: string }][];
  lifted: [string, Lift][];
  blocks: AccountBlock[];
  removed: string[];
  log: OverrideLogEntry[];
  seq: number;
}

function loadMemory(): void {
  try {
    const raw = window.sessionStorage.getItem(MEMORY_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as StoredMemory;
    if (stored.base !== NOW) {
      window.sessionStorage.removeItem(MEMORY_KEY);
      return;
    }
    memory.decided = new Map(stored.decided);
    memory.added = stored.added;
    memory.suspended = new Map(stored.suspended);
    memory.compensated = new Map(stored.compensated);
    memory.lifted = new Map(stored.lifted);
    memory.blocks = stored.blocks;
    memory.removed = new Set(stored.removed);
    memory.log = stored.log;
    memory.seq = stored.seq;
  } catch {
    /* no window, no storage or a damaged entry: this load starts clean */
  }
}

/** Called after every write, so the next load (or a reload) reads what was done. */
function saveMemory(): void {
  const stored: StoredMemory = {
    base: NOW,
    decided: [...memory.decided],
    added: memory.added,
    suspended: [...memory.suspended],
    compensated: [...memory.compensated],
    lifted: [...memory.lifted],
    blocks: memory.blocks,
    removed: [...memory.removed],
    log: memory.log,
    seq: memory.seq,
  };
  try {
    window.sessionStorage.setItem(MEMORY_KEY, JSON.stringify(stored));
  } catch {
    /* no window or no storage (build, tests, private mode): remembered for this load only */
  }
}

loadMemory();

function nextId(prefix: string): string {
  memory.seq += 1;
  return `${prefix}-demo-${memory.seq}`;
}

function caseNow(c: DemoCase): DemoCase {
  // Paid back by an approved pay-back: executed on chain, then compensated (the list's "Closed · paid back").
  if (memory.compensated.has(c.id)) return { ...c, status: "REVERSED" };
  if (!memory.suspended.has(c.id)) return c;
  // Suspending closes the case; a record standing on chain gets its cancel requested.
  const standing = c.chainStatus === "PENDING" || c.chainStatus === "DISPUTED";
  return { ...c, status: "OVERTURNED", chainStatus: standing ? "CANCEL_REQUESTED" : c.chainStatus, outcome: "OVERTURNED_PLATFORM_DEFECT" };
}

/** Every request as it reads now: decided here, or lapsed — a pending one past its deadline is EXPIRED, as the API answers. */
function approvalsNow(): OperatorApproval[] {
  const now = Date.now();
  return [...memory.added, ...APPROVALS].map((a) => {
    const row = memory.decided.get(a.id) ?? a;
    return row.status === "PENDING" && Date.parse(row.expiresAt) <= now ? { ...row, status: "EXPIRED" as const, decidedAt: row.expiresAt } : row;
  });
}

function blocksNow(): AccountBlock[] {
  return [...memory.blocks, ...BLOCKS].map((b) => {
    const lift = memory.lifted.get(b.id);
    return lift
      ? { ...b, active: false, unblockedBy: lift.by, unblockApprovedBy: lift.approvedBy, unblockedAt: lift.at, unblockNote: lift.note }
      : b;
  });
}

function bodyText(data: Record<string, unknown> | undefined, key: string): string {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

/** A request sent for approval: remembered, and answered the way the API answers a 202. */
function queue(action: string, code: string, target: string, payload: Record<string, unknown>) {
  const self = me();
  const approval: OperatorApproval = {
    id: nextId("apr"),
    action,
    code,
    target,
    payload,
    status: "PENDING",
    requestedBy: self.subject,
    requestedById: self.id,
    approvedBy: null,
    rejectedBy: null,
    createdAt: nowIso(),
    decidedAt: null,
    expiresAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  };
  memory.added.unshift(approval);
  saveMemory();
  return { approvalId: approval.id, status: "PENDING" as const, action, expiresAt: approval.expiresAt };
}

function remember(entry: Omit<OverrideLogEntry, "createdAt" | "family" | "organizationId" | "before" | "after" | "breakGlass" | "approvalMode"> & { approvalMode?: string }) {
  memory.log.unshift({
    createdAt: nowIso(),
    family: entry.code.startsWith("S") ? "SLASH" : "ACCESS",
    organizationId: null,
    before: {},
    after: {},
    breakGlass: false,
    approvalMode: entry.approvalMode ?? (entry.approverSubject ? "TWO_PERSON" : "SINGLE"),
    ...entry,
  });
  saveMemory();
}

function suspend(caseId: string, reasonCode: string, note: string, by: string, approver: string | null): void {
  memory.suspended.set(caseId, { reasonCode, note, by, at: nowIso() });
  remember({
    id: nextId("log"),
    code: "S-1",
    label: "Suspend slash proposal",
    action: "slash.suspend",
    actorSubject: by,
    approverSubject: approver,
    targetType: "slash_proposal",
    targetId: caseId,
    reasonCode,
    reason: note,
    ticketRef: null,
  });
}

function approve(id: string) {
  const approval = approvalsNow().find((a) => a.id === id) ?? APPROVALS[0];
  const self = me();
  const decided: OperatorApproval = { ...approval, status: "APPROVED", approvedBy: self.subject, decidedAt: nowIso() };
  memory.decided.set(approval.id, decided);
  const body = (approval.payload.body ?? {}) as Record<string, unknown>;
  const reasonCode = bodyText(body, "reasonCode");
  const note = bodyText(body, "note");
  let result: unknown = {};
  if (approval.action === "account.unblock") {
    const blockId = String(approval.payload.blockId ?? approval.target.split(":")[1] ?? "");
    memory.lifted.set(blockId, { by: approval.requestedBy, approvedBy: self.subject, at: nowIso(), note });
    result = blocksNow().find((b) => b.id === blockId) ?? {};
    remember({ id: nextId("log"), code: "A-10", label: "Lift account block", action: "account.unblock", actorSubject: approval.requestedBy, approverSubject: self.subject, targetType: "account_block", targetId: blockId, reasonCode, reason: note, ticketRef: null });
  } else if (approval.action === "slash.suspend") {
    suspend(String(approval.payload.proposalId ?? ""), reasonCode, note, approval.requestedBy, self.subject);
  } else if (approval.action === "slash.compensated") {
    const caseId = String(approval.payload.proposalId ?? "");
    memory.compensated.set(caseId, { by: approval.requestedBy, at: nowIso() });
    remember({ id: nextId("log"), code: "S-5", label: "Compensate executed slash", action: "slash.compensated", actorSubject: approval.requestedBy, approverSubject: self.subject, targetType: "slash_proposal", targetId: caseId, reasonCode, reason: note, ticketRef: null });
  }
  saveMemory();
  return { approval: decided, result };
}

// ── Penalties ───────────────────────────────────────────────────────────────

interface DemoCase {
  id: string;
  providerId: string;
  tool: string;
  binding: string;
  window: string;
  penalty: string;
  status: string;
  chainStatus: OperatorCaseBrief["chainStatus"];
  proposedMinutesAgo: number;
  /** Minutes from now; negative = past. */
  executableIn: number;
  disputedMinutesAgo: number | null;
  /** When the arbiter upheld it, for an upheld case. */
  upheldMinutesAgo?: number;
  requestId: string;
  executedMinutesAgo?: number;
  /** When a closed case was closed, for its timeline. */
  resolvedMinutesAgo?: number;
  /** Disputed on chain and left unruled for 30 days. */
  expired?: boolean;
  outcome?: string | null;
  /** The window's measurement: calls posted and verified, failed, and the declared failure rate. */
  m: { posted: number; verified: number; failed: number; sla: number };
}

const CASES: DemoCase[] = [
  {
    id: "5e0c7a1d-4b62-4f3e-9a18-2d7c6b9e0f41",
    providerId: HELIOS,
    tool: "search_web",
    binding: "Helios search",
    window: "w_118",
    penalty: "12.40",
    status: "PROPOSED",
    chainStatus: "PENDING",
    proposedMinutesAgo: 31 * HOUR,
    executableIn: 41 * HOUR,
    disputedMinutesAgo: null,
    requestId: `0x${"a1".repeat(32)}`,
    m: { posted: 588, verified: 231, failed: 31, sla: 0.05 },
  },
  {
    id: "8b3f2e9a-1c74-4d05-b6e2-7f0a9c3d5e18",
    providerId: NORTHWIND,
    tool: "geocode",
    binding: "Northwind geocode",
    window: "w_96",
    penalty: "28.47",
    status: "PROPOSED",
    chainStatus: "DISPUTED",
    proposedMinutesAgo: 25 * DAY,
    executableIn: -21 * DAY,
    disputedMinutesAgo: 23 * DAY,
    requestId: `0x${"b2".repeat(32)}`,
    m: { posted: 604, verified: 214, failed: 27, sla: 0.05 },
  },
  {
    id: "2d9e4c7b-6a13-4f80-8e5d-0b1c3a7f9e62",
    providerId: TIDEWATER,
    tool: "fx_rates",
    binding: "Tidewater FX",
    window: "w_131",
    penalty: "5.00",
    status: "PROPOSED",
    chainStatus: "DISPUTED",
    proposedMinutesAgo: 6 * DAY,
    executableIn: -3 * DAY,
    disputedMinutesAgo: 4 * DAY + 2 * HOUR,
    requestId: `0x${"c3".repeat(32)}`,
    m: { posted: 412, verified: 203, failed: 12, sla: 0.02 },
  },
  {
    id: "c7a0e5f3-9d21-4b68-a4c9-3e8f1b6d2a07",
    providerId: COBALT,
    tool: "company_lookup",
    binding: "Cobalt company data",
    window: "w_77",
    penalty: "9.10",
    status: "OVERTURNED",
    chainStatus: "CANCEL_REQUESTED",
    proposedMinutesAgo: 63 * HOUR,
    executableIn: 9 * HOUR,
    disputedMinutesAgo: null,
    requestId: `0x${"d4".repeat(32)}`,
    outcome: "OVERTURNED_PLATFORM_DEFECT",
    m: { posted: 530, verified: 240, failed: 22, sla: 0.03 },
  },
  {
    id: "f1b8d6a2-3e57-4c09-9b14-6a2e0d8c7f35",
    providerId: LATTICE,
    tool: "retrieve",
    binding: "Lattice retrieval",
    window: "w_54",
    penalty: "41.20",
    status: "UPHELD",
    chainStatus: "PENDING",
    /*
      As the stake contract has it: an uphold makes the record executable from
      max(the executableAt frozen at proposal, the uphold), never sooner. Proposed
      42 h ago with the 72 h timelock, it is executable in 30 h although it was
      upheld 20 h ago — a wait the timeline explains.
    */
    proposedMinutesAgo: 42 * HOUR,
    executableIn: 30 * HOUR,
    disputedMinutesAgo: 40 * HOUR,
    upheldMinutesAgo: 20 * HOUR,
    requestId: `0x${"e5".repeat(32)}`,
    outcome: "UPHELD",
    m: { posted: 1210, verified: 402, failed: 58, sla: 0.05 },
  },
  {
    id: "0a6d3b9e-7c42-4e1f-8d05-9b3a6c1e4f78",
    providerId: MERIDIAN,
    tool: "index_quote",
    binding: "Meridian quotes",
    window: "w_201",
    penalty: "3.75",
    status: "EXECUTED",
    chainStatus: "EXECUTED",
    proposedMinutesAgo: 12 * DAY,
    executableIn: -9 * DAY,
    disputedMinutesAgo: null,
    requestId: `0x${"f6".repeat(32)}`,
    executedMinutesAgo: 9 * DAY - 2 * HOUR,
    outcome: "UPHELD",
    m: { posted: 350, verified: 206, failed: 11, sla: 0.01 },
  },
  {
    id: "6f2a8c41-0b93-4d7e-a5c2-1e9b7d3f0a64",
    providerId: VERDANT,
    tool: "maps_tiles",
    binding: "Verdant tiles",
    window: "w_63",
    penalty: "7.20",
    status: "CANCELLED",
    chainStatus: "CANCELLED",
    proposedMinutesAgo: 15 * DAY,
    executableIn: -12 * DAY,
    disputedMinutesAgo: null,
    requestId: `0x${"a7".repeat(32)}`,
    resolvedMinutesAgo: 14 * DAY,
    m: { posted: 480, verified: 219, failed: 19, sla: 0.04 },
  },
  {
    id: "93d0e7b5-4c18-4a2f-8e61-7b5c0a9d2e13",
    providerId: QUANTA,
    tool: "signals",
    binding: "Quanta signals",
    window: "w_12",
    penalty: "15.60",
    status: "CANCELLED",
    chainStatus: "CANCELLED",
    proposedMinutesAgo: 40 * DAY,
    executableIn: -37 * DAY,
    disputedMinutesAgo: 38 * DAY,
    requestId: `0x${"b8".repeat(32)}`,
    resolvedMinutesAgo: 8 * DAY,
    expired: true,
    m: { posted: 760, verified: 305, failed: 41, sla: 0.05 },
  },
  {
    id: "d48b1f6e-2a07-4c93-b5e8-0f6a3c9d7e21",
    providerId: HELIOS,
    tool: "search_web",
    binding: "Helios search",
    window: "w_88",
    penalty: "4.10",
    status: "REVERSED",
    chainStatus: "EXECUTED",
    proposedMinutesAgo: 30 * DAY,
    executableIn: -27 * DAY,
    disputedMinutesAgo: null,
    requestId: `0x${"c9".repeat(32)}`,
    executedMinutesAgo: 27 * DAY,
    resolvedMinutesAgo: 20 * DAY,
    outcome: "UPHELD",
    m: { posted: 300, verified: 208, failed: 14, sla: 0.02 },
  },
];

const CASE_BY_ID = new Map(CASES.map((c) => [c.id, c]));

function caseBrief(original: DemoCase): OperatorCaseBrief {
  const c = caseNow(original);
  const suspended = memory.suspended.get(c.id);
  const paidBack = memory.compensated.get(c.id);
  const proposedAt = minutesAgo(c.proposedMinutesAgo);
  const executableAt = inMinutes(c.executableIn);
  const disputedAt = c.disputedMinutesAgo === null ? null : minutesAgo(c.disputedMinutesAgo);
  const penalty = usd(c.penalty);
  const executed = c.status === "EXECUTED";
  const measured = measurement(c);
  return {
    case: {
      proposal: {
        id: c.id,
        status: c.status,
        providerId: c.providerId,
        bindingId: `bnd_${c.id.slice(0, 6)}`,
        bindingLabel: c.binding,
        toolId: `tool_${c.tool}`,
        toolName: c.tool,
        windowId: `win_${c.window}`,
        windowLabel: c.window,
        penaltyAmount: penalty,
        appliedAmount: executed ? penalty : null,
        clocks: {
          proposedAt,
          notifiedAt: proposedAt,
          acknowledgedAt: null,
          respondByAt: executableAt,
          platformDecisionDueAt: null,
          earliestExecutionAt: executableAt,
          chainExecutableAt: executableAt,
          chainStatus: c.chainStatus,
          chainDisputedAt: disputedAt,
          chainDisputedParts: original.chainStatus === "DISPUTED" ? 1 : 0,
          secondsRemaining: null,
          runningClock: "NONE",
        },
        disputeId: null,
        outcome: c.outcome ?? null,
        resolutionKind: c.expired ? "AUTO_CHAIN_VOIDED" : null,
        resolvedAt: paidBack
          ? paidBack.at
          : executed
          ? minutesAgo(c.executedMinutesAgo ?? 0)
          : suspended
            ? suspended.at
            : c.resolvedMinutesAgo !== undefined
              ? minutesAgo(c.resolvedMinutesAgo)
              : c.status === "OVERTURNED"
                ? minutesAgo(5 * HOUR)
                : null,
        executedAt: c.executedMinutesAgo !== undefined ? minutesAgo(c.executedMinutesAgo) : null,
      },
      changeOverlay: null,
      failuresByAgent: measured.byAgent,
      failuresByRule: measured.byRule,
      evidenceVerdictCount: c.m.verified,
      suggestedClaim: null,
      inaction: {
        executesAt: executableAt,
        stakeBefore: usd("600.00"),
        stakeAfter: usd((600 - Number(c.penalty)).toFixed(2)),
        minimumRequired: usd("450.00"),
        fallsBelowMinimum: false,
        graceHours: null,
        projectedRestoreHours: null,
        routingContinues: true,
      },
      arithmetic: measured.arithmetic,
      priorWindows: [
        ...measured.prior.map((rate, index) => ({
          windowId: `pw_${c.window}_${index + 1}`,
          label: `w_${Number(c.window.slice(2)) - measured.prior.length + index}`,
          observedRate: rate,
          closedAt: minutesAgo(c.proposedMinutesAgo + (measured.prior.length - index) * 7 * DAY),
          isSubject: false,
        })),
        { windowId: `win_${c.window}`, label: c.window, observedRate: c.m.failed / c.m.verified, closedAt: proposedAt, isSubject: true },
      ],
    },
    dispute: null,
    timeline: [
      { id: `${c.id}-1`, occurredAt: proposedAt, kind: "PROPOSED", actorType: "system", actorId: null, summary: `Penalty proposed · $${c.penalty}`, detail: {} },
      ...(disputedAt
        ? [{ id: `${c.id}-2`, occurredAt: disputedAt, kind: "CHAIN_DISPUTED", actorType: "provider" as const, actorId: null, summary: "Disputed on chain by the provider", detail: {} }]
        : []),
      ...(c.status === "UPHELD"
        ? [{ id: `${c.id}-3`, occurredAt: minutesAgo(c.upheldMinutesAgo ?? 2 * DAY), kind: "CHAIN_UPHELD", actorType: "operator" as const, actorId: "riley@", summary: "Upheld by the arbiter", detail: {} }]
        : []),
      ...(c.status === "OVERTURNED" && !suspended
        ? [{ id: `${c.id}-3`, occurredAt: minutesAgo(5 * HOUR), kind: "SUSPENDED", actorType: "operator" as const, actorId: "jordan@", summary: "Suspended: proposed during a mapping regression", detail: {} }]
        : []),
      ...(suspended
        ? [{ id: `${c.id}-s`, occurredAt: suspended.at, kind: "SUSPENDED", actorType: "operator" as const, actorId: suspended.by, summary: `Suspended: ${suspended.note}`, detail: {} }]
        : []),
      ...(c.executedMinutesAgo !== undefined
        ? [{ id: `${c.id}-4`, occurredAt: minutesAgo(c.executedMinutesAgo), kind: "EXECUTED", actorType: "system" as const, actorId: null, summary: "Executed on chain", detail: {} }]
        : []),
      ...(paidBack
        ? [{ id: `${c.id}-5`, occurredAt: paidBack.at, kind: "COMPENSATED", actorType: "operator" as const, actorId: paidBack.by, summary: `Paid back into the provider's stake · $${c.penalty}`, detail: {} }]
        : []),
    ],
    restoration: [
      { label: "Penalty", value: `$${c.penalty}`, status: executed ? "NOT_APPLICABLE" : "ON_DECISION" },
      { label: "Routing", value: "unaffected throughout", status: "NOT_APPLICABLE" },
    ],
    requiresSecondSignature: false,
    chainStatus: c.chainStatus,
    chainExecutableAt: executableAt,
    chainDisputedParts: original.chainStatus === "DISPUTED" ? 1 : 0,
    upheldViolations30d: c.providerId === NORTHWIND ? 2 : 0,
  };
}

/** "12.62%". */
function percentText(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

/** Whole counts in the given shares, adding up to `total` exactly. */
function splitCount(total: number, shares: readonly number[]): number[] {
  const counts = shares.map((share) => Math.floor(total * share));
  let left = total - counts.reduce((sum, n) => sum + n, 0);
  const order = shares.map((share, index) => ({ index, rest: total * share - counts[index]! })).sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    counts[index]! += 1;
    left -= 1;
  }
  return counts;
}

/**
 * Each penalty's own measurement, from its window's counts: the observed rate,
 * the threshold (declared rate plus the 99% one-sided margin for that many
 * calls), the earlier windows and where the failures came from — so no two
 * penalties read the same numbers, and each breach is real arithmetic.
 */
function measurement(c: DemoCase) {
  const { posted, verified, failed, sla } = c.m;
  const observed = failed / verified;
  const threshold = sla + 2.58 * Math.sqrt((sla * (1 - sla)) / verified);
  // A small per-case variation, stable for a given window, for the shares and the earlier windows.
  const seed = [...c.window].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 5;
  const ruleShares = [0.55 + seed * 0.05, 0.45 - seed * 0.05];
  const agentShares = [0.4 + seed * 0.04, 0.35 - seed * 0.02, 0.25 - seed * 0.02];
  const rules = splitCount(failed, ruleShares);
  const agents = splitCount(failed, agentShares);
  const rows = (keys: string[], counts: number[]) =>
    keys.map((key, index) => ({ key, count: counts[index]!, share: counts[index]! / failed })).filter((row) => row.count > 0);
  return {
    byRule: rows(["schema.required_fields", c.tool === "fx_rates" || c.tool === "index_quote" ? "stale_timestamp" : "latency.p95"], rules),
    byAgent: rows(["agent:research-bot", "agent:pricing-sync", "agent:other"], agents),
    prior: [sla * (0.3 + seed * 0.08), sla * (0.45 + seed * 0.06)],
    arithmetic: [
      { key: "verified_calls", expression: `${verified} verified of ${posted} posted`, value: String(verified), note: "above the 200-call sample gate", tone: "NEUTRAL" as const },
      {
        key: "observed_rate",
        expression: `${failed} failed / ${verified} verified`,
        value: percentText(observed),
        note: `observed ${percentText(observed)} > ${percentText(threshold)} → breach`,
        tone: "BAD" as const,
      },
      { key: "declared_sla", expression: null, value: percentText(sla), note: "frozen when the window opened", tone: "NEUTRAL" as const },
      {
        key: "effective_threshold",
        expression: `${percentText(sla)} + 2.58 × sqrt(p(1−p)/${verified})`,
        value: percentText(threshold),
        note: null,
        tone: "NEUTRAL" as const,
      },
      { key: "penalty", expression: "failed spend × multiplier, capped", value: `$${c.penalty}`, note: null, tone: "BAD" as const },
    ],
  };
}

function arbiterDispute(original: DemoCase): ArbiterDispute {
  const c = caseNow(original);
  const disputedAt = minutesAgo(c.disputedMinutesAgo ?? 0);
  return {
    requestId: c.requestId,
    proposalId: c.id,
    providerId: c.providerId,
    chainId: DEMO_CHAIN_ID,
    caseStatus: c.status,
    caseChainStatus: c.chainStatus,
    penaltyAmount: usd(c.penalty).amount,
    reservedAmount: usd(c.penalty).amount,
    disputedAt,
    executableAt: inMinutes(c.executableIn),
    expiresAt: new Date(Date.parse(disputedAt) + 30 * 86_400_000).toISOString(),
    upheldViolations30d: c.providerId === NORTHWIND ? 2 : 0,
    beneficiary: `${DEMO_CHAIN_ID}:0x2f9a6c3e1b8d47a05c2e9f1b6a3d8c4e7f0b5a92`,
    beneficiaryEvidence:
      c.providerId === NORTHWIND
        ? {
            payer: `${DEMO_CHAIN_ID}:0x2f9a6c3e1b8d47a05c2e9f1b6a3d8c4e7f0b5a92`,
            failedCalls: 27,
            paidAmount: usd("3.24").amount,
            formulaShareAmount: usd("28.47").amount,
            redeemedAmount: usd("3.24").amount,
            shareAmount: usd("17.08").amount,
            ok: true,
            reason: null,
          }
        : null,
  };
}

const DISPUTED = CASES.filter((c) => c.chainStatus === "DISPUTED");

const PROVIDER_NAMES: Record<string, string> = {
  [HELIOS]: "Helios Data Labs",
  [MERIDIAN]: "Meridian Index",
  [NORTHWIND]: "Northwind Geo",
  [TIDEWATER]: "Tidewater Markets",
  [COBALT]: "Cobalt Street Data",
  [QUANTA]: "Quanta Signals",
  [VERDANT]: "Verdant Atlas",
  [LATTICE]: "Lattice Retrieval",
};

const CLOSED_WITHOUT_PENALTY = ["OVERTURNED", "WAIVED", "CANCELLED"];

/** The backend's list status for a demo case, in the same precedence (`findOperatorCasePage`). */
function listStatus(c: DemoCase): OperatorCaseStatus {
  if (c.status === "REVERSED") return "COMPENSATED";
  if (c.chainStatus === "EXECUTED" || c.status === "EXECUTED") return "EXECUTED";
  if (c.chainStatus === "CANCEL_REQUESTED") return "CANCEL_REQUESTED";
  if (c.expired) return "EXPIRED";
  if (c.chainStatus === "CANCELLED" || CLOSED_WITHOUT_PENALTY.includes(c.status)) return "CANCELLED";
  if (c.chainStatus === "DISPUTED") return "CHAIN_DISPUTED";
  return "PROPOSED";
}

function caseListRow(original: DemoCase): OperatorCaseListRow {
  const c = caseNow(original);
  const status = listStatus(c);
  const disputedAt = c.disputedMinutesAgo === null ? null : minutesAgo(c.disputedMinutesAgo);
  const disputeEnds = disputedAt ? new Date(Date.parse(disputedAt) + 30 * 86_400_000).toISOString() : null;
  const executableAt = inMinutes(c.executableIn);
  const nextDeadline =
    status === "CHAIN_DISPUTED"
      ? disputeEnds
      : status === "CANCEL_REQUESTED"
        ? original.chainStatus === "DISPUTED"
          ? disputeEnds
          : executableAt
        : status === "PROPOSED"
          ? executableAt
          : null;
  return {
    proposalId: c.id,
    providerId: c.providerId,
    providerName: PROVIDER_NAMES[c.providerId] ?? c.providerId,
    toolName: c.binding,
    amount: usd(c.penalty),
    chainId: DEMO_CHAIN_ID,
    status,
    proposedAt: minutesAgo(c.proposedMinutesAgo),
    disputedAt,
    nextDeadline,
  };
}

/** `GET /operator/cases`: next deadline first, then the larger penalty, then the newest. */
function caseList(query: Record<string, unknown>): CursorPage<OperatorCaseListRow> {
  const wanted = typeof query.status === "string" && query.status ? query.status.split(",") : null;
  const provider = typeof query.providerId === "string" ? query.providerId : null;
  const at = (iso: string | null) => (iso ? Date.parse(iso) : Number.POSITIVE_INFINITY);
  const rows = CASES.map(caseListRow)
    .filter((row) => (wanted ? wanted.includes(row.status) : true) && (provider ? row.providerId === provider : true))
    .sort(
      (a, b) =>
        at(a.nextDeadline) - at(b.nextDeadline) ||
        Number(b.amount.amount) - Number(a.amount.amount) ||
        Date.parse(b.proposedAt) - Date.parse(a.proposedAt),
    );
  return page(rows);
}

// ── Approvals ───────────────────────────────────────────────────────────────

const APPROVALS: OperatorApproval[] = [
  {
    id: "apr-unblock-1",
    action: "account.unblock",
    code: "A-10",
    target: "account_block:blk-2",
    payload: { blockId: "blk-2", body: { reasonCode: "KEY_ROTATED", note: "Customer rotated the leaked key and confirmed in ticket SUP-2231." } },
    status: "PENDING",
    requestedBy: "sam@",
    requestedById: "op-sam",
    approvedBy: null,
    rejectedBy: null,
    createdAt: minutesAgo(2 * HOUR + 10),
    decidedAt: null,
    expiresAt: inMinutes(22 * HOUR - 10),
  },
  {
    id: "apr-comp-1",
    action: "slash.compensated",
    code: "S-5",
    target: `slash_proposal:${CASES[5].id}`,
    payload: {
      proposalId: CASES[5].id,
      body: { signature: "0x9d1c…e4a0", reasonCode: "EXECUTED_IN_ERROR", note: "Executed during the w_201 mapping regression; treasury deposit confirmed." },
    },
    status: "PENDING",
    requestedBy: "riley@",
    requestedById: "op-riley",
    approvedBy: null,
    rejectedBy: null,
    createdAt: minutesAgo(6 * HOUR),
    decidedAt: null,
    expiresAt: inMinutes(18 * HOUR),
  },
  {
    id: "apr-suspend-1",
    action: "slash.suspend",
    code: "S-1",
    target: `slash_proposal:${CASES[4].id}`,
    payload: { proposalId: CASES[4].id, body: { reasonCode: "PROPOSED_IN_ERROR", note: "Upheld on evidence that later proved to be our own timeout." } },
    status: "PENDING",
    requestedBy: "jordan@",
    requestedById: "op-jordan",
    approvedBy: null,
    rejectedBy: null,
    // Asked 16 h ago: 8 h left, so it outlives the demo session (SESSION_SAFE_MINUTES).
    createdAt: minutesAgo(16 * HOUR),
    decidedAt: null,
    expiresAt: inMinutes(8 * HOUR),
  },
  {
    id: "apr-add-1",
    action: "operator.add",
    code: "A-12",
    target: "operator_wallet:0x4d2e8a1c6b9f3e07d5a2c8b1e4f7a0d3c6b9e258",
    payload: {
      body: {
        walletAddress: "0x4d2e8a1c6b9f3e07d5a2c8b1e4f7a0d3c6b9e258",
        subject: "noor@",
        displayName: "Noor Hassan",
        roles: ["ADJ"],
        authorityLimitMinor: "100000000",
        reasonCode: "NEW_HIRE",
        note: "Joins the adjudication rota next week.",
      },
    },
    status: "PENDING",
    requestedBy: "dan@",
    requestedById: "op-dan",
    approvedBy: null,
    rejectedBy: null,
    createdAt: minutesAgo(50),
    decidedAt: null,
    expiresAt: inMinutes(23 * HOUR + 10),
  },
  {
    id: "apr-change-1",
    action: "operator.change",
    code: "A-13",
    target: "operator:op-iris",
    payload: {
      operatorId: "op-iris",
      body: { authorityLimitMinor: "1000000000", reasonCode: "ROLE_CHANGE", note: "Iris now covers the weekend adjudication rota." },
    },
    status: "PENDING",
    requestedBy: "ava@",
    requestedById: "op-ava",
    approvedBy: null,
    rejectedBy: null,
    createdAt: minutesAgo(3 * HOUR),
    decidedAt: null,
    expiresAt: inMinutes(21 * HOUR),
  },
  {
    id: "apr-old-1",
    action: "account.unblock",
    code: "A-10",
    target: "account_block:blk-3",
    payload: { blockId: "blk-3", body: { reasonCode: "BLOCKED_IN_ERROR", note: "Wrong wallet blocked during the incident." } },
    status: "APPROVED",
    requestedBy: "sam@",
    requestedById: "op-sam",
    approvedBy: "jordan@",
    rejectedBy: null,
    createdAt: minutesAgo(4 * DAY),
    decidedAt: minutesAgo(4 * DAY - 40),
    expiresAt: minutesAgo(3 * DAY),
  },
  {
    id: "apr-old-2",
    action: "operator.change",
    code: "A-13",
    target: "operator:op-iris",
    payload: { operatorId: "op-iris", body: { authorityLimitMinor: "1000000000", reasonCode: "PROMOTION", note: "Raise to $1,000 after training." } },
    status: "REJECTED",
    requestedBy: "dan@",
    requestedById: "op-dan",
    approvedBy: null,
    rejectedBy: "dan@",
    createdAt: minutesAgo(6 * DAY),
    decidedAt: minutesAgo(6 * DAY - 15),
    expiresAt: minutesAgo(5 * DAY),
  },
];

// ── Blocks ──────────────────────────────────────────────────────────────────

const BLOCKS: AccountBlock[] = [
  {
    id: "blk-1",
    subjectKind: "ORGANIZATION",
    subject: QUANTA,
    subjectKey: QUANTA,
    active: true,
    reasonCode: "FRAUD",
    note: "Self-dealing: agents owned by the provider farmed refunds.",
    ticketRef: "INC-412",
    blockedBy: "sam@",
    blockedAt: minutesAgo(3 * DAY),
    unblockedBy: null,
    unblockApprovedBy: null,
    unblockedAt: null,
    unblockNote: null,
  },
  {
    id: "blk-2",
    subjectKind: "WALLET",
    subject: "eip155:46630:0x9f3c2b7e1d4a8c05b6e9f2a3d7c1b4e8a0d5f36c",
    subjectKey: "eip155:0x9f3c2b7e1d4a8c05b6e9f2a3d7c1b4e8a0d5f36c",
    active: true,
    reasonCode: "LEAKED_KEY",
    note: "Key posted in a public repository; customer notified.",
    ticketRef: "SUP-2231",
    blockedBy: "jordan@",
    blockedAt: minutesAgo(26 * HOUR),
    unblockedBy: null,
    unblockApprovedBy: null,
    unblockedAt: null,
    unblockNote: null,
  },
  {
    id: "blk-3",
    subjectKind: "WALLET",
    subject: "eip155:46630:0x2c7a9e4f1b6d3a08e5c2b9f4a7d1e3c6b0a8f592",
    subjectKey: "eip155:0x2c7a9e4f1b6d3a08e5c2b9f4a7d1e3c6b0a8f592",
    active: false,
    reasonCode: "ABUSE",
    note: "Burst of malformed calls; turned out to be a misconfigured agent.",
    ticketRef: null,
    blockedBy: "sam@",
    blockedAt: minutesAgo(5 * DAY),
    unblockedBy: "sam@",
    unblockApprovedBy: "jordan@",
    unblockedAt: minutesAgo(4 * DAY - 40),
    unblockNote: "Wrong wallet blocked during the incident.",
  },
];

// ── Activity ────────────────────────────────────────────────────────────────

function logRow(partial: Partial<OverrideLogEntry> & Pick<OverrideLogEntry, "id" | "code" | "label" | "action" | "actorSubject" | "targetType" | "targetId" | "reasonCode" | "reason">, minutes: number): OverrideLogEntry {
  return {
    createdAt: minutesAgo(minutes),
    family: partial.code.startsWith("S") ? "SLASH" : "ACCESS",
    approverSubject: null,
    approvalMode: "SINGLE",
    organizationId: null,
    before: {},
    after: {},
    ticketRef: null,
    breakGlass: false,
    ...partial,
  };
}

const LOG: OverrideLogEntry[] = [
  logRow({ id: "log-1", code: "S-1", label: "Suspend slash proposal", action: "slash.suspend", actorSubject: "jordan@", targetType: "slash_proposal", targetId: CASES[3].id, reasonCode: "PLATFORM_DEFECT", reason: "Proposed during a mapping regression." }, 5 * HOUR),
  logRow({ id: "log-3", code: "S-13", label: "Arbiter ruling", action: "arbiter.ruling", actorSubject: "riley@", targetType: "slash_proposal", targetId: CASES[4].id, reasonCode: "EVIDENCE_HOLDS", reason: "Failures reproduce on the provider's side." }, CASES[4].upheldMinutesAgo ?? 2 * DAY),
  logRow({ id: "log-2", code: "A-9", label: "Block account", action: "account.block", actorSubject: "jordan@", targetType: "account_block", targetId: "blk-2", reasonCode: "LEAKED_KEY", reason: "Key posted in a public repository; customer notified.", ticketRef: "SUP-2231" }, 26 * HOUR),
  logRow({ id: "log-4", code: "A-9", label: "Block account", action: "account.block", actorSubject: "sam@", targetType: "account_block", targetId: "blk-1", reasonCode: "FRAUD", reason: "Self-dealing: agents owned by the provider farmed refunds.", ticketRef: "INC-412" }, 3 * DAY),
  logRow({ id: "log-5", code: "A-10", label: "Lift account block", action: "account.unblock", actorSubject: "sam@", approverSubject: "jordan@", approvalMode: "TWO_PERSON", targetType: "account_block", targetId: "blk-3", reasonCode: "BLOCKED_IN_ERROR", reason: "Wrong wallet blocked during the incident." }, 4 * DAY - 40),
  logRow({ id: "log-6", code: "A-12", label: "Add operator", action: "operator.add", actorSubject: "dan@", approverSubject: "jordan@", approvalMode: "TWO_PERSON", targetType: "operator", targetId: "op-iris", reasonCode: "NEW_HIRE", reason: "Adjudication rota." }, 40 * DAY),
];

// ── Health ──────────────────────────────────────────────────────────────────

function health(): PlatformHealth {
  return {
    intentsPerMinute: 184,
    intentsPerMinuteDeltaVsHour: 0.06,
    verificationBacklog: 37,
    verificationBacklogP95AgeSeconds: 41,
    falsePositiveRate: 0.012,
    falsePositiveGate: 0.02,
    policiesInShadow: 2,
    policiesTotal: 31,
    stakeLocked: usd("48210.00"),
    providersWithStake: 8,
    openDisputes: DISPUTED.length,
    oldestOpenDisputeAgeSeconds: 23 * 86_400,
    chainState: [
      {
        chainId: DEMO_CHAIN_ID,
        paused: false,
        arbiter: ARBITER.toLowerCase(),
        slashDelaySeconds: 259_200,
        blockedCount: 1,
        indexedBlock: "133000100",
        headBlock: "133000112",
        lagSeconds: 24,
        stale: false,
        reconciledAt: minutesAgo(1),
      },
    ],
    slashHolds: [
      {
        providerId: VERDANT,
        chainId: DEMO_CHAIN_ID,
        reasons: ["STAKE_FULLY_RESERVED"],
        heldSince: minutesAgo(7 * HOUR),
        checkedAt: minutesAgo(4),
      },
    ],
  };
}

function contractCall(functionName: string, requestIds: string[]) {
  return {
    chainId: DEMO_CHAIN_ID,
    to: STAKE_CONTRACT,
    data: `0x${"5f2a9c1e".repeat(9)}${requestIds.map((id) => id.slice(2)).join("")}`,
    value: "0",
    signer: ARBITER,
    signerRole: "ARBITER" as const,
    functionName,
    requestIds,
  };
}

// ── The table ───────────────────────────────────────────────────────────────

export const OPERATOR_FIXTURES: readonly DemoFixture[] = [
  { method: "GET", match: "/operator/me", body: () => me() },
  { method: "POST", match: "/operator/auth/logout", body: () => ({}) },
  { method: "GET", match: "/operator/health", body: () => health() },
  // The retired off-chain queue: empty, as it is once the objection process is gone.
  { method: "GET", match: "/operator/queue", body: () => page([]) },
  { method: "GET", match: "/operator/cases", body: (_path, query) => caseList(query) },
  {
    method: "GET",
    match: /^\/operator\/cases\/[^/]+$/,
    body: (path) => {
      const found = CASE_BY_ID.get(lastSegment(path));
      return found ? caseBrief(found) : undefined;
    },
  },
  {
    method: "POST",
    match: /^\/operator\/cases\/[^/]+\/suspend$/,
    body: (path, _query, data) => {
      const id = lastSegment(path, 1);
      const found = CASE_BY_ID.get(id);
      const reasonCode = bodyText(data, "reasonCode");
      const note = bodyText(data, "note");
      // From UPHELD a suspension is two-person (S-1): the API answers 202 { approvalId }.
      if (found && caseNow(found).status === "UPHELD") {
        return queue("slash.suspend", "S-1", `slash_proposal:${id}`, { proposalId: id, body: { reasonCode, note } });
      }
      suspend(id, reasonCode, note, me().subject, null);
      return { id, status: "CANCELLED" };
    },
  },
  {
    method: "POST",
    match: /^\/operator\/cases\/[^/]+\/cancel-intent$/,
    body: (path) => {
      const found = CASE_BY_ID.get(lastSegment(path, 1)) ?? CASES[3];
      return {
        transaction: contractCall("cancelSlash", [found.requestId]).data,
        admin: ARBITER,
        signerRole: "ARBITER",
        to: STAKE_CONTRACT,
        requestId: found.requestId.slice(2),
        provider: found.providerId,
      };
    },
  },
  {
    method: "GET",
    match: "/operator/approvals",
    body: (_path, query) => {
      const status = typeof query.status === "string" ? query.status : null;
      // History reads newest decision first, so a request decided in this demo tops it.
      // Pending rows keep their order ahead of the decided ones.
      const decidedAt = (a: OperatorApproval) => (a.status === "PENDING" ? null : Date.parse(a.decidedAt ?? a.expiresAt));
      const rows = approvalsNow().sort((a, b) => {
        const [x, y] = [decidedAt(a), decidedAt(b)];
        if (x === null || y === null) return (x === null ? 0 : 1) - (y === null ? 0 : 1);
        return y - x;
      });
      return page(status ? rows.filter((a) => a.status === status) : rows);
    },
  },
  {
    method: "POST",
    match: /^\/operator\/approvals\/[^/]+\/approve$/,
    body: (path) => approve(lastSegment(path, 1)),
  },
  {
    method: "POST",
    match: /^\/operator\/approvals\/[^/]+\/reject$/,
    body: (path) => {
      const approval = approvalsNow().find((a) => a.id === lastSegment(path, 1)) ?? APPROVALS[0];
      const decided: OperatorApproval = { ...approval, status: "REJECTED", rejectedBy: me().subject, decidedAt: nowIso() };
      memory.decided.set(approval.id, decided);
      saveMemory();
      return { approval: decided };
    },
  },
  {
    method: "GET",
    match: "/operator/blocks",
    body: (_path, query) => {
      const active = query.active === undefined ? null : String(query.active) === "true";
      const rows = blocksNow();
      return page(active === null ? rows : rows.filter((b) => b.active === active));
    },
  },
  {
    method: "POST",
    match: "/operator/blocks",
    body: (_path, _query, data) => {
      const subjectKind = bodyText(data, "subjectKind") === "ORGANIZATION" ? "ORGANIZATION" : "WALLET";
      const subject = bodyText(data, "subject") || BLOCKS[1].subject;
      const block: AccountBlock = {
        ...BLOCKS[1],
        id: nextId("blk"),
        subjectKind,
        subject,
        subjectKey: subjectKind === "WALLET" ? `eip155:${subject.split(":").pop()}` : subject,
        reasonCode: bodyText(data, "reasonCode") || "OTHER",
        note: bodyText(data, "note"),
        ticketRef: bodyText(data, "ticketRef") || null,
        blockedBy: me().subject,
        blockedAt: nowIso(),
      };
      memory.blocks.unshift(block);
      remember({ id: nextId("log"), code: "A-9", label: "Block account", action: "account.block", actorSubject: me().subject, approverSubject: null, targetType: "account_block", targetId: block.id, reasonCode: block.reasonCode, reason: block.note, ticketRef: block.ticketRef });
      return block;
    },
  },
  {
    method: "POST",
    match: /^\/operator\/blocks\/[^/]+\/unblock$/,
    body: (path, _query, data) => {
      const blockId = lastSegment(path, 1);
      return queue("account.unblock", "A-10", `account_block:${blockId}`, { blockId, body: { reasonCode: bodyText(data, "reasonCode"), note: bodyText(data, "note") } });
    },
  },
  {
    method: "GET",
    match: "/operator/override-log",
    body: (_path, query) => {
      const targetId = typeof query.targetId === "string" ? query.targetId : null;
      const targetType = typeof query.targetType === "string" ? query.targetType : null;
      return page([...memory.log, ...LOG].filter((row) => (!targetId || row.targetId === targetId) && (!targetType || row.targetType === targetType)));
    },
  },
  {
    method: "GET",
    match: "/operator/arbiter/terms",
    body: () => ({ chainId: DEMO_CHAIN_ID, paused: false, arbiter: ARBITER, admin: "0xAb8483F64d9C6d1EcF9b849Ae677dD3315835cb2", slashDelaySeconds: 259_200, slashAgentBps: 6000 }),
  },
  { method: "GET", match: "/operator/arbiter/disputes", body: () => ({ items: DISPUTED.map(arbiterDispute) }) },
  {
    method: "POST",
    match: "/operator/arbiter/ruling-intent",
    body: () => contractCall("cancelSlashBatch", DISPUTED.map((c) => c.requestId)),
  },
  { method: "POST", match: "/operator/arbiter/block-intent", body: () => contractCall("setBlocked", []) },
  {
    method: "POST",
    match: "/operator/operators",
    body: (_path, _query, data) => {
      const wallet = bodyText(data, "walletAddress").toLowerCase();
      return queue("operator.add", "A-12", `operator_wallet:${wallet}`, { body: { ...data } });
    },
  },
  {
    method: "PATCH",
    match: /^\/operator\/operators\/[^/]+$/,
    body: (path, _query, data) => {
      const operatorId = lastSegment(path);
      return queue("operator.change", "A-13", `operator:${operatorId}`, { operatorId, body: { ...data } });
    },
  },
  {
    method: "POST",
    match: /^\/operator\/operators\/[^/]+\/remove$/,
    body: (path, _query, data) => {
      const id = lastSegment(path, 1);
      memory.removed.add(id);
      remember({ id: nextId("log"), code: "A-14", label: "Remove operator", action: "operator.remove", actorSubject: me().subject, approverSubject: null, targetType: "operator", targetId: id, reasonCode: bodyText(data, "reasonCode"), reason: bodyText(data, "note"), ticketRef: null });
      return { ...OPERATORS.find((op) => op.id === id), status: "REMOVED" };
    },
  },
  {
    method: "GET",
    match: "/operator/operators",
    body: (_path, query) => {
      const status = typeof query.status === "string" ? query.status : null;
      const rows = OPERATORS.map((op) => (memory.removed.has(op.id) ? { ...op, status: "REMOVED" as const } : op));
      return page(status ? rows.filter((op) => op.status === status) : rows);
    },
  },
];
