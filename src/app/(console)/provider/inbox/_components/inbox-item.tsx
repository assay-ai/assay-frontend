import { CircleCheck, FileDiff, Scale } from "lucide-react";
import Link from "next/link";

import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { contractNoticeAction, contractNoticeText, contractNoticeTitle, isContractNoticeEvent, readContractNotice } from "@/features/toolsets/contract-notices";
import { routes } from "@/libs/routes";
import { formatMoney, symbolForAsset } from "@/utils/money";

/**
 * One inbox item card.
 *
 * Lives in `_components` rather than inside `page.tsx` so it can be rendered
 * in isolation: `notifications` has no producer anywhere in the backend, so
 * the only way to see this component with data in it is to hand it data
 * directly. See the inbox screen's page docstring for why the row list is empty.
 */

/**
 * `NotificationDto`, transcribed from the OpenAPI document at
 * `/api/docs-json`. `account.service.ts` types this resource as
 * `CursorPage<unknown>` and that file is not a screen's to edit, so the shape
 * is declared here and narrowed at the boundary. When the service gains a
 * real type, delete this and import it.
 */
export interface NotificationItem {
  id: string;
  /** From the shared event catalogue, e.g. `payment_intent.refunded`. */
  event: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  subjectType?: string | null;
  subjectId?: string | null;
  /** Null means unread. */
  readAt?: string | null;
  /** The event payload; a `tool_version.*` notice carries the tool, the major, the sunset and the replacement. */
  payload?: unknown;
  createdAt: string;
}

export function isNotification(value: unknown): value is NotificationItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.title === "string";
}

/**
 * The frame paints one icon per item — `scale`/`$danger-500`,
 * `file-diff`/`$warning-500`, `circle-check`/`$success-500` — and those track
 * the *kind* of item, which lives in `event`, whose catalogue is unenumerable
 * from here (no producer, no published list). `severity` is a closed
 * three-value enum on the DTO and its three values map onto the frame's three
 * tones exactly, so that is what is keyed on. When the event catalogue lands,
 * this table is the one thing to change.
 */
const SEVERITY_ICON = {
  CRITICAL: { Icon: Scale, tone: "text-danger-500", border: "border-danger-20" },
  WARNING: { Icon: FileDiff, tone: "text-warning-500", border: "border-01" },
  INFO: { Icon: CircleCheck, tone: "text-success-500", border: "border-01" },
} as const;

/** The platform settles in 6-decimal stablecoins; the notification carries no scale. */
const NOTIFICATION_ASSET_DECIMALS = 6;

/**
 * The penalty notification's body names the amount in raw minor units and the
 * asset by its chain-scoped id ("Estimated penalty 28470000 solana:…/token:…").
 * Neither is something a person reads, so the pair is rewritten as money.
 * Bodies that do not match are returned untouched.
 */
export function formatNotificationBody(body: string): string {
  return body.replace(/(\d{1,30}) ([a-z0-9-]+:[^\s/]+\/[^\s]+?)(?=[\s,.;)]|$)/gi, (_match, amount: string, asset: string) =>
    formatMoney(
      { amount, asset, decimals: NOTIFICATION_ASSET_DECIMALS },
      { symbol: symbolForAsset(asset), decimals: 2 }
    )
  );
}

/**
 * The penalty title carries the amount in raw minor units with no asset at all
 * ("A penalty of 28470000 is proposed against your stake"), so the settlement
 * scale is assumed here too.
 */
export function formatNotificationTitle(title: string): string {
  return title.replace(/\b(penalty of )(\d{1,30})\b(?![.:/])/gi, (_match, lead: string, amount: string) =>
    `${lead}${formatMoney({ amount, asset: "", decimals: NOTIFICATION_ASSET_DECIMALS }, { decimals: 2 })}`
  );
}

/** Where a notification's subject lives, when the console has a page for it. */
export function notificationHref(item: Pick<NotificationItem, "subjectType" | "subjectId">): { href: string; label: string } | null {
  const id = item.subjectId;
  if (!id) return null;
  switch (item.subjectType) {
    case "slash_proposal":
    case "slash_execution":
      return { href: routes.penalty(id), label: "Open the penalty" };
    case "binding":
      return { href: routes.binding(id), label: "Open the tool" };
    case "policy_change":
      return { href: "/provider/policy-changes", label: "Review the change" };
    case "tool_request":
      return { href: routes.toolRequest(id), label: "Open the request" };
    case "call_dispute":
      return { href: routes.providerCallDispute(id), label: "Reply to the report" };
    default:
      return null;
  }
}

/** A contract notice in the provider's words, with its next step; null for every other event. */
function contractView(item: NotificationItem): { title: string; body: string; target: { href: string; label: string } } | null {
  if (!isContractNoticeEvent(item.event)) return null;
  const notice = readContractNotice(item.payload);
  if (!notice) return null;
  const provider = { ...notice, role: "PROVIDER" as const };
  return { title: contractNoticeTitle(item.event, provider), body: contractNoticeText(item.event, provider), target: contractNoticeAction(provider) };
}

export function InboxItem({ item }: { item: NotificationItem }) {
  const { Icon, tone, border } = SEVERITY_ICON[item.severity] ?? SEVERITY_ICON.INFO;
  const contract = contractView(item);
  const target = contract?.target ?? notificationHref(item);

  return (
    <article className={`flex w-full flex-col gap-3 rounded-lg border bg-01 p-4 tablet:flex-row tablet:items-center tablet:gap-3.5 ${border}`}>
      <Icon width={18} height={18} strokeWidth={1.5} aria-hidden="true" className={`hidden shrink-0 tablet:block ${tone}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-label-sm leading-[1.4] text-01">
          {item.readAt ? null : <span className="mr-1.5 inline-block size-2 rounded-full bg-primary-500 align-middle" aria-label="Unread" />}
          {contract ? contract.title : formatNotificationTitle(item.title)}
        </p>
        <p className="break-words text-body-13 leading-[1.55] text-02 [overflow-wrap:anywhere]">{contract ? contract.body : formatNotificationBody(item.body)}</p>
        <UtcTime value={item.createdAt} className="text-body-xs text-03" />
      </div>
      {target ? (
        <Button size="sm" variant="secondary" asChild className="self-start tablet:self-center">
          <Link href={target.href}>{target.label}</Link>
        </Button>
      ) : null}
    </article>
  );
}
