"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Ban, Check, ChevronRight, CircleDot, CirclePause, Coins, Link2, LockOpen, Scale, Search, UserCog, X, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import {
  ACTIVITY_KINDS,
  activityIcon,
  activitySentence,
  byActor,
  groupByDay,
  isOfKind,
  targetTypeOf,
  type ActivityIcon,
  type ActivityKind,
} from "@/features/operator/activity";
import { replaceUrlQuery } from "@/features/operator/url-params";
import { blockSubjectLabel } from "@/features/operator/block-targets";
import { operatorLabel } from "@/features/operator/inbox";
import { useOperatorSession } from "@/features/operator/session-context";
import { useScrollFade } from "@/features/operator/scroll-fade";
import { useOperatorDirectory, usePenaltyNames, useProviderNames } from "@/features/operator/use-operator-lookups";
import type { OverrideLogEntry } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { formatClock, utcDay, utcTitle } from "@/libs/utc-time";
import { listAccountBlocks, listOverrideLog } from "@/services/operator.service";
import { cn } from "@/utils";

/**
 * Activity, route `/operator/override-log`: every manual intervention, newest
 * first, as sentences — "Jordan blocked Wallet 0x9f3C…F36c (Leaked key),
 * approved by Dan" — with a link to what it was about.
 *
 * Grouped by UTC day, one line per action: an icon for the kind, the
 * sentence, the ticket, and the time in its own column. A row with a note
 * opens it in place: a click anywhere on the row, or Enter on its chevron. Kind chips, "By me" and one search box.
 * `?targetId=` shows one record's history (the "History" links on penalties,
 * blocks and approvals); `?kind=`, `?mine=1` and `?q=` are kept in the URL so
 * a filtered view can be shared.
 */

const ICONS: Readonly<Record<ActivityIcon, LucideIcon>> = {
  block: Ban,
  unblock: LockOpen,
  chain: Link2,
  suspend: CirclePause,
  ruling: Scale,
  money: Coins,
  team: UserCog,
  other: CircleDot,
};


const LIST_LIMIT = 25;
const CHIP =
  "inline-flex min-h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-label-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 tablet:min-h-8";
const CHIP_ON = "border-primary-500 bg-primary-10 text-01";
const CHIP_OFF = "border-02 bg-01 text-02 hover:text-01";
const KINDS = new Set(ACTIVITY_KINDS.map((kind) => kind.id));

function ActivityScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chipRow = useScrollFade<HTMLDivElement>();
  const kindParam = searchParams.get("kind") as ActivityKind | null;
  const kind: ActivityKind = kindParam && KINDS.has(kindParam) ? kindParam : "all";
  const q = searchParams.get("q") ?? "";
  const targetId = searchParams.get("targetId") ?? "";
  const mine = searchParams.get("mine") === "1";
  const me = useOperatorSession();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState(q);
  React.useEffect(() => setDraft(q), [q]);

  const directory = useOperatorDirectory();
  const providers = useProviderNames();
  const blocks = useQuery({
    queryKey: ["operator", "blocks", "lookup"],
    queryFn: () => listAccountBlocks({ limit: 100 }),
    retry: 0,
  });

  const setParams = (next: { kind?: ActivityKind; q?: string; targetId?: string | null; mine?: boolean }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.kind !== undefined) {
      if (next.kind === "all") params.delete("kind");
      else params.set("kind", next.kind);
    }
    if (next.q !== undefined) {
      if (next.q.trim()) params.set("q", next.q.trim());
      else params.delete("q");
    }
    if (next.targetId === null) params.delete("targetId");
    if (next.mine !== undefined) {
      if (next.mine) params.set("mine", "1");
      else params.delete("mine");
    }
    const query = params.toString();
    replaceUrlQuery("/operator/override-log", query);
  };

  const log = useInfiniteQuery({
    queryKey: ["operator", "override-log", { kind, q, targetId }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listOverrideLog({
        limit: LIST_LIMIT,
        cursor: pageParam,
        targetType: targetTypeOf(kind),
        targetId: targetId || undefined,
        q: q || undefined,
      }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });

  const rows = React.useMemo(() => {
    const all = (log.data?.pages ?? []).flatMap((page) => page.items).filter((row) => isOfKind(row, kind));
    return mine ? byActor(all, me.subject) : all;
  }, [log.data, kind, mine, me.subject]);
  const days = React.useMemo(() => {
    const now = Date.now();
    return groupByDay(rows, (iso) => utcDay(iso, { now }));
  }, [rows]);

  // "Northwind Geo's $28.47 penalty", read from each penalty the page shows.
  const penaltyIds = React.useMemo(() => rows.filter((row) => row.targetType === "slash_proposal").map((row) => row.targetId), [rows]);
  const penalties = usePenaltyNames(penaltyIds);
  const penaltiesKey = [...penalties.entries()].map(([id, name]) => `${id}=${name}`).join("|");

  const blockById = React.useMemo(() => new Map((blocks.data?.items ?? []).map((b) => [b.id, b])), [blocks.data]);
  const names = React.useMemo(
    () => ({
      operator: directory.nameOf,
      target: (entry: Pick<OverrideLogEntry, "targetType" | "targetId">) => {
        if (entry.targetType === "account_block") {
          const block = blockById.get(entry.targetId);
          return block ? blockSubjectLabel(block, providers.lookup) : null;
        }
        if (entry.targetType === "operator") {
          const op = directory.operators.find((o) => o.id === entry.targetId);
          return op ? operatorLabel(op) : null;
        }
        if (entry.targetType === "slash_proposal") return penalties.get(entry.targetId) ?? null;
        return null;
      },
    }),
    // `penalties` is rebuilt every render; its content is `penaltiesKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockById, directory, providers, penaltiesKey],
  );

  return (
    <>
      <header className="flex w-full flex-col gap-0.5">
        <h1 className="text-heading-md text-01">Activity</h1>
        <p className="text-body-13 text-03">Every manual action, who took it and who approved it.</p>
      </header>

      <div className="flex w-full flex-col gap-2.5 tablet:flex-row tablet:items-center tablet:justify-between">
        {/* One row that scrolls sideways on a phone, never three. "All" means no filter at all, so it is lit only
            when neither a kind nor "By me" is on, and pressing it clears both. */}
        <div ref={chipRow} className="scroll-fade-x -mx-4 flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] tablet:mx-0 tablet:px-0 [&::-webkit-scrollbar]:hidden">
          <div role="radiogroup" aria-label="Kind" className="flex flex-nowrap gap-2">
            {ACTIVITY_KINDS.map((option) => {
              const on = option.id === "all" ? kind === "all" && !mine : kind === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setParams(option.id === "all" ? { kind: "all", mine: false } : { kind: option.id })}
                  className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-03" />
          <button type="button" aria-pressed={mine} onClick={() => setParams({ mine: !mine })} className={cn(CHIP, mine ? CHIP_ON : CHIP_OFF)}>
            {mine ? <Check aria-hidden="true" className="size-3.5" /> : null}
            By me
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setParams({ q: draft });
          }}
          className="flex w-full items-center gap-2 rounded-md border border-02 bg-01 px-3 py-2 focus-within:ring-2 focus-within:ring-primary-500 tablet:max-w-[320px]"
          role="search"
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-03" />
          <label className="sr-only" htmlFor="activity-search">
            Search activity
          </label>
          <input
            id="activity-search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Search: who, reason, ticket"
            className="w-full min-w-0 bg-transparent text-body-sm text-01 outline-none placeholder:text-03"
          />
          {q ? (
            <button type="button" aria-label="Clear search" onClick={() => setParams({ q: "" })} className="text-03 hover:text-01">
              <X aria-hidden="true" className="size-4" />
            </button>
          ) : null}
        </form>
      </div>

      {targetId ? (
        <p className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-primary-20 bg-primary-10 px-3.5 py-2 text-body-13 text-01">
          Showing the history of one record.
          <button type="button" onClick={() => setParams({ targetId: null })} className="hit-area text-label-13 text-primary-600 hover:underline">
            Show everything
          </button>
        </p>
      ) : null}

      {log.isLoading ? (
        <PageState kind="loading" rows={5} label="Loading activity" />
      ) : log.isError ? (
        <PageState
          kind="error"
          description="Activity could not be loaded."
          onRetry={() => void log.refetch()}
          code={log.error instanceof ApiError ? log.error.code : null}
        />
      ) : rows.length === 0 ? (
        <PageState
          kind="empty"
          title="Nothing here"
          description={
            kind === "arbiter" && log.hasNextPage
              ? "No arbiter action in the latest entries. Older ones may still match."
              : q || targetId || mine || kind !== "all"
                ? "Nothing matches these filters."
                : "No manual action has been taken yet."
          }
          action={kind === "arbiter" && log.hasNextPage ? { label: "Look further back", onClick: () => void log.fetchNextPage() } : undefined}
        />
      ) : (
        <div className="flex w-full flex-col gap-4">
          {days.map((day) => (
            <section key={day.key} aria-label={day.label} className="flex w-full flex-col gap-1.5">
              <h2 className="text-label-13 text-02">{day.label}</h2>
              <ol className="flex w-full flex-col divide-y divide-01 overflow-hidden rounded-xl border border-01 bg-01">
                {day.rows.map((row) => {
                  const sentence = activitySentence(row, names);
                  const Icon = ICONS[activityIcon(row)];
                  const hasNote = row.reason.trim().length > 0;
                  const open = hasNote && openId === row.id;
                  const toggle = () => setOpenId(open ? null : row.id);
                  return (
                    <li
                      key={row.id}
                      onClick={(event) => {
                        if (!hasNote || (event.target as HTMLElement).closest("a,button")) return;
                        toggle();
                      }}
                      className={cn(
                        "flex w-full flex-col px-4 py-2.5",
                        hasNote && "cursor-pointer hover:bg-02",
                      )}
                    >
                      <div className="flex w-full min-w-0 items-start gap-3">
                        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-03" />
                        <p className="min-w-0 flex-1 text-body-13 text-01 [overflow-wrap:anywhere]">
                          <span className="font-medium">{sentence.actor}</span> {sentence.verb}{" "}
                          {sentence.href ? (
                            <Link href={sentence.href} className="hit-area text-primary-700 hover:underline">
                              {sentence.target}
                            </Link>
                          ) : (
                            sentence.target
                          )}
                          {sentence.reason ? <span className="text-02"> · {sentence.reason}</span> : null}
                          {sentence.approver ? <span className="text-02">, approved by {sentence.approver}</span> : null}
                          {row.breakGlass ? <span className="text-danger-600"> · emergency override</span> : null}
                          {sentence.pending ? <span className="block text-body-xs text-03">Built as a {sentence.pending}.</span> : null}
                        </p>
                        {row.ticketRef ? (
                          <span className="hidden max-w-[10rem] shrink-0 truncate rounded bg-03 px-1.5 py-px font-mono text-mono-12 text-02 min-[480px]:inline" title={row.ticketRef}>{row.ticketRef}</span>
                        ) : null}
                        <time dateTime={row.createdAt} title={utcTitle(row.createdAt)} className="w-[4.5rem] shrink-0 text-right text-body-13 tabular-nums text-03">
                          {formatClock(row.createdAt)} UTC
                        </time>
                        {hasNote ? (
                          <button
                            type="button"
                            aria-label={open ? "Hide the note" : "Show the note"}
                            aria-expanded={open}
                            onClick={toggle}
                            className="-m-3 shrink-0 rounded p-3 text-03 hover:text-01 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                          >
                            <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform", open && "rotate-90")} />
                          </button>
                        ) : (
                          <span aria-hidden="true" className="w-4 shrink-0" />
                        )}
                      </div>
                      {row.ticketRef ? (
                        <span className="ml-7 mt-1 max-w-[calc(100%-1.75rem)] self-start rounded bg-03 px-1.5 py-px font-mono text-mono-12 text-02 [overflow-wrap:anywhere] min-[480px]:hidden">{row.ticketRef}</span>
                      ) : null}
                      {open ? <p className="ml-7 mt-1.5 text-body-13 text-02 [overflow-wrap:anywhere]">{row.reason}</p> : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      {log.hasNextPage ? (
        <Button variant="secondary" className="self-start" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
          Load more
        </Button>
      ) : null}
    </>
  );
}

export default function ActivityPage() {
  return (
    <React.Suspense fallback={null}>
      <ActivityScreen />
    </React.Suspense>
  );
}
