import { CircleCheck, FlaskConical } from "lucide-react";
import { notFound } from "next/navigation";

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

/**
 * Tool contract and policy — route
 * `/catalogue/[toolId]`.
 *
 * The reader is a data
 * company with no agent story, asking whether their licence survives our
 * retention and whether the schema fits. So the page is two answers and no
 * decoration — the field-by-field contract on the left, and the arithmetic of
 * the one field they probably cannot supply on the right.
 *
 * **This screen renders design-fixture data.** There is no public catalogue in
 * the backend: no `catalogue` controller exists, no service in `src/services/`
 * reaches one, and `outputSchema` / rule weights / `passThreshold` are exposed
 * by no endpoint at any scope, let alone an anonymous one. The numbers below
 * are transcribed from the design frame character for character rather than
 * invented, and there is deliberately no fetch here to be swapped later.
 *
 * Because the fixture is the design's, it covers exactly the one tool the
 * design draws. Any other `toolId` 404s rather than re-labelling `search_web`'s
 * contract with someone else's name.
 */

interface SchemaField {
  id: string;
  field: string;
  type: string;
  required: string;
  readBy: string;
  weight: string;
}

interface ArithmeticLine {
  key: string;
  value: string;
  /** The design rules a line off above the two conclusions, and only those. */
  concluding?: boolean;
  /** `Verdict`'s value is the only figure the design paints green. */
  tone?: "pass";
}

interface DemandLine {
  key: string;
  value: string;
}

interface ToolContract {
  /** Page title, verbatim. */
  title: string;
  /** Page sub, verbatim. */
  sub: string;
  schema: SchemaField[];
  arithmetic: {
    title: string;
    description: string;
    lines: ArithmeticLine[];
    note: string;
  };
  demand: {
    title: string;
    description: string;
    lines: DemandLine[];
  };
}

const FIXTURES: Record<string, ToolContract> = {
  search_web: {
    title: "search_web · tool contract",
    sub: "the annotation is the point: “your schema wants publishedAt and we don't have dates” becomes an arithmetic decision you can make alone",
    schema: [
      {
        id: "results",
        field: "results",
        type: "array",
        required: "yes",
        readBy: "MIN_ARRAY_LENGTH",
        weight: "0.40",
      },
      {
        id: "results.url",
        field: "results[].url",
        type: "string",
        required: "yes",
        readBy: "REQUIRED_FIELDS · VALID_URL · NO_DUPLICATES",
        weight: "0.50",
      },
      {
        id: "results.title",
        field: "results[].title",
        type: "string",
        required: "yes",
        readBy: "REQUIRED_FIELDS",
        weight: "0.20",
      },
      {
        id: "results.snippet",
        field: "results[].snippet",
        type: "string",
        required: "no",
        readBy: "— not read by any rule",
        weight: "0.00",
      },
      {
        id: "results.publishedAt",
        field: "results[].publishedAt",
        type: "string",
        required: "no",
        readBy: "FRESHNESS (30d)",
        weight: "0.10",
      },
    ],
    arithmetic: {
      title: "If you cannot map publishedAt",
      description: "the decision, as arithmetic",
      lines: [
        { key: "Maximum score", value: "1.00" },
        { key: "FRESHNESS forfeited", value: "−0.10" },
        { key: "Your score", value: "0.90", concluding: true },
        { key: "passThreshold", value: "0.70" },
        { key: "Verdict", value: "PASS", concluding: true, tone: "pass" },
      ],
      note: "Declaring publishedAt unmappable costs 0.10 of 1.00. You would still pass at 0.90.",
    },
    demand: {
      title: "Demand",
      description: "30 days",
      lines: [
        { key: "Paid calls", value: "2.18M" },
        { key: "Free calls", value: "0.94M" },
        { key: "Bindings", value: "11" },
        { key: "Price range", value: "$0.0080 – $0.0120" },
        { key: "Median observed fail", value: "3.1%" },
        { key: "p90 observed fail", value: "8.4%" },
      ],
    },
  },
};

/**
 * The design paints the field name in `$text-01` at 600 and every other cell in
 * `$text-02` at 400. `Table` renders one weight and one colour for all mono
 * cells, so the two treatments are re-applied per cell rather than by editing
 * the shared component.
 */
