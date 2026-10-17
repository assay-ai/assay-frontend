"use client";

import { SharedServerPage } from "@/components/toolsets/shared-server-page";

/**
 * `/toolsets/view?handle=&slug=[&v=]` and `/toolsets/view#token=[&v=]` — where a
 * browser opening a shared tool set's MCP URL lands (design spec §7.4).
 */
export default function SharedToolsetPage() {
  return <SharedServerPage page="view" />;
}
