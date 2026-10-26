import { CircleCheck, FileDiff, Scale } from "lucide-react";
import Link from "next/link";

import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { contractNoticeAction, contractNoticeText, contractNoticeTitle, isContractNoticeEvent, readContractNotice } from "@/features/toolsets/contract-notices";
import { routes } from "@/libs/routes";

import { noticeView, type NoticeContext, type NoticeView } from "./notice-view";

/**
 * One inbox item card, rendered from the notice's `event` and `payload`
 * (`notice-view.ts`), so stored rows written in minor units or with ids read
 * the same as new ones.
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
      return { href: routes.providerCallDispute(id), label: "Open the report" };
    case "provider_tool":
      return { href: routes.providerApi(id), label: "Open your API" };
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

/** No tool names known: a notice without a resolver still never shows an id. */
const NO_NAMES: NoticeContext = { toolName: () => null };

/** A notice in the provider's words: contract notices from their own copy, the rest from `event` + `payload`. */
export function inboxView(item: NotificationItem, ctx: NoticeContext = NO_NAMES): NoticeView & { target: { href: string; label: string } | null } {
  const contract = contractView(item);
  if (contract) return { title: contract.title, body: contract.body, target: contract.target, groupKey: null };
  const view = noticeView(item, ctx);
  return { ...view, target: view.target ?? notificationHref(item) };
}

/**
 * One card. `repeats` is how many older notices saying the same thing were
 * folded into it (see `collapseNotices`); `since` is the oldest of them.
 */
export function InboxItem({
  item,
  view,
  repeats = 0,
  since,
  unread,
}: {
  item: NotificationItem;
  view?: NoticeView;
  repeats?: number;
  since?: string;
  /** Unread when any folded notice is; defaults to this one's own state. */
  unread?: boolean;
}) {
  const shown = view ?? inboxView(item);
  const { Icon, tone, border } = SEVERITY_ICON[shown.severity ?? item.severity] ?? SEVERITY_ICON.INFO;
  const target = shown.target ?? notificationHref(item);
  const isUnread = unread ?? !item.readAt;

  return (
    <article className={`flex w-full flex-col gap-3 rounded-lg border bg-01 p-4 tablet:flex-row tablet:items-center tablet:gap-3.5 ${border}`}>
      <Icon width={18} height={18} strokeWidth={1.5} aria-hidden="true" className={`hidden shrink-0 tablet:block ${tone}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-label-sm leading-[1.4] text-01">
          {isUnread ? <span className="mr-1.5 inline-block size-2 rounded-full bg-primary-500 align-middle" aria-label="Unread" /> : null}
          {shown.title}
        </p>
        <p className="break-words text-body-13 leading-[1.55] text-02 [overflow-wrap:anywhere]">{shown.body}</p>
        <p className="text-body-xs text-03">
          <UtcTime value={item.createdAt} />
          {repeats > 0 && since ? (
            <>
              {" "}· said {repeats + 1} times since <UtcTime value={since} />
            </>
          ) : null}
        </p>
      </div>
      {target ? (
        <Button size="sm" variant="secondary" asChild className="self-start tablet:self-center">
          <Link href={target.href}>{target.label}</Link>
        </Button>
      ) : null}
    </article>
  );
}
