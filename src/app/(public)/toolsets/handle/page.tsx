"use client";

import { SharedServerPage } from "@/components/toolsets/shared-server-page";

/** `/toolsets/handle?handle=` — where a browser opening `/@{handle}` on the MCP host lands (design spec §7.4). */
export default function PublicNamePage() {
  return <SharedServerPage page="handle" />;
}
