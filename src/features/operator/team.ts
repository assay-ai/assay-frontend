import type { OperatorApproval, OperatorDirectoryEntry, OperatorRole } from "@/interfaces/operator";
import { formatMoney } from "@/utils/money";

import { eligibleApprovers } from "./inbox";
import { actsOnMoney } from "./roles";

/**
 * Team's list, as pure functions: the limit column, and the people whose
 * addition is still waiting for a second admin (from the pending approvals —
 * the directory only lists them once they are added).
 */

/** "$1,000", "No limit", or "—" for someone who cannot act on money at all. */
export function limitCell(row: Pick<OperatorDirectoryEntry, "authorityLimit" | "roles">): string {
  if (!actsOnMoney(row.roles)) return "—";
  if (row.authorityLimit === null) return "No limit";
  return formatMoney(row.authorityLimit).replace(/\.00$/, "");
}

/** An invite's limit, as `limitCell` says it for a member. */
export function inviteLimit(invite: Pick<Invite, "roles" | "limitMinor">, asset: string, decimals: number): string {
  if (invite.roles.length > 0 && !actsOnMoney(invite.roles)) return "—";
  if (invite.limitMinor === null) return "No limit";
  if (invite.limitMinor === undefined) return "—";
  return formatMoney({ amount: invite.limitMinor, asset, decimals }).replace(/\.00$/, "");
}

/** A pending `operator.add`, drawn as a row until it is approved. */
export interface Invite {
  id: string;
  name: string;
  subject: string;
  roles: OperatorRole[];
  limitMinor: string | null | undefined;
  wallet: string | null;
  waitingFor: string[];
}

export function invitesOf(
  approvals: readonly OperatorApproval[],
  operators: Parameters<typeof eligibleApprovers>[1],
): Invite[] {
  return approvals
    .filter((approval) => approval.action === "operator.add" && approval.status === "PENDING")
    .map((approval) => {
      const body = (approval.payload.body ?? {}) as Record<string, unknown>;
      const subject = typeof body.subject === "string" ? body.subject : "";
      return {
        id: approval.id,
        name: (typeof body.displayName === "string" && body.displayName.trim()) || subject || "Someone new",
        subject,
        roles: Array.isArray(body.roles) ? (body.roles as OperatorRole[]) : [],
        limitMinor: body.authorityLimitMinor === null ? null : typeof body.authorityLimitMinor === "string" ? body.authorityLimitMinor : undefined,
        wallet: typeof body.walletAddress === "string" ? body.walletAddress : null,
        waitingFor: eligibleApprovers("A-12", operators, approval.requestedById),
      };
    });
}

export function firstNames(names: readonly string[]): string {
  if (names.length === 0) return "a second admin";
  if (names.length === 1) return names[0]!;
  const first = (name: string) => name.split(/\s+/)[0] ?? name;
  return names.length === 2 ? `${first(names[0]!)} or ${first(names[1]!)}` : `${first(names[0]!)} or ${names.length - 1} others`;
}

