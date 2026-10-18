"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Inbox, List, Mail, MessageSquare, Pencil, Smartphone, Webhook } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle, PanelTitles } from "@/components/ui/panel";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import {
  ALERT_PRESETS,
  BUYER_EVENTS,
  CHANNEL_NAME,
  availableChannels,
  destinationError,
  presetState,
  presetToast,
  type AlertPreset,
  type ExternalChannel,
} from "@/features/buyer/alert-presets";
import { groupAlerts, readableBody } from "@/features/buyer/alert-model";
import { contractNoticeText, isContractNoticeEvent, readContractNotice } from "@/features/toolsets/contract-notices";
import { ContractNoticeFix } from "@/components/toolsets/contract-notice-fix";
import { readUpdateNotice, updateNoticeText } from "@/features/toolsets/sharing";
import { useSearchParam } from "@/hooks/useSearchParam";
import { plainError } from "@/libs/plain-language";
import { ApiError } from "@/libs/ApiClient";
import { getUnreadCount, listNotifications, markAllNotificationsRead } from "@/services/account.service";
import {
  listNotificationChannels,
  listNotificationDeliveries,
  listNotificationPreferences,
  upsertNotificationChannel,
  upsertNotificationPreferences,
  type NotificationChannel,
  type NotificationChannelDto,
  type NotificationDeliveryDto,
  type NotificationEvent,
} from "@/services/notifications.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

import { presentAlert, useAlertLimitContext, useMarkAlertsRead } from "@/components/layout/alert-entry";

import { AGGREGATION_LABEL, NOTIFICATION_CATALOGUE, NOTIFICATION_EVENT_LABEL } from "./notification-catalogue";
import { PageHeader, StatusPill } from "./chrome";

/**
 * Alert settings (`/alerts`): where alerts go and what you are told about.
 *
 * In-app is the only channel that reaches a person today (business #5: the
 * other senders only log), so the others show as "not available yet" until a
 * deployment lists a real sender in `NEXT_PUBLIC_ALERT_CHANNELS`. Three presets
 * replace the 25-row grid; the full list sits behind "Customise". The event
 * catalogue is a frontend mirror (`./notification-catalogue.ts`) of the
 * backend's; events with no producer are left out of the list.
 */

