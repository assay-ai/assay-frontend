"use client";

import { ArrowRight, Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { StatusChip } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { REPLY_PROMISE, ToolRequestSheet } from "@/features/provider-tool-requests/request-sheet";
import type { CatalogueTool, ToolBindingSummary } from "@/interfaces";
import { routes } from "@/libs/routes";
import { cn } from "@/utils";

import { bindingStatusChip } from "../binding-header";
import { isFixtureTool } from "../tool-name";

import { needsLine, returnsLine } from "./seeds";

export function matchesTool(tool: Pick<CatalogueTool, "name" | "description">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${tool.name} ${tool.description}`.toLowerCase().includes(needle);
}

/**
 * Stage 1: pick the catalogue tool your API implements. Cards in plain words
 * (what it returns, what it needs), test fixtures hidden, a tool you already
 * list opens that listing instead, and a way out when the tool is missing.
 */
export function ToolStage({
  tools,
  isLoading,
  error,
  onRetry,
  boundByTool,
  selectedId,
  onPick,
}: {
  tools: readonly CatalogueTool[];
  isLoading: boolean;
  error: boolean;
  onRetry: () => void;
  boundByTool: ReadonlyMap<string, ToolBindingSummary>;
  selectedId: string | null;
  onPick: (tool: CatalogueTool) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [requestOpen, setRequestOpen] = React.useState(false);
  const listable = React.useMemo(() => tools.filter((tool) => !isFixtureTool(tool)), [tools]);
  const visible = listable.filter((tool) => matchesTool(tool, query));

  return (
    <section aria-labelledby="tool-stage-title" className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="tool-stage-title" className="text-label-md text-01">
          How do you want to list your API?
        </h2>
        <p className="text-body-13 text-02">
          Agents call tools by what they do. Two equal ways in: answer a tool agents already call, or publish your API as a new tool.
        </p>
      </div>

      {/* Two equal choices, always offered — not only when the catalogue is empty (onboarding wave 2, item 2). */}
      <div className="grid w-full grid-cols-1 gap-3 tablet:grid-cols-2" data-testid="listing-choice">
        <div className="flex flex-col gap-1 rounded-lg border border-primary-500 bg-primary-5 p-4">
          <span className="text-label-sm text-01">Pick a tool from the catalogue</span>
          <p className="text-body-13 text-02">Your API answers a tool that is already listed. Pick it below; next you connect your API and run a test.</p>
        </div>
        <div className="flex flex-col gap-2 rounded-lg border border-01 bg-01 p-4">
          <span className="text-label-sm text-01">Publish your own API as a new tool</span>
          <p className="text-body-13 text-02">Your own name, description and fields. Nobody has to add it to the catalogue first.</p>
          <div className="mt-auto pt-1">
            <Button size="sm" variant="secondary" asChild>
              <Link href="/provider/apis/new">
                Publish your API
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <h3 className="text-label-13 text-01">Pick a tool from the catalogue</h3>

      <label className="flex w-full items-center gap-2 rounded-md border border-02 bg-01 px-3 py-2.5 focus-within:border-primary-500 tablet:max-w-[420px]">
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-03" />
        <span className="sr-only">Search tools</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tools, e.g. weather"
          className="w-full min-w-0 bg-transparent text-body-13 text-01 outline-none placeholder:text-03"
        />
      </label>

      {isLoading ? (
        <PageState kind="loading" rows={4} label="Loading the tool catalogue" />
      ) : error ? (
        <PageState kind="error" description="The tool catalogue could not be loaded." onRetry={onRetry} />
      ) : visible.length === 0 ? (
        <PageState
          kind="empty"
          title={query ? `No tool matches “${query}”` : "No tools to list yet"}
          description={`Publish your own API as a tool now, or ask us to add one. ${REPLY_PROMISE}`}
          action={{ label: "Request a tool", onClick: () => setRequestOpen(true) }}
          secondaryAction={{ label: "Publish your API", href: "/provider/apis/new" }}
        />
      ) : (
        <ul className="grid w-full grid-cols-1 gap-3 tablet:grid-cols-2">
          {visible.map((tool) => {
            const bound = boundByTool.get(tool.id);
            const selected = tool.id === selectedId;
            const returns = returnsLine(tool);
            const needs = needsLine(tool);
            return (
              <li key={tool.id}>
                <div
                  className={cn(
                    "flex h-full w-full flex-col gap-2 rounded-lg border p-4",
                    selected ? "border-primary-500 bg-primary-5" : "border-01 bg-01",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-label-sm text-01">{tool.name}</span>
                    {bound ? <StatusChip status={bindingStatusChip(bound.status)} detail="already listed" /> : null}
                  </div>
                  <p className="text-body-13 text-02">{tool.description}</p>
                  {returns ? <p className="text-body-xs text-03">{returns}</p> : null}
                  {needs ? <p className="text-body-xs text-03">{needs}</p> : null}
                  <div className="mt-auto pt-1">
                    {bound ? (
                      <Button variant="secondary" size="sm" asChild>
                        <Link href={bound.status === "DRAFT" ? routes.bindingWizard(bound.id) : routes.binding(bound.id)}>
                          {bound.status === "DRAFT" ? "Continue this draft" : "Open your listing"}
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      </Button>
                    ) : (
                      <Button size="sm" variant={selected ? "primary" : "secondary"} onClick={() => onPick(tool)}>
                        {selected ? "Selected · continue" : "Use this tool"}
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-body-13 text-02">
        Can&apos;t find your tool?{" "}
        <button type="button" onClick={() => setRequestOpen(true)} className="text-primary-600 underline-offset-2 hover:underline">
          Request it
        </button>
        . {REPLY_PROMISE}
      </p>

      <ToolRequestSheet open={requestOpen} onOpenChange={setRequestOpen} initialName={query.trim()} />
    </section>
  );
}
