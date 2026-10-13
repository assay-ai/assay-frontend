"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { stampUtc } from "@/features/g34a/stats";
import { toolRequestOwnerLabel, toolRequestStateLine } from "@/features/provider-tool-requests/state";
import { isHttpsUrl } from "@/features/provider-tool-requests/url";
import type { CursorPage } from "@/interfaces/api";
import type { ToolRequest } from "@/interfaces/provider-tool-requests";
import { ApiError } from "@/libs/ApiClient";
import { createToolRequest, listToolRequests } from "@/services/provider-tool-requests.service";
import { toast } from "@/utils/toast";

/**
 * Tool request (MVP) — route `/provider/tool-requests`.
 *
 * At MVP this is a form that creates a ticket with a named owner and a
 * two-working-day first response, and a page that says plainly that we author
 * tools today and how long that takes; a proposal workflow waits until
 * reviewers exist. So: a form, a queue, and this page's own header copy — no schema
 * editor, no review rounds, no revision history, no accept-into-catalogue
 * path. `PATCH` does not exist on this controller; answering a ticket is an
 * operator action on a different surface (`OperatorToolRequestsController`),
 * not something this screen can do.
 *
 * ## Header and banner copy
 *
 * Taken verbatim from the design frame:
 * - Subtitle: "MVP is a queue with a named owner and a two-working-day first
 *   response — not a proposal workflow."
 * - Banner: "We author tools today. A provider who writes a schema and hears
 *   nothing is a worse outcome than one who was told no, so the proposal
 *   workflow does not ship before the reviewers exist." Split across
 *   `Banner`'s `title`/`description` slots — the component has no single
 *   free-flowing paragraph prop, so the first sentence is the title and the
 *   rest is the description; nothing in the text was altered.
 *
 * ## Three form prompts, two wire fields
 *
 * The frame draws three text prompts — "Proposed tool name", "What it does,
 * in one sentence", "Why a per-call price is truthful for it" — but
 * `CreateToolRequestBodyDto` has exactly `title`, `description`,
 * `upstreamUrl?`, `expectedMonthlyCalls?`. There is no second free-text field
 * to hold the pricing-rationale prompt, so both content prompts are folded
 * into one `description` string at submit time, each under its own heading.
 * Nothing is dropped; the wire just has nowhere else to put it.
 *
 * The frame does not draw `upstreamUrl` or `expectedMonthlyCalls` at all —
 * both are added here as clearly-optional fields because they are part of
 * `POST /tool-requests`'s body, and a form that could never set an optional field the wire accepts
 * would silently drop capability the backend supports.
 *
 * ## The "Owner" column
 *
 * `ownerOperatorId` is a bare uuid, `null` until an operator's first
 * response assigns one, and no operator-name endpoint exists to
 * read. The design's example rows show something that reads like an
 * email (`product@…`) — there is no such field on the wire. This renders the
 * id itself (shortened) or "unassigned", never an invented name. See
 * `toolRequestOwnerLabel`.
 *
 * ## The "State" column
 *
 * See `toolRequestStateLine`'s docstring for why `ACKNOWLEDGED` does not
 * reuse the frame's "in schema review" copy.
 *
 * ## Export overlap
 *
 * The frame's "The queue" table has two text layers rendered on top of each
 * other for the Owner/State columns. Read carefully, the three rows appear to be:
 * `transcribe_audio` / `product@…` / `first response due 2026-08-13`,
 * `ocr_document` / `product@…` / `in schema review`,
 * `geocode_address` / `declined@…` or `product@…` / `declined — overlaps
 * query_blockchain`. This is ambiguous enough to be a guess rather than a
 * read, and is shown as such.
 */

const LIST_LIMIT = 20;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-label-13 text-01">{children}</span>;
}

