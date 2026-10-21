"use client";

import { useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { ToolsetPage } from "@/components/toolsets/toolset-editor";
import { ToolsetsView } from "@/components/toolsets/toolsets-view";

/**
 * Controls › Tool sets. `/toolsets/mine` lists them; `?id=` opens one, and
 * `?slug=` is where a browser opening `/my/{slug}` on the MCP host lands
 * (other accounts see "Not found"). Query strings, not segments: the app is
 * a static export.
 */
function MyToolsets() {
  const params = useSearchParams();
  const id = params.get("id");
  const slug = params.get("slug");
  const v = Number(params.get("v"));
  if (id || slug) return <ToolsetPage id={id} slug={slug} free={params.get("free") === "1"} version={Number.isInteger(v) && v > 0 ? v : null} />;
  return <ToolsetsView />;
}

export default function MyToolsetsPage() {
  return (
    <React.Suspense fallback={<PageState kind="loading" rows={4} label="Loading your tool sets" />}>
      <MyToolsets />
    </React.Suspense>
  );
}
