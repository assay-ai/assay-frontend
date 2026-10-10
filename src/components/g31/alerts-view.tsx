"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Inbox,
  List,
  Lock,
  Mail,
  MessageSquare,
  Pencil,
  Send,
  Smartphone,
  Webhook,
} from "lucide-react";
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
import { ApiError } from "@/libs/ApiClient";
import { listNotifications } from "@/services/account.service";
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

import { AGGREGATION_LABEL, NOTIFICATION_CATALOGUE, NOTIFICATION_EVENT_ORDER } from "./notification-catalogue";
import { MicroLabel, PageHeader, StatusPill } from "./chrome";
import { timestamp } from "./format";

/**
 * Alerts and notifications.
 *
 * Foundations rule 04 puts this screen squarely in the "tell" region: an
 * alert blocks nothing. That is why nothing here can refuse a call, and why
 * the design's own subtitle insists the aggregation rule is part of the event
 * definition rather than a user setting.
 *
 * This screen has real endpoints for channels and preferences. What
 * is real and what is still not, honestly:
 *
 *  - **Channels are real** (`GET`/`PUT /notification-channels`). A row is
 *    read, toggled and edited against the wire. `IN_APP` is drawn as an
 *    always-on row and never sent a write — the controller short-circuits it
 *    before the service layer, per its own comment.
 *  - **No channel reaches a person off-platform.** EMAIL, PUSH, SLACK and
 *    WEBHOOK all run through `LoggingChannelSender` right now — it logs what
 *    it would send and reports "delivered". Saving a destination here does
 *    not put it on any mail, push, Slack or webhook vendor's send list; it
 *    only tells the platform's own pipeline where it WOULD go once a real
 *    sender exists. That comment lives in the backend file itself, not just
 *    here.
 *  - **The Events table is the product's event catalogue, read from a
 *    frontend MIRROR** (`./notification-catalogue.ts`), because no endpoint
 *    serves the catalogue — `GET /notification-preferences` returns only the
 *    rows an organization has overridden, never the defaults they are
 *    relative to. The mirror is transcribed by hand from the backend's
 *    `NOTIFICATION_CATALOGUE` and can drift from it; nothing enforces they
 *    stay in sync. Some rows are marked "no producer yet" for the same reason
 *    — the backend's own enum comments say so, and pretending otherwise would
 *    promise an alert that cannot currently fire.
 *  - A `nonSuppressible` event's channels are locked in this UI, not merely
 *    refused server-side after the fact — the whole point of the account-
 *    takeover/consent list is that a person cannot click their way into
 *    silencing it and find out from a 400 afterwards. The server-side refusal
 *    (`NOTIFICATION_NONSUPPRESSIBLE_EVENT`) is still handled defensively below,
 *    because a mirror can drift out from under the lock.
 *
 * `listNotifications()` (`GET /notifications`) backs the "Delivery log"
 * sheet, and each row can now expand into its real per-channel outcomes via
 * `GET /notifications/:id/deliveries`.
 */

