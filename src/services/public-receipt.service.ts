import { publicApi } from "./public-api";

/**
 * `GET /public/receipts/:intentId`: what anyone with the link may see of one
 * call (SPEC-public-receipts 3.1). No session, so it goes through `publicApi`.
 *
 * The response is never handed on as it came. `parsePublicReceipt` builds a
 * new object field by field from the keys below, so a key the API adds by
 * mistake can never reach the page. A response that does not have this shape
 * is refused as a whole (`PublicReceiptShapeError`).
 */

export const PUBLIC_RECEIPT_STATUSES = ["IN_PROGRESS", "CHARGED", "NOT_CHARGED", "CLOSED"] as const;
export type PublicReceiptStatus = (typeof PUBLIC_RECEIPT_STATUSES)[number];

export const PUBLIC_RECEIPT_STAGES = ["SCHEMA", "DETERMINISTIC_RULES", "CROSS_CHECK", "SEMANTIC"] as const;
export type PublicReceiptStageName = (typeof PUBLIC_RECEIPT_STAGES)[number];

export interface PublicReceiptNamed {
  id: string;
  name: string;
}

export interface PublicReceiptMoney {
  amount: string;
  asset: string;
  decimals: number;
}

export interface PublicReceiptStage {
  stage: PublicReceiptStageName;
  status: string;
  label: string;
}

export interface PublicReceipt {
  status: PublicReceiptStatus;
  tool: PublicReceiptNamed | null;
  provider: PublicReceiptNamed | null;
  listedPrice: PublicReceiptMoney;
  chargedPrice: PublicReceiptMoney;
  notCharged: { reason: string; text: string } | null;
  stages: PublicReceiptStage[];
  sampling: string | null;
  createdAt: string;
  settledAt: string | null;
}

export class PublicReceiptShapeError extends Error {}

type Obj = Record<string, unknown>;

function fail(path: string): never {
  // The path only, never the value.
  throw new PublicReceiptShapeError(`Unexpected public receipt shape at ${path}`);
}

function object(value: unknown, path: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(path);
  return value as Obj;
}

// C0 and C1 control characters, and the bidi overrides that can reorder a line.
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** A string from the API as plain, single-line text, capped at `max` characters. */
function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string") return fail(path);
  return value.replace(CONTROL, "").slice(0, max);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) return fail(path);
  return value as T;
}

function named(value: unknown, path: string): PublicReceiptNamed | null {
  if (value === null) return null;
  const o = object(value, path);
  return { id: text(o.id, `${path}.id`, 64), name: text(o.name, `${path}.name`, 80) };
}

function money(value: unknown, path: string): PublicReceiptMoney {
  const o = object(value, path);
  if (typeof o.amount !== "string" || !/^[0-9]{1,40}$/.test(o.amount)) return fail(`${path}.amount`);
  if (typeof o.decimals !== "number" || !Number.isInteger(o.decimals) || o.decimals < 0 || o.decimals > 36) {
    return fail(`${path}.decimals`);
  }
  return { amount: o.amount, asset: text(o.asset, `${path}.asset`, 120), decimals: o.decimals };
}

function instant(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length > 40 || Number.isNaN(Date.parse(value))) return fail(path);
  return value;
}

function stage(value: unknown, path: string): PublicReceiptStage {
  const o = object(value, path);
  return {
    stage: oneOf(o.stage, PUBLIC_RECEIPT_STAGES, `${path}.stage`),
    status: text(o.status, `${path}.status`, 40),
    label: text(o.label, `${path}.label`, 40),
  };
}

/** The response, rebuilt field by field. Unknown keys are dropped; a wrong shape throws. */
export function parsePublicReceipt(value: unknown): PublicReceipt {
  const o = object(value, "$");
  if (!Array.isArray(o.stages) || o.stages.length !== PUBLIC_RECEIPT_STAGES.length) fail("$.stages");
  const stages = (o.stages as unknown[]).map((item, i) => stage(item, `$.stages[${i}]`));
  let notCharged: PublicReceipt["notCharged"] = null;
  if (o.notCharged !== null) {
    const n = object(o.notCharged, "$.notCharged");
    notCharged = { reason: text(n.reason, "$.notCharged.reason", 64), text: text(n.text, "$.notCharged.text", 200) };
  }
  return {
    status: oneOf(o.status, PUBLIC_RECEIPT_STATUSES, "$.status"),
    tool: named(o.tool, "$.tool"),
    provider: named(o.provider, "$.provider"),
    listedPrice: money(o.listedPrice, "$.listedPrice"),
    chargedPrice: money(o.chargedPrice, "$.chargedPrice"),
    notCharged,
    stages,
    sampling: o.sampling === null ? null : text(o.sampling, "$.sampling", 120),
    createdAt: instant(o.createdAt, "$.createdAt"),
    settledAt: o.settledAt === null ? null : instant(o.settledAt, "$.settledAt"),
  };
}

export async function getPublicReceipt(intentId: string): Promise<PublicReceipt> {
  const body = await publicApi.get<unknown>(`/public/receipts/${encodeURIComponent(intentId)}`);
  return parsePublicReceipt(body);
}
