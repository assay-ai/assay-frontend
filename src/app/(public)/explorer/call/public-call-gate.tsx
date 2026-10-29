"use client";

import * as React from "react";

import { MissingRecord } from "@/components/record/record-gate";
import { usePublicCallId } from "@/hooks/usePublicCallId";

/** `RecordGate` for an id carried in the path (`/explorer/call/<id>`) rather than the query string. */
export function PublicCallGate({ children }: { children: React.ReactNode }) {
  const id = usePublicCallId();
  if (!id.trim()) return <MissingRecord record="call" backHref="/catalogue" backLabel="See all tools" />;
  return <>{children}</>;
}
