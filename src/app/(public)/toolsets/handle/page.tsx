"use client";

import { PublicHandleView } from "@/components/toolsets/public-toolsets";

/** `/toolsets/handle?handle=` — a public name's page, where a browser opening `/@{handle}` on the MCP host lands (design spec §7.4). */
export default function PublicNamePage() {
  return <PublicHandleView />;
}
