import { CircleCheck, FileDiff, Scale } from "lucide-react";

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

/** `2026-08-01 00:12 UTC` — the mono line's format on the frame's third card. */
function utcStamp(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return `${at.toISOString().slice(0, 10)} ${at.toISOString().slice(11, 16)} UTC`;
}

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

export function InboxItem({ item }: { item: NotificationItem }) {
  const { Icon, tone, border } = SEVERITY_ICON[item.severity] ?? SEVERITY_ICON.INFO;

  return (
    <article
      className={`flex w-full items-center gap-3.5 rounded-lg border bg-01 p-[18px] ${border}`}
    >
      <Icon
        width={18}
        height={18}
        strokeWidth={1.5}
        aria-hidden="true"
        className={`shrink-0 ${tone}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-label-sm leading-[1.4] text-01">{item.title}</p>
        <p className="break-words text-body-13 leading-[1.55] text-02 [overflow-wrap:anywhere]">
          {formatNotificationBody(item.body)}
        </p>
        {/*
          The frame's `C` line is a deadline ("respond by … · 2d 21h") on the
          two items that have one. **No deadline field exists on the wire** —
          `NotificationDto` carries no due-at of any kind — so this is
          `createdAt`, the only timestamp there is.
        */}
        <p className="font-mono text-mono-xs text-03">{utcStamp(item.createdAt)}</p>
      </div>
      {/*
        No CTA. Every card on the frame ends in one — "Open the case", "Review
        the 14", "Reconcile" — and no field on the DTO names a destination.
        `subjectType`/`subjectId` might route one day, but no producer has ever
        written a value, so there is no mapping to write against. An inert
        button on every row would be worse than none.
      */}
    </article>
  );
}
