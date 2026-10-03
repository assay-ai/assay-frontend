"use client";

import { Plus, Target } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Table, type TableColumn } from "@/components/ui/table";

import { CATALOGUE_DEMAND_FIXTURE, type CatalogueDemandRow } from "./catalogue-fixture";

/**
 * Catalogue and demand — route `/catalogue`.
 *
 * The Public Top Bar is applied by `(public)/layout.tsx`; this file
 * is the frame's `Body` only — vertical, gap 18, padding [22, 28].
 *
 * **The rows are a design fixture, not live data.** There is no catalogue
 * endpoint in the API, public or otherwise. Read `./catalogue-fixture.ts`
 * before touching anything here — it names the exact endpoint that would have
 * to exist.
 *
 * Three things the design draws that this page therefore cannot do:
 *
 * 1. **No row links to `/catalogue/[toolId]`.** Three reasons, in
 *    order of weight. The design draws no link affordance on any row — no
 *    caret, no chevron, no underline, no `href` on the tool-name text node.
 *    There is no tool id to link with: `toolId` is a bare UUID the API never
 *    returns alongside a name, so the fixture's `id` is the tool NAME, which
 *    is a fabricated route parameter. And the tool contract screen as built resolves exactly one
 *    slug — `/catalogue/search_web` — and `notFound()`s every other, so
 *    linking all seven rows would ship six 404s.
 * 2. **"Request a tool" has no destination.** The design draws the button
 *    (a secondary the design with a `plus` icon) but no target frame and
 *    no endpoint exists to receive a request. It is rendered as drawn and does
 *    nothing.
 * 3. **No empty state.** The design draws none for this screen — no the design
 *    ref anywhere in the design — and with a static fixture no empty path is
 *    reachable. The nearest thing the design does draw is a *row-level* empty:
 *    `transcribe_audio`, demand with zero bindings, which is the page's point.
 */
export default function CataloguePage() {
  const columns: TableColumn<CatalogueDemandRow>[] = React.useMemo(
    () => [
      {
        key: "tool",
        header: "Tool",
        mono: true,
        // The design paints the tool name `$text-01` at weight 600 while every
        // figure to its right is `$text-02` at normal weight. Table's own
        // `valueClass` paints all cells `text-01`/normal, so the tone is set
        // per cell here rather than by patching a shared component.
        cell: (row) => <span className="font-semibold">{row.tool}</span>,
      },
      {
        key: "paidCalls30d",
        header: "Paid calls 30d",
        width: 150,
        align: "end",
        mono: true,
        cell: (row) => <span className="text-02">{row.paidCalls30d}</span>,
      },
      {
        key: "freeCalls30d",
        header: "Free calls 30d",
        width: 150,
        align: "end",
        mono: true,
        cell: (row) => <span className="text-02">{row.freeCalls30d}</span>,
      },
      {
        key: "bindings",
        header: "Bindings",
        width: 110,
        align: "end",
        mono: true,
        cell: (row) => <span className="text-02">{row.bindings}</span>,
      },
      {
        key: "priceRange",
        header: "Price range",
        width: 170,
        align: "end",
        mono: true,
        // `transcribe_audio`'s "no provider serves this yet" is 27 characters of
        // 13px JetBrains Mono (~210px) inside a 170px column. The design lets it
        // overflow into the neighbouring cells; Table clips and ellipsises it.
        // `title` keeps the string readable on hover.
        cell: (row) => (
          <span className="text-02" title={row.priceRange}>
            {row.priceRange}
          </span>
        ),
      },
      {
        key: "observedFail",
        header: "Observed fail",
        width: 140,
        align: "end",
        mono: true,
        cell: (row) => <span className="text-02">{row.observedFail}</span>,
      },
      {
        key: "firstParty",
        header: "First-party",
        width: 130,
        align: "end",
        mono: true,
        cell: (row) => <span className="text-02">{row.firstParty}</span>,
      },
    ],
    []
  );

  return (
    <div className="flex w-full flex-1 flex-col gap-[18px] px-7 py-[22px]">
      {/* Page Header the design */}
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Where the demand is</h1>
          <p className="text-mono-12 font-mono text-03">
            30-day volume across all bindings · absence of supply is the most interesting thing
            on this page
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <Button variant="secondary" icon={<Plus />}>
            Request a tool
          </Button>
        </div>
      </div>

      {/* Panel — "Tools by demand" */}
      <Panel>
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Tools by demand</PanelTitle>
            <PanelDescription>
              first-party share is shown, because a tool we serve ourselves is a different
              proposition
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-2.5 pb-2.5 pt-1.5">
          <Table columns={columns} rows={CATALOGUE_DEMAND_FIXTURE} caption="Tools by demand" />
        </PanelBody>
      </Panel>

      {/* Note the design */}
      <div className="flex w-full items-start gap-2.5 rounded-lg border border-teal-20 bg-teal-10 p-[15px]">
        <Target
          aria-hidden="true"
          className="h-[15px] w-[15px] shrink-0 text-teal-600"
          strokeWidth={1.5}
        />
        <p className="min-w-0 flex-1 text-body-13 text-01">
          transcribe_audio has demand recorded against it and no binding. A schema already
          exists — the first provider to list it takes all of it.
        </p>
      </div>
    </div>
  );
}