interface Notification {
  id: string;
  event: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
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
  { channel: "WEBHOOK", name: "Webhook", icon: Webhook, placeholder: "https://your-endpoint…" },
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

function DeliveryRow({ delivery }: { delivery: NotificationDeliveryDto }) {
  const tone = DELIVERY_STATUS_TONE[delivery.status as keyof typeof DELIVERY_STATUS_TONE] ?? "neutral";
  return (
    <div className="flex w-full flex-col gap-1 rounded-md border border-01 bg-01 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-mono-12 font-semibold text-01">{delivery.channel}</span>
        <StatusPill label={delivery.status} tone={tone} />
        <span className="ml-auto font-mono text-mono-2xs text-03">{delivery.attempts} attempt(s)</span>
      </div>
      {delivery.status === "DELIVERED" ? (
        <p className="text-body-xs text-03">
          Reached the platform&apos;s own pipeline {timestamp(delivery.deliveredAt)} — not a confirmation a
          person read it, only that this channel&apos;s attempt finished.
        </p>
      ) : delivery.status === "SUPPRESSED" ? (
        <p className="text-body-xs text-03">
          Skipped on purpose — either this event&apos;s aggregation rule already sent one, or a preference
          turned this channel off. Not an error.
        </p>
      ) : delivery.status === "FAILED" ? (
        <p className="text-body-xs text-danger-600">{delivery.lastError ?? "Failed with no recorded reason."}</p>
      ) : (
        <p className="text-body-xs text-03">Queued, not yet attempted.</p>
      )}
    </div>
  );
}

export function AlertsView() {
  const queryClient = useQueryClient();
  const [logOpen, setLogOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [configuringChannel, setConfiguringChannel] = React.useState<Exclude<
    NotificationChannel,
    "IN_APP"
  > | null>(null);
  const [draftDestination, setDraftDestination] = React.useState("");

  const feed = useQuery({
    queryKey: ["notifications", "delivery-log"],
    enabled: logOpen,
    retry: false,
    queryFn: () => listNotifications({ limit: 25 }) as Promise<{ items: Notification[] }>,
  });

  const deliveriesQuery = useQuery({
    queryKey: ["notification-deliveries", expandedId],
    enabled: Boolean(expandedId),
    retry: false,
    queryFn: () => listNotificationDeliveries(expandedId as string),
  });

  const channelsQuery = useQuery({
    queryKey: ["notification-channels"],
    retry: false,
    queryFn: listNotificationChannels,
  });

  const preferencesQuery = useQuery({
    queryKey: ["notification-preferences"],
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

  /** Catalogue default XOR any override row. Absence of a row means the catalogue default (true, since the channel is in that event's default list). */
  function isEventChannelEnabled(event: NotificationEvent, channel: NotificationChannel): boolean {
    return preferenceOverride.get(`${event}|${channel}`) ?? true;
  }

  const channelMutation = useMutation({
    mutationFn: (vars: { channel: Exclude<NotificationChannel, "IN_APP">; destination?: string | null; enabled: boolean }) =>
      upsertNotificationChannel(vars.channel, { destination: vars.destination, enabled: vars.enabled }),
    onSuccess: (dto) => {
      queryClient.setQueryData<NotificationChannelDto[]>(["notification-channels"], (prev) => {
        const rest = (prev ?? []).filter((row) => row.channel !== dto.channel);
        return [...rest, dto];
      });
      toast.success(`${dto.channel} saved`);
      setConfiguringChannel(null);
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "The channel could not be saved");
    },
  });

  const preferenceMutation = useMutation({
    mutationFn: (item: { event: NotificationEvent; channel: NotificationChannel; enabled: boolean }) =>
      upsertNotificationPreferences([item]),
    onSuccess: (rows) => {
      queryClient.setQueryData(["notification-preferences"], rows);
    },
    onError: (error) => {
      // Defensive: the lock in this UI should make NOTIFICATION_NONSUPPRESSIBLE_EVENT
      // unreachable, but the mirror can drift out from under it — surface the
      // server's own message rather than swallowing it.
      toast.error(error instanceof ApiError ? error.message : "The preference could not be saved");
    },
  });

  function openConfigure(channel: Exclude<NotificationChannel, "IN_APP">) {
    setConfiguringChannel(channel);
    setDraftDestination(channelByType.get(channel)?.destination ?? "");
  }

  function saveDestination() {
    if (!configuringChannel) return;
    const existing = channelByType.get(configuringChannel);
    const trimmed = draftDestination.trim();
    // The API refuses a blank destination (400): a channel is turned off with its toggle.
    if (trimmed === "") return;
    channelMutation.mutate({
      channel: configuringChannel,
      destination: trimmed,
      enabled: existing?.enabled ?? true,
    });
  }

  function toggleChannelEnabled(channel: Exclude<NotificationChannel, "IN_APP">, next: boolean) {
    channelMutation.mutate({ channel, enabled: next });
  }

  function toggleEventChannel(event: NotificationEvent, channel: NotificationChannel, nonSuppressible: boolean) {
    if (nonSuppressible) return;
    preferenceMutation.mutate({ event, channel, enabled: !isEventChannelEnabled(event, channel) });
  }

  const configuringMeta = EDITABLE_CHANNELS.find((entry) => entry.channel === configuringChannel);

  return (
    <div className="flex w-full flex-col gap-4 px-4 py-5 tablet:gap-[18px] tablet:px-7 tablet:py-[22px]">
      <PageHeader
        title="Alerts and notifications"
        subtitle="the aggregation rule is part of the event definition, not a user setting"
        actions={
          <>
            <Button variant="secondary" icon={<List />} type="button" onClick={() => setLogOpen(true)}>
              Delivery log
            </Button>
            <Button variant="secondary" icon={<Send />} type="button" disabled>
              Send a test
            </Button>
          </>
        }
      />

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Channels</PanelTitle>
            <PanelDescription className="whitespace-normal">
              every non-suppressible event is a consent or account-takeover path
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-3 p-5">
          <div className="flex w-full items-start gap-2.5 rounded-lg border border-warning-20 bg-warning-10 p-3.5">
            <p className="text-body-13 text-warning-700">
              No channel below reaches a person yet. EMAIL, PUSH, SLACK and WEBHOOK all run through a
              placeholder sender that logs what it would deliver and reports success — nothing here has a
              real mail, push, Slack or webhook vendor behind it. Saving an address does not put it on any
              send list.
            </p>
          </div>

          {channelsQuery.isError ? (
            <p className="text-body-13 text-danger-600">Channels could not be read.</p>
          ) : (
            EDITABLE_CHANNELS.map(({ channel, name, icon: Icon, placeholder }) => {
              const row = channelByType.get(channel);
              const configured = Boolean(row);
              const pending = channelMutation.isPending && channelMutation.variables?.channel === channel;
              return (
                <div
                  key={channel}
                  className="flex w-full flex-col gap-2.5 rounded-lg border border-01 bg-02 p-3.5 tablet:flex-row tablet:items-center tablet:gap-3"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Icon aria-hidden="true" className="size-4 shrink-0 text-02" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-label-sm text-01">{name}</span>
                      <span className="truncate font-mono text-mono-xs text-03">
                        {row?.destination ?? "not configured"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 tablet:shrink-0">
                    {configured ? (
                      <StatusPill
                        label={row?.verifiedAt ? "VERIFIED" : "UNVERIFIED"}
                        tone={row?.verifiedAt ? "success" : "warning"}
                      />
                    ) : (
                      <StatusPill label="NOT CONFIGURED" tone="neutral" />
                    )}
                    {configured ? (
                      <Switch
                        aria-label={`${name} enabled`}
                        checked={row?.enabled ?? false}
                        disabled={pending}
                        onChange={(e) => toggleChannelEnabled(channel, e.currentTarget.checked)}
                      />
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Pencil />}
                      type="button"
                      loading={pending && configuringChannel !== channel}
                      onClick={() => openConfigure(channel)}
                    >
                      {configured ? "Edit" : "Configure"}
                    </Button>
                  </div>
                </div>
              );
            })
          )}

          <div className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-01 bg-02 p-3.5">
            <Inbox aria-hidden="true" className="size-4 shrink-0 text-02" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-label-sm text-01">In-app</span>
              <span className="truncate font-mono text-mono-xs text-03">the dashboard inbox itself</span>
            </div>
            <StatusPill label="ALWAYS ON" tone="success" />
          </div>
          <p className="text-body-xs text-03">
            In-app needs no destination and cannot be disabled — the API refuses a write to it before it
            reaches storage, so this row is not a rendering choice.
          </p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Events</PanelTitle>
            <PanelDescription className="whitespace-normal">
              urgency and aggregation are fixed by the event; only the channel is yours to choose
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          {preferencesQuery.isError ? (
            <p className="px-3 py-2 text-body-13 text-danger-600">
              Preferences could not be read — the toggles below show only the catalogue default.
            </p>
          ) : null}
          <div className="w-full overflow-x-auto">
            <div className="min-w-[900px]">
              <div className="flex items-center gap-3 border-b border-02 px-3 pb-2.5">
                <div className="min-w-0 flex-1">
                  <MicroLabel>Event</MicroLabel>
                </div>
                <div className="w-[100px] text-right">
                  {/*
                    "Urgency", the design's word and the one this panel's own
                    subtitle already uses — the column header said "Severity"
                    and disagreed with the sentence directly above it. The
                    VALUES stay the backend's `NotificationSeverity` members;
                    the design's High/Medium/Low vocabulary exists nowhere in
                    the enum and inventing a mapping would put a word on screen
                    that no row can be filtered by.
                  */}
                  <MicroLabel>Urgency</MicroLabel>
                </div>
                <div className="w-[220px] text-right">
                  <MicroLabel>Aggregation</MicroLabel>
                </div>
                <div className="w-[280px] text-right">
                  <MicroLabel>Channels</MicroLabel>
                </div>
              </div>
              {NOTIFICATION_EVENT_ORDER.map((event) => {
                const def = NOTIFICATION_CATALOGUE[event];
                return (
                  <div
                    key={event}
                    className="flex items-center gap-3 border-b border-01 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-[7px]">
                      <span className="font-mono text-mono-12 font-semibold text-01">{event}</span>
                      {def.nonSuppressible ? <StatusPill label="NOT SUPPRESSIBLE" tone="danger" /> : null}
                      {!def.hasProducer ? <StatusPill label="NO PRODUCER YET" dot={false} tone="neutral" /> : null}
                    </div>
                    <div className="w-[100px] text-right">
                      <span
                        className={
                          def.severity === "CRITICAL"
                            ? "font-mono text-mono-12 text-danger-600"
                            : def.severity === "WARNING"
                              ? "font-mono text-mono-12 text-warning-600"
                              : "font-mono text-mono-12 text-02"
                        }
                      >
                        {def.severity}
                      </span>
                    </div>
                    <div className="w-[220px] text-right">
                      <span className="font-mono text-mono-12 text-02">{AGGREGATION_LABEL[def.aggregation]}</span>
                    </div>
                    <div className="flex w-[280px] flex-wrap items-center justify-end gap-1">
                      {def.channels.map((channel) => {
                        if (channel === "IN_APP") {
                          return (
                            <StatusPill key="IN_APP" label="IN-APP" tone="neutral" dot={false} />
                          );
                        }
                        const enabled = isEventChannelEnabled(event, channel);
                        const locked = def.nonSuppressible;
                        const cellPending =
                          preferenceMutation.isPending &&
                          preferenceMutation.variables?.event === event &&
                          preferenceMutation.variables?.channel === channel;
                        return (
                          <button
                            key={channel}
                            type="button"
                            disabled={locked || cellPending}
                            onClick={() => toggleEventChannel(event, channel, locked)}
                            title={
                              locked
                                ? "Cannot be disabled — on the account-takeover/consent list"
                                : `Toggle ${channel} for this event`
                            }
                            className={cn(
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-mono-xs font-semibold transition-colors",
                              enabled ? "bg-success-10 text-success-700" : "bg-03 text-03",
                              locked ? "cursor-not-allowed opacity-80" : "cursor-pointer hover:bg-02"
                            )}
                          >
                            {locked ? <Lock aria-hidden="true" className="size-2.5" /> : null}
                            {channel}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/*
            The padlock's reason has to be on the page, not only in the chip's
            `title`. A tooltip answers "why is this locked" for a mouse user who
            already suspected something was wrong; the person this matters to is
            the one about to conclude we simply forgot to make the control work.
          */}
          <div className="flex w-full flex-col gap-1.5 border-t border-01 px-3 pb-1 pt-3">
            <p className="flex items-start gap-1.5 text-body-xs text-03">
              <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              <span>
                A locked channel cannot be switched off — not here and not through the API, which
                refuses the whole save. These are the withdrawal and credential-expiry events: the
                only warning you would get that somebody else is moving your money or holding your
                credential. Muting them is how that becomes silent, so the account keeps the choice
                away from you on purpose.
              </span>
            </p>
            <p className="text-body-xs text-03">
              <span className="font-mono text-mono-2xs text-03">NO PRODUCER YET</span> means nothing
              in the platform emits that event today, whatever this row is set to. It is listed
              because its urgency and aggregation are already decided and waiting for the code that
              will raise it.
            </p>
          </div>
        </PanelBody>
      </Panel>

      <Dialog open={Boolean(configuringChannel)} onOpenChange={(open) => !open && setConfiguringChannel(null)}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{configuringMeta ? `Configure ${configuringMeta.name}` : "Configure channel"}</DialogTitle>
            <DialogDescription>
              This only tells the platform&apos;s own pipeline where it would send — no vendor is wired up
              behind {configuringMeta?.name ?? "this channel"} yet, so nothing here reaches you off-platform.
            </DialogDescription>
          </DialogHeader>
          <Field
            label="Destination"
            placeholder={configuringMeta?.placeholder}
            value={draftDestination}
            onChange={(e) => setDraftDestination(e.currentTarget.value)}
            hint="A destination is required. To stop receiving this channel, turn it off with its toggle instead."
          />
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={() => setConfiguringChannel(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="button"
              loading={channelMutation.isPending}
              disabled={draftDestination.trim() === ""}
              onClick={saveDestination}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={logOpen} onOpenChange={setLogOpen}>
        <SheetContent className="tablet:max-w-[640px]">
          <SheetHeader>
            <SheetTitle>Delivery log</SheetTitle>
            <SheetDescription>
              What actually went out, newest first. An alert blocks nothing — every call in this log
              still ran or still failed on its own terms.
            </SheetDescription>
          </SheetHeader>
          <div className="flex w-full flex-col gap-3 px-[18px] pb-6 pt-4">
            {feed.isPending ? (
              <p className="font-mono text-mono-13 text-03">Loading…</p>
            ) : feed.isError ? (
              <p className="text-body-13 text-danger-600">
                The delivery log could not be read.
              </p>
            ) : (feed.data?.items.length ?? 0) === 0 ? (
              <p className="text-body-13 text-02">
                Nothing has been delivered yet. A quiet log is an account nothing has gone wrong on,
                not a broken feed.
              </p>
            ) : (
              feed.data?.items.map((item) => {
                const expanded = expandedId === item.id;
                return (
                  <div key={item.id} className="flex w-full flex-col gap-1.5 rounded-lg border border-01 bg-02 p-3.5">
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center gap-2 text-left"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                    >
                      <StatusPill label={item.severity} tone={SEVERITY_TONE[item.severity] ?? "neutral"} />
                      <span className="min-w-0 flex-1 truncate font-mono text-mono-12 text-03">{item.event}</span>
                      <span className="font-mono text-mono-12 text-03">{timestamp(item.createdAt)}</span>
                      {expanded ? (
                        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-03" />
                      ) : (
                        <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-03" />
                      )}
                    </button>
                    <p className="text-label-sm text-01">{item.title}</p>
                    <p className="text-body-13 text-02">{item.body}</p>
                    {expanded ? (
                      <div className="flex flex-col gap-1.5 border-t border-01 pt-2">
                        {deliveriesQuery.isPending ? (
                          <p className="font-mono text-mono-13 text-03">Loading deliveries…</p>
                        ) : deliveriesQuery.isError ? (
                          <p className="text-body-xs text-danger-600">
                            {deliveriesQuery.error instanceof ApiError
                              ? deliveriesQuery.error.message
                              : "Deliveries could not be read."}
                          </p>
                        ) : (deliveriesQuery.data?.length ?? 0) === 0 ? (
                          <p className="text-body-xs text-03">No delivery attempt is on record for this one.</p>
                        ) : (
                          deliveriesQuery.data?.map((delivery) => (
                            <DeliveryRow key={delivery.id} delivery={delivery} />
                          ))
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
