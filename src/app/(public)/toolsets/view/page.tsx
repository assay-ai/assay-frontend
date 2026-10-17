"use client";

import { PublicToolsetView } from "@/components/toolsets/public-toolsets";

/**
 * `/toolsets/view?handle=&slug=[&v=]` and `/toolsets/view#token=[&v=]` — a
 * shared tool set's page, where a browser opening its MCP URL lands (design
 * spec §7.4). The link-only token stays in the fragment.
 */
export default function SharedToolsetPage() {
  return <PublicToolsetView />;
}