const SCHEMA_COLUMNS: TableColumn<SchemaField>[] = [
  {
    key: "field",
    header: "Field",
    mono: true,
    cell: (row) => <span className="font-semibold text-01">{row.field}</span>,
  },
  {
    key: "type",
    header: "Type",
    width: 120,
    align: "end",
    mono: true,
    cell: (row) => <span className="text-02">{row.type}</span>,
  },
  {
    key: "required",
    header: "Required",
    width: 110,
    align: "end",
    mono: true,
    cell: (row) => <span className="text-02">{row.required}</span>,
  },
  {
    key: "readBy",
    header: "Read by",
    width: 340,
    align: "end",
    mono: true,
    cell: (row) => <span className="text-02">{row.readBy}</span>,
  },
  {
    key: "weight",
    header: "Weight",
    width: 100,
    align: "end",
    mono: true,
    cell: (row) => <span className="text-02">{row.weight}</span>,
  },
];

/** Static export: one page per fixture, written at build time; any other id is a 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(FIXTURES).map((toolId) => ({ toolId }));
}

export default async function ToolContractPage({
  params,
}: {
  params: Promise<{ toolId: string }>;
}) {
  const { toolId } = await params;
  const contract = FIXTURES[decodeURIComponent(toolId)];

  if (!contract) notFound();

  const { arithmetic, demand } = contract;

  return (
    <div className="flex w-full flex-1 flex-col gap-[18px] px-7 py-[22px]">
      <header className="flex w-full flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">{contract.title}</h1>
          <p className="text-mono-12 font-mono text-03">{contract.sub}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {/*
            The design draws this button and names no destination for it. The
            tester is a console screen behind provider auth and no route
            resolves to it yet, so this stays a control with no navigation
            rather than a guess at a URL.
          */}
          <Button variant="secondary" icon={<FlaskConical />}>
            Open in tester
          </Button>
        </div>
      </header>

      <div className="flex w-full flex-1 flex-col items-stretch gap-4 tablet:flex-row tablet:items-start">
        <Panel className="min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>outputSchema</PanelTitle>
              <PanelDescription>
                each field annotated with the rules that read it and the weight they carry
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          {/*
            The design draws this table 908px wide inside a 1440px frame, and
            its four fixed columns already account for 718 of that. Below about
            1210px of viewport the flexible Field column would be squeezed to
            nothing and the field names — the substance of the page — would
            vanish silently. The frame has no narrow variant, so the honest
            degradation is to hold the design's geometry and scroll it.

            906, not the design's 908: the design tool's `strokeAlignment: "inner"` does
            not shrink a frame's content box, so the canvas computes 928 − 20 of
            padding and ignores the panel's own 1px border on each side. The
            browser does not. 906 is the width at which 1440 produces no
            scrollbar; the Field column lands at 164 rather than 166.
          */}
          <PanelBody className="overflow-x-auto px-2.5 pb-2.5 pt-1.5">
            <Table
              columns={SCHEMA_COLUMNS}
              rows={contract.schema}
              caption="outputSchema"
              className="min-w-[906px]"
            />
          </PanelBody>
        </Panel>

        <div className="flex w-full shrink-0 flex-col gap-4 tablet:w-[440px]">
          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>{arithmetic.title}</PanelTitle>
                <PanelDescription>{arithmetic.description}</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="px-5 pb-[18px] pt-2">
              {arithmetic.lines.map((line) => (
                <div
                  key={line.key}
                  className={
                    line.concluding
                      ? "flex w-full items-center justify-between gap-4 border-t border-02 pt-3"
                      : "flex w-full items-center justify-between gap-4 py-[9px]"
                  }
                >
                  <span
                    className={
                      line.concluding ? "text-label-13 text-01" : "text-body-13 text-01"
                    }
                  >
                    {line.key}
                  </span>
                  <span
                    className={[
                      "font-mono font-semibold",
                      line.concluding ? "text-mono-md" : "text-mono-sm",
                      line.tone === "pass" ? "text-success-600" : "text-01",
                    ].join(" ")}
                  >
                    {line.value}
                  </span>
                </div>
              ))}

              {/* Flush against the Verdict line — the design's Body frame has gap 0. */}
              <div className="flex w-full items-start gap-2.5 rounded-lg border border-success-20 bg-success-10 p-[15px]">
                <CircleCheck
                  className="size-[15px] shrink-0 text-success-600"
                  aria-hidden="true"
                />
                <p className="text-body-13 leading-[1.6] text-success-700">{arithmetic.note}</p>
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader>
              <PanelTitles>
                <PanelTitle>{demand.title}</PanelTitle>
                <PanelDescription>{demand.description}</PanelDescription>
              </PanelTitles>
            </PanelHeader>
            <PanelBody className="px-5 pb-[18px] pt-2">
              {demand.lines.map((line) => (
                <div
                  key={line.key}
                  className="flex w-full items-center justify-between gap-4 py-[9px]"
                >
                  <span className="text-body-13 text-02">{line.key}</span>
                  <span className="text-mono-13 font-mono font-semibold text-01">
                    {line.value}
                  </span>
                </div>
              ))}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}