interface Notification {
  id: string;
  event: string;
  payload?: unknown;
  subjectType?: string | null;
  subjectId?: string | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

/**
 * The body as a person reads it: a tool-set update or a contract notice is
 * told from its payload; any other body only when it is written for a person
 * (`readableBody`), so an older notice never shows an id or an enum code.
 */
function alertBody(item: Notification): string | null {
  if (item.event === "toolset.update_available") {
    const notice = readUpdateNotice(item.payload);
    if (notice) return updateNoticeText(notice);
  }
  if (isContractNoticeEvent(item.event)) {
    const notice = readContractNotice(item.payload);
    if (notice) return contractNoticeText(item.event, notice);
  }
  return readableBody(item.body);
}

const SEVERITY_TONE = {
  INFO: "neutral",
  WARNING: "warning",
  CRITICAL: "danger",
} as const;

/** The four channels this screen can configure. `IN_APP` is drawn separately, below. */
const EDITABLE_CHANNELS: {
  channel: Exclude<NotificationChannel, "IN_APP">;
  name: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  placeholder: string;
}[] = [
  { channel: "EMAIL", name: "Email", icon: Mail, placeholder: "name@example.com" },
  { channel: "PUSH", name: "Push", icon: Smartphone, placeholder: "device / registration token" },
  { channel: "SLACK", name: "Slack", icon: MessageSquare, placeholder: "incoming webhook URL" },
  { channel: "WEBHOOK", name: "Webhook", icon: Webhook, placeholder: "https://example.com/assay-alerts" },
];

/**
 * Four outcomes, four tones, and none of them shared.
 *
 * `SUPPRESSED` is the one that matters. It is not a failure — a channel was
 * deliberately skipped by the event's aggregation rule or by a preference — so
 * it must not carry `danger`. It is also not a success: nothing was sent, and
 * painting it green (or the near-green `teal` this first shipped as) puts it
 * one glance away from `DELIVERED` and quietly tells the reader the message
 * went out. `neutral` grey is the honest third thing: the platform did nothing,
 * on purpose.
 */
const DELIVERY_STATUS_TONE = {
  /** In flight. Distinct from SUPPRESSED, which will never be attempted at all. */
  PENDING: "warning",
  DELIVERED: "success",
  FAILED: "danger",
  SUPPRESSED: "neutral",
} as const;

const DELIVERY_WORD = { PENDING: "Queued", DELIVERED: "Sent", FAILED: "Failed", SUPPRESSED: "Skipped" } as const;

function DeliveryRow({ delivery }: { delivery: NotificationDeliveryDto }) {
  const tone = DELIVERY_STATUS_TONE[delivery.status as keyof typeof DELIVERY_STATUS_TONE] ?? "neutral";
  return (
    <div className="flex w-full flex-col gap-1 rounded-md border border-01 bg-01 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label-13 text-01">{CHANNEL_NAME[delivery.channel] ?? delivery.channel}</span>
        <StatusPill label={DELIVERY_WORD[delivery.status] ?? delivery.status} tone={tone} />
      </div>
      {delivery.status === "SUPPRESSED" ? (
        <p className="text-body-xs text-03">Skipped on purpose: one was already sent, or you turned this off.</p>
      ) : delivery.status === "FAILED" ? (
        <p className="text-body-xs text-danger-600">{delivery.lastError ?? "It could not be delivered."}</p>
      ) : delivery.status === "PENDING" ? (
        <p className="text-body-xs text-03">Waiting to be sent.</p>
      ) : null}
    </div>
  );
}

const URGENCY: Record<string, string> = { CRITICAL: "Urgent", WARNING: "Warning", INFO: "Info" };

export function AlertsView() {
  const queryClient = useQueryClient();
  const available = React.useMemo(() => availableChannels(), []);
  const [logOpen, setLogOpen] = React.useState(false);
  // `/alerts?view=recent` (the bell's "See all alerts") opens the list at once.
  const view = useSearchParam("view");
  const [seenView, setSeenView] = React.useState("");
  if (view !== seenView) {
    setSeenView(view);
    if (view === "recent") setLogOpen(true);
  }
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [configuringChannel, setConfiguringChannel] = React.useState<ExternalChannel | null>(null);
  const [draftDestination, setDraftDestination] = React.useState("");
  const [touched, setTouched] = React.useState(false);

  const feed = useQuery({
    queryKey: ["notifications", "delivery-log"],
    enabled: logOpen,
    retry: false,
    queryFn: () => listNotifications({ limit: 25 }) as Promise<{ items: Notification[] }>,
  });
  const limits = useAlertLimitContext(logOpen);
  const alertGroups = React.useMemo(() => groupAlerts(feed.data?.items ?? []), [feed.data]);

  // Opening the list is reading it: what it shows is marked read, once.
  const markRead = useMarkAlertsRead();
  const marked = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (!logOpen) return;
    const ids = alertGroups.filter((g) => g.unread).flatMap((g) => g.ids).filter((id) => !marked.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) marked.current.add(id);
    markRead.mutate(ids);
  }, [logOpen, alertGroups, markRead]);
  const unreadQuery = useQuery({
    queryKey: ["notifications", "unread-count"],
    enabled: logOpen,
    queryFn: getUnreadCount,
  });
  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => toast.success("Every alert is marked read."),
    onError: (error) => toast.error(error instanceof ApiError ? plainError(error.code) : "Alerts could not be marked read"),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const deliveriesQuery = useQuery({
    queryKey: ["notification-deliveries", expandedId],
    enabled: Boolean(expandedId),
    retry: false,
    queryFn: () => listNotificationDeliveries(expandedId as string),
  });

  const channelsQuery = useQuery({
    queryKey: ["notification-channels"],
    enabled: available.length > 0,
    retry: false,
    queryFn: listNotificationChannels,
  });

  const preferencesQuery = useQuery({
    queryKey: ["notification-preferences"],
    enabled: available.length > 0,
    retry: false,
    queryFn: listNotificationPreferences,
  });

  const channelByType = React.useMemo(() => {
    const map = new Map<NotificationChannel, NotificationChannelDto>();
    for (const row of channelsQuery.data ?? []) map.set(row.channel, row);
    return map;
  }, [channelsQuery.data]);

  const preferenceOverride = React.useMemo(() => {
    const map = new Map<string, boolean>();
    for (const row of preferencesQuery.data ?? []) map.set(`${row.event}|${row.channel}`, row.enabled);
    return map;
  }, [preferencesQuery.data]);

  const isEnabled = React.useCallback(
    (event: NotificationEvent, channel: NotificationChannel) => preferenceOverride.get(`${event}|${channel}`) ?? true,
    [preferenceOverride],
  );

  const channelMutation = useMutation({
    mutationFn: (vars: { channel: ExternalChannel; destination?: string | null; enabled: boolean }) =>
      upsertNotificationChannel(vars.channel, { destination: vars.destination, enabled: vars.enabled }),
    onSuccess: (dto, vars) => {
      queryClient.setQueryData<NotificationChannelDto[]>(["notification-channels"], (prev) => {
        const rest = (prev ?? []).filter((row) => row.channel !== dto.channel);
        return [...rest, dto];
      });
      const name = CHANNEL_NAME[vars.channel];
      toast.success(
        vars.destination
          ? `${name} alerts will go to ${vars.destination}`
          : `${name} alerts turned ${vars.enabled ? "on" : "off"}`,
      );
      setConfiguringChannel(null);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? plainError(error.code) : "The channel could not be saved");
    },
  });

  const preferenceMutation = useMutation({
    mutationFn: (vars: { items: { event: NotificationEvent; channel: NotificationChannel; enabled: boolean }[]; message: string }) =>
      upsertNotificationPreferences(vars.items),
    onSuccess: (rows, vars) => {
      queryClient.setQueryData(["notification-preferences"], rows);
      toast.success(vars.message);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? plainError(error.code) : "The change could not be saved");
    },
  });

  function openConfigure(channel: ExternalChannel) {
    setConfiguringChannel(channel);
    setTouched(false);
    setDraftDestination(channelByType.get(channel)?.destination ?? "");
  }

  const draftError = configuringChannel ? destinationError(configuringChannel, draftDestination) : null;

  function saveDestination() {
    if (!configuringChannel) return;
    setTouched(true);
    if (draftError) return;
    channelMutation.mutate({
      channel: configuringChannel,
      destination: draftDestination.trim(),
      enabled: channelByType.get(configuringChannel)?.enabled ?? true,
    });
  }

  function togglePreset(preset: AlertPreset, channel: ExternalChannel, next: boolean) {
    preferenceMutation.mutate({
      items: preset.events.map((event) => ({ event, channel, enabled: next })),
      message: presetToast(preset, channel, next),
    });
  }

  const configured = available.filter((c) => Boolean(channelByType.get(c)?.destination));

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Alert settings"
        actions={
          <Button variant="secondary" icon={<List />} type="button" onClick={() => setLogOpen(true)}>
            Recent alerts
          </Button>
        }
      />
      <p className="-mt-2 text-body-13 text-03">What Assay tells you about, and where. Alerts never block a call.</p>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Where alerts go</PanelTitle>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-2.5 p-4 tablet:p-5">
          <div className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-01 bg-02 p-3.5">
            <Inbox aria-hidden="true" className="size-4 shrink-0 text-02" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-label-sm text-01">In-app</span>
              <span className="text-body-xs text-03">The bell at the top of every page</span>
            </div>
            <span className="text-body-xs text-02">On</span>
          </div>
          {EDITABLE_CHANNELS.filter(({ channel }) => available.includes(channel)).map(({ channel, name, icon: Icon }) => {
            const row = channelByType.get(channel);
            const pending = channelMutation.isPending && channelMutation.variables?.channel === channel;
            return (
              <div key={channel} className="flex w-full flex-col gap-2.5 rounded-lg border border-01 bg-02 p-3.5 tablet:flex-row tablet:items-center tablet:gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-02" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-label-sm text-01">{name}</span>
                    <span className="truncate text-body-xs text-03">{row?.destination ?? "Not set up"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 tablet:shrink-0">
                  {row?.destination ? (
                    <Switch
                      aria-label={`${name} alerts on`}
                      checked={row.enabled}
                      disabled={pending}
                      onChange={(e) => channelMutation.mutate({ channel, enabled: e.currentTarget.checked })}
                    />
                  ) : null}
                  <Button variant="secondary" size="sm" icon={<Pencil />} type="button" onClick={() => openConfigure(channel)}>
                    {row?.destination ? "Change" : "Set up"}
                  </Button>
                </div>
              </div>
            );
          })}
          {!available.includes("EMAIL") ? (
            <p className="text-body-xs text-03" data-testid="email-not-available">
              Email alerts are not available yet. For now alerts reach you only in the app: the bell on every page and
              Needs attention on Overview.
            </p>
          ) : available.length < EDITABLE_CHANNELS.length ? (
            <p className="text-body-xs text-03">More channels are coming.</p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>What you are told about</PanelTitle>
          </PanelTitles>
        </PanelHeader>
        <PanelBody>
          {/* A preset nothing can raise yet is left out rather than shown as "coming soon". */}
          {ALERT_PRESETS.filter((preset) => preset.events.some((e) => NOTIFICATION_CATALOGUE[e].hasProducer)).map((preset) => (
              <div key={preset.id} className="flex w-full flex-col gap-2.5 border-b border-01 px-4 py-4 last:border-b-0 tablet:flex-row tablet:items-center tablet:gap-4 tablet:px-5">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-label-sm text-01">
                    {preset.title}
                    {preset.alwaysOn ? <span className="text-body-xs font-normal text-03">always on</span> : null}
                  </span>
                  <span className="text-body-13 text-02">{preset.description}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 tablet:shrink-0">
                  <span className="inline-flex items-center gap-1 rounded-full bg-success-10 px-2 py-0.5 text-label-xs text-success-700">
                    <Inbox aria-hidden="true" className="size-3" />
                    In-app
                  </span>
                  {configured.map((channel) => {
                        const state = presetState(preset, channel, isEnabled);
                        const on = state !== "off";
                        return preset.alwaysOn ? (
                          <span key={channel} className="inline-flex items-center rounded-full bg-success-10 px-2 py-0.5 text-label-xs text-success-700">
                            {CHANNEL_NAME[channel]}
                          </span>
                        ) : (
                          <button
                            key={channel}
                            type="button"
                            role="switch"
                            aria-checked={on}
                            disabled={preferenceMutation.isPending}
                            onClick={() => togglePreset(preset, channel, !on)}
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-label-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
                              on ? "bg-success-10 text-success-700" : "bg-03 text-03 line-through",
                            )}
                          >
                            {CHANNEL_NAME[channel]}
                            {state === "mixed" ? " · some" : ""}
                          </button>
                        );
                      })}
                </div>
              </div>
          ))}
          <details className="group border-t border-01">
            <summary className="cursor-pointer select-none px-4 py-3 text-label-13 text-02 hover:text-01 tablet:px-5">
              Customise: every alert, how urgent and how often
            </summary>
            <ul className="flex flex-col px-4 pb-3 tablet:px-5">
              {BUYER_EVENTS.filter((event) => NOTIFICATION_CATALOGUE[event].hasProducer).map((event) => {
                const def = NOTIFICATION_CATALOGUE[event];
                return (
                  <li key={event} className="flex flex-col gap-1 border-t border-01 py-2.5 first:border-t-0 tablet:flex-row tablet:items-center tablet:gap-3">
                    <span className="min-w-0 flex-1 text-body-13 text-01">{NOTIFICATION_EVENT_LABEL[event]}</span>
                    <span className="text-body-xs text-03 tablet:w-[90px]">{URGENCY[def.severity] ?? def.severity}</span>
                    <span className="text-body-xs text-03 tablet:w-[200px]">{AGGREGATION_LABEL[def.aggregation]}</span>
                    <span className="flex flex-wrap gap-1 tablet:w-[220px] tablet:justify-end">
                      <span className="rounded-full bg-success-10 px-2 py-0.5 text-label-xs text-success-700">In-app</span>
                      {configured.map((channel) => {
                        const on = isEnabled(event, channel);
                        return def.nonSuppressible ? (
                          <span key={channel} title="Always sent: it warns you if someone else moves your money" className="rounded-full bg-success-10 px-2 py-0.5 text-label-xs text-success-700">
                            {CHANNEL_NAME[channel]}
                          </span>
                        ) : (
                          <button
                            key={channel}
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label={`${NOTIFICATION_EVENT_LABEL[event]} by ${CHANNEL_NAME[channel]}`}
                            disabled={preferenceMutation.isPending}
                            onClick={() =>
                              preferenceMutation.mutate({
                                items: [{ event, channel, enabled: !on }],
                                message: `${NOTIFICATION_EVENT_LABEL[event]} by ${CHANNEL_NAME[channel]} turned ${on ? "off" : "on"}`,
                              })
                            }
                            className={cn(
                              "rounded-full px-2 py-0.5 text-label-xs transition-colors",
                              on ? "bg-success-10 text-success-700" : "bg-03 text-03 line-through",
                            )}
                          >
                            {CHANNEL_NAME[channel]}
                          </button>
                        );
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </details>
        </PanelBody>
      </Panel>

      <Dialog open={Boolean(configuringChannel)} onOpenChange={(open) => !open && setConfiguringChannel(null)}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{configuringChannel ? `${CHANNEL_NAME[configuringChannel]} alerts` : "Alerts"}</DialogTitle>
            <DialogDescription>Where should we send them?</DialogDescription>
          </DialogHeader>
          <Field
            label="Send to"
            placeholder={EDITABLE_CHANNELS.find((c) => c.channel === configuringChannel)?.placeholder}
            value={draftDestination}
            onChange={(e) => setDraftDestination(e.currentTarget.value)}
            onBlur={() => setTouched(true)}
            error={touched && draftError ? draftError : undefined}
            hint="To stop these alerts, turn the channel off with its switch."
          />
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={() => setConfiguringChannel(null)}>
              Cancel
            </Button>
            <Button variant="primary" type="button" loading={channelMutation.isPending} onClick={saveDestination}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={logOpen} onOpenChange={setLogOpen}>
        <SheetContent className="tablet:max-w-[640px]">
          <SheetHeader>
            <SheetTitle>Recent alerts</SheetTitle>
            <SheetDescription>Newest first. Opening this list marks them read. Open one to see where it was delivered.</SheetDescription>
          </SheetHeader>
          {(unreadQuery.data?.count ?? 0) > 0 ? (
            <div className="px-[18px] pt-3">
              <Button variant="secondary" size="sm" type="button" loading={markAll.isPending} onClick={() => markAll.mutate()}>
                Mark all {unreadQuery.data!.count} unread as read
              </Button>
            </div>
          ) : null}
          <div className="flex w-full flex-col gap-3 px-[18px] pb-6 pt-4">
            {feed.isPending ? (
              <PageState kind="loading" rows={4} label="Loading recent alerts" />
            ) : feed.isError ? (
              <PageState kind="error" bare description="Recent alerts could not be loaded." onRetry={() => void feed.refetch()} />
            ) : alertGroups.length === 0 ? (
              <p className="text-body-13 text-02">No alerts yet.</p>
            ) : (
              alertGroups.map(({ note: item }) => {
                const expanded = expandedId === item.id;
                const { title, action } = presentAlert(item, limits);
                const body = alertBody(item);
                return (
                  <div key={item.id} className="flex w-full flex-col gap-1.5 rounded-lg border border-01 bg-02 p-3.5">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      className="flex w-full flex-wrap items-center gap-2 text-left"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                    >
                      <StatusPill label={URGENCY[item.severity] ?? item.severity} tone={SEVERITY_TONE[item.severity] ?? "neutral"} />
                      <span className="min-w-0 flex-1 truncate text-label-sm text-01">{title}</span>
                      <span className="text-body-xs text-03">
                        <UtcTime value={item.createdAt} />
                      </span>
                      {expanded ? (
                        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-03" />
                      ) : (
                        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-03" />
                      )}
                    </button>
                    {body ? <p className="text-body-13 text-02">{body}</p> : null}
                    {action ? (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                        <Link href={action.href} className="min-h-10 self-start content-center text-label-13 font-semibold text-primary-600 hover:underline">
                          {action.label}
                        </Link>
                        {isContractNoticeEvent(item.event) ? <ContractNoticeFix payload={item.payload} /> : null}
                      </div>
                    ) : null}
                    {expanded ? (
                      <div className="flex flex-col gap-1.5 border-t border-01 pt-2">
                        {deliveriesQuery.isPending ? (
                          <PageState kind="loading" rows={1} label="Loading deliveries" />
                        ) : deliveriesQuery.isError ? (
                          <p className="text-body-xs text-danger-600">Where this went could not be loaded.</p>
                        ) : (deliveriesQuery.data?.length ?? 0) === 0 ? (
                          <p className="text-body-xs text-03">Shown in-app only.</p>
                        ) : (
                          deliveriesQuery.data?.map((delivery) => <DeliveryRow key={delivery.id} delivery={delivery} />)
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