export default function ToolRequestsPage() {
  const queryClient = useQueryClient();

  const [title, setTitle] = React.useState("");
  const [whatItDoes, setWhatItDoes] = React.useState("");
  const [pricingRationale, setPricingRationale] = React.useState("");
  const [upstreamUrl, setUpstreamUrl] = React.useState("");
  const [expectedMonthlyCalls, setExpectedMonthlyCalls] = React.useState("");
  const [formError, setFormError] = React.useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["provider", "tool-requests", "list"],
    queryFn: () => listToolRequests({ limit: LIST_LIMIT }),
    retry: 0,
  });

  const items: ToolRequest[] = listQuery.data?.items ?? [];

  const create = useMutation({
    mutationFn: createToolRequest,
    onSuccess: (created) => {
      queryClient.setQueryData(["provider", "tool-requests", "detail", created.id], created);
      /*
        Seeded directly rather than invalidated. `GET /tool-requests` is
        HTTP-cached for ~10s server-side (the same defect the SLA screen's
        pause/resume works around) — an invalidate-triggered refetch right
        after this POST is served the pre-write list, and the new ticket
        would appear to vanish for up to 10 seconds. Measured on the running
        API: a refetch immediately after a 201 returned the old, one-row
        list; a plain `curl` a few seconds later returned the real two-row
        list. Prepending the server's own response avoids depending on that
        window at all.
      */
      queryClient.setQueryData(
        ["provider", "tool-requests", "list"],
        (old: CursorPage<ToolRequest> | undefined) =>
          old ? { ...old, items: [created, ...old.items] } : old
      );
      setTitle("");
      setWhatItDoes("");
      setPricingRationale("");
      setUpstreamUrl("");
      setExpectedMonthlyCalls("");
      setFormError(null);
      toast.success(`Filed — first response due ${stampUtc(created.firstResponseDueAt)} UTC`);
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? `${e.code} · ${e.message}` : "The request could not be filed.");
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);

    if (!title.trim() || !whatItDoes.trim()) {
      setFormError("Proposed tool name and what it does are both required.");
      return;
    }

    const description = pricingRationale.trim()
      ? `What it does: ${whatItDoes.trim()}\n\nWhy a per-call price is truthful for it: ${pricingRationale.trim()}`
      : whatItDoes.trim();

    if (upstreamUrl.trim() && !isHttpsUrl(upstreamUrl.trim())) {
      setFormError("Upstream URL must be a valid https:// address.");
      return;
    }

    let monthlyCalls: number | undefined;
    if (expectedMonthlyCalls.trim()) {
      const parsed = Number(expectedMonthlyCalls.trim());
      if (!Number.isInteger(parsed) || parsed < 0) {
        setFormError("Expected monthly calls must be a whole number, zero or more.");
        return;
      }
      monthlyCalls = parsed;
    }

    create.mutate({
      title: title.trim(),
      description,
      upstreamUrl: upstreamUrl.trim() || undefined,
      expectedMonthlyCalls: monthlyCalls,
    });
  };

  const columns: TableColumn<ToolRequest & { id: string }>[] = [
    {
      key: "request",
      header: "Request",
      cell: (row) => (
        <Link href={`/provider/tool-requests/${row.id}`} className="font-mono text-mono-13 text-01 hover:underline">
          {row.title}
        </Link>
      ),
    },
    {
      key: "owner",
      header: "Owner",
      width: 140,
      align: "start",
      cell: (row) => toolRequestOwnerLabel(row),
    },
    {
      key: "state",
      header: "State",
      align: "start",
      noTruncate: true,
      cell: (row) => toolRequestStateLine(row),
    },
  ];

  return (
    <>
      <header className="flex w-full flex-col items-start gap-4 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Request a tool</h1>
          <p className="text-body-sm text-03">
            every request gets a named owner and a first response within two working days
          </p>
        </div>
        <Button
          type="submit"
          form="tool-request-form"
          icon={<Send aria-hidden="true" />}
          loading={create.isPending}
        >
          Submit request
        </Button>
      </header>

      <Banner
        tone="warning"
        title="We author tools today."
        description="You cannot publish your own tool definition yet. Tell us what you need below and we will review your request."
      />

      <section className="flex w-full flex-col items-start gap-4 tablet:flex-row">
        <Panel className="w-full min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Your request</PanelTitle>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-4 p-4 tablet:p-5">
            <form id="tool-request-form" onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
              <Field
                label="Proposed tool name"
                placeholder="transcribe_audio"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
                required
              />

              <label className="flex w-full flex-col gap-1.5">
                <FieldLabel>What it does, in one sentence</FieldLabel>
                <Textarea
                  placeholder="Returns a timestamped transcript for an audio URL."
                  value={whatItDoes}
                  onChange={(e) => setWhatItDoes(e.target.value)}
                  rows={2}
                  required
                />
              </label>

              <label className="flex w-full flex-col gap-1.5">
                <FieldLabel>Why a per-call price is truthful for it</FieldLabel>
                <Textarea
                  placeholder="Priced per minute of audio — this is a metered tool, so a single per-call price would not be fair."
                  value={pricingRationale}
                  onChange={(e) => setPricingRationale(e.target.value)}
                  rows={3}
                />
                <p className="text-body-xs text-03">
                  Metered tools are not listed in the catalogue yet, because a single per-call price would mislead.
                </p>
              </label>

              <Field
                label="Upstream URL (optional)"
                placeholder="https://api.example.com/v1/…"
                type="url"
                value={upstreamUrl}
                onChange={(e) => setUpstreamUrl(e.target.value)}
                hint="The API this would wrap, if there is one."
              />

              <Field
                label="Expected monthly calls (optional)"
                placeholder="40000"
                inputMode="numeric"
                value={expectedMonthlyCalls}
                onChange={(e) => setExpectedMonthlyCalls(e.target.value)}
                hint="Rough volume, if you know it."
              />

              {formError ? <p className="text-body-xs text-danger-600">{formError}</p> : null}
            </form>
          </PanelBody>
        </Panel>

        <Panel className="w-full tablet:w-[420px] tablet:shrink-0">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>The queue</PanelTitle>
              <PanelDescription>named owner, stated turnaround</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-5">
            {listQuery.isLoading ? (
              <p className="text-body-13 text-03">Loading…</p>
            ) : listQuery.isError ? (
              <p className="text-body-13 text-danger-600">
                The queue could not be loaded.{" "}
                {listQuery.error instanceof ApiError ? listQuery.error.message : ""}
              </p>
            ) : items.length === 0 ? (
              <EmptyState
                title="No requests filed yet"
                description="File a request on the left. It creates a ticket with a named owner and a two-working-day first response — nothing here reviews a schema."
              />
            ) : (
              <Table columns={columns} rows={items} caption="Filed tool requests" />
            )}
          </PanelBody>
        </Panel>
      </section>
    </>
  );
}
